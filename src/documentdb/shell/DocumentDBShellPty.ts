/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, UserCancelledError } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { randomUUID } from 'crypto';
import * as vscode from 'vscode';
import { classifyCommand, extractRunCommandName } from '../../utils/classifyCommand';
import { ClustersClient } from '../ClustersClient';
import { CredentialCache } from '../CredentialCache';
import { deserializeResultForSchema, feedResultToSchemaStore } from '../feedResultToSchemaStore';
import { type SerializableExecutionResult } from '../playground/workerTypes';
import { SchemaStore } from '../SchemaStore';
import { getHostsFromConnectionString } from '../utils/connectionStringHelpers';
import { addDomainInfoToProperties } from '../utils/getClusterMetadata';
import { getClosingBrackets } from './bracketDepthCounter';
import { colorizeShellInput } from './highlighting/colorizeShellInput';
import { SettingsHintError } from './SettingsHintError';
import { type CompletionResult, ShellCompletionProvider } from './ShellCompletionProvider';
import { findCommonPrefix, renderCompletionList } from './ShellCompletionRenderer';
import { ShellGhostText } from './ShellGhostText';
import { ShellInputHandler } from './ShellInputHandler';
import { extractErrorCode, ShellOutputFormatter } from './ShellOutputFormatter';
import { type ShellConnectionInfo, type ShellSessionCallbacks, ShellSessionManager } from './ShellSessionManager';
import { ShellSpinner } from './ShellSpinner';
import {
    ACTION_LINE_PREFIX,
    PLAYGROUND_ACTION_PREFIX,
    SETTINGS_ACTION_PREFIX,
    getRegisteredShellTerminals,
    type ShellTerminalInfo,
    unregisterShellTerminal,
} from './ShellTerminalLinkProvider';

/**
 * Configuration for the interactive shell Pseudoterminal.
 */
export interface DocumentDBShellPtyOptions {
    /** Connection parameters for the shell session. */
    readonly connectionInfo: ShellConnectionInfo;
    /** Optional command to pre-fill in the input line after initialization (not executed). */
    readonly initialInput?: string;
}

/**
 * VS Code Pseudoterminal implementation for the DocumentDB Interactive Shell.
 *
 * Provides a REPL experience within a VS Code terminal tab:
 * - Prompt with current database name
 * - Line editing (insert, delete, cursor movement)
 * - Command history (Up/Down arrows)
 * - JavaScript evaluation via the shell-runtime worker
 * - Result formatting with ANSI colors
 * - Shell commands: help, exit, quit, cls, clear, show dbs, use <db>, it
 */
export class DocumentDBShellPty implements vscode.Pseudoterminal {
    private readonly _writeEmitter = new vscode.EventEmitter<string>();
    private readonly _closeEmitter = new vscode.EventEmitter<number | void>();
    private readonly _nameEmitter = new vscode.EventEmitter<string>();

    readonly onDidWrite: vscode.Event<string> = this._writeEmitter.event;
    readonly onDidClose: vscode.Event<number | void> = this._closeEmitter.event;
    readonly onDidChangeName: vscode.Event<string> = this._nameEmitter.event;

    private readonly _sessionManager: ShellSessionManager;
    private readonly _inputHandler: ShellInputHandler;
    private readonly _outputFormatter: ShellOutputFormatter;
    private readonly _connectionInfo: ShellConnectionInfo;

    /** Current database name — updated when `use <db>` changes it. */
    private _currentDatabase: string;
    /** Cached username from initialization (used for terminal tab title). */
    private _username: string | undefined;
    /** Whether the shell is currently evaluating a command. */
    private _evaluating = false;
    /** Whether the shell has been closed. */
    private _closed = false;
    /** Whether the current evaluation was cancelled by Ctrl+C. */
    private _interrupted = false;
    /** Spinner shown during long-running evaluations. */
    private _spinner: ShellSpinner | undefined;
    /** The terminal instance this PTY is attached to (set via {@link setTerminal}). */
    private _terminal: vscode.Terminal | undefined;
    /** Terminal width in columns (used for completion rendering). */
    private _columns: number = 80;
    /** Completion provider for tab completion and ghost text. */
    private readonly _completionProvider: ShellCompletionProvider;
    /** Ghost text manager for inline suggestions. */
    private readonly _ghostText: ShellGhostText;
    /** Timer for debounced ghost text evaluation. */
    private _ghostTextTimer: ReturnType<typeof setTimeout> | undefined;
    /** Whether a completion list is currently displayed below the prompt. */
    private _completionListVisible: boolean = false;
    /** Whether the current ghost text is an informational hint (not insertable). */
    private _ghostTextIsHint: boolean = false;
    /** Optional initial input to pre-fill after initialization. */
    private _initialInput: string | undefined;

    // ─── Telemetry tracking ──────────────────────────────────────────────────

    /** Unique session ID for correlating all events within this shell session. */
    private readonly _shellSessionId: string = randomUUID();
    /** Running count of commands evaluated in this session (for commandIndex measurement). */
    private _commandCount: number = 0;
    /** Whether the session was successfully initialized (for guarding sessionEnd emission). */
    private _sessionStarted: boolean = false;

