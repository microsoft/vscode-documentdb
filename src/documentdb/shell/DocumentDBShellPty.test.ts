/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { DocumentDBShellPty, type DocumentDBShellPtyOptions } from './DocumentDBShellPty';
import { ShellSpinner } from './ShellSpinner';

// Mock ShellSessionManager
const mockInitialize = jest.fn().mockResolvedValue({
    host: 'test-host.documents.azure.com:10255',
    authMechanism: 'NativeAuth',
    isEmulator: false,
});
const mockEvaluate = jest.fn();
const mockDispose = jest.fn();
const mockKillWorker = jest.fn();
const mockSetActiveDatabase = jest.fn();

jest.mock('./ShellSessionManager', () => ({
    ShellSessionManager: jest.fn().mockImplementation((_connectionInfo, callbacks) => {
        // Store callbacks so tests can trigger events
        (mockInitialize as jest.Mock & { _callbacks?: unknown })._callbacks = callbacks;
        return {
            initialize: mockInitialize,
            evaluate: mockEvaluate,
            dispose: mockDispose,
            killWorker: mockKillWorker,
            setActiveDatabase: mockSetActiveDatabase,
            isInitialized: true,
        };
    }),
}));

describe('DocumentDBShellPty', () => {
    let pty: DocumentDBShellPty;
    let written: string;
    let closeCode: number | void | undefined;
    let terminalName: string | undefined;

    const defaultOptions: DocumentDBShellPtyOptions = {
        connectionInfo: {
            clusterId: 'test-cluster-id',
            clusterDisplayName: 'TestCluster',
            databaseName: 'testdb',
        },
    };

    beforeEach(() => {
        jest.clearAllMocks();
        written = '';
        closeCode = undefined;
        terminalName = undefined;

        // Mock settings
        jest.spyOn(vscode.workspace, 'getConfiguration').mockImplementation((section?: string) => {
            return {
                get: jest.fn((_key: string, defaultValue?: unknown) => {
                    if (section === undefined || section === '') {
                        if (_key === 'documentDB.shell.display.colorOutput') {
                            return false; // Disable colors for easier test assertions
                        }
                        if (_key === 'documentDB.timeout') {
                            return 120;
                        }
                    }
                    if (section === 'documentDB.shell' && _key === 'multiLinePasteBehavior') {
                        return 'runLineByLine'; // Default to line-by-line in tests for backward compat
                    }
                    return defaultValue;
                }),
            } as unknown as vscode.WorkspaceConfiguration;
        });

        pty = new DocumentDBShellPty(defaultOptions);

        // Subscribe to events
        pty.onDidWrite((data) => {
            written += data;
        });
        pty.onDidClose((code) => {
            closeCode = code;
        });
        pty.onDidChangeName((name) => {
            terminalName = name;
        });
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('open', () => {
        it('should display welcome banner', () => {
            pty.open(undefined);
            expect(written).toContain('DocumentDB Shell');
            expect(written).toContain('TestCluster');
        });

        it('should show spinner during connection and clear it after', async () => {
            // Slow down init so we can observe the spinner label
            let resolveInit!: (value: unknown) => void;
            mockInitialize.mockReturnValue(
                new Promise((resolve) => {
                    resolveInit = resolve;
                }),
            );
            pty.open(undefined);

            // Wait for the spinner's setTimeout(…, 0) to fire
            await new Promise((resolve) => setTimeout(resolve, 10));
            expect(written).toContain('Connecting and authenticating');

            // Resolve initialization
            resolveInit({
                host: 'test-host.documents.azure.com:10255',
                authMechanism: 'NativeAuth',
                isEmulator: false,
            });
            await new Promise((resolve) => setTimeout(resolve, 10));

            // Spinner output should be cleared; connection info should appear
            expect(written).toContain('Connected to');
        });

        it('should initialize session on open', () => {
            pty.open(undefined);
            expect(mockInitialize).toHaveBeenCalled();
        });

        it('should show prompt after successful connection', async () => {
            pty.open(undefined);
            // Wait for async init to complete
            await new Promise((resolve) => setTimeout(resolve, 10));
            expect(written).toContain('testdb> ');
            expect(written).toContain('Connected to');
            expect(written).toContain('SCRAM');
        });

        it('should show error and close on connection failure', async () => {
            mockInitialize.mockRejectedValue(new Error('Connection refused'));
            pty.open(undefined);
            await new Promise((resolve) => setTimeout(resolve, 10));
            expect(written).toContain('Failed to connect: Connection refused');
            expect(closeCode).toBe(1);
        });
    });

    describe('handleInput — line submission', () => {
        beforeEach(async () => {
            pty.open(undefined);
            await new Promise((resolve) => setTimeout(resolve, 10));
            written = ''; // Reset to capture only subsequent output
        });

        it('should show new prompt on empty Enter', async () => {
            pty.handleInput('\r');
            await new Promise((resolve) => setTimeout(resolve, 10));
            expect(written).toContain('testdb> ');
        });

        it('should evaluate non-empty input', async () => {
            mockEvaluate.mockResolvedValue({
                type: 'string',
                printable: '"hello"',
                durationMs: 5,
            });

            pty.handleInput('db.test.find()');
            pty.handleInput('\r');
            await new Promise((resolve) => setTimeout(resolve, 10));

            expect(mockEvaluate).toHaveBeenCalledWith('db.test.find()', expect.any(Number));
        });

        it('should display evaluation result', async () => {
            mockEvaluate.mockResolvedValue({
                type: 'string',
                printable: '"test result"',
                durationMs: 5,
            });

            pty.handleInput('db.test.find()');
            pty.handleInput('\r');
            await new Promise((resolve) => setTimeout(resolve, 10));

            expect(written).toContain('test result');
        });

        it('should display error message on evaluation failure', async () => {
            mockEvaluate.mockRejectedValue(new Error('Syntax error'));

            pty.handleInput('invalid{}');
            pty.handleInput('\r');
            await new Promise((resolve) => setTimeout(resolve, 10));

            expect(written).toContain('Syntax error');
        });

        it('should show prompt after evaluation completes', async () => {
            mockEvaluate.mockResolvedValue({
                type: null,
                printable: '"done"',
                durationMs: 1,
            });

            pty.handleInput('x');
            pty.handleInput('\r');
            await new Promise((resolve) => setTimeout(resolve, 10));

            // Count prompts — should have a new one after result
            const prompts = written.split('testdb> ');
            expect(prompts.length).toBeGreaterThanOrEqual(2);
        });
    });

    describe('special results', () => {
        beforeEach(async () => {
            pty.open(undefined);
            await new Promise((resolve) => setTimeout(resolve, 10));
            written = '';
        });

        it('should close terminal on exit result', async () => {
            mockEvaluate.mockResolvedValue({
                type: 'exit',
                printable: '""',
                durationMs: 0,
            });

            pty.handleInput('exit');
            pty.handleInput('\r');
            await new Promise((resolve) => setTimeout(resolve, 10));

            expect(closeCode).toBe(0);
            expect(mockDispose).toHaveBeenCalled();
        });

        it('should clear screen on clear result', async () => {
            mockEvaluate.mockResolvedValue({
                type: 'clear',
                printable: '""',
                durationMs: 0,
            });

            pty.handleInput('cls');
            pty.handleInput('\r');
            await new Promise((resolve) => setTimeout(resolve, 10));

            // ANSI clear screen sequence
            expect(written).toContain('\x1b[2J\x1b[H');
        });
    });

    describe('database switching', () => {
        beforeEach(async () => {
            pty.open(undefined);
            await new Promise((resolve) => setTimeout(resolve, 10));
            written = '';
        });

        it('should update prompt after use <db> result', async () => {
            mockEvaluate.mockResolvedValue({
                type: null,
                printable: JSON.stringify('switched to db newdb'),
                durationMs: 1,
            });

            pty.handleInput('use newdb');
            pty.handleInput('\r');
            await new Promise((resolve) => setTimeout(resolve, 10));

            expect(written).toContain('newdb> ');
        });

        it('should update terminal title after use <db> for Entra ID sessions', async () => {
            mockInitialize.mockResolvedValue({
                host: 'test-host.documents.azure.com:10255',
                authMechanism: 'MicrosoftEntraID',
                isEmulator: false,
                username: undefined,
            });

            pty = new DocumentDBShellPty(defaultOptions);
            pty.onDidWrite((data) => {
                written += data;
            });
            pty.onDidClose((code) => {
                closeCode = code;
            });
            pty.onDidChangeName((name) => {
                terminalName = name;
            });

            pty.open(undefined);
            await new Promise((resolve) => setTimeout(resolve, 10));

            mockEvaluate.mockResolvedValue({
                type: null,
                printable: JSON.stringify('switched to db newdb'),
                durationMs: 1,
            });

            pty.handleInput('use newdb');
            pty.handleInput('\r');
            await new Promise((resolve) => setTimeout(resolve, 10));

            expect(terminalName).toBe('DocumentDB: TestCluster/newdb');
        });
    });

    describe('print suppression', () => {
        beforeEach(async () => {
            pty.open(undefined);
            await new Promise((resolve) => setTimeout(resolve, 10));
            written = '';
        });

        it('should suppress null display when printableIsUndefined is true', async () => {
            mockEvaluate.mockResolvedValue({
                type: null,
                printable: 'null',
                durationMs: 1,
                printableIsUndefined: true,
            });

            pty.handleInput("print('hello')");
            pty.handleInput('\r');
            await new Promise((resolve) => setTimeout(resolve, 10));

            // Should NOT contain "null" in output (only the prompt)
            expect(written).not.toContain('null');
        });
    });

    describe('close', () => {
        it('should dispose session manager on close', () => {
            pty.open(undefined);
            pty.close();
            expect(mockDispose).toHaveBeenCalled();
        });

        it('should stop the spinner when closing during initialization', async () => {
            let resolveInit!: (value: unknown) => void;
            mockInitialize.mockReturnValue(
                new Promise((resolve) => {
                    resolveInit = resolve;
                }),
            );

            const stopSpy = jest.spyOn(ShellSpinner.prototype, 'stop');

            pty.open(undefined);
            await new Promise((resolve) => setTimeout(resolve, 10));

            const callsBeforeClose = stopSpy.mock.calls.length;
            pty.close();

            expect(stopSpy).toHaveBeenCalledTimes(callsBeforeClose + 1);

            resolveInit({
                host: 'test-host.documents.azure.com:10255',
                authMechanism: 'NativeAuth',
                isEmulator: false,
            });
        });
    });

    describe('Ctrl+C interrupt', () => {
        beforeEach(async () => {
            pty.open(undefined);
            await new Promise((resolve) => setTimeout(resolve, 10));
            written = '';
        });

        it('should show new prompt on Ctrl+C when not evaluating', () => {
            pty.handleInput('partial input');
            pty.handleInput('\x03'); // Ctrl+C
            expect(written).toContain('testdb> ');
        });
    });

    describe('action line — Open in Collection View', () => {
        beforeEach(async () => {
            pty.open(undefined);
            await new Promise((resolve) => setTimeout(resolve, 10));
            written = '';
        });

        it('should show action line after Cursor result with namespace', async () => {
            mockEvaluate.mockResolvedValue({
                type: 'Cursor',
                printable: '[{"name":"Alice"}]',
                durationMs: 5,
                source: { namespace: { db: 'mydb', collection: 'users' } },
            });

            pty.handleInput('db.users.find()');
            pty.handleInput('\r');
            await new Promise((resolve) => setTimeout(resolve, 10));

            expect(written).toContain('[mydb.users]');
        });

        it('should show action line after Document result with namespace', async () => {
            mockEvaluate.mockResolvedValue({
                type: 'Document',
                printable: '{"name":"Alice"}',
                durationMs: 5,
                source: { namespace: { db: 'mydb', collection: 'users' } },
            });

            pty.handleInput('db.users.findOne()');
            pty.handleInput('\r');
            await new Promise((resolve) => setTimeout(resolve, 10));

            expect(written).toContain('[mydb.users]');
        });

        it('should NOT show action line when namespace is missing', async () => {
            mockEvaluate.mockResolvedValue({
                type: 'Cursor',
                printable: '[{"x":1}]',
                durationMs: 5,
            });

            pty.handleInput('db.users.find()');
            pty.handleInput('\r');
            await new Promise((resolve) => setTimeout(resolve, 10));

            expect(written).not.toContain('[mydb');
        });

        it('should NOT show action line for non-query result types', async () => {
            mockEvaluate.mockResolvedValue({
                type: 'string',
                printable: '"hello"',
                durationMs: 5,
                source: { namespace: { db: 'mydb', collection: 'users' } },
            });

            pty.handleInput('db.users.count()');
            pty.handleInput('\r');
            await new Promise((resolve) => setTimeout(resolve, 10));

            expect(written).not.toContain('[mydb');
        });

        it('should NOT show action line for suppressed output', async () => {
            mockEvaluate.mockResolvedValue({
                type: 'Document',
                printable: 'null',
                durationMs: 5,
                printableIsUndefined: true,
                source: { namespace: { db: 'mydb', collection: 'users' } },
            });

            pty.handleInput('db.users.insertOne({})');
            pty.handleInput('\r');
            await new Promise((resolve) => setTimeout(resolve, 10));

            expect(written).not.toContain('[mydb');
        });

        it('should handle collection names with special characters', async () => {
            mockEvaluate.mockResolvedValue({
                type: 'Cursor',
                printable: '[{"x":1}]',
                durationMs: 5,
                source: { namespace: { db: 'mydb', collection: 'stores (10)' } },
            });

            pty.handleInput('db["stores (10)"].find()');
            pty.handleInput('\r');
            await new Promise((resolve) => setTimeout(resolve, 10));

            expect(written).toContain('[mydb.stores (10)]');
        });
    });

    describe('multi-line input', () => {
        beforeEach(async () => {
            pty.open(undefined);
            await new Promise((resolve) => setTimeout(resolve, 10));
            written = '';
        });

        it('should show continuation prompt for incomplete expression', () => {
            pty.handleInput('db.test.find({');
            pty.handleInput('\r');

            // All continuation prompt candidates end with ` > ` (baseline alignment testing)
            expect(written).toContain(' > ');
            expect(mockEvaluate).not.toHaveBeenCalled();
        });

        it('should evaluate complete multi-line expression', async () => {
            mockEvaluate.mockResolvedValue({
                type: 'Cursor',
                printable: '[{"age":25}]',
                durationMs: 5,
            });

            pty.handleInput('db.test.find({');
            pty.handleInput('\r');
            pty.handleInput('  age: 25');
            pty.handleInput('\r');
            pty.handleInput('})');
            pty.handleInput('\r');

            await new Promise((resolve) => setTimeout(resolve, 10));

            expect(mockEvaluate).toHaveBeenCalledWith('db.test.find({\n  age: 25\n})', expect.any(Number));
        });

        it('should show database prompt after multi-line evaluation completes', async () => {
            mockEvaluate.mockResolvedValue({
                type: null,
                printable: '"done"',
                durationMs: 1,
            });

            pty.handleInput('db.test.find({');
            pty.handleInput('\r');
            pty.handleInput('})');
            pty.handleInput('\r');

            await new Promise((resolve) => setTimeout(resolve, 10));

            // Should show the database prompt after execution
            expect(written).toContain('testdb> ');
        });

        it('should return to normal prompt on Ctrl+C during multi-line mode', () => {
            pty.handleInput('db.test.find({');
            pty.handleInput('\r');

            // All continuation prompt candidates end with ` > ` (baseline alignment testing)
            expect(written).toContain(' > ');

            written = '';
            pty.handleInput('\x03'); // Ctrl+C

            expect(written).toContain('testdb> ');
            expect(mockKillWorker).not.toHaveBeenCalled();
        });

        it('should handle pasted multi-line text with LF newlines', async () => {
            mockEvaluate.mockResolvedValue({
                type: 'Cursor',
                printable: '[{"age":25}]',
                durationMs: 5,
            });

            // Paste a complete multi-line expression with \n
            pty.handleInput('db.test.find({\n  age: 25\n})');
            pty.handleInput('\r');

            await new Promise((resolve) => setTimeout(resolve, 10));

            expect(mockEvaluate).toHaveBeenCalledWith('db.test.find({\n  age: 25\n})', expect.any(Number));
        });

        it('should process sequential pasted commands via paste queue', async () => {
            mockEvaluate
                .mockResolvedValueOnce({
                    type: null,
                    printable: '"dbs listed"',
                    durationMs: 1,
                })
                .mockResolvedValueOnce({
                    type: null,
                    printable: JSON.stringify('switched to db newdb'),
                    durationMs: 1,
                });

            // Paste two commands separated by \n
            pty.handleInput('show dbs\nuse newdb\n');

            // Wait for both commands to complete
            await new Promise((resolve) => setTimeout(resolve, 50));

            expect(mockEvaluate).toHaveBeenCalledTimes(2);
            expect(mockEvaluate).toHaveBeenNthCalledWith(1, 'show dbs', expect.any(Number));
            expect(mockEvaluate).toHaveBeenNthCalledWith(2, 'use newdb', expect.any(Number));
        });
    });

    describe('multi-line paste dialog', () => {
        /**
         * Override paste-related settings while preserving other mocked settings.
         * @param behavior - value for documentDB.shell.multiLinePasteBehavior
         * @param vscodePasteWarning - value for terminal.integrated.enableMultiLinePasteWarning (default: 'never')
         */
        function mockPasteBehavior(behavior: string, vscodePasteWarning: string = 'never'): void {
            jest.spyOn(vscode.workspace, 'getConfiguration').mockImplementation((section?: string) => {
                return {
                    get: jest.fn((_key: string, defaultValue?: unknown) => {
                        if (section === 'documentDB.shell' && _key === 'multiLinePasteBehavior') {
                            return behavior;
                        }
                        if (section === 'terminal.integrated' && _key === 'enableMultiLinePasteWarning') {
                            return vscodePasteWarning;
                        }
                        // Preserve base settings needed by the PTY
                        if ((section === undefined || section === '') && _key === 'documentDB.timeout') {
                            return 120;
                        }
                        return defaultValue;
                    }),
                } as unknown as vscode.WorkspaceConfiguration;
            });
        }

        beforeEach(async () => {
            pty.open({ columns: 80, rows: 24 });
            await new Promise((resolve) => setTimeout(resolve, 10));
            written = '';
        });

        it('should show QuickPick when behavior is "ask" and multi-line paste detected', async () => {
            mockPasteBehavior('ask');

            const showQuickPickSpy = jest
                .spyOn(vscode.window, 'showQuickPick')
                .mockResolvedValue({ label: 'Cancel', detail: '', id: 'cancel' } as never);

            pty.handleInput('line1\nline2\n');

            await new Promise((resolve) => setTimeout(resolve, 10));
            expect(showQuickPickSpy).toHaveBeenCalledTimes(1);

            showQuickPickSpy.mockRestore();
        });

        it('should join and execute when "Execute as One" is chosen', async () => {
            mockPasteBehavior('ask');

            mockEvaluate.mockResolvedValue({
                type: null,
                printable: '"result"',
                durationMs: 1,
            });

            const showQuickPickSpy = jest
                .spyOn(vscode.window, 'showQuickPick')
                .mockResolvedValue({ label: 'Execute as One', detail: '', id: 'join' } as never);

            pty.handleInput('db.restaurants\n    .find({})\n    .limit(5);\n');

            await new Promise((resolve) => setTimeout(resolve, 100));

            // Lines starting with . should be joined directly (no space)
            expect(mockEvaluate).toHaveBeenCalledWith('db.restaurants.find({}).limit(5);', expect.any(Number));

            showQuickPickSpy.mockRestore();
        });

        it('should join continuation lines with space when they do not start with .', async () => {
            mockPasteBehavior('executeAsOne');

            mockEvaluate.mockResolvedValue({
                type: null,
                printable: '"result"',
                durationMs: 1,
            });

            pty.handleInput('var x =\n  42;\n');

            await new Promise((resolve) => setTimeout(resolve, 50));

            expect(mockEvaluate).toHaveBeenCalledWith('var x = 42;', expect.any(Number));
        });

        it('should run line by line when behavior is "runLineByLine"', async () => {
            // Already the default in tests — just verify
            mockEvaluate
                .mockResolvedValueOnce({ type: null, printable: '"r1"', durationMs: 1 })
                .mockResolvedValueOnce({ type: null, printable: '"r2"', durationMs: 1 });

            pty.handleInput('show dbs\nuse mydb\n');

            await new Promise((resolve) => setTimeout(resolve, 50));

            expect(mockEvaluate).toHaveBeenCalledTimes(2);
        });

        it('should discard input when dialog is cancelled', async () => {
            mockPasteBehavior('ask');

            const showQuickPickSpy = jest.spyOn(vscode.window, 'showQuickPick').mockResolvedValue(undefined);

            pty.handleInput('line1\nline2\n');

            await new Promise((resolve) => setTimeout(resolve, 50));

            expect(mockEvaluate).not.toHaveBeenCalled();

            showQuickPickSpy.mockRestore();
        });

        it('should not show dialog for single-line paste', async () => {
            mockPasteBehavior('ask');

            mockEvaluate.mockResolvedValue({ type: null, printable: '"ok"', durationMs: 1 });

            const showQuickPickSpy = jest.spyOn(vscode.window, 'showQuickPick');

            // Single line with trailing \r — should NOT trigger the dialog
            pty.handleInput('show dbs\r');

            await new Promise((resolve) => setTimeout(resolve, 50));

            expect(showQuickPickSpy).not.toHaveBeenCalled();
            expect(mockEvaluate).toHaveBeenCalledWith('show dbs', expect.any(Number));

            showQuickPickSpy.mockRestore();
        });

        it('should skip our dialog and run line-by-line when VS Code paste warning is active', async () => {
            // behavior=ask but VS Code's warning is 'auto' (default) → skip our dialog
            mockPasteBehavior('ask', 'auto');

            mockEvaluate
                .mockResolvedValueOnce({ type: null, printable: '"r1"', durationMs: 1 })
                .mockResolvedValueOnce({ type: null, printable: '"r2"', durationMs: 1 });

            const showQuickPickSpy = jest.spyOn(vscode.window, 'showQuickPick');

            pty.handleInput('show dbs\nuse mydb\n');

            await new Promise((resolve) => setTimeout(resolve, 50));

            // Our QuickPick should NOT have been shown
            expect(showQuickPickSpy).not.toHaveBeenCalled();
            // Lines should have been run independently
            expect(mockEvaluate).toHaveBeenCalledTimes(2);

            showQuickPickSpy.mockRestore();
        });

        it('should show our dialog when VS Code paste warning is disabled', async () => {
            // behavior=ask and VS Code's warning is 'never' → show our dialog
            mockPasteBehavior('ask', 'never');

            const showQuickPickSpy = jest
                .spyOn(vscode.window, 'showQuickPick')
                .mockResolvedValue({ label: 'Cancel', detail: '', id: 'cancel' } as never);

            pty.handleInput('line1\nline2\n');

            await new Promise((resolve) => setTimeout(resolve, 10));
            expect(showQuickPickSpy).toHaveBeenCalledTimes(1);

            showQuickPickSpy.mockRestore();
        });

        it('should show our dialog even when VS Code paste warning is active if alwaysAsk', async () => {
            // behavior=alwaysAsk and VS Code's warning is 'auto' → still show our dialog
            mockPasteBehavior('alwaysAsk', 'auto');

            const showQuickPickSpy = jest
                .spyOn(vscode.window, 'showQuickPick')
                .mockResolvedValue({ label: 'Cancel', detail: '', id: 'cancel' } as never);

            pty.handleInput('line1\nline2\n');

            await new Promise((resolve) => setTimeout(resolve, 10));
            expect(showQuickPickSpy).toHaveBeenCalledTimes(1);

            showQuickPickSpy.mockRestore();
        });
    });
});
