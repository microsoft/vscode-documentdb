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

    readonly onDidWrite: vscode.Event<string> = this._writeEmitter.event;
    readonly onDidClose: vscode.Event<number | void> = this._closeEmitter.event;

    private readonly _sessionManager: ShellSessionManager;
    private readonly _inputHandler: ShellInputHandler;
    private readonly _outputFormatter: ShellOutputFormatter;
    private readonly _connectionInfo: ShellConnectionInfo;

    /** Current database name — updated when `use <db>` changes it. */
    private _currentDatabase: string;
    /** Whether the shell is currently evaluating a command. */
    private _evaluating = false;
    /** Whether the shell has been closed. */
    private _closed = false;

    constructor(options: DocumentDBShellPtyOptions) {
        this._connectionInfo = options.connectionInfo;
        this._currentDatabase = options.connectionInfo.databaseName;

        const sessionCallbacks: ShellSessionCallbacks = {
            onConsoleOutput: (output: string) => {
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
        };

        this._sessionManager = new ShellSessionManager(options.connectionInfo, sessionCallbacks);

        this._outputFormatter = new ShellOutputFormatter();

        this._inputHandler = new ShellInputHandler({
            write: (data: string) => this._writeEmitter.fire(data),
            onLine: (line: string) => void this.handleLineInput(line),
            onInterrupt: () => this.handleInterrupt(),
        });
    }

    // ─── Pseudoterminal interface ────────────────────────────────────────────

    open(_initialDimensions: vscode.TerminalDimensions | undefined): void {
        // Display welcome banner and start initialization
        this.writeLine(
            this._outputFormatter.formatSystemMessage(
                l10n.t('DocumentDB Shell — {0}', this._connectionInfo.clusterDisplayName),
            ),
        );
        this.writeLine(this._outputFormatter.formatSystemMessage(l10n.t('Authenticating and connecting...')));
        this.writeLine('');

        void this.initializeSession();
    }

    close(): void {
        this._closed = true;
        this._sessionManager.dispose();
    }

    handleInput(data: string): void {
        this._inputHandler.handleInput(data);
    }

    // ─── Private: Session initialization ─────────────────────────────────────

    private async initializeSession(): Promise<void> {
        try {
            const metadata = await this._sessionManager.initialize();

            // Display connection summary
            const authLabel = metadata.authMechanism === 'MicrosoftEntraID' ? 'Entra ID' : 'SCRAM';
            const hostLabel = metadata.isEmulator ? l10n.t('{0} (Emulator)', metadata.host) : metadata.host;

            this.writeLine(this._outputFormatter.formatSystemMessage(l10n.t('Connected to {0}', hostLabel)));
            this.writeLine(
                this._outputFormatter.formatSystemMessage(
                    l10n.t('Authentication: {0} | Database: {1}', authLabel, this._currentDatabase),
                ),
            );
            this.writeLine(this._outputFormatter.formatSystemMessage(l10n.t('Type "help" for available commands.')));
            this.writeLine('');
            this.showPrompt();
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.writeLine(this._outputFormatter.formatError(l10n.t('Failed to connect: {0}', errorMessage)));
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
        this._inputHandler.setEnabled(false);

        try {
            await this.evaluateInput(trimmed);
        } finally {
            this._evaluating = false;
            this._inputHandler.setEnabled(true);

            if (!this._closed) {
                this.showPrompt();
            }
        }
    }

    private async evaluateInput(input: string): Promise<void> {
        try {
            const timeoutMs = this.getShellTimeoutMs();
            const result = await this._sessionManager.evaluate(input, timeoutMs);

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
        } catch (error: unknown) {
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
        if (result.source?.namespace?.db && result.source.namespace.db !== this._currentDatabase) {
            this._currentDatabase = result.source.namespace.db;
        }

        // Detect `use <db>` results — @mongosh returns the string "switched to db <name>"
        // The type is null (not 'string') because @mongosh uses null for all primitives.
        // The printable is EJSON-serialized, so we parse it back.
        if (typeof result.printable === 'string') {
            try {
                const parsed = JSON.parse(result.printable) as unknown;
                if (typeof parsed === 'string') {
                    const match = /^switched to db (\S+)$/.exec(parsed);
                    if (match?.[1]) {
                        this._currentDatabase = match[1];
                    }
                }
            } catch {
                // Not JSON — ignore
            }
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
            // Kill the worker to cancel a running evaluation
            this._sessionManager.killWorker();
            this.writeLine('');
            this.writeLine(this._outputFormatter.formatSystemMessage(l10n.t('^C')));
        } else {
            // Not evaluating — just clear the current line and show a new prompt
            this.writeLine('');
            this.showPrompt();
        }
    }

    // ─── Private: Settings ───────────────────────────────────────────────────

    private getShellTimeoutMs(): number {
        const config = vscode.workspace.getConfiguration();
        const timeoutSec = config.get<number>(ext.settingsKeys.shellTimeout, 120);
        return timeoutSec * 1000;
    }
}