    constructor(options: DocumentDBShellPtyOptions) {
        this._connectionInfo = options.connectionInfo;
        this._currentDatabase = options.connectionInfo.databaseName;
        this._initialInput = options.initialInput;

        this._completionProvider = new ShellCompletionProvider();
        this._ghostText = new ShellGhostText();

        const sessionCallbacks: ShellSessionCallbacks = {
            onConsoleOutput: (output: string) => {
                // Erase the spinner character before writing console output
                // so the two don't collide. The spinner re-renders itself
                // on the next interval tick automatically.
                if (this._spinner?.isVisible) {
                    this._spinner.hide();
                }
                this.writeOutput(output);
            },
            onWorkerExit: (_exitCode: number) => {
                if (!this._closed) {
                    this.writeOutput(
                        '\r\n' +
                            this._outputFormatter.formatError(l10n.t('Shell session ended unexpectedly.')) +
                            '\r\n',
                    );
                    this._closeEmitter.fire(1);
                }
            },
            onReconnecting: () => {
                if (this._spinner) {
                    this._spinner.setLabel(l10n.t('Reconnecting...'));
                }
            },
            onReconnected: () => {
                if (this._spinner) {
                    this._spinner.setLabel(undefined);
                }
            },
        };

        this._sessionManager = new ShellSessionManager(options.connectionInfo, sessionCallbacks);

        this._outputFormatter = new ShellOutputFormatter();

        this._inputHandler = new ShellInputHandler({
            write: (data: string) => this._writeEmitter.fire(data),
            onLine: (line: string) => void this.handleLineInput(line),
            onInterrupt: () => this.handleInterrupt(),
            onContinuation: () => this.showContinuationPrompt(),
            colorize: (input: string) => {
                if (!this.isColorEnabled()) {
                    return input;
                }
                return colorizeShellInput(input);
            },
            onTab: (buffer: string, cursor: number) => this.handleTab(buffer, cursor),
            onBufferChange: (buffer: string, cursor: number) => this.handleBufferChange(buffer, cursor),
            onAcceptGhostText: () => this.handleAcceptGhostText(),
        });
    }

    // ─── Pseudoterminal interface ────────────────────────────────────────────

    open(initialDimensions: vscode.TerminalDimensions | undefined): void {
        // Track terminal width for completion rendering and wrap-aware re-rendering
        if (initialDimensions) {
            this._columns = initialDimensions.columns;
            this._inputHandler.setColumns(initialDimensions.columns);
        }

        // Disable input during initialization to prevent race conditions
        this._inputHandler.setEnabled(false);

        // Display welcome banner
        this.writeLine(
            this._outputFormatter.formatSystemMessage(
                l10n.t('DocumentDB Shell: {0}', this._connectionInfo.clusterDisplayName),
            ),
        );

        // Show a labeled spinner during connection
        this._spinner = new ShellSpinner(
            (data) => this._writeEmitter.fire(data),
            this.isColorEnabled(),
            0,
            l10n.t('Connecting and authenticating...'),
        );
        this._spinner.start();

        void this.initializeSession();
    }

    close(): void {
        this._closed = true;
        this._spinner?.stop();
        this._spinner = undefined;
        if (this._ghostTextTimer) {
            clearTimeout(this._ghostTextTimer);
            this._ghostTextTimer = undefined;
        }

        // ── Telemetry: shell session ended ───────────────────────────────
        // Lightweight close marker — NO summary properties.
        // Session depth (commands, errors) is derived from per-eval events
        // via MAX(commandIndex) GROUP BY shellSessionId.
        // This event exists solely to measure start-vs-close ratio
        // (how often users close cleanly vs. just killing VS Code).
        // Only emit if the session was successfully started — otherwise
        // we'd produce unpaired sessionEnd events on connection failure.
        if (this._sessionStarted) {
            void callWithTelemetryAndErrorHandling('shell.sessionEnd', async (context) => {
                context.errorHandling.suppressDisplay = true;
                context.telemetry.properties.shellSessionId = this._shellSessionId;
            });
        }

        this._sessionManager.dispose();
        this._writeEmitter.dispose();
        this._closeEmitter.dispose();
        this._nameEmitter.dispose();
        if (this._terminal) {
            unregisterShellTerminal(this._terminal);
            this._terminal = undefined;
        }
    }

    /**
     * Associate this PTY with its terminal instance.
     * Called by the command handler after `createTerminal()`.
     */
    setTerminal(terminal: vscode.Terminal): void {
        this._terminal = terminal;
    }

    /**
     * Returns current shell metadata for the terminal link provider and debug stats.
     */
    getTerminalInfo(): ShellTerminalInfo {
        return {
            clusterId: this._connectionInfo.clusterId,
            clusterDisplayName: this._connectionInfo.clusterDisplayName,
            activeDatabase: this._sessionManager.activeDatabase,
            isInitialized: this._sessionManager.isInitialized,
            isEvaluating: this._evaluating,
            workerState: this._sessionManager.workerState,
            authMethod: this._sessionManager.authMethod,
            username: this._username,
        };
    }

