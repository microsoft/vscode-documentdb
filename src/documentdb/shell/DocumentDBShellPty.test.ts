/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ext } from '../../extensionVariables';
import { AuthMethodId } from '../auth/AuthMethod';
import { CredentialCache } from '../CredentialCache';
import { DocumentDBShellPty, type DocumentDBShellPtyOptions } from './DocumentDBShellPty';
import { ShellCompletionProvider } from './ShellCompletionProvider';
import { ShellSpinner } from './ShellSpinner';

// callWithTelemetryAndErrorHandling from @microsoft/vscode-azext-utils silently swallows
// errors in the Jest environment because its internal error handling relies on extension
// infrastructure (ext._internalReporter, etc.) that is not initialized in unit tests.
// With rethrow=true set by the callback, the framework's handleError() never reaches the
// rethrow check — it hits an error state first and calls sendHandlerFailedEvent() instead.
// This mock runs the callback transparently so errors propagate correctly to callers.
jest.mock('@microsoft/vscode-azext-utils', () => {
    const actual = jest.requireActual('@microsoft/vscode-azext-utils');
    return {
        ...actual,
        callWithTelemetryAndErrorHandling: jest.fn(
            async (_callbackId: string, callback: (ctx: unknown) => Promise<unknown>) => {
                const ctx = {
                    telemetry: {
                        properties: {} as Record<string, string | undefined>,
                        measurements: {} as Record<string, number | undefined>,
                        suppressIfSuccessful: false,
                        suppressAll: false,
                    },
                    errorHandling: { suppressDisplay: false, rethrow: false, issueProperties: {} },
                    valuesToMask: [] as string[],
                    ui: undefined,
                };
                return callback(ctx);
            },
        ),
    };
});

