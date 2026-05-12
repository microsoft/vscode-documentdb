/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import {
    ACTION_LINE_PREFIX,
    PLAYGROUND_ACTION_PREFIX,
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

        it('should handle underline-wrapped action line', () => {
            registerShellTerminal(mockTerminal, () => mockShellInfo('test-id'));

            // Underline wrapping: \x1b[4m ... \x1b[24m
            const actionLine = `\x1b[4m${ACTION_LINE_PREFIX}[mydb.users]\x1b[24m`;
            const context = {
                terminal: mockTerminal,
                line: actionLine,
            } as vscode.TerminalLinkContext;

            const links = provider.provideTerminalLinks(context);
            expect(links).toHaveLength(1);
            expect(links[0]).toMatchObject({
                linkType: 'collectionView',
                startIndex: 0,
                length: actionLine.length,
                databaseName: 'mydb',
                collectionName: 'users',
            });
        });

        it('should handle gray + underline wrapped action line', () => {
            registerShellTerminal(mockTerminal, () => mockShellInfo('test-id'));

            // Gray wrapping outside, underline inside (matches real output)
            const actionLine = `\x1b[90m\x1b[4m${ACTION_LINE_PREFIX}[mydb.users]\x1b[24m\x1b[0m`;
            const context = {
                terminal: mockTerminal,
                line: actionLine,
            } as vscode.TerminalLinkContext;

            const links = provider.provideTerminalLinks(context);
            expect(links).toHaveLength(1);
            expect(links[0]).toMatchObject({
                linkType: 'collectionView',
                startIndex: 0,
                length: actionLine.length,
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

            const actionLine = `${SETTINGS_ACTION_PREFIX}[documentDB.shell.initTimeout]`;
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

        it('should handle underline-wrapped settings action line', () => {
            registerShellTerminal(mockTerminal, () => mockShellInfo('test-id'));

            const actionLine = `\x1b[90m\x1b[4m${SETTINGS_ACTION_PREFIX}[documentDB.shell.initTimeout]\x1b[24m\x1b[0m`;
            const context = {
                terminal: mockTerminal,
                line: actionLine,
            } as vscode.TerminalLinkContext;

            const links = provider.provideTerminalLinks(context);
            expect(links).toHaveLength(1);
            expect(links[0]).toMatchObject({
                linkType: 'settings',
                startIndex: 0,
                length: actionLine.length,
                settingKey: 'documentDB.shell.initTimeout',
            });
        });

        it('should not match settings line for non-shell terminals', () => {
            const context = {
                terminal: { name: 'bash' } as unknown as vscode.Terminal,
                line: `${SETTINGS_ACTION_PREFIX}[documentDB.shell.initTimeout]`,
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
                settingKey: 'documentDB.shell.initTimeout',
            };

            provider.handleTerminalLink(link as Parameters<typeof provider.handleTerminalLink>[0]);

            return new Promise<void>((resolve) => {
                setTimeout(() => {
                    expect(spy).toHaveBeenCalledWith('workbench.action.openSettings', 'documentDB.shell.initTimeout');
                    spy.mockRestore();
                    resolve();
                }, 50);
            });
        });
    });

    describe('playground links', () => {
        it('should detect playground action line and return a playground link', () => {
            registerShellTerminal(mockTerminal, () => mockShellInfo('test-cluster-id'));

            const actionLine = `${PLAYGROUND_ACTION_PREFIX}[mydb.users]`;
            const context = {
                terminal: mockTerminal,
                line: actionLine,
            } as vscode.TerminalLinkContext;

            const links = provider.provideTerminalLinks(context);
            expect(links).toHaveLength(1);
            expect(links[0]).toMatchObject({
                linkType: 'playground',
                databaseName: 'mydb',
                collectionName: 'users',
                clusterId: 'test-cluster-id',
            });
        });

        it('should detect both collection view and playground links on the same line', () => {
            registerShellTerminal(mockTerminal, () => mockShellInfo('test-cluster-id'));

            const actionLine = `${ACTION_LINE_PREFIX}[mydb.orders]  ${PLAYGROUND_ACTION_PREFIX}[mydb.orders]`;
            const context = {
                terminal: mockTerminal,
                line: actionLine,
            } as vscode.TerminalLinkContext;

            const links = provider.provideTerminalLinks(context);
            expect(links).toHaveLength(2);
            expect(links[0]).toMatchObject({
                linkType: 'collectionView',
                databaseName: 'mydb',
                collectionName: 'orders',
            });
            expect(links[1]).toMatchObject({
                linkType: 'playground',
                databaseName: 'mydb',
                collectionName: 'orders',
            });
        });

        it('should detect both links when each is individually underline-wrapped', () => {
            registerShellTerminal(mockTerminal, () => mockShellInfo('test-cluster-id'));

            // Matches real output: gray wraps the whole line, each link segment is underlined separately
            const collectionPart = `\x1b[90m\x1b[4m${ACTION_LINE_PREFIX}[mydb.orders]\x1b[24m`;
            const playgroundPart = `\x1b[4m${PLAYGROUND_ACTION_PREFIX}[mydb.orders]\x1b[24m\x1b[0m`;
            const actionLine = `${collectionPart}  ${playgroundPart}`;
            const context = {
                terminal: mockTerminal,
                line: actionLine,
            } as vscode.TerminalLinkContext;

            const links = provider.provideTerminalLinks(context);
            expect(links).toHaveLength(2);
            expect(links[0]).toMatchObject({
                linkType: 'collectionView',
                startIndex: 0,
                length: collectionPart.length,
                databaseName: 'mydb',
                collectionName: 'orders',
            });
            expect(links[1]).toMatchObject({
                linkType: 'playground',
                startIndex: collectionPart.length + 2, // +2 for "  " separator
                length: playgroundPart.length,
                databaseName: 'mydb',
                collectionName: 'orders',
            });
        });

        it('should execute the open playground command for playground links', () => {
            const spy = jest.spyOn(vscode.commands, 'executeCommand').mockResolvedValue(undefined);

            const link = {
                linkType: 'playground' as const,
                startIndex: 0,
                length: 50,
                clusterId: 'my-cluster',
                databaseName: 'mydb',
                collectionName: 'users',
            };

            provider.handleTerminalLink(link as Parameters<typeof provider.handleTerminalLink>[0]);

            return new Promise<void>((resolve) => {
                setTimeout(() => {
                    expect(spy).toHaveBeenCalledWith(
                        'vscode-documentdb.command.playground.new.withContent',
                        expect.objectContaining({
                            clusterId: 'my-cluster',
                            databaseName: 'mydb',
                            content: "db.getCollection('users').find({ })",
                        }),
                    );
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