    handleInput(data: string): void {
        // Detect multi-line paste: a single handleInput call with multiple characters
        // containing newlines. Single keystrokes are always length 1 (or short escape
        // sequences that never contain \r or \n).
        if (data.length > 1 && /[\r\n]/.test(data) && this._inputHandler.isEnabled) {
            void this.handleMultiLinePaste(data);
            return;
        }

        // Clear ghost text before processing input (except for Right Arrow and Tab
        // which are handled by the input handler's escape sequence processing)
        if (data !== '\x1b[C' && data !== '\x09') {
            this._ghostText.clear((d) => this._writeEmitter.fire(d));
            this._ghostTextIsHint = false;
        }

        // Dismiss completion list on any input
        this._completionListVisible = false;

        this._inputHandler.handleInput(data);
    }

    /**
     * Called when the terminal dimensions change.
     */
    setDimensions(dimensions: vscode.TerminalDimensions): void {
        this._columns = dimensions.columns;
        this._inputHandler.setColumns(dimensions.columns);
    }

    // ─── Private: Multi-line paste handling ──────────────────────────────────

    /**
     * Handle pasted text that contains multiple lines.
     *
     * Depending on the `documentDB.shell.multiLinePasteBehavior` setting, either:
     * - Asks the user how to process the text (default)
     * - Joins lines into a single expression
     * - Runs each line independently (raw shell behavior)
     */
    private async handleMultiLinePaste(data: string): Promise<void> {
        // Normalize line endings and split
        const lines = data.split(/\r\n|\r|\n/).filter((l) => l.trim().length > 0);

        // If only one non-empty line after splitting, process normally
        if (lines.length <= 1) {
            this.processInputDirectly(data);
            return;
        }

        const behavior = vscode.workspace
            .getConfiguration('documentDB.shell')
            .get<string>('multiLinePasteBehavior', 'ask');

        if (behavior === 'executeAsOne') {
            this.processInputDirectly(this.joinPastedLines(lines) + '\r');
            return;
        }

        if (behavior === 'runLineByLine') {
            this.processInputDirectly(data);
            return;
        }

        // 'ask' — show QuickPick, but only if VS Code's built-in multi-line paste
        // warning is disabled.  When their dialog is active ('auto' or 'always'),
        // the user already had a chance to cancel or "Paste as one line", so
        // showing a second dialog would be redundant.
        // 'alwaysAsk' — always show our dialog regardless of VS Code's setting.
        if (behavior === 'ask') {
            const vscodePasteWarning = vscode.workspace
                .getConfiguration('terminal.integrated')
                .get<string>('enableMultiLinePasteWarning', 'auto');

            if (vscodePasteWarning !== 'never') {
                // VS Code already prompted — run line by line (the user chose "Paste")
                this.processInputDirectly(data);
                return;
            }
        }

        // 'ask' with VS Code dialog disabled, or 'alwaysAsk' — show our own
        // Disable input while the dialog is open to prevent typing
        this._inputHandler.setEnabled(false);

        try {
            const picked = await vscode.window.showQuickPick(
                [
                    {
                        label: l10n.t('Execute as One'),
                        detail: l10n.t('Lines will be joined into a single expression and executed.'),
                        id: 'join',
                    },
                    {
                        label: l10n.t('Run as Is'),
                        detail: l10n.t('Each line will be run independently.'),
                        id: 'lineByLine',
                    },
                    {
                        label: l10n.t('Cancel'),
                        detail: l10n.t('Discard the pasted input.'),
                        id: 'cancel',
                    },
                    {
                        label: '',
                        kind: vscode.QuickPickItemKind.Separator,
                    },
                    {
                        label: l10n.t('Configure in Settings'),
                        detail: l10n.t('Open settings to change the default behavior.'),
                        id: 'settings',
                    },
                ],
                {
                    title: l10n.t('How to process your multi-line text?'),
                    placeHolder: l10n.t('{0} lines detected in pasted text', lines.length),
                },
            );

            if (!picked || !('id' in picked)) {
                // Dismissed — do nothing
                return;
            }

            // Re-enable input before processing the chosen action
            this._inputHandler.setEnabled(true);

            switch (picked.id) {
                case 'join':
                    this.processInputDirectly(this.joinPastedLines(lines) + '\r');
                    break;
                case 'lineByLine':
                    this.processInputDirectly(data);
                    break;
                case 'settings':
                    void vscode.commands.executeCommand(
                        'workbench.action.openSettings',
                        'documentDB.shell.multiLinePasteBehavior',
                    );
                    break;
                case 'cancel':
                default:
                    break;
            }
        } finally {
            if (!this._evaluating) {
                this._inputHandler.setEnabled(true);
            }
        }
    }

    /**
     * Join pasted lines into a single expression.
     * Lines that start with `.` (method chaining) are joined directly;
     * other continuation lines are joined with a space.
     */
    private joinPastedLines(lines: string[]): string {
        if (lines.length === 0) {
            return '';
        }

        let result = lines[0];
        for (let i = 1; i < lines.length; i++) {
            const trimmed = lines[i].trimStart();
            if (trimmed.startsWith('.')) {
                // Method chaining — join directly (no space needed)
                result += trimmed;
            } else {
                // Other continuation — join with a space
                result += ' ' + trimmed;
            }
        }
        return result;
    }

