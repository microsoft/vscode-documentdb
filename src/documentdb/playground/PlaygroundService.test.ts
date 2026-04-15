/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { PlaygroundService } from './PlaygroundService';
import { type PlaygroundConnection } from './types';

// Access the vscode mock (auto-mock from __mocks__/vscode.js)
import * as vscode from 'vscode';

describe('PlaygroundService', () => {
    let service: PlaygroundService;

    const mockUri = { toString: () => 'untitled:playground-1.documentdb.js' } as vscode.Uri;

    beforeEach(() => {
        // Reset singleton between tests
        service = PlaygroundService.getInstance();
    });

    afterEach(() => {
        service.dispose();
    });

    describe('singleton', () => {
        it('returns the same instance on repeated calls', () => {
            const second = PlaygroundService.getInstance();
            expect(second).toBe(service);
        });

        it('creates a new instance after dispose', () => {
            service.dispose();
            const fresh = PlaygroundService.getInstance();
            expect(fresh).not.toBe(service);
            service = fresh; // reassign for afterEach cleanup
        });
    });

    describe('connection management', () => {
        const connection: PlaygroundConnection = {
            clusterId: 'cluster-123',
            clusterDisplayName: 'MyCluster',
            databaseName: 'orders',
        };

        it('starts disconnected', () => {
            expect(service.isConnected(mockUri)).toBe(false);
            expect(service.getConnection(mockUri)).toBeUndefined();
            expect(service.getDisplayName(mockUri)).toBeUndefined();
        });

        it('setConnection stores the connection for a specific URI', () => {
            service.setConnection(mockUri, connection);
            expect(service.isConnected(mockUri)).toBe(true);
            expect(service.getConnection(mockUri)).toBe(connection);
        });

        it('getDisplayName returns formatted string', () => {
            service.setConnection(mockUri, connection);
            expect(service.getDisplayName(mockUri)).toBe('MyCluster / orders');
        });

        it('removeConnection resets to disconnected', () => {
            service.setConnection(mockUri, connection);
            service.removeConnection(mockUri);
            expect(service.isConnected(mockUri)).toBe(false);
            expect(service.getConnection(mockUri)).toBeUndefined();
        });

        it('fires onDidChangeState on setConnection', () => {
            const listener = jest.fn();
            service.onDidChangeState(listener);
            service.setConnection(mockUri, connection);
            expect(listener).toHaveBeenCalledTimes(1);
        });

        it('fires onDidChangeState on removeConnection', () => {
            service.setConnection(mockUri, connection);
            const listener = jest.fn();
            service.onDidChangeState(listener);
            service.removeConnection(mockUri);
            expect(listener).toHaveBeenCalledTimes(1);
        });

        it('supports multiple documents with different connections', () => {
            const uri2 = { toString: () => 'untitled:playground-2.documentdb.js' } as vscode.Uri;
            const connection2: PlaygroundConnection = {
                clusterId: 'cluster-456',
                clusterDisplayName: 'OtherCluster',
                databaseName: 'products',
            };

            service.setConnection(mockUri, connection);
            service.setConnection(uri2, connection2);

            expect(service.getConnection(mockUri)).toBe(connection);
            expect(service.getConnection(uri2)).toBe(connection2);
            expect(service.getDisplayName(mockUri)).toBe('MyCluster / orders');
            expect(service.getDisplayName(uri2)).toBe('OtherCluster / products');
        });

        it('getActiveClusterIds returns all unique cluster IDs', () => {
            const uri2 = { toString: () => 'untitled:playground-2.documentdb.js' } as vscode.Uri;
            const connection2: PlaygroundConnection = {
                clusterId: 'cluster-456',
                clusterDisplayName: 'OtherCluster',
                databaseName: 'products',
            };

            service.setConnection(mockUri, connection);
            service.setConnection(uri2, connection2);

            const ids = service.getActiveClusterIds();
            expect(ids.size).toBe(2);
            expect(ids.has('cluster-123')).toBe(true);
            expect(ids.has('cluster-456')).toBe(true);
        });

        it('hasPlaygroundsForCluster checks for open playgrounds on a cluster', () => {
            service.setConnection(mockUri, connection);
            expect(service.hasPlaygroundsForCluster('cluster-123')).toBe(true);
            expect(service.hasPlaygroundsForCluster('cluster-other')).toBe(false);
        });
    });

    describe('execution state', () => {
        it('starts not executing', () => {
            expect(service.isExecuting).toBe(false);
        });

        it('setExecuting updates state and fires event', () => {
            const listener = jest.fn();
            service.onDidChangeState(listener);
            service.setExecuting(true);
            expect(service.isExecuting).toBe(true);
            expect(listener).toHaveBeenCalledTimes(1);
        });
    });

    describe('StatusBarItem', () => {
        it('creates a StatusBarItem with the showConnectionInfo command', () => {
            // The StatusBarItem is created in the constructor; verify it was configured
            expect(vscode.window.createStatusBarItem).toHaveBeenCalledWith(vscode.StatusBarAlignment.Left, 100);
        });
    });

    describe('onDidCloseTextDocument cleanup', () => {
        const connection: PlaygroundConnection = {
            clusterId: 'cluster-123',
            clusterDisplayName: 'MyCluster',
            databaseName: 'orders',
        };

        function getCloseDocHandler(): (doc: Partial<vscode.TextDocument>) => void {
            const calls = (vscode.workspace.onDidCloseTextDocument as jest.Mock).mock.calls;
            // Find the callback registered by PlaygroundService
            const lastCall = calls[calls.length - 1];
            return lastCall[0] as (doc: Partial<vscode.TextDocument>) => void;
        }

        it('removes connection when a playground document is closed', () => {
            service.setConnection(mockUri, connection);
            expect(service.isConnected(mockUri)).toBe(true);

            const handler = getCloseDocHandler();
            handler({
                uri: mockUri,
                languageId: 'documentdb-playground',
            });

            expect(service.isConnected(mockUri)).toBe(false);
            expect(service.getConnection(mockUri)).toBeUndefined();
        });

        it('fires onDidChangeState when document is closed', () => {
            service.setConnection(mockUri, connection);
            const listener = jest.fn();
            service.onDidChangeState(listener);

            const handler = getCloseDocHandler();
            handler({
                uri: mockUri,
                languageId: 'documentdb-playground',
            });

            expect(listener).toHaveBeenCalledTimes(1);
        });

        it('ignores non-playground documents', () => {
            service.setConnection(mockUri, connection);

            const handler = getCloseDocHandler();
            handler({
                uri: mockUri,
                languageId: 'javascript',
            });

            expect(service.isConnected(mockUri)).toBe(true);
        });
    });

    describe('untitled→file URI migration', () => {
        const connection: PlaygroundConnection = {
            clusterId: 'cluster-123',
            clusterDisplayName: 'MyCluster',
            databaseName: 'orders',
        };

        function getCloseDocHandler(): (doc: Partial<vscode.TextDocument>) => void {
            const calls = (vscode.workspace.onDidCloseTextDocument as jest.Mock).mock.calls;
            return calls[calls.length - 1][0] as (doc: Partial<vscode.TextDocument>) => void;
        }

        function getOpenDocHandler(): (doc: Partial<vscode.TextDocument>) => void {
            const calls = (vscode.workspace.onDidOpenTextDocument as jest.Mock).mock.calls;
            return calls[calls.length - 1][0] as (doc: Partial<vscode.TextDocument>) => void;
        }

        it('migrates connection when untitled doc closes and file doc opens with same fsPath', () => {
            const fsPath = '/workspace/playground-test.documentdb.js';
            const untitledUri = {
                toString: () => `untitled:${fsPath}`,
                scheme: 'untitled',
                fsPath,
            } as vscode.Uri;
            const fileUri = {
                toString: () => `file://${fsPath}`,
                scheme: 'file',
                fsPath,
            } as vscode.Uri;

            service.setConnection(untitledUri, connection);
            expect(service.isConnected(untitledUri)).toBe(true);

            // Simulate VS Code closing the untitled doc on save
            const closeHandler = getCloseDocHandler();
            closeHandler({
                uri: untitledUri,
                languageId: 'documentdb-playground',
            });

            expect(service.isConnected(untitledUri)).toBe(false);

            // Simulate VS Code opening the file doc
            const openHandler = getOpenDocHandler();
            openHandler({
                uri: fileUri,
                languageId: 'documentdb-playground',
            });

            expect(service.isConnected(fileUri)).toBe(true);
            expect(service.getConnection(fileUri)).toEqual(connection);
        });
    });
});
