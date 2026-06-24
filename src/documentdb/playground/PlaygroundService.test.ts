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
        const connection: PlaygroundConnection = {
            clusterId: 'cluster-123',
            clusterDisplayName: 'MyCluster',
            databaseName: 'orders',
        };

        it('starts not executing', () => {
            expect(service.isExecuting()).toBe(false);
            expect(service.isExecuting('cluster-123')).toBe(false);
        });

        it('setExecuting tracks state per cluster and fires event', () => {
            const listener = jest.fn();
            service.onDidChangeState(listener);
            service.setExecuting('cluster-123', true);
            expect(service.isExecuting('cluster-123')).toBe(true);
            expect(service.isExecuting()).toBe(true);
            expect(listener).toHaveBeenCalledTimes(1);
        });

        it('setExecuting(false) clears state for a specific cluster', () => {
            service.setExecuting('cluster-123', true);
            service.setExecuting('cluster-456', true);
            service.setExecuting('cluster-123', false);
            expect(service.isExecuting('cluster-123')).toBe(false);
            expect(service.isExecuting('cluster-456')).toBe(true);
            expect(service.isExecuting()).toBe(true);
        });

        it('isExecutingForUri checks the document connection cluster', () => {
            service.setConnection(mockUri, connection);
            expect(service.isExecutingForUri(mockUri)).toBe(false);
            service.setExecuting('cluster-123', true);
            expect(service.isExecutingForUri(mockUri)).toBe(true);
        });

        it('isExecutingForUri returns false for disconnected documents', () => {
            service.setExecuting('cluster-123', true);
            expect(service.isExecutingForUri(mockUri)).toBe(false);
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

    describe('untitled→file connection migration on save', () => {
        const connection: PlaygroundConnection = {
            clusterId: 'cluster-123',
            clusterDisplayName: 'MyCluster',
            databaseName: 'orders',
        };

        function getSaveDocHandler(): (doc: Partial<vscode.TextDocument>) => void {
            const calls = (vscode.workspace.onDidSaveTextDocument as jest.Mock).mock.calls;
            return calls[calls.length - 1][0] as (doc: Partial<vscode.TextDocument>) => void;
        }

        function setOpenDocuments(docs: Partial<vscode.TextDocument>[]): void {
            Object.defineProperty(vscode.workspace, 'textDocuments', {
                value: docs,
                configurable: true,
            });
        }

        function makeUntitledDoc(uriString: string, text: string): Partial<vscode.TextDocument> {
            return {
                uri: { toString: () => uriString, scheme: 'untitled' } as vscode.Uri,
                languageId: 'documentdb-playground',
                lineCount: text.split('\n').length,
                getText: () => text,
                offsetAt: () => text.length,
            };
        }

        function makeFileDoc(uriString: string, text: string): Partial<vscode.TextDocument> {
            return {
                uri: { toString: () => uriString, scheme: 'file' } as vscode.Uri,
                languageId: 'documentdb-playground',
                lineCount: text.split('\n').length,
                getText: () => text,
                offsetAt: () => text.length,
            };
        }

        afterEach(() => {
            // Reset to an empty document list for other suites
            setOpenDocuments([]);
        });

        it('re-keys the connection onto the saved file document (content match)', () => {
            const content = "// Query Playground: MyCluster\ndb.getCollection('orders').find({ })";
            const untitled = makeUntitledDoc('untitled:/tmp/orders.documentdb.js', content);
            service.setConnection(untitled.uri as vscode.Uri, connection);
            setOpenDocuments([untitled]);

            // The saved file gains a trailing newline (insertFinalNewline) — still matches.
            const fileDoc = makeFileDoc('file:///home/u/orders.documentdb.documentdb.js', content + '\n');
            getSaveDocHandler()(fileDoc);

            expect(service.isConnected(fileDoc.uri as vscode.Uri)).toBe(true);
            expect(service.getConnection(fileDoc.uri as vscode.Uri)).toEqual(connection);
            expect(service.isConnected(untitled.uri as vscode.Uri)).toBe(false);
        });

        it('does not migrate when no untitled playground has matching content', () => {
            const untitled = makeUntitledDoc('untitled:/tmp/orders.documentdb.js', 'db.orders.find({})');
            service.setConnection(untitled.uri as vscode.Uri, connection);
            setOpenDocuments([untitled]);

            const fileDoc = makeFileDoc('file:///home/u/other.documentdb.documentdb.js', 'db.products.find({})');
            getSaveDocHandler()(fileDoc);

            expect(service.isConnected(fileDoc.uri as vscode.Uri)).toBe(false);
            expect(service.isConnected(untitled.uri as vscode.Uri)).toBe(true);
        });

        it('does not migrate when the content match is ambiguous (Save All of identical buffers)', () => {
            const content = 'db.orders.find({})';
            const untitledA = makeUntitledDoc('untitled:/tmp/a.documentdb.js', content);
            const untitledB = makeUntitledDoc('untitled:/tmp/b.documentdb.js', content);
            service.setConnection(untitledA.uri as vscode.Uri, connection);
            service.setConnection(untitledB.uri as vscode.Uri, {
                clusterId: 'cluster-999',
                clusterDisplayName: 'Other',
                databaseName: 'misc',
            });
            setOpenDocuments([untitledA, untitledB]);

            const fileDoc = makeFileDoc('file:///home/u/a.documentdb.documentdb.js', content);
            getSaveDocHandler()(fileDoc);

            // Ambiguous → leave everything untouched rather than bind the wrong connection.
            expect(service.isConnected(fileDoc.uri as vscode.Uri)).toBe(false);
            expect(service.isConnected(untitledA.uri as vscode.Uri)).toBe(true);
            expect(service.isConnected(untitledB.uri as vscode.Uri)).toBe(true);
        });

        it('does not migrate when the document exceeds the size cap', () => {
            const huge = 'x'.repeat(1_000_001);
            const untitled = makeUntitledDoc('untitled:/tmp/big.documentdb.js', huge);
            service.setConnection(untitled.uri as vscode.Uri, connection);
            setOpenDocuments([untitled]);

            const fileDoc = makeFileDoc('file:///home/u/big.documentdb.documentdb.js', huge);
            getSaveDocHandler()(fileDoc);

            expect(service.isConnected(fileDoc.uri as vscode.Uri)).toBe(false);
            expect(service.isConnected(untitled.uri as vscode.Uri)).toBe(true);
        });
    });
});