    /**
     * Process input through the normal path (clear ghost text, dismiss
     * completion, forward to input handler).
     */
    private processInputDirectly(data: string): void {
        this._ghostText.clear((d) => this._writeEmitter.fire(d));
        this._ghostTextIsHint = false;
        this._completionListVisible = false;
        this._inputHandler.handleInput(data);
    }

    // ─── Private: Session initialization ─────────────────────────────────────

    private async initializeSession(): Promise<void> {
        try {
            const metadata = await this._sessionManager.initialize();

            // Stop the connection spinner
            this._spinner?.stop();
            this._spinner = undefined;

            // ── Telemetry: shell session started ─────────────────────────
            this._sessionStarted = true;
            void callWithTelemetryAndErrorHandling('shell.sessionStart', async (context) => {
                context.errorHandling.suppressDisplay = true;
                context.telemetry.properties.shellSessionId = this._shellSessionId;
                context.telemetry.properties.authMethod = metadata.authMechanism;
                context.telemetry.properties.isEmulator = metadata.isEmulator ? 'true' : 'false';
                context.telemetry.properties.hasInitialInput = this._initialInput ? 'true' : 'false';
                context.telemetry.measurements.activeShellSessionCount = getRegisteredShellTerminals().length;

                // Link to server metadata via connectionCorrelationId
                try {
                    const client = ClustersClient.getExistingClient(this._connectionInfo.clusterId);
                    if (client?.connectionCorrelationId) {
                        context.telemetry.properties.connectionCorrelationId = client.connectionCorrelationId;
                    }
                } catch {
                    // Best-effort — client may not exist yet
                }

                // Domain info — privacy-safe hashed host data
                const domainProps: Record<string, string | undefined> = {};
                this.collectShellDomainTelemetry(domainProps);
                Object.assign(context.telemetry.properties, domainProps);
            });

            // Display connection summary
            const authLabel = metadata.authMechanism === 'MicrosoftEntraID' ? 'Entra ID' : 'SCRAM';
            const hostLabel = metadata.isEmulator ? l10n.t('{0} (Emulator)', metadata.host) : metadata.host;

            this.writeLine(this._outputFormatter.formatSystemMessage(l10n.t('Connected to: {0}', hostLabel)));

            if (metadata.username) {
                this.writeLine(
                    this._outputFormatter.formatSystemMessage(
                        l10n.t(
                            'User: {0} | Authentication: {1} | Database: {2}',
                            metadata.username,
                            authLabel,
                            this._currentDatabase,
                        ),
                    ),
                );
            } else {
                this.writeLine(
                    this._outputFormatter.formatSystemMessage(
                        l10n.t('Authentication: {0} | Database: {1}', authLabel, this._currentDatabase),
                    ),
                );
            }

            this.writeLine(this._outputFormatter.formatSystemMessage(l10n.t('Type "help" for available commands.')));
            this.writeLine('');

            // Re-enable input after successful initialization
            this._inputHandler.setEnabled(true);

            // Cache the username when available, but always refresh the tab
            // title so database changes remain visible for all auth modes.
            this._username = metadata.username;
            this.updateTerminalTitle();

            this.showPrompt();

            // Pre-fill initial input (e.g., from Collection View → Shell navigation)
            if (this._initialInput) {
                this._inputHandler.insertText(this._initialInput);
                this._initialInput = undefined;
            }
        } catch (error: unknown) {
            // Stop the connection spinner on failure
            this._spinner?.stop();
            this._spinner = undefined;

            const rawMessage = error instanceof Error ? error.message : String(error);
            // Strip technical error codes for clean user-facing output;
            // the extracted code is preserved for future telemetry.
            const { message: errorMessage } = extractErrorCode(rawMessage);
            this.writeLine(this._outputFormatter.formatError(l10n.t('Failed to connect: {0}', errorMessage)));

            // Show a hint line and clickable settings link for errors that reference a VS Code setting
            if (error instanceof SettingsHintError) {
                this.writeLine(
                    this._outputFormatter.formatSystemMessage(
                        `${error.settingsHint} ${SETTINGS_ACTION_PREFIX}[${error.settingKey}]`,
                    ),
                );
            }

            this._inputHandler.setEnabled(true);
            this._closeEmitter.fire(1);
        }
    }

    // ─── Private: Line handling ──────────────────────────────────────────────

    private async handleLineInput(line: string): Promise<void> {
        const trimmed = line.trim();

        // Empty line — just show a new prompt
        if (trimmed.length === 0) {
            this.showPrompt();
            return;
        }

        // Disable input while evaluating
        this._evaluating = true;
        this._interrupted = false;
        this._inputHandler.setEnabled(false);

        // Start the spinner — it appears after a short delay so fast
        // commands complete without any visual noise.
        this._spinner = new ShellSpinner((data) => this._writeEmitter.fire(data), this.isColorEnabled());
        this._spinner.start();

        try {
            await this.evaluateInput(trimmed);
        } catch (error: unknown) {
            this.handleEvalError(error);
        } finally {
            // Stop the spinner before writing results or the next prompt.
            this._spinner?.stop();
            this._spinner = undefined;

            this._evaluating = false;

            // If Ctrl+C was pressed, the interrupt handler already re-enabled
            // input and showed a prompt — don't duplicate.
            if (!this._interrupted) {
                this._inputHandler.setEnabled(true);

                if (!this._closed) {
                    this.showPrompt();

                    // Process any input that was queued during execution
                    // (e.g., remaining lines from a multi-line paste).
                    this._inputHandler.processPendingInput();
                }
            }

            this._interrupted = false;
        }
    }

