/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, beforeEach, describe, expect, it, vi, type Mock, type MockInstance } from 'vitest';

import { UserCancelledError } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { ClustersClient } from '../../documentdb/ClustersClient';
import { ConnectionUnavailableError } from '../../documentdb/ConnectionUnavailableError';
import { CredentialCache } from '../../documentdb/CredentialCache';
import { Views } from '../../documentdb/Views';
import { DocumentDBShellPty, type DocumentDBShellPtyOptions } from '../../documentdb/shell/DocumentDBShellPty';
import { registerShellTerminal } from '../../documentdb/shell/ShellTerminalLinkProvider';
import * as unauthenticatedEndpoint from '../../documentdb/shell/unauthenticatedEndpoint';
import { ErrorExplanationService } from '../../services/errorExplanationService';
import { type ClusterItemBase } from '../../tree/documentdb/ClusterItemBase';
import { refreshAuthenticationNode } from '../retryAuthentication/retryAuthentication';
import { openInteractiveShell, openUnauthenticatedShell } from './openInteractiveShell';

vi.mock('../../documentdb/ClustersClient', () => {
    const latches = new Map<string, string>();
    return {
        ClustersClient: {
            getEpoch: vi.fn(() => 0),
            getLatchReason: vi.fn((clusterId: string) => latches.get(clusterId)),
            latch: vi.fn((clusterId: string, reason: string): void => {
                latches.set(clusterId, reason);
            }),
            unlatch: vi.fn((clusterId: string): void => {
                latches.delete(clusterId);
            }),
        },
    };
});

vi.mock('../../services/errorExplanationService', () => ({
    ErrorExplanationService: { explain: vi.fn() },
}));

vi.mock('../retryAuthentication/retryAuthentication', () => ({
    refreshAuthenticationNode: vi.fn(),
}));

