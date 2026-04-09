/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import {
    ACTION_LINE_PREFIX,
    registerShellTerminal,
    ShellTerminalLinkProvider,
    unregisterShellTerminal,
} from './ShellTerminalLinkProvider';

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
                line: `${ACTION_LINE_PREFIX}Open collection [mydb.users] in Collection View`,
            } as vscode.TerminalLinkContext;

            const links = provider.provideTerminalLinks(context);
            expect(links).toEqual([]);
        });

        it('should return empty array when line does not match action pattern', () => {
            registerShellTerminal(mockTerminal, () => ({ clusterId: 'test-id' }));

            const context = {
                terminal: mockTerminal,
                line: '  "name": "Alice"',
            } as vscode.TerminalLinkContext;

            const links = provider.provideTerminalLinks(context);
            expect(links).toEqual([]);
        });

        it('should detect action line and return a link', () => {
            registerShellTerminal(mockTerminal, () => ({ clusterId: 'test-cluster-id' }));

            const actionLine = `${ACTION_LINE_PREFIX}Open collection [mydb.users] in Collection View`;
            const context = {
                terminal: mockTerminal,
                line: actionLine,
            } as vscode.TerminalLinkContext;

            const links = provider.provideTerminalLinks(context);
            expect(links).toHaveLength(1);
            expect(links[0].databaseName).toBe('mydb');
            expect(links[0].collectionName).toBe('users');
            expect(links[0].clusterId).toBe('test-cluster-id');
        });

        it('should handle collection names with dots', () => {
            registerShellTerminal(mockTerminal, () => ({ clusterId: 'test-id' }));

            const actionLine = `${ACTION_LINE_PREFIX}Open collection [analytics.events.2024] in Collection View`;
            const context = {
                terminal: mockTerminal,
                line: actionLine,
            } as vscode.TerminalLinkContext;

            const links = provider.provideTerminalLinks(context);
            expect(links).toHaveLength(1);
            // First dot separates db from collection; rest belongs to collection name
            expect(links[0].databaseName).toBe('analytics');
            expect(links[0].collectionName).toBe('events.2024');
        });

        it('should handle collection names with parentheses', () => {
            registerShellTerminal(mockTerminal, () => ({ clusterId: 'test-id' }));

            const actionLine = `${ACTION_LINE_PREFIX}Open collection [mydb.stores (10)] in Collection View`;
            const context = {
                terminal: mockTerminal,
                line: actionLine,
            } as vscode.TerminalLinkContext;

            const links = provider.provideTerminalLinks(context);
            expect(links).toHaveLength(1);
            expect(links[0].databaseName).toBe('mydb');
            expect(links[0].collectionName).toBe('stores (10)');
        });

        it('should handle collection names with spaces', () => {
            registerShellTerminal(mockTerminal, () => ({ clusterId: 'test-id' }));

            const actionLine = `${ACTION_LINE_PREFIX}Open collection [mydb.my collection] in Collection View`;
            const context = {
                terminal: mockTerminal,
                line: actionLine,
            } as vscode.TerminalLinkContext;

            const links = provider.provideTerminalLinks(context);
            expect(links).toHaveLength(1);
            expect(links[0].databaseName).toBe('mydb');
            expect(links[0].collectionName).toBe('my collection');
        });

        it('should handle ANSI-wrapped action line (gray color)', () => {
            registerShellTerminal(mockTerminal, () => ({ clusterId: 'test-id' }));

            // Gray ANSI wrapping: \x1b[90m ... \x1b[0m
            const actionLine = `\x1b[90m${ACTION_LINE_PREFIX}Open collection [mydb.users] in Collection View\x1b[0m`;
            const context = {
                terminal: mockTerminal,
                line: actionLine,
            } as vscode.TerminalLinkContext;

            const links = provider.provideTerminalLinks(context);
            expect(links).toHaveLength(1);
            expect(links[0].databaseName).toBe('mydb');
            expect(links[0].collectionName).toBe('users');
        });

        it('should not match partial action line text', () => {
            registerShellTerminal(mockTerminal, () => ({ clusterId: 'test-id' }));

            const context = {
                terminal: mockTerminal,
                line: 'Open collection [mydb.users] in Collection View', // Missing 📊 prefix
            } as vscode.TerminalLinkContext;

            const links = provider.provideTerminalLinks(context);
            expect(links).toEqual([]);
        });
    });

    describe('handleTerminalLink', () => {
        it('should execute the open collection view command', () => {
            const spy = jest.spyOn(vscode.commands, 'executeCommand').mockResolvedValue(undefined);

            const link = {
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

    describe('registry', () => {
        it('should not match after terminal is unregistered', () => {
            registerShellTerminal(mockTerminal, () => ({ clusterId: 'test-id' }));
            unregisterShellTerminal(mockTerminal);

            const actionLine = `${ACTION_LINE_PREFIX}Open collection [mydb.users] in Collection View`;
            const context = {
                terminal: mockTerminal,
                line: actionLine,
            } as vscode.TerminalLinkContext;

            const links = provider.provideTerminalLinks(context);
            expect(links).toEqual([]);
        });
    });
});