    private async evaluateInput(input: string): Promise<void> {
        this._commandCount++;
        const commandIndex = this._commandCount;
        const commandCategory = classifyCommand(input);

        // Wrap the entire eval in callWithTelemetryAndErrorHandling so the
        // framework automatically captures duration, result, and error details
        // in a single event — no need for separate success/failure blocks.
        await callWithTelemetryAndErrorHandling('shell.eval', async (context) => {
            context.errorHandling.suppressDisplay = true;
            context.errorHandling.rethrow = true; // let the outer catch handle display

            // ── Pre-eval telemetry ───────────────────────────────────────
            context.telemetry.properties.shellSessionId = this._shellSessionId;
            context.telemetry.properties.commandCategory = commandCategory;
            context.telemetry.measurements.commandIndex = commandIndex;

            if (commandCategory === 'runCommand') {
                context.telemetry.properties.runCommandName = extractRunCommandName(input) ?? 'unknown';
            }

            let result: SerializableExecutionResult;
            try {
                result = await this._sessionManager.evaluate(input);
            } catch (evalError) {
                // Ctrl+C kills the worker, producing a "Worker terminated" error.
                // Re-classify as user cancellation for accurate telemetry.
                if (this._interrupted) {
                    throw new UserCancelledError('shell.eval');
                }
                throw evalError;
            }

            // Stop the spinner before writing any output so the spinner
            // character doesn't collide with the result text.
            this._spinner?.stop();
            this._spinner = undefined;

            // If this eval was cancelled by Ctrl+C, skip output — the interrupt
            // handler already showed ^C and a new prompt.
            if (this._interrupted) {
                return;
            }

            // ── Post-eval telemetry ──────────────────────────────────────
            context.telemetry.properties.resultType = result.type ?? 'null';

            // Check for special result types (intercepted commands)
            if (this.handleSpecialResult(result)) {
                return;
            }

            // Update the current database if the result source indicates a change
            this.updateDatabaseFromResult(result);

            // Format and display the result
            const formatted = this._outputFormatter.formatResult(result);
            if (formatted.length > 0) {
                this.writeOutput(formatted + '\r\n');
            }

            // Show "Open in Collection View" action line for query results with a namespace
            this.maybeWriteActionLine(result);

            // Feed query result documents to SchemaStore for field completions.
            // This runs asynchronously after output is displayed — schema feeding
            // is non-blocking and failure is non-critical.
            this.maybeFeedSchemaStore(result);
        });
    }

    /**
     * Handles display of eval errors in the terminal.
     * Called by handleLineInput when evaluateInput throws.
     */
    private handleEvalError(error: unknown): void {
        // Stop the spinner before writing error output.
        this._spinner?.stop();
        this._spinner = undefined;

        // Suppress errors from intentional Ctrl+C cancellation — the interrupt
        // handler already showed ^C and a new prompt.
        if (this._interrupted) {
            return;
        }

        const rawMessage = error instanceof Error ? error.message : String(error);
        // Strip technical error codes for clean user-facing output;
        // the extracted code is preserved for future telemetry.
        const { message: errorMessage } = extractErrorCode(rawMessage);
        this.writeLine(this._outputFormatter.formatError(errorMessage));

        // Show a hint line and clickable settings link for errors that reference a VS Code setting
        if (error instanceof SettingsHintError) {
            this.writeLine(
                this._outputFormatter.formatSystemMessage(
                    `${error.settingsHint} ${SETTINGS_ACTION_PREFIX}[${error.settingKey}]`,
                ),
            );
        }

        // Detect query timeout errors (error code 50: MaxTimeMSExpired / ExceededTimeLimit)
        if (error instanceof Error && 'code' in error && (error as { code: unknown }).code === 50) {
            this.writeLine(
                this._outputFormatter.formatSystemMessage(
                    l10n.t('Tip: use .maxTimeMS() to increase the time limit for this query.'),
                ),
            );
        }
    }

    /**
     * Handle special intercepted results (exit, clear).
     * Returns true if the result was handled (no further output needed).
     */
    private handleSpecialResult(result: SerializableExecutionResult): boolean {
        if (result.type === 'exit') {
            this._closed = true;
            this._sessionManager.dispose();
            this._closeEmitter.fire(0);
            return true;
        }

        if (result.type === 'clear') {
            // Clear visible display, scrollback buffer, and move cursor home
            this._writeEmitter.fire('\x1b[2J\x1b[3J\x1b[H');
            return true;
        }

        return false;
    }