// Mock DocumentDBShellPty
vi.mock('../../documentdb/shell/DocumentDBShellPty', () => ({
    DocumentDBShellPty: vi.fn().mockImplementation(function () {
        return {
            shellSessionId: 'shell-session',
            onDidWrite: vi.fn(),
            onDidClose: vi.fn(),
            onDidChangeName: vi.fn(),
            open: vi.fn(),
            close: vi.fn(),
            handleInput: vi.fn(),
            setTerminal: vi.fn(),
            getTerminalInfo: vi.fn().mockReturnValue({ clusterId: 'test-cluster-id' }),
            disconnect: vi.fn(),
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
        getCredentials: vi.fn(),
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
        errorHandling: {} as { suppressDisplay?: boolean },
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
        mockContext.errorHandling = {};
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
            viewId: string;
            contextValue: string;
        }>,
    ): unknown {
        return {
            contextValue: overrides?.contextValue ?? 'connectionsView;treeItem_documentdbcluster',
            cluster: {
                clusterId: overrides?.clusterId ?? 'test-cluster-id',
                name: overrides?.clusterName ?? 'TestCluster',
                treeId: 'treeId-test',
                viewId: overrides?.viewId ?? 'connectionsView',
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

    describe('unauthenticated failure-row entry', () => {
        function expectPreTerminalModal(detail: string): void {
            expect(mockShowErrorMessage).toHaveBeenCalledExactlyOnceWith('Unable to complete this tree action.', {
                modal: true,
                detail,
            });
            expect(mockCreateTerminal).not.toHaveBeenCalled();
            expect(CredentialCache.hasCredentials).not.toHaveBeenCalled();
            expect(CredentialCache.getCredentials).not.toHaveBeenCalled();
            expect(ErrorExplanationService.explain).not.toHaveBeenCalled();
            expect(mockContext.errorHandling.suppressDisplay).toBe(true);
        }

        function makeAnonymousNode(
            overrides?: Partial<{
                viewId: string;
                contextValue: string;
            }>,
        ): ClusterItemBase {
            return {
                ...(makeClusterNode(overrides) as object),
                getUnauthenticatedEndpoint: vi.fn().mockResolvedValue('mongodb://user:secret@host/?authSource=admin'),
                getCredentials: vi.fn(),
                getCredentialsForDiagnostics: vi.fn(),
            } as unknown as ClusterItemBase;
        }

        it('opens with an evicted cache and rereads sanitized endpoints without fetching credentials', async (): Promise<void> => {
            const node = makeAnonymousNode();
            vi.mocked(CredentialCache.hasCredentials).mockReturnValue(false);
            await openUnauthenticatedShell(mockContext as never, node);
            const options = vi.mocked(DocumentDBShellPty).mock.calls[0][0];
            expect(options.unauthenticated?.connectionString).toBe('mongodb://host/');
            expect(await options.unauthenticated?.reread()).toBe('mongodb://host/');
            expect(CredentialCache.hasCredentials).not.toHaveBeenCalled();
            expect(node.getCredentials).not.toHaveBeenCalled();
            expect(node.getCredentialsForDiagnostics).not.toHaveBeenCalled();
            expect(registerShellTerminal).toHaveBeenCalledWith(
                expect.anything(),
                expect.any(Function),
                expect.any(Function),
            );
            expect(mockShowTerminal).toHaveBeenCalledOnce();
        });

        it('keeps the normal command on its authenticated startup options', async (): Promise<void> => {
            await openInteractiveShell(mockContext as never, makeClusterNode() as never);
            expect(CredentialCache.hasCredentials).toHaveBeenCalledWith('test-cluster-id');
            const options: DocumentDBShellPtyOptions = vi.mocked(DocumentDBShellPty).mock.calls[0][0];
            expect(options.unauthenticated).toBeUndefined();
        });

        it('reports an unavailable endpoint without opening a terminal', async (): Promise<void> => {
            const node = makeAnonymousNode();
            vi.mocked(node.getUnauthenticatedEndpoint).mockResolvedValue(undefined);
            await openUnauthenticatedShell(mockContext as never, node);
            expect(mockShowErrorMessage).toHaveBeenCalledExactlyOnceWith(
                'Cannot open a shell without authentication for "TestCluster": its endpoint is not available.',
                { modal: true },
            );
            expect(mockCreateTerminal).not.toHaveBeenCalled();
            expect(CredentialCache.hasCredentials).not.toHaveBeenCalled();
            expect(CredentialCache.getCredentials).not.toHaveBeenCalled();
            expect(ErrorExplanationService.explain).not.toHaveBeenCalled();
        });

        it('propagates only bounded parser errors without creating a terminal', async (): Promise<void> => {
            const node = makeAnonymousNode();
            vi.mocked(node.getUnauthenticatedEndpoint).mockResolvedValue('mongodb://user:private@');
            await expect(openUnauthenticatedShell(mockContext as never, node)).rejects.toMatchObject({
                message: 'Invalid connection string.',
            });
            expectPreTerminalModal('Invalid connection string.');
        });

        it.each(['credentialsRejected', 'signInRequired', 'credentialsMissing'] as const)(
            'allows the %s hold without clearing it',
            async (reason): Promise<void> => {
                const node = makeAnonymousNode();
                ClustersClient.latch(node.cluster.clusterId, reason);
                try {
                    await openUnauthenticatedShell(mockContext as never, node);
                    expect(mockShowTerminal).toHaveBeenCalledOnce();
                    expect(ClustersClient.getLatchReason(node.cluster.clusterId)).toBe(reason);
                } finally {
                    ClustersClient.unlatch(node.cluster.clusterId);
                }
            },
        );

        it.each([
            [Views.ConnectionsView, 'connectionsView;treeItem_documentdbcluster', 'connectionRemoved'],
            [Views.DiscoveryView, 'discoveryView;treeItem_documentdbcluster', 'credentialsChanged'],
            [Views.AzureResourcesView, 'azureResourcesView;ruBranch;treeItem_documentdbcluster', 'identityChanged'],
            [
                Views.AzureResourcesView,
                'azureResourcesView;documentDbBranch;treeItem_documentdbcluster',
                'connectionRemoved',
            ],
        ] as const)(
            'refreshes and explains %s stale nodes with routing tag %s for %s',
            async (viewId, contextValue, reason): Promise<void> => {
                const node = makeAnonymousNode({ viewId, contextValue });
                ClustersClient.latch(node.cluster.clusterId, reason);
                try {
                    await expect(openUnauthenticatedShell(mockContext as never, node)).rejects.toMatchObject({
                        reason,
                    });
                    expect(refreshAuthenticationNode).toHaveBeenCalledExactlyOnceWith(node);
                    expect(refreshAuthenticationNode).toHaveBeenCalledBefore(vi.mocked(vscode.window.showErrorMessage));
                    expect(mockShowErrorMessage).toHaveBeenCalledExactlyOnceWith(
                        reason === 'connectionRemoved'
                            ? 'This connection was removed. Choose another connection.'
                            : 'This connection changed. Refresh the tree and try again.',
                        { modal: true },
                    );
                    expect(node.getUnauthenticatedEndpoint).not.toHaveBeenCalled();
                    expect(mockCreateTerminal).not.toHaveBeenCalled();
                    expect(mockContext.errorHandling.suppressDisplay).toBe(true);
                } finally {
                    ClustersClient.unlatch(node.cluster.clusterId);
                }
            },
        );

        it.each(['userDisconnected', 'credentialsUpdating', 'unreachable'] as const)(
            'uses the generic modal for the %s hold before reading an endpoint',
            async (reason): Promise<void> => {
                const node = makeAnonymousNode();
                ClustersClient.latch(node.cluster.clusterId, reason);
                try {
                    await expect(openUnauthenticatedShell(mockContext as never, node)).rejects.toMatchObject({
                        reason,
                    });
                    expect(node.getUnauthenticatedEndpoint).not.toHaveBeenCalled();
                    expect(refreshAuthenticationNode).toHaveBeenCalledExactlyOnceWith(node);
                    expectPreTerminalModal('The connection is unavailable.');
                } finally {
                    ClustersClient.unlatch(node.cluster.clusterId);
                }
            },
        );

        it.each([
            [Views.AzureWorkspaceView, 'azureWorkspaceView;treeItem_documentdbcluster'],
            [Views.AzureResourcesView, 'azureResourcesView;otherBranch;treeItem_documentdbcluster'],
        ] as const)(
            'keeps typed stale feedback generic for unsupported %s node',
            async (viewId, contextValue): Promise<void> => {
                const node = makeAnonymousNode({ viewId, contextValue });
                ClustersClient.latch(node.cluster.clusterId, 'connectionRemoved');
                try {
                    await expect(openUnauthenticatedShell(mockContext as never, node)).rejects.toMatchObject({
                        reason: 'connectionRemoved',
                    });
                    expect(refreshAuthenticationNode).not.toHaveBeenCalled();
                    expectPreTerminalModal('The connection is unavailable.');
                } finally {
                    ClustersClient.unlatch(node.cluster.clusterId);
                }
            },
        );

        it('rethrows the same unavailability error with generic feedback when no current latch exists', async (): Promise<void> => {
            const node = makeAnonymousNode();
            const error = new ConnectionUnavailableError('credentialsChanged');
            vi.mocked(node.getUnauthenticatedEndpoint).mockRejectedValueOnce(error);

            await expect(openUnauthenticatedShell(mockContext as never, node)).rejects.toBe(error);

            expect(refreshAuthenticationNode).toHaveBeenCalledExactlyOnceWith(node);
            expectPreTerminalModal(error.message);
        });

        it('uses the current latch rather than the unavailable error reason', async (): Promise<void> => {
            const node = makeAnonymousNode();
            const error = new ConnectionUnavailableError('credentialsChanged');
            vi.mocked(node.getUnauthenticatedEndpoint).mockImplementationOnce(async (): Promise<string> => {
                ClustersClient.latch(node.cluster.clusterId, 'connectionRemoved');
                throw error;
            });
            try {
                await expect(openUnauthenticatedShell(mockContext as never, node)).rejects.toBe(error);
                expect(refreshAuthenticationNode).toHaveBeenCalledExactlyOnceWith(node);
                expect(mockShowErrorMessage).toHaveBeenCalledExactlyOnceWith(
                    'This connection was removed. Choose another connection.',
                    { modal: true },
                );
            } finally {
                ClustersClient.unlatch(node.cluster.clusterId);
            }
        });

        it('honors Disconnect during the endpoint read', async (): Promise<void> => {
            const node = makeAnonymousNode();
            vi.mocked(node.getUnauthenticatedEndpoint).mockImplementation(async (): Promise<string> => {
                ClustersClient.latch(node.cluster.clusterId, 'userDisconnected');
                return 'mongodb://host/';
            });

            try {
                await expect(openUnauthenticatedShell(mockContext as never, node)).rejects.toMatchObject({
                    reason: 'userDisconnected',
                });
                expectPreTerminalModal('The connection is unavailable.');
            } finally {
                ClustersClient.unlatch(node.cluster.clusterId);
            }
        });

        it('honors an epoch change during the endpoint read before opening a terminal', async (): Promise<void> => {
            const node = makeAnonymousNode();
            let epoch = 0;
            vi.mocked(ClustersClient.getEpoch).mockImplementation(() => epoch);
            vi.mocked(node.getUnauthenticatedEndpoint).mockImplementation(async (): Promise<string> => {
                epoch++;
                return 'mongodb://host/';
            });
            await expect(openUnauthenticatedShell(mockContext as never, node)).rejects.toMatchObject({
                reason: 'credentialsChanged',
            });
            expectPreTerminalModal('The connection is unavailable.');
            expect(refreshAuthenticationNode).toHaveBeenCalledExactlyOnceWith(node);
            vi.mocked(ClustersClient.getEpoch).mockReturnValue(0);
        });

        it.each(['endpoint', 'sanitization', 'pty'] as const)(
            'shows one modal and rethrows the same safe %s failure',
            async (phase): Promise<void> => {
                const node = makeAnonymousNode();
                const error = new Error('Safe startup failure');
                if (phase === 'endpoint') {
                    vi.mocked(node.getUnauthenticatedEndpoint).mockRejectedValueOnce(error);
                } else if (phase === 'sanitization') {
                    vi.spyOn(unauthenticatedEndpoint, 'toUnauthenticatedConnectionString').mockImplementationOnce(
                        (): never => {
                            throw error;
                        },
                    );
                } else {
                    vi.mocked(DocumentDBShellPty).mockImplementationOnce(function (): never {
                        throw error;
                    });
                }
                await expect(openUnauthenticatedShell(mockContext as never, node)).rejects.toBe(error);
                expectPreTerminalModal(error.message);
            },
        );

        it('keeps endpoint-read cancellation quiet and rethrows the same cancellation', async (): Promise<void> => {
            const node = makeAnonymousNode();
            const cancellation = new UserCancelledError();
            vi.mocked(node.getUnauthenticatedEndpoint).mockRejectedValueOnce(cancellation);
            await expect(openUnauthenticatedShell(mockContext as never, node)).rejects.toBe(cancellation);
            expect(mockShowErrorMessage).not.toHaveBeenCalled();
            expect(refreshAuthenticationNode).not.toHaveBeenCalled();
            expect(mockCreateTerminal).not.toHaveBeenCalled();
            expect(mockContext.errorHandling.suppressDisplay).toBeUndefined();
            expect(CredentialCache.hasCredentials).not.toHaveBeenCalled();
            expect(ErrorExplanationService.explain).not.toHaveBeenCalled();
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
        it('attributes URL-driven opens and returns their session id', async (): Promise<void> => {
            const deepLink = { deepLinkCorrelationId: 'link-id', deepLinkSource: 'portal' };
            const result = await openInteractiveShell(mockContext as never, makeClusterNode() as never, null, {
                deepLink,
            });
            expect(result).toEqual({ opened: true, shellSessionId: 'shell-session' });
            expect(mockContext.telemetry.properties).toMatchObject({
                activationSource: 'deepLink',
                deepLinkSource: 'portal',
                deepLinkCorrelationId: 'link-id',
                shellSessionId: 'shell-session',
            });
        });

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
