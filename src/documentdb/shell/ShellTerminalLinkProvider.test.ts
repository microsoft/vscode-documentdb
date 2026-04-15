/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import {
    ACTION_LINE_PREFIX,
    registerShellTerminal,
    SETTINGS_ACTION_PREFIX,
    ShellTerminalLinkProvider,
    unregisterShellTerminal,
    type ShellTerminalInfo,
} from './ShellTerminalLinkProvider';

/** Build a mock ShellTerminalInfo with sensible defaults. */
function mockShellInfo(clusterId: string): ShellTerminalInfo {
    return {
        clusterId,
        clusterDisplayName: 'TestCluster',
        activeDatabase: 'testdb',
        isInitialized: true,
        isEvaluating: false,
        workerState: 'ready',
        authMethod: 'NativeAuth',
        username: 'admin',
    };
}

describe('ShellTerminalLinkProvider', () => {
    let provider: ShellTerminalLinkProvider;
    let mockTerminal: vscode.Terminal;

    beforeEach(() => {
        jest.clearAllMocks();
        provider = new ShellTerminalLinkProvider();

        // Create a mock terminal
        mockTerminal = {
            name: 'DocumentDB: TestCluster/testdb',
        } as unknown as vscode.Terminal;
    });

    afterEach(() => {
        unregisterShellTerminal(mockTerminal);
    });

    describe('provideTerminalLinks', () => {
        it('should return empty array for non-shell terminals', () => {
            const context = {
                terminal: { name: 'bash' } as unknown as vscode.Terminal,
                line: `${ACTION_LINE_PREFIX}[mydb.users]`,
            } as vscode.TerminalLinkContext;

            const links = provider.provideTerminalLinks(context);
            expect(links).toEqual([]);
        });

        it('should return empty array when line does not match action pattern', () => {
            registerShellTerminal(mockTerminal, () => mockShellInfo('test-id'));

            const context = {
                terminal: mockTerminal,
                line: '  "name": "Alice"',
            } as vscode.TerminalLinkContext;

            const links = provider.provideTerminalLinks(context);
            expect(links).toEqual([]);
        });

        it('should detect action line and return a link', () => {
            registerShellTerminal(mockTerminal, () => mockShellInfo('test-cluster-id'));

            const actionLine = `${ACTION_LINE_PREFIX}[mydb.users]`;
            const context = {
                terminal: mockTerminal,
                line: actionLine,
            } as vscode.TerminalLinkContext;

            const links = provider.provideTerminalLinks(context);
            expect(links).toHaveLength(1);
            expect(links[0]).toMatchObject({
                linkType: 'collectionView',
                databaseName: 'mydb',
                collectionName: 'users',
                clusterId: 'test-cluster-id',
            });
        });

        it('should handle collection names with dots', () => {
            registerShellTerminal(mockTerminal, () => mockShellInfo('test-id'));

            const actionLine = `${ACTION_LINE_PREFIX}[analytics.events.2024]`;
            const context = {
                terminal: mockTerminal,
                line: actionLine,
            } as vscode.TerminalLinkContext;

            const links = provider.provideTerminalLinks(context);
            expect(links).toHaveLength(1);
            // First dot separates db from collection; rest belongs to collection name
            expect(links[0]).toMatchObject({
                linkType: 'collectionView',
                databaseName: 'analytics',
                collectionName: 'events.2024',
            });
        });

        it('should handle collection names with parentheses', () => {
            registerShellTerminal(mockTerminal, () => mockShellInfo('test-id'));

            const actionLine = `${ACTION_LINE_PREFIX}[mydb.stores (10)]`;
            const context = {
                terminal: mockTerminal,
                line: actionLine,
            } as vscode.TerminalLinkContext;

            const links = provider.provideTerminalLinks(context);
            expect(links).toHaveLength(1);
            expect(links[0]).toMatchObject({
                linkType: 'collectionView',
                databaseName: 'mydb',
                collectionName: 'stores (10)',
            });
        });

        it('should handle collection names with spaces', () => {
            registerShellTerminal(mockTerminal, () => mockShellInfo('test-id'));

            const actionLine = `${ACTION_LINE_PREFIX}[mydb.my collection]`;
            const context = {
                terminal: mockTerminal,
                line: actionLine,
            } as vscode.TerminalLinkContext;

            const links = provider.provideTerminalLinks(context);
            expect(links).toHaveLength(1);
            expect(links[0]).toMatchObject({
                linkType: 'collectionView',
                databaseName: 'mydb',
                collectionName: 'my collection',
            });
        });

        it('should handle ANSI-wrapped action line (gray color)', () => {
            registerShellTerminal(mockTerminal, () => mockShellInfo('test-id'));

            // Gray ANSI wrapping: \x1b[90m ... \x1b[0m
            const actionLine = `\x1b[90m${ACTION_LINE_PREFIX}[mydb.users]\x1b[0m`;
            const context = {
                terminal: mockTerminal,
                line: actionLine,
            } as vscode.TerminalLinkContext;

            const links = provider.provideTerminalLinks(context);
            expect(links).toHaveLength(1);
            expect(links[0]).toMatchObject({
                linkType: 'collectionView',
                databaseName: 'mydb',
                collectionName: 'users',
            });
        });

        it('should not match partial action line text', () => {
            registerShellTerminal(mockTerminal, () => mockShellInfo('test-id'));

            const context = {
                terminal: mockTerminal,
                line: '[mydb.users]', // Missing � prefix
            } as vscode.TerminalLinkContext;

            const links = provider.provideTerminalLinks(context);
            expect(links).toEqual([]);
        });
    });

    describe('handleTerminalLink', () => {
        it('should execute the open collection view command', () => {
            const spy = jest.spyOn(vscode.commands, 'executeCommand').mockResolvedValue(undefined);

            const link = {
                linkType: 'collectionView' as const,
                startIndex: 0,
                length: 50,
                clusterId: 'my-cluster',
                databaseName: 'mydb',
                collectionName: 'users',
            };

            provider.handleTerminalLink(link as Parameters<typeof provider.handleTerminalLink>[0]);

            // callWithTelemetryAndErrorHandling is async — give it a tick
            return new Promise<void>((resolve) => {
                setTimeout(() => {
                    expect(spy).toHaveBeenCalledWith(
                        'vscode-documentdb.command.internal.containerView.open',
                        expect.objectContaining({
                            clusterId: 'my-cluster',
                            databaseName: 'mydb',
                            collectionName: 'users',
                        }),
                    );
                    spy.mockRestore();
                    resolve();
                }, 50);
            });
        });
    });

    describe('settings links', () => {
        it('should detect settings action line and return a settings link', () => {
            registerShellTerminal(mockTerminal, () => mockShellInfo('test-id'));

            const actionLine = `${SETTINGS_ACTION_PREFIX}[documentDB.shell.timeout]`;
            const context = {
                terminal: mockTerminal,
                line: actionLine,
            } as vscode.TerminalLinkContext;

            const links = provider.provideTerminalLinks(context);
            expect(links).toHaveLength(1);
            expect(links[0]).toMatchObject({
                linkType: 'settings',
                settingKey: 'documentDB.shell.timeout',
            });
        });

        it('should handle ANSI-wrapped settings action line', () => {
            registerShellTerminal(mockTerminal, () => mockShellInfo('test-id'));

            const actionLine = `\x1b[90m${SETTINGS_ACTION_PREFIX}[documentDB.shell.initTimeout]\x1b[0m`;
            const context = {
                terminal: mockTerminal,
                line: actionLine,
            } as vscode.TerminalLinkContext;

            const links = provider.provideTerminalLinks(context);
            expect(links).toHaveLength(1);
            expect(links[0]).toMatchObject({
                linkType: 'settings',
                settingKey: 'documentDB.shell.initTimeout',
            });
        });

        it('should not match settings line for non-shell terminals', () => {
            const context = {
                terminal: { name: 'bash' } as unknown as vscode.Terminal,
                line: `${SETTINGS_ACTION_PREFIX}[documentDB.shell.timeout]`,
            } as vscode.TerminalLinkContext;

            const links = provider.provideTerminalLinks(context);
            expect(links).toEqual([]);
        });

        it('should execute openSettings command for settings links', () => {
            const spy = jest.spyOn(vscode.commands, 'executeCommand').mockResolvedValue(undefined);

            const link = {
                linkType: 'settings' as const,
                startIndex: 0,
                length: 40,
                settingKey: 'documentDB.shell.timeout',
            };

            provider.handleTerminalLink(link as Parameters<typeof provider.handleTerminalLink>[0]);

            return new Promise<void>((resolve) => {
                setTimeout(() => {
                    expect(spy).toHaveBeenCalledWith('workbench.action.openSettings', 'documentDB.shell.timeout');
                    spy.mockRestore();
                    resolve();
                }, 50);
            });
        });
    });

    describe('registry', () => {
        it('should not match after terminal is unregistered', () => {
            registerShellTerminal(mockTerminal, () => mockShellInfo('test-id'));
            unregisterShellTerminal(mockTerminal);

            const actionLine = `${ACTION_LINE_PREFIX}[mydb.users]`;
            const context = {
                terminal: mockTerminal,
                line: actionLine,
            } as vscode.TerminalLinkContext;

            const links = provider.provideTerminalLinks(context);
            expect(links).toEqual([]);
        });
    });
});