    /**
     * Update the current database name if the eval result indicates a database switch.
     * This happens when the user runs `use <db>`.
     *
     * Detection strategy:
     * 1. Check source namespace from @mongosh (set on query results)
     * 2. Parse the printable value for "switched to db <name>" pattern
     *    (@mongosh returns this as a string with type: null for primitives)
     */
    private updateDatabaseFromResult(result: SerializableExecutionResult): void {
        let newDb: string | undefined;

        if (result.source?.namespace?.db && result.source.namespace.db !== this._currentDatabase) {
            newDb = result.source.namespace.db;
        }

        // Detect `use <db>` results — @mongosh returns the string "switched to db <name>"
        // The type is null (not 'string') because @mongosh uses null for all primitives.
        // The printable is EJSON-serialized, so we parse it back.
        if (typeof result.printable === 'string') {
            try {
                const parsed = JSON.parse(result.printable) as unknown;
                if (typeof parsed === 'string') {
                    const match = /^switched to db (.+)$/.exec(parsed);
                    if (match?.[1]) {
                        newDb = match[1];
                    }
                }
            } catch {
                // Not JSON — ignore
            }
        }

        if (newDb) {
            this._currentDatabase = newDb;
            this._sessionManager.setActiveDatabase(newDb);
            this.updateTerminalTitle();
        }
    }

    /**
     * Update the terminal tab title to reflect the current database.
     */
    private updateTerminalTitle(): void {
        if (this._username) {
            this._nameEmitter.fire(
                l10n.t(
                    'DocumentDB: {0}@{1}/{2}',
                    this._username,
                    this._connectionInfo.clusterDisplayName,
                    this._currentDatabase,
                ),
            );
        } else {
            this._nameEmitter.fire(
                l10n.t('DocumentDB: {0}/{1}', this._connectionInfo.clusterDisplayName, this._currentDatabase),
            );
        }
    }

    // ─── Private: Terminal output helpers ────────────────────────────────────

    private showPrompt(): void {
        const prompt = `${this._currentDatabase}> `;
        this._inputHandler.setPromptWidth(prompt.length);
        this._inputHandler.resetLine();
        this._ghostText.reset();
        this._completionListVisible = false;

        // Cancel any pending ghost text timer — its closure captures the old
        // buffer/cursor and would re-render ghost text on the fresh prompt.
        if (this._ghostTextTimer) {
            clearTimeout(this._ghostTextTimer);
            this._ghostTextTimer = undefined;
        }

        this._writeEmitter.fire(prompt);
    }

    /**
     * Show a continuation prompt for incomplete multi-line expressions.
     * Uses a dashed vertical line (┆) to match the playground gutter's
     * block indicator for a unified visual language.
     * Called by ShellInputHandler when an incomplete expression is detected.
     */
    private showContinuationPrompt(): void {
        const prompt = '┆ > ';
        this._inputHandler.setPromptWidth(prompt.length);
        this._writeEmitter.fire(prompt);
    }

    /**
     * Write a line to the terminal (with \r\n).
     */
    private writeLine(text: string): void {
        this._writeEmitter.fire(text + '\r\n');
    }

    /**
     * Write raw text to the terminal (no newline appended).
     * Converts \n to \r\n for proper terminal rendering.
     */
    private writeOutput(text: string): void {
        // Terminals expect \r\n for line breaks — convert bare \n
        const normalized = text.replace(/\r?\n/g, '\r\n');
        this._writeEmitter.fire(normalized);
    }

    // ─── Private: Interrupt handling ─────────────────────────────────────────

    private handleInterrupt(): void {
        if (this._evaluating) {
            // Mark as interrupted so evaluateInput() knows to suppress its
            // error/result output and handleLineInput() skips the double prompt.
            this._interrupted = true;

            // Stop the spinner immediately on Ctrl+C.
            this._spinner?.stop();
            this._spinner = undefined;

            // Kill the worker to cancel a running evaluation.
            // The _terminatingIntentionally flag in WorkerSessionManager prevents
            // the onWorkerExit callback from showing "ended unexpectedly".
            this._sessionManager.killWorker();
            this._evaluating = false;
            this._inputHandler.setEnabled(true);
            this.writeLine('');
            this.writeLine(this._outputFormatter.formatSystemMessage(l10n.t('^C')));
            this.showPrompt();
        } else {
            // Not evaluating — just clear the current line and show a new prompt
            this.writeLine('');
            this.showPrompt();
        }
    }

    // ─── Private: Action line ("Open in Collection View") ────────────────────

    /**
     * If the result came from a query with a known namespace (db + collection),
     * write clickable action lines below the output.
     *
     * The line uses the {@link ACTION_LINE_PREFIX} and {@link PLAYGROUND_ACTION_PREFIX}
     * sentinels matched by {@link ShellTerminalLinkProvider}. Database and collection
     * names are wrapped in brackets to handle names with special characters.
     *
     * Format: ` ↗ Collection View [db.collection]   ↗ Query Playground [db.collection]`
     */
    private maybeWriteActionLine(result: SerializableExecutionResult): void {
        const ns = result.source?.namespace;
        if (!ns?.db || !ns?.collection) {
            return;
        }

        // Only show for result types that represent query output
        if (result.type !== 'Cursor' && result.type !== 'Document') {
            return;
        }

        // Don't show for suppressed output (e.g., print(), side-effect-only)
        if (result.printableIsUndefined) {
            return;
        }

        const nsLabel = `[${ns.db}.${ns.collection}]`;
        const actionText = `${ACTION_LINE_PREFIX}${nsLabel}  ${PLAYGROUND_ACTION_PREFIX}${nsLabel}`;
        this.writeLine(this._outputFormatter.formatSystemMessage(actionText));
    }

