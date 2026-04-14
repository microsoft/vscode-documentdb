/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { ext } from '../../extensionVariables';
import { type SerializableExecutionResult } from '../playground/workerTypes';
import { ShellInputHandler } from './ShellInputHandler';
import { ShellOutputFormatter } from './ShellOutputFormatter';
import { type ShellConnectionInfo, type ShellSessionCallbacks, ShellSessionManager } from './ShellSessionManager';
import { ShellSpinner } from './ShellSpinner';
import { ACTION_LINE_PREFIX, type ShellTerminalInfo, unregisterShellTerminal } from './ShellTerminalLinkProvider';

/**
 * Configuration for the interactive shell Pseudoterminal.
 */
export interface DocumentDBShellPtyOptions {
    /** Connection parameters for the shell session. */
    readonly connectionInfo: ShellConnectionInfo;
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

    constructor(options: DocumentDBShellPtyOptions) {
        this._connectionInfo = options.connectionInfo;
        this._currentDatabase = options.connectionInfo.databaseName;

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
        });
    }

    // ─── Pseudoterminal interface ────────────────────────────────────────────

    open(_initialDimensions: vscode.TerminalDimensions | undefined): void {
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
     * Returns current shell metadata for the terminal link provider.
     */
    getTerminalInfo(): ShellTerminalInfo {
        return {
            clusterId: this._connectionInfo.clusterId,
        };
    }

    handleInput(data: string): void {
        this._inputHandler.handleInput(data);
    }

    // ─── Private: Session initialization ─────────────────────────────────────

    private async initializeSession(): Promise<void> {
        try {
            const metadata = await this._sessionManager.initialize();

            // Stop the connection spinner
            this._spinner?.stop();
            this._spinner = undefined;

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
        } catch (error: unknown) {
            // Stop the connection spinner on failure
            this._spinner?.stop();
            this._spinner = undefined;

            const errorMessage = error instanceof Error ? error.message : String(error);
            this.writeLine(this._outputFormatter.formatError(l10n.t('Failed to connect: {0}', errorMessage)));
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
        try {
            const timeoutMs = this.getShellTimeoutMs();
            const result = await this._sessionManager.evaluate(input, timeoutMs);

            // Stop the spinner before writing any output so the spinner
            // character doesn't collide with the result text.
            this._spinner?.stop();
            this._spinner = undefined;

            // If this eval was cancelled by Ctrl+C, skip output — the interrupt
            // handler already showed ^C and a new prompt.
            if (this._interrupted) {
                return;
            }

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
        } catch (error: unknown) {
            // Stop the spinner before writing error output.
            this._spinner?.stop();
            this._spinner = undefined;

            // Suppress errors from intentional Ctrl+C cancellation — the interrupt
            // handler already showed ^C and a new prompt.
            if (this._interrupted) {
                return;
            }
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.writeLine(this._outputFormatter.formatError(errorMessage));
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
            // Write ANSI clear screen and cursor home
            this._writeEmitter.fire('\x1b[2J\x1b[H');
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
        this._writeEmitter.fire(prompt);
    }

    /**
     * Show a continuation prompt for incomplete multi-line expressions.
     * Uses midline ellipsis (⋯ >) for clean baseline alignment.
     * Called by ShellInputHandler when an incomplete expression is detected.
     */
    private showContinuationPrompt(): void {
        const prompt = '⋯ > ';
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
     * write a clickable action line below the output.
     *
     * The line uses the {@link ACTION_LINE_PREFIX} sentinel matched by
     * {@link ShellTerminalLinkProvider}. Database and collection names are
     * wrapped in brackets to handle names with special characters.
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

        const actionText = `${ACTION_LINE_PREFIX}[${ns.db}.${ns.collection}]`;
        this.writeLine(this._outputFormatter.formatSystemMessage(actionText));
    }

    // ─── Private: Settings ───────────────────────────────────────────────────

    private getShellTimeoutMs(): number {
        const config = vscode.workspace.getConfiguration();
        const timeoutSec = config.get<number>(ext.settingsKeys.shellTimeout, 30);
        return timeoutSec * 1000;
    }

    private isColorEnabled(): boolean {
        const config = vscode.workspace.getConfiguration();
        return config.get<boolean>('documentDB.shell.display.colorOutput', true);
    }
}
