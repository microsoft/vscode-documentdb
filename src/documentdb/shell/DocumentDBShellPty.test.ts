/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { DocumentDBShellPty, type DocumentDBShellPtyOptions } from './DocumentDBShellPty';

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
        jest.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({
            get: jest.fn((_key: string, defaultValue?: unknown) => {
                if (_key === 'documentDB.shell.display.colorOutput') {
                    return false; // Disable colors for easier test assertions
                }
                if (_key === 'documentDB.shell.timeout') {
                    return 120;
                }
                return defaultValue;
            }),
        } as unknown as vscode.WorkspaceConfiguration);

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
});