    /**
     * Feed query result documents to {@link SchemaStore} for field completions.
     *
     * Deserializes the EJSON printable string back to raw objects (preserving BSON
     * types) and delegates to the shared {@link feedResultToSchemaStore} utility.
     * Runs asynchronously and never blocks the prompt — failures are silently ignored.
     */
    private maybeFeedSchemaStore(result: SerializableExecutionResult): void {
        // Only Cursor and Document results with a namespace are worth parsing
        if (result.type !== 'Cursor' && result.type !== 'Document') {
            return;
        }
        if (!result.source?.namespace?.collection) {
            return;
        }

        void deserializeResultForSchema(result)
            .then((deserialized) => {
                feedResultToSchemaStore(deserialized, this._connectionInfo.clusterId);
            })
            .catch(() => {
                // Non-critical — schema feeding is best-effort
            });
    }

    // ─── Private: Tab completion ────────────────────────────────────────────

    /**
     * Handle Tab keypress — provide completions or accept ghost text.
     */
    private handleTab(buffer: string, cursor: number): void {
        // If insertable ghost text is visible (not a hint), accept it
        if (this._ghostText.isVisible && !this._ghostTextIsHint) {
            this.handleAcceptGhostText();
            return;
        }

        // Clear hint ghost text if visible (hints are not insertable)
        if (this._ghostText.isVisible) {
            this._ghostText.clear((d) => this._writeEmitter.fire(d));
            this._ghostTextIsHint = false;
        }

        const result = this.getCompletionResult(buffer, cursor);
        if (result.candidates.length === 0) {
            return;
        }

        if (result.candidates.length === 1) {
            // Single match — complete inline
            this.applySingleCompletion(result);
            return;
        }

        // Multiple matches — insert common prefix and show picker
        const commonExtra = findCommonPrefix(result.candidates, result.prefix);
        if (commonExtra.length > 0) {
            this._inputHandler.insertText(commonExtra);
        }

        // Render the completion list below the prompt
        const listOutput = renderCompletionList(result.candidates, this._columns);
        if (listOutput.length > 0) {
            this._writeEmitter.fire(listOutput);
            this._completionListVisible = true;

            // Rewrite the prompt + buffer so the user continues editing
            this._writeEmitter.fire('\r\n');
            this.rewriteCurrentLine();
        }
    }

    /**
     * Apply a single completion by inserting the remaining text.
     * When the insertText doesn't start with the typed prefix (e.g., bracket
     * notation, quoted field paths), replaces the prefix entirely.
     */
    private applySingleCompletion(result: CompletionResult): void {
        const candidate = result.candidates[0];

        // If insertText doesn't start with the typed prefix, replace
        // the prefix entirely. Covers bracket notation (db[re → 'restaurants']),
        // quoted field paths (address.ci → "address.city"), and
        // special-char collections (sto → ['stores (10)']).
        if (result.prefix.length > 0 && !candidate.insertText.startsWith(result.prefix)) {
            this._inputHandler.replaceText(result.prefix.length, candidate.insertText);
            return;
        }

        const remaining = candidate.insertText.slice(result.prefix.length);
        if (remaining.length > 0) {
            this._inputHandler.insertText(remaining);
        }
    }

    /**
     * Get completion result from the provider using current shell context.
     */
    private getCompletionResult(buffer: string, cursor: number): CompletionResult {
        return this._completionProvider.getCompletions(buffer, cursor, {
            clusterId: this._connectionInfo.clusterId,
            databaseName: this._currentDatabase,
        });
    }

    /**
     * Rewrite the prompt and current buffer after showing a completion list.
     * Uses the colorize callback (via renderCurrentLine) so highlighting is preserved.
     */
    private rewriteCurrentLine(): void {
        const prompt = `${this._currentDatabase}> `;
        this._inputHandler.setPromptWidth(prompt.length);
        this._writeEmitter.fire(prompt);
        this._inputHandler.renderCurrentLine();
    }

    // ─── Private: Ghost text ─────────────────────────────────────────────────

    /**
     * Handle buffer changes for ghost text evaluation.
     * Called after every character insertion or deletion.
     */
    private handleBufferChange(buffer: string, cursor: number): void {
        // Clear any pending ghost text timer
        if (this._ghostTextTimer) {
            clearTimeout(this._ghostTextTimer);
        }

        // Don't show ghost text during evaluation, multi-line mode, or when completion list is visible
        if (this._evaluating || this._inputHandler.isInMultiLineMode || this._completionListVisible) {
            return;
        }

        // Don't show ghost text if cursor is not at end of buffer
        if (cursor < buffer.length) {
            this._ghostText.clear((d) => this._writeEmitter.fire(d));
            return;
        }

        // Debounce ghost text evaluation (50ms)
        this._ghostTextTimer = setTimeout(() => {
            this._ghostTextTimer = undefined;
            this.evaluateGhostText(buffer, cursor);
        }, 50);
    }

