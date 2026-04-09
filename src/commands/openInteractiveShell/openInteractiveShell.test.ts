/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { CredentialCache } from '../../documentdb/CredentialCache';
import { openInteractiveShell } from './openInteractiveShell';

// Mock DocumentDBShellPty
jest.mock('../../documentdb/shell/DocumentDBShellPty', () => ({
    DocumentDBShellPty: jest.fn().mockImplementation(() => ({
        onDidWrite: jest.fn(),
        onDidClose: jest.fn(),
        open: jest.fn(),
        close: jest.fn(),
        handleInput: jest.fn(),
    })),
}));

// Mock CredentialCache
jest.mock('../../documentdb/CredentialCache', () => ({
    CredentialCache: {
        hasCredentials: jest.fn().mockReturnValue(true),
    },
}));

describe('openInteractiveShell', () => {
    let mockCreateTerminal: jest.SpyInstance;
    let mockShowTerminal: jest.Mock;
    let mockShowInformationMessage: jest.SpyInstance;
    let mockShowErrorMessage: jest.SpyInstance;

    const mockContext = {
        telemetry: {
            properties: {} as Record<string, string>,
            measurements: {},
        },
        errorHandling: {},
        ui: {},
        valuesToMask: [],
    };

    beforeEach(() => {
        jest.clearAllMocks();
        mockShowTerminal = jest.fn();
        mockCreateTerminal = jest.spyOn(vscode.window, 'createTerminal').mockReturnValue({
            show: mockShowTerminal,
        } as unknown as vscode.Terminal);
        mockShowInformationMessage = jest.spyOn(vscode.window, 'showInformationMessage').mockResolvedValue(undefined);
        mockShowErrorMessage = jest.spyOn(vscode.window, 'showErrorMessage').mockResolvedValue(undefined);
        mockContext.telemetry.properties = {};
        (CredentialCache.hasCredentials as jest.Mock).mockReturnValue(true);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    function makeDatabaseNode(
        overrides?: Partial<{
            clusterId: string;
            clusterName: string;
            databaseName: string;
        }>,
    ): unknown {
        return {
            cluster: {
                clusterId: overrides?.clusterId ?? 'test-cluster-id',
                name: overrides?.clusterName ?? 'TestCluster',
                treeId: 'treeId-test',
                viewId: 'connectionsView',
                dbExperience: { api: 'documentDB' },
            },
            databaseInfo: {
                name: overrides?.databaseName ?? 'mydb',
            },
            experience: { api: 'documentDB' },
        };
    }

    function makeClusterNode(
        overrides?: Partial<{
            clusterId: string;
            clusterName: string;
        }>,
    ): unknown {
        return {
            cluster: {
                clusterId: overrides?.clusterId ?? 'test-cluster-id',
                name: overrides?.clusterName ?? 'TestCluster',
                treeId: 'treeId-test',
                viewId: 'connectionsView',
                dbExperience: { api: 'documentDB' },
            },
            experience: { api: 'documentDB' },
        };
    }

    function makeCollectionNode(): unknown {
        return {
            cluster: {
                clusterId: 'test-cluster-id',
                name: 'TestCluster',
                treeId: 'treeId-test',
                viewId: 'connectionsView',
                dbExperience: { api: 'documentDB' },
            },
            databaseInfo: {
                name: 'mydb',
            },
            collectionInfo: {
                name: 'users',
            },
            experience: { api: 'documentDB' },
        };
    }

    describe('when invoked without a node', () => {
        it('should show informational message', async () => {
            await openInteractiveShell(mockContext as never);

            expect(mockShowInformationMessage).toHaveBeenCalled();
            expect(mockCreateTerminal).not.toHaveBeenCalled();
        });
    });

    describe('when invoked from a database node', () => {
        it('should create terminal with correct name', async () => {
            await openInteractiveShell(mockContext as never, makeDatabaseNode() as never);

            expect(mockCreateTerminal).toHaveBeenCalledWith(
                expect.objectContaining({
                    name: expect.stringContaining('TestCluster') as string,
                }),
            );
            expect(mockCreateTerminal).toHaveBeenCalledWith(
                expect.objectContaining({
                    name: expect.stringContaining('mydb') as string,
                }),
            );
        });

        it('should show the terminal', async () => {
            await openInteractiveShell(mockContext as never, makeDatabaseNode() as never);
            expect(mockShowTerminal).toHaveBeenCalled();
        });

        it('should set telemetry properties', async () => {
            await openInteractiveShell(mockContext as never, makeDatabaseNode() as never);
            expect(mockContext.telemetry.properties.experience).toBe('documentDB');
            expect(mockContext.telemetry.properties.nodeType).toBe('database');
        });
    });

    describe('when invoked from a cluster node', () => {
        it('should create terminal with default database "test"', async () => {
            await openInteractiveShell(mockContext as never, makeClusterNode() as never);

            expect(mockCreateTerminal).toHaveBeenCalledWith(
                expect.objectContaining({
                    name: expect.stringContaining('test') as string,
                }),
            );
        });

        it('should set nodeType to cluster', async () => {
            await openInteractiveShell(mockContext as never, makeClusterNode() as never);
            expect(mockContext.telemetry.properties.nodeType).toBe('cluster');
        });
    });

    describe('when invoked from a collection node', () => {
        it('should use collection database name', async () => {
            await openInteractiveShell(mockContext as never, makeCollectionNode() as never);

            expect(mockCreateTerminal).toHaveBeenCalledWith(
                expect.objectContaining({
                    name: expect.stringContaining('mydb') as string,
                }),
            );
        });

        it('should set nodeType to collection', async () => {
            await openInteractiveShell(mockContext as never, makeCollectionNode() as never);
            expect(mockContext.telemetry.properties.nodeType).toBe('collection');
        });
    });

    describe('when credentials are missing', () => {
        it('should show error and not create terminal', async () => {
            (CredentialCache.hasCredentials as jest.Mock).mockReturnValue(false);

            await openInteractiveShell(mockContext as never, makeDatabaseNode() as never);

            expect(mockShowErrorMessage).toHaveBeenCalledWith(expect.stringContaining('Not signed in') as string);
            expect(mockCreateTerminal).not.toHaveBeenCalled();
        });
    });
});