// Connection failures are logged so they survive in a shared output channel; the extension's
// output channel is not initialized in unit tests.
jest.mock('../../extensionVariables', () => ({
    ext: {
        outputChannel: {
            error: jest.fn(),
            warn: jest.fn(),
            info: jest.fn(),
            debug: jest.fn(),
            trace: jest.fn(),
            appendLine: jest.fn(),
        },
    },
}));

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
    /** Per-test overrides for top-level (unsectioned) settings. */
    let settingOverrides: Record<string, unknown>;

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
        settingOverrides = {};

        // Mock settings
        jest.spyOn(vscode.workspace, 'getConfiguration').mockImplementation((section?: string) => {
            return {
                get: jest.fn((_key: string, defaultValue?: unknown) => {
                    if (section === undefined || section === '') {
                        if (_key in settingOverrides) {
                            return settingOverrides[_key];
                        }
                        if (_key === 'documentDB.shell.display.colorSupport') {
                            return false; // Disable colors for easier test assertions
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
        // The shell has exactly two hint markers: nothing (appendable) and 🛈
        // (informational). It names no keys. Asserted for every test so a new
        // hint cannot quietly reintroduce a third marker or a `(Tab)` suffix.
        expect(written).not.toContain('→');
        expect(written).not.toContain('(Tab)');

        jest.restoreAllMocks();
    });

    describe('open', () => {
        it('should display welcome banner', () => {
            pty.open(undefined);
            expect(written).toContain('DocumentDB Shell');
        });

        it('should display the shell logo without persistent connection details', () => {
            pty.open(undefined);

            expect(written).toContain(
                '╭──────────────────────╮\r\n│ DocumentDB Shell  >_ │\r\n╰──────────────────────╯',
            );
            expect(written).not.toContain('│ TestCluster');
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
            expect(written).toContain('Connected to: TestCluster (test-host.documents.azure.com:10255)');
            expect(written).toContain('SCRAM');
        });

        it('should not repeat the host when it matches the connection name', async () => {
            mockInitialize.mockResolvedValueOnce({
                host: 'TestCluster',
                authMechanism: 'NativeAuth',
                isEmulator: false,
            });

            pty.open(undefined);
            await new Promise((resolve) => setTimeout(resolve, 10));

            expect(written).toContain('Connected to: TestCluster');
            expect(written).not.toContain('Connected to: TestCluster (TestCluster)');
        });

        it.each([
            ['NativeAuth', 'Username and Password (SCRAM)'],
            ['MicrosoftEntraID', 'Microsoft Entra ID (Account)'],
            ['ManagedIdentity', 'Microsoft Entra ID (Managed Identity)'],
            ['NoAuth', 'No Authentication'],
        ] as const)('should display the %s authentication label', async (authMechanism, expectedLabel) => {
            mockInitialize.mockResolvedValueOnce({
                host: 'test-host.documents.azure.com:10255',
                authMechanism,
                isEmulator: false,
            });

            pty.open(undefined);
            await new Promise((resolve) => setTimeout(resolve, 10));

            expect(written).toContain(`Authentication: ${expectedLabel}`);
        });

        it('should display an optional account name as the identity', async () => {
            mockInitialize.mockResolvedValueOnce({
                host: 'test-host.documents.azure.com:10255',
                authMechanism: 'MicrosoftEntraID',
                isEmulator: false,
                displayName: 'alex@contoso.com',
            });

            pty.open(undefined);
            await new Promise((resolve) => setTimeout(resolve, 10));

            expect(written).toContain(
                'Identity: alex@contoso.com | Authentication: Microsoft Entra ID (Account) | Database: testdb',
            );
        });

        it('should display a SCRAM username as the identity', async () => {
            mockInitialize.mockResolvedValueOnce({
                host: 'test-host.documents.azure.com:10255',
                authMechanism: 'NativeAuth',
                isEmulator: false,
                username: 'app-user',
            });

            pty.open(undefined);
            await new Promise((resolve) => setTimeout(resolve, 10));

            expect(written).toContain(
                'Identity: app-user | Authentication: Username and Password (SCRAM) | Database: testdb',
            );
        });

        it('should show error and stay open on connection failure', async () => {
            mockInitialize.mockRejectedValue(new Error('Connection refused'));
            pty.open(undefined);
            await new Promise((resolve) => setTimeout(resolve, 10));
            expect(written).toContain('Failed to connect: Connection refused');
            // Closing would dispose the terminal and take the message with it; the prompt lets the
            // user retry, since evaluate() re-initializes an uninitialized session.
            expect(closeCode).toBeUndefined();
            expect(written).toContain('testdb> ');
        });

        it('redacts cached credentials before logging the failure to the output channel', async () => {
            CredentialCache.setAuthCredentials(
                'test-cluster-id',
                AuthMethodId.NativeAuth,
                'mongodb://localhost:10260/',
                { connectionUser: 'qs_user', connectionPassword: 'sup3r-s3cret' },
            );
            mockInitialize.mockRejectedValue(
                new Error('Invalid connection string: mongodb://qs_user:sup3r-s3cret@localhost:10260/'),
            );

            pty.open(undefined);
            await new Promise((resolve) => setTimeout(resolve, 10));

            const logged = jest.mocked(ext.outputChannel.error).mock.calls.map(String).join('\n');
            expect(logged).toContain('[Shell] Failed to connect');
            expect(logged).not.toContain('sup3r-s3cret');

            CredentialCache.deleteCredentials('test-cluster-id');
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

            expect(mockEvaluate).toHaveBeenCalledWith('db.test.find()', 80);
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

        it('should normalize bare \\n in multi-line error messages to \\r\\n', async () => {
            // Many driver / server error messages embed bare LFs to delimit
            // a multi-line explanation. Without normalization the terminal
            // moves the cursor down but not to column 0, producing a staircase.
            // The terminating \r\n that writeLine appends should be the ONLY
            // CR-LF pair followed by no further characters in the captured
            // output for this error.
            mockEvaluate.mockRejectedValue(new Error('first line\nsecond line\nthird line'));

            pty.handleInput('db.cmd()');
            pty.handleInput('\r');
            await new Promise((resolve) => setTimeout(resolve, 10));

            expect(written).toContain('first line\r\nsecond line\r\nthird line');
            // Scope the "no bare LF" assertion to the error block itself so the
            // test doesn't accidentally start failing if some future, unrelated
            // output later in the captured buffer happens to contain a bare LF.
            const errorBlock = written.slice(written.indexOf('first line'));
            const bareLfCount = (errorBlock.match(/(?<!\r)\n/g) ?? []).length;
            expect(bareLfCount).toBe(0);
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

            // ANSI clear screen + scrollback clear sequence
            expect(written).toContain('\x1b[2J\x1b[3J\x1b[H');
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

    describe('ghost text — append-only invariant', () => {
        /** Dim + gray prefix emitted by ShellGhostText. */
        const GHOST_STYLE = '\x1b[2m\x1b[90m';
        /** Ghost text is debounced by 50 ms in the PTY. */
        const afterGhostDebounce = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 80));

        beforeEach(async () => {
            pty.open(undefined);
            await new Promise((resolve) => setTimeout(resolve, 10));
            written = '';
        });

        it('renders ghost text when the cursor sits at the end of the buffer', async () => {
            pty.handleInput('hel'); // 'help' is the only top-level command with this prefix

            await afterGhostDebounce();

            expect(written).toContain(`${GHOST_STYLE}p`);
        });

        it('renders no ghost text when the cursor is mid-buffer', async () => {
            pty.handleInput('hel))');
            await afterGhostDebounce();

            pty.handleInput('\x1b[D\x1b[D'); // cursor back between 'hel' and '))'
            written = '';

            pty.handleInput('\x1b[3~'); // Delete — buffer becomes 'hel)', cursor stays at 3
            await afterGhostDebounce();

            expect(written).not.toContain(GHOST_STYLE);
        });
    });

    describe('ghost text — candidate description hint', () => {
        /** Dim + gray prefix emitted by ShellGhostText. */
        const GHOST_STYLE = '\x1b[2m\x1b[90m';
        const afterGhostDebounce = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 80));

        beforeEach(async () => {
            pty.open(undefined);
            await new Promise((resolve) => setTimeout(resolve, 10));
            written = '';
        });

        it("shows the candidate's description once it is fully typed", async () => {
            pty.handleInput('help'); // exact, single candidate — nothing left to insert

            await afterGhostDebounce();

            expect(written).toContain(`${GHOST_STYLE}  🛈 Show help`);
        });

        it('yields the row to an insertable completion', async () => {
            pty.handleInput('hel'); // 'help' is still incomplete

            await afterGhostDebounce();

            expect(written).toContain(`${GHOST_STYLE}p`);
            expect(written).not.toContain('🛈');
        });

        it('is not insertable', async () => {
            mockEvaluate.mockResolvedValue({ type: 'string', printable: '"x"', durationMs: 1 });

            pty.handleInput('help');
            await afterGhostDebounce();

            pty.handleInput('\x09'); // Tab
            pty.handleInput('\r');
            await new Promise((resolve) => setTimeout(resolve, 10));

            expect(mockEvaluate).toHaveBeenCalledWith('help', 80);
        });
    });

    describe('ghost text — bracket-notation preview', () => {
        /** Dim + gray prefix emitted by ShellGhostText. */
        const GHOST_STYLE = '\x1b[2m\x1b[90m';
        const afterGhostDebounce = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 80));

        /**
         * A collection whose name is not a valid JS identifier: Tab has to
         * rewrite the `db.` dot, which inline ghost text cannot represent.
         */
        function mockBracketNotationCandidate(): void {
            jest.spyOn(ShellCompletionProvider.prototype, 'getCompletions').mockReturnValue({
                candidates: [
                    {
                        label: 'restaurants-something',
                        insertText: "['restaurants-something']",
                        kind: 'collection',
                        replaceCharsBefore: 1,
                    },
                ],
                prefix: 'rest',
                replacementStart: 3,
            });
        }

        beforeEach(async () => {
            pty.open(undefined);
            await new Promise((resolve) => setTimeout(resolve, 10));
            written = '';
        });

        it('advertises what Tab would produce instead of showing nothing', async () => {
            mockBracketNotationCandidate();

            pty.handleInput('db.rest');
            await afterGhostDebounce();

            expect(written).toContain(`${GHOST_STYLE}  🛈 db['restaurants-something']`);
        });

        it('previews exactly what Tab then produces', async () => {
            mockBracketNotationCandidate();
            mockEvaluate.mockResolvedValue({ type: 'string', printable: '"x"', durationMs: 1 });

            pty.handleInput('db.rest');
            await afterGhostDebounce();

            pty.handleInput('\x09'); // Tab
            pty.handleInput('\r');
            await new Promise((resolve) => setTimeout(resolve, 10));

            expect(mockEvaluate).toHaveBeenCalledWith("db['restaurants-something']", 80);
        });
    });

    describe('ghost text — collection count at `db.`', () => {
        /** Dim + gray prefix emitted by ShellGhostText. */
        const GHOST_STYLE = '\x1b[2m\x1b[90m';
        const afterGhostDebounce = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 80));

        /**
         * `db.` always returns every database method alongside the collections,
         * so it is never a single candidate.
         */
        function mockDbDotCandidates(collectionNames: string[]): void {
            jest.spyOn(ShellCompletionProvider.prototype, 'getCompletions').mockReturnValue({
                candidates: [
                    ...collectionNames.map((name) => ({
                        label: name,
                        insertText: name,
                        kind: 'collection' as const,
                    })),
                    { label: 'getName', insertText: 'getName', kind: 'method' as const },
                    { label: 'runCommand', insertText: 'runCommand', kind: 'method' as const },
                ],
                prefix: '',
                replacementStart: 3,
            });
        }

        beforeEach(async () => {
            pty.open(undefined);
            await new Promise((resolve) => setTimeout(resolve, 10));
            written = '';
        });

        it('says how many collections the database holds', async () => {
            mockDbDotCandidates(['a', 'b', 'c', 'd', 'e', 'f', 'g']);

            pty.handleInput('db.');
            await afterGhostDebounce();

            expect(written).toContain(`${GHOST_STYLE}  🛈 7 collections`);
        });

        it('says it in the singular for one collection', async () => {
            mockDbDotCandidates(['restaurants']);

            pty.handleInput('db.');
            await afterGhostDebounce();

            expect(written).toContain(`${GHOST_STYLE}  🛈 1 collection`);
            expect(written).not.toContain('1 collections');
        });

        it('stays silent on a cold cache, which yields no collection candidates', async () => {
            mockDbDotCandidates([]);

            pty.handleInput('db.');
            await afterGhostDebounce();

            expect(written).not.toContain(GHOST_STYLE);
        });

        it('is informational — Tab still shows the candidate list', async () => {
            mockDbDotCandidates(['restaurants']);

            pty.handleInput('db.');
            await afterGhostDebounce();
            written = '';

            pty.handleInput('\x09'); // Tab

            expect(written).toContain('restaurants');
            expect(written).toContain('getName');
            expect(written).toContain('runCommand');
        });

        it('outranks a history suggestion, which `db.` almost always has', async () => {
            mockEvaluate.mockResolvedValue({ type: 'string', printable: '"x"', durationMs: 1 });
            mockDbDotCandidates(['restaurants']);

            pty.handleInput('db.restaurants.find()');
            pty.handleInput('\r');
            await new Promise((resolve) => setTimeout(resolve, 20));
            written = '';

            pty.handleInput('db.');
            await afterGhostDebounce();

            expect(written).toContain(`${GHOST_STYLE}  🛈 1 collection`);
            expect(written).not.toContain(`${GHOST_STYLE}restaurants.find()`);
        });

        it('previews a bracket-notation collection rather than counting it, once a prefix is typed', async () => {
            jest.spyOn(ShellCompletionProvider.prototype, 'getCompletions').mockReturnValue({
                candidates: [
                    {
                        label: 'restaurants-original',
                        insertText: "['restaurants-original']",
                        kind: 'collection',
                        replaceCharsBefore: 1,
                    },
                ],
                prefix: 'rest',
                replacementStart: 3,
            });

            pty.handleInput('db.rest');
            await afterGhostDebounce();

            expect(written).toContain(`${GHOST_STYLE}  🛈 db['restaurants-original']`);
        });
    });

    describe('ghost text — history autosuggestion', () => {
        /** Dim + gray prefix emitted by ShellGhostText. */
        const GHOST_STYLE = '\x1b[2m\x1b[90m';
        const afterGhostDebounce = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 80));

        beforeEach(async () => {
            pty.open(undefined);
            await new Promise((resolve) => setTimeout(resolve, 10));
            mockEvaluate.mockResolvedValue({ type: 'string', printable: '"x"', durationMs: 1 });
            written = '';
        });

        it('suggests the rest of a previously run command', async () => {
            // Bracket notation and all — no syntax awareness required.
            pty.handleInput("db['restaurants-something'].find()");
            pty.handleInput('\r');
            await new Promise((resolve) => setTimeout(resolve, 20));
            written = '';

            pty.handleInput('db[');
            await afterGhostDebounce();

            expect(written).toContain(`${GHOST_STYLE}'restaurants-something'].find()`);
        });

        it('yields to a completion candidate, which can also be accepted', async () => {
            pty.handleInput('help me');
            pty.handleInput('\r');
            await new Promise((resolve) => setTimeout(resolve, 20));
            written = '';

            pty.handleInput('hel');
            await afterGhostDebounce();

            // 'help' is a real completion candidate, so it owns the row.
            expect(written).toContain(`${GHOST_STYLE}p`);
            expect(written).not.toContain(`${GHOST_STYLE}p me`);
        });

        it('is insertable', async () => {
            pty.handleInput('db.restaurants.countDocuments({})');
            pty.handleInput('\r');
            await new Promise((resolve) => setTimeout(resolve, 20));

            pty.handleInput('db.restaurants.c');
            await afterGhostDebounce();

            pty.handleInput('\x1b[C'); // Right Arrow accepts ghost text
            pty.handleInput('\r');
            await new Promise((resolve) => setTimeout(resolve, 20));

            expect(mockEvaluate).toHaveBeenLastCalledWith('db.restaurants.countDocuments({})', 80);
        });
    });

    describe('Tab versus ghost text — which key owns which job', () => {
        const afterGhostDebounce = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 80));

        const DATABASES = ['Copies', 'MyDatabase', 'SecondDatabase', 'Yelp'];

        /** `use ` offers every database, at an empty prefix. */
        function mockDatabaseCandidates(): void {
            jest.spyOn(ShellCompletionProvider.prototype, 'getCompletions').mockReturnValue({
                candidates: DATABASES.map((name) => ({
                    label: name,
                    insertText: name,
                    kind: 'database' as const,
                })),
                prefix: '',
                replacementStart: 4,
            });
        }

        beforeEach(async () => {
            pty.open(undefined);
            await new Promise((resolve) => setTimeout(resolve, 10));
            mockEvaluate.mockResolvedValue({ type: 'string', printable: '"x"', durationMs: 1 });
            written = '';
        });

        it('lists the databases at `use ` even while a history suggestion is showing', async () => {
            mockDatabaseCandidates();

            pty.handleInput('use MyDatabase');
            pty.handleInput('\r');
            await new Promise((resolve) => setTimeout(resolve, 20));

            pty.handleInput('use ');
            await afterGhostDebounce();
            written = '';

            pty.handleInput('\x09'); // Tab

            for (const name of DATABASES) {
                expect(written).toContain(name);
            }
        });

        it('accepts the history suggestion on Right Arrow', async () => {
            mockDatabaseCandidates();

            pty.handleInput('use MyDatabase');
            pty.handleInput('\r');
            await new Promise((resolve) => setTimeout(resolve, 20));

            pty.handleInput('use ');
            await afterGhostDebounce();

            pty.handleInput('\x1b[C'); // Right Arrow
            pty.handleInput('\r');
            await new Promise((resolve) => setTimeout(resolve, 20));

            expect(mockEvaluate).toHaveBeenLastCalledWith('use MyDatabase', 80);
        });

        it('still accepts a closing-bracket ghost, which has no completion behind it', async () => {
            jest.spyOn(ShellCompletionProvider.prototype, 'getCompletions').mockReturnValue({
                candidates: [],
                prefix: '',
                replacementStart: 0,
            });
            // Keeps the schema hint out of the way, so the closing-bracket
            // fallback is the ghost under test.
            jest.spyOn(ShellCompletionProvider.prototype, 'detectContext').mockReturnValue({ kind: 'unknown' });

            pty.handleInput('db.c.find({ _id: 1 ');
            await afterGhostDebounce();

            pty.handleInput('\x09'); // Tab
            pty.handleInput('\r');
            await new Promise((resolve) => setTimeout(resolve, 20));

            expect(mockEvaluate).toHaveBeenLastCalledWith('db.c.find({ _id: 1 })', 80);
        });

        it('still completes a single candidate whose ghost is showing', async () => {
            pty.handleInput('hel');
            await afterGhostDebounce();

            pty.handleInput('\x09'); // Tab
            pty.handleInput('\r');
            await new Promise((resolve) => setTimeout(resolve, 20));

            expect(mockEvaluate).toHaveBeenLastCalledWith('help', 80);
        });

        it('still completes through a non-insertable preview hint', async () => {
            jest.spyOn(ShellCompletionProvider.prototype, 'getCompletions').mockReturnValue({
                candidates: [
                    {
                        label: 'restaurants-original',
                        insertText: "['restaurants-original']",
                        kind: 'collection',
                        replaceCharsBefore: 1,
                    },
                ],
                prefix: 'rest',
                replacementStart: 3,
            });

            pty.handleInput('db.rest');
            await afterGhostDebounce();

            pty.handleInput('\x09'); // Tab
            pty.handleInput('\r');
            await new Promise((resolve) => setTimeout(resolve, 20));

            expect(mockEvaluate).toHaveBeenLastCalledWith("db['restaurants-original']", 80);
        });
    });

    describe('display settings — two switches, one per marker', () => {
        /** Dim + gray prefix emitted by ShellGhostText. */
        const GHOST_STYLE = '\x1b[2m\x1b[90m';
        const afterGhostDebounce = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 80));

        const AUTOCOMPLETION = 'documentDB.shell.display.autocompletion';
        const INLINE_HINTS = 'documentDB.shell.display.inlineHints';

        beforeEach(async () => {
            pty.open(undefined);
            await new Promise((resolve) => setTimeout(resolve, 10));
            mockEvaluate.mockResolvedValue({ type: 'string', printable: '"x"', durationMs: 1 });
            written = '';
        });

        it('autocompletion off: no ghost at `hel`, and Tab does not complete', async () => {
            settingOverrides[AUTOCOMPLETION] = false;

            pty.handleInput('hel');
            await afterGhostDebounce();

            expect(written).not.toContain(GHOST_STYLE);

            pty.handleInput('\x09'); // Tab
            pty.handleInput('\r');
            await new Promise((resolve) => setTimeout(resolve, 20));

            expect(mockEvaluate).toHaveBeenLastCalledWith('hel', 80);
        });

        it('autocompletion off: the 🛈 description still appears', async () => {
            settingOverrides[AUTOCOMPLETION] = false;

            pty.handleInput('help');
            await afterGhostDebounce();

            expect(written).toContain(`${GHOST_STYLE}  🛈 Show help`);
        });

        it('inline hints off: no 🛈 description', async () => {
            settingOverrides[INLINE_HINTS] = false;

            pty.handleInput('help');
            await afterGhostDebounce();

            expect(written).not.toContain('🛈');
        });

        it('inline hints off: no collection count at `db.`', async () => {
            settingOverrides[INLINE_HINTS] = false;
            jest.spyOn(ShellCompletionProvider.prototype, 'getCompletions').mockReturnValue({
                candidates: [{ label: 'restaurants', insertText: 'restaurants', kind: 'collection' }],
                prefix: '',
                replacementStart: 3,
            });

            pty.handleInput('db.');
            await afterGhostDebounce();

            expect(written).not.toContain('🛈');
        });

        it('inline hints off: `db.` gives the row back to the history suggestion it displaced', async () => {
            settingOverrides[INLINE_HINTS] = false;
            jest.spyOn(ShellCompletionProvider.prototype, 'getCompletions').mockReturnValue({
                candidates: [{ label: 'restaurants', insertText: 'restaurants', kind: 'collection' }],
                prefix: '',
                replacementStart: 3,
            });

            pty.handleInput('db.restaurants.find()');
            pty.handleInput('\r');
            await new Promise((resolve) => setTimeout(resolve, 20));
            written = '';

            pty.handleInput('db.');
            await afterGhostDebounce();

            expect(written).toContain(`${GHOST_STYLE}restaurants.find()`);
        });

        it('inline hints off: `hel` still ghosts and Tab still completes', async () => {
            settingOverrides[INLINE_HINTS] = false;

            pty.handleInput('hel');
            await afterGhostDebounce();

            expect(written).toContain(`${GHOST_STYLE}p`);

            pty.handleInput('\x09'); // Tab
            pty.handleInput('\r');
            await new Promise((resolve) => setTimeout(resolve, 20));

            expect(mockEvaluate).toHaveBeenLastCalledWith('help', 80);
        });
    });

    describe('prompt width — display columns, not UTF-16 units', () => {
        it('positions the cursor past a wide-character database name', async () => {
            // '日本語> ' is 5 UTF-16 code units but 8 terminal columns: each CJK
            // ideograph occupies two. Measuring it with String.length makes
            // _promptWidth too small, and every re-render lands two columns short.
            const widePty = new DocumentDBShellPty({
                connectionInfo: {
                    clusterId: 'test-cluster-id',
                    clusterDisplayName: 'TestCluster',
                    databaseName: '日本語',
                },
            });

            let wideWritten = '';
            widePty.onDidWrite((data) => {
                wideWritten += data;
            });

            widePty.open(undefined);
            await new Promise((resolve) => setTimeout(resolve, 10));
            wideWritten = '';

            widePty.handleInput('x'); // any keystroke triggers a full re-render

            expect(wideWritten).toContain('\r\x1b[8C');
            expect(wideWritten).not.toContain('\r\x1b[5C');

            widePty.close();
        });
    });

    describe('setDimensions', () => {
        beforeEach(async () => {
            pty.open(undefined);
            await new Promise((resolve) => setTimeout(resolve, 10));
            written = '';
        });

        it('repaints the input line at the new width', () => {
            pty.handleInput('db.test');
            written = '';

            pty.setDimensions({ columns: 40, rows: 24 });

            // A full re-render: back to the prompt column, then the buffer.
            expect(written).toContain('\r\x1b[8C');
            expect(written).toContain('db.test');
        });

        it('does not touch the terminal while a command is evaluating', async () => {
            let resolveEval!: (value: unknown) => void;
            mockEvaluate.mockReturnValue(
                new Promise((resolve) => {
                    resolveEval = resolve;
                }),
            );

            pty.handleInput('db.test.find()');
            pty.handleInput('\r');
            await new Promise((resolve) => setTimeout(resolve, 10));
            written = '';

            pty.setDimensions({ columns: 40, rows: 24 });

            expect(written).not.toContain('db.test.find()');

            resolveEval({ type: 'string', printable: '"x"', durationMs: 1 });
            await new Promise((resolve) => setTimeout(resolve, 10));
        });

        it('forwards the current width to evaluation, so width-aware output fits', async () => {
            mockEvaluate.mockResolvedValue({ type: 'Help', printable: 'help text', durationMs: 0 });

            pty.setDimensions({ columns: 42, rows: 24 });
            pty.handleInput('help');
            pty.handleInput('\r');
            await new Promise((resolve) => setTimeout(resolve, 10));

            expect(mockEvaluate).toHaveBeenCalledWith('help', 42);
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

            expect(mockEvaluate).toHaveBeenCalledWith('db.test.find({\n  age: 25\n})', 80);
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

            expect(mockEvaluate).toHaveBeenCalledWith('db.test.find({\n  age: 25\n})', 80);
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
            expect(mockEvaluate).toHaveBeenNthCalledWith(1, 'show dbs', 80);
            expect(mockEvaluate).toHaveBeenNthCalledWith(2, 'use newdb', 80);
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
                        if (section === undefined || section === '') {
                            if (_key === 'documentDB.shell.display.colorSupport') {
                                return false;
                            }
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
            expect(mockEvaluate).toHaveBeenCalledWith('db.restaurants.find({}).limit(5);', 80);

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

            expect(mockEvaluate).toHaveBeenCalledWith('var x = 42;', 80);
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
            expect(mockEvaluate).toHaveBeenCalledWith('show dbs', 80);

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