    /**
     * Evaluate and show ghost text if there's a single obvious completion.
     */
    private evaluateGhostText(buffer: string, cursor: number): void {
        if (this._closed || this._evaluating) {
            return;
        }

        // Need at least 1 character to show ghost text
        if (buffer.trim().length === 0) {
            this._ghostText.clear((d) => this._writeEmitter.fire(d));
            return;
        }

        const result = this.getCompletionResult(buffer, cursor);

        if (result.candidates.length === 1 && result.prefix.length > 0) {
            const candidate = result.candidates[0];

            // Skip ghost text when insertText doesn't start with the typed prefix
            // (e.g., bracket notation, quoted field paths, special-char collections).
            // The visual would be misleading since the insertion replaces the prefix.
            if (!candidate.insertText.startsWith(result.prefix)) {
                this._ghostText.clear((d) => this._writeEmitter.fire(d));
                return;
            }

            // Single match with a typed prefix — show ghost text
            const remaining = candidate.insertText.slice(result.prefix.length);
            if (remaining.length > 0) {
                this._ghostTextIsHint = false;
                this._ghostText.show(remaining, (d) => this._writeEmitter.fire(d));
                return;
            }
        }

        // No completions inside a method argument — show schema hint only if
        // SchemaStore has no fields for this collection (not just a typo/no match)
        if (result.candidates.length === 0) {
            const ctx = this._completionProvider.detectContext(buffer, cursor);
            if (ctx.kind === 'method-argument') {
                const fields = SchemaStore.getInstance().getKnownFields(
                    this._connectionInfo.clusterId,
                    this._currentDatabase,
                    ctx.collectionName,
                );
                if (fields.length === 0) {
                    this.showSchemaHint(ctx.collectionName);
                    return;
                }
            }
        }

        // Fallback: suggest closing brackets when the buffer ends with a space
        // and has unclosed brackets/parens/braces.
        // e.g. `db.col.find({ _id: { $exists: true ` → ghost `}})`
        //
        // Skip when the last non-whitespace character indicates the user is
        // still typing a value, field, or operator (e.g. `:`, `,`, `{`, `.`).
        if (buffer.endsWith(' ')) {
            const trimmed = buffer.trimEnd();
            const lastCh = trimmed.length > 0 ? trimmed[trimmed.length - 1] : '';
            const expectsMoreInput = ':,([{.=+*/%!<>&|?~-';
            if (lastCh && !expectsMoreInput.includes(lastCh)) {
                const closing = getClosingBrackets(buffer);
                if (closing.length > 0) {
                    this._ghostTextIsHint = false;
                    this._ghostText.show(closing, (d) => this._writeEmitter.fire(d));
                    return;
                }
            }
        }

        this._ghostText.clear((d) => this._writeEmitter.fire(d));
    }

    /**
     * Show a hint as ghost text when no schema data is available for a collection.
     * The hint is non-insertable — pressing Tab or Right Arrow won't accept it.
     */
    private showSchemaHint(collectionName: string): void {
        const hint = `  🛈 Run db.${collectionName}.find() first for field suggestions`;
        this._ghostTextIsHint = true;
        this._ghostText.show(hint, (d) => this._writeEmitter.fire(d));
    }

    /**
     * Accept the currently displayed ghost text.
     * Called when the user presses Right Arrow at end of buffer or Tab with ghost visible.
     *
     * @returns the accepted text, or undefined if no ghost text was visible
     */
    private handleAcceptGhostText(): string | undefined {
        if (!this._ghostText.isVisible) {
            return undefined;
        }

        // Don't accept hint ghost text — it's informational only
        if (this._ghostTextIsHint) {
            this._ghostText.clear((d) => this._writeEmitter.fire(d));
            this._ghostTextIsHint = false;
            return undefined;
        }

        const ghostText = this._ghostText.currentText;
        // Clear ghost state and erase the dim rendering
        this._ghostText.clear((d) => this._writeEmitter.fire(d));

        if (ghostText) {
            // Insert the ghost text into the buffer through the input handler.
            // insertText handles buffer update + terminal echo in normal color.
            this._inputHandler.insertText(ghostText);
        }

        return ghostText;
    }

    // ─── Private: Settings ───────────────────────────────────────────────────

    private isColorEnabled(): boolean {
        const config = vscode.workspace.getConfiguration();
        return config.get<boolean>('documentDB.shell.display.colorSupport', true);
    }

    // ─── Private: Telemetry helpers ──────────────────────────────────────────

    /**
     * Collect domain info from cached credentials for telemetry.
     * Reuses the same hashing logic as the connection metadata telemetry.
     */
    private collectShellDomainTelemetry(properties: Record<string, string | undefined>): void {
        try {
            const credentials = CredentialCache.getCredentials(this._connectionInfo.clusterId);
            if (!credentials?.connectionString) {
                return;
            }
            const hosts = getHostsFromConnectionString(credentials.connectionString);
            addDomainInfoToProperties(hosts, properties);
        } catch {
            // Domain info is best-effort — don't fail telemetry if parsing fails
        }
    }
}
