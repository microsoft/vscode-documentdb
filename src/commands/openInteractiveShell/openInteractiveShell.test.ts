/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, beforeEach, describe, expect, it, vi, type Mock, type MockInstance } from 'vitest';

import * as vscode from 'vscode';
import { CredentialCache } from '../../documentdb/CredentialCache';
import { openInteractiveShell } from './openInteractiveShell';

// Mock DocumentDBShellPty
vi.mock('../../documentdb/shell/DocumentDBShellPty', () => ({
    DocumentDBShellPty: vi.fn().mockImplementation(function () {
        return {
            onDidWrite: vi.fn(),
            onDidClose: vi.fn(),
            onDidChangeName: vi.fn(),
            open: vi.fn(),
            close: vi.fn(),
            handleInput: vi.fn(),
            setTerminal: vi.fn(),
            getTerminalInfo: vi.fn().mockReturnValue({ clusterId: 'test-cluster-id' }),
        };
    }),
}));

// Mock ShellTerminalLinkProvider registry
vi.mock('../../documentdb/shell/ShellTerminalLinkProvider', () => ({
    registerShellTerminal: vi.fn(),
    unregisterShellTerminal: vi.fn(),
}));

// Mock CredentialCache
vi.mock('../../documentdb/CredentialCache', () => ({
    CredentialCache: {
        hasCredentials: vi.fn().mockReturnValue(true),
    },
}));

describe('openInteractiveShell', () => {
    let mockCreateTerminal: MockInstance;
    let mockShowTerminal: Mock;
    let mockShowInformationMessage: MockInstance;
    let mockShowErrorMessage: MockInstance;

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
        vi.clearAllMocks();
        mockShowTerminal = vi.fn();
        mockCreateTerminal = vi.spyOn(vscode.window, 'createTerminal').mockReturnValue({
            show: mockShowTerminal,
        } as unknown as vscode.Terminal);
        mockShowInformationMessage = vi.spyOn(vscode.window, 'showInformationMessage').mockResolvedValue(undefined);
        mockShowErrorMessage = vi.spyOn(vscode.window, 'showErrorMessage').mockResolvedValue(undefined);
        mockContext.telemetry.properties = {};
        (CredentialCache.hasCredentials as Mock).mockReturnValue(true);
    });

    afterEach(() => {
        vi.restoreAllMocks();
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
            (CredentialCache.hasCredentials as Mock).mockReturnValue(false);

            await openInteractiveShell(mockContext as never, makeDatabaseNode() as never);

            expect(mockShowErrorMessage).toHaveBeenCalledWith(expect.stringContaining('Not signed in') as string);
            expect(mockCreateTerminal).not.toHaveBeenCalled();
        });
    });
});
