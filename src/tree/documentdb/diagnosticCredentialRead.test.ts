/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { type AzureSubscription } from '@microsoft/vscode-azureresources-api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { DocumentDBExperience } from '../../DocumentDBExperiences';
import { CredentialCache } from '../../documentdb/CredentialCache';
import { Views } from '../../documentdb/Views';
import { AtlasClusterItem } from '../../plugins/service-atlas-mongodb/discovery-tree/AtlasClusterItem';
import { type AtlasClusterModel } from '../../plugins/service-atlas-mongodb/models/AtlasClusterModel';
import {
    AzureVMResourceItem,
    type VirtualMachineModel,
} from '../../plugins/service-azure-vm/discovery-tree/vm/AzureVMResourceItem';
import { VCoreResourceItem } from '../azure-resources-view/documentdb/VCoreResourceItem';
import { type AzureClusterModel } from '../azure-views/models/AzureClusterModel';
import { type TreeCluster } from '../models/BaseClusterModel';
import {
    ConnectionEndpointUnavailableError,
    ConnectionInputCancelledError,
    ConnectionSourceUnavailableError,
} from './diagnosticCredentialRead';
import { cancellationTokenFromSignal, readCredentialsForDiagnostics } from './readCredentialsForDiagnostics';

const telemetry = vi.hoisted(() => ({ contexts: [] as IActionContext[] }));

// Mirrors the real helper's contract: errors are displayed unless suppressDisplay is set, and
// swallowed (resolving undefined) unless rethrow is set.
vi.mock('@microsoft/vscode-azext-utils', async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    const vscodeMock = await import('vscode');
    return {
        ...actual,
        callWithTelemetryAndErrorHandling: vi.fn(
            async <T>(_name: string, callback: (context: IActionContext) => Promise<T>): Promise<T | undefined> => {
                const context = {
                    telemetry: { properties: {}, measurements: {} },
                    errorHandling: {},
                    valuesToMask: [],
                    ui: { showInputBox: vi.fn() },
                } as unknown as IActionContext;
                telemetry.contexts.push(context);
                try {
                    return await callback(context);
                } catch (error) {
                    if (!context.errorHandling.suppressDisplay) {
                        void vscodeMock.window.showErrorMessage(error instanceof Error ? error.message : String(error));
                    }
                    if (context.errorHandling.rethrow) {
                        throw error;
                    }
                    return undefined;
                }
            },
        ),
    };
});

const azure = vi.hoisted(() => ({ getClusterInformationFromAzure: vi.fn() }));
vi.mock('../../plugins/service-azure-mongo-vcore/utils/clusterHelpers', () => ({
    getClusterInformationFromAzure: azure.getClusterInformationFromAzure,
    extractCredentialsFromCluster: vi.fn(() => ({
        connectionString: 'mongodb://cluster.example/',
        availableAuthMethods: [],
    })),
}));

vi.mock('../../utils/icons', () => ({
    getThemeAgnosticIconPath: vi.fn(() => 'icon.svg'),
    getResourcesPath: vi.fn(() => '/resources'),
}));

const subscription = { subscriptionId: 'sub', tenantId: 'tenant' } as unknown as AzureSubscription;

function read(signal: AbortSignal = new AbortController().signal): { signal: AbortSignal } {
    return { signal };
}

function armError(statusCode: number): Error {
    return Object.assign(new Error('The client does not have authorization over /subscriptions/sub'), {
        name: 'RestError',
        statusCode,
    });
}

describe('diagnostic credential reads (review R2, option A)', (): void => {
    beforeEach((): void => {
        telemetry.contexts.length = 0;
        vi.mocked(vscode.window.showErrorMessage).mockClear();
        vi.mocked(vscode.window.showWarningMessage).mockClear();
        vi.mocked(vscode.window.showInputBox).mockReset();
        vi.spyOn(CredentialCache, 'getCredentials').mockReturnValue(undefined);
    });
    afterEach((): void => {
        vi.restoreAllMocks();
    });

    describe('readCredentialsForDiagnostics', (): void => {
        it('records telemetry but neither displays nor swallows errors', async (): Promise<void> => {
            const cause = new Error('Private resource unavailable');
            const failure = Object.assign(
                new Error('Permission denied for namespace orchid-prod at api.orchid.internal'),
                { cause },
            );
            const pending = readCredentialsForDiagnostics('read', 'azure', read(), async (context): Promise<never> => {
                expect(context.telemetry.maskEntireErrorMessage).toBe(true);
                throw failure;
            });
            await expect(pending).rejects.toMatchObject({
                name: 'ConnectionSourceUnavailableError',
                source: 'azure',
                sourceError: failure,
            });
            const wrapped = await pending.catch((error: unknown): unknown => error);
            expect(wrapped instanceof ConnectionSourceUnavailableError && wrapped.sourceError).toBe(failure);
            expect(failure.cause).toBe(cause);
            expect(telemetry.contexts[0].errorHandling).toMatchObject({
                rethrow: true,
                suppressDisplay: true,
                suppressReportIssue: true,
            });
            expect(telemetry.contexts[0].telemetry.properties.connectionIntent).toBe('diagnostic');
            expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
            expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
        });

        it.each([
            new ConnectionSourceUnavailableError('atlas', new Error('Private source unavailable')),
            new ConnectionEndpointUnavailableError('kubernetes', 'pending'),
            new ConnectionInputCancelledError('port'),
        ])('passes $name through unchanged with masking already enabled', async (typed): Promise<void> => {
            await expect(
                readCredentialsForDiagnostics('read', 'kubernetes', read(), async (context): Promise<never> => {
                    expect(context.telemetry.maskEntireErrorMessage).toBe(true);
                    throw typed;
                }),
            ).rejects.toBe(typed);
            expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
            expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
        });

        it('returns successful reads unchanged with masking already enabled', async (): Promise<void> => {
            const credentials = { connectionString: 'mongodb://private.example/' };
            await expect(
                readCredentialsForDiagnostics('read', 'azure', read(), async (context): Promise<typeof credentials> => {
                    expect(context.telemetry.maskEntireErrorMessage).toBe(true);
                    return credentials;
                }),
            ).resolves.toBe(credentials);
            expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
            expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
        });

        it('does not start a read for an aborted run', async (): Promise<void> => {
            const controller = new AbortController();
            const reason = new Error('Diagnosis cancelled');
            controller.abort(reason);
            const callback = vi.fn();
            await expect(
                readCredentialsForDiagnostics('read', 'azure', read(controller.signal), callback),
            ).rejects.toBe(reason);
            expect(callback).not.toHaveBeenCalled();
            expect(telemetry.contexts).toHaveLength(0);
            expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
            expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
        });

        it('preserves cancellation during a read without source wrapping or notifications', async (): Promise<void> => {
            const controller = new AbortController();
            const reason = new Error('Diagnosis cancelled');
            await expect(
                readCredentialsForDiagnostics(
                    'read',
                    'azure',
                    read(controller.signal),
                    async (context): Promise<never> => {
                        expect(context.telemetry.maskEntireErrorMessage).toBe(true);
                        controller.abort(reason);
                        controller.signal.throwIfAborted();
                        throw new Error('Expected the aborted signal to throw');
                    },
                ),
            ).rejects.toBe(reason);
            expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
            expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
        });

        it('bridges the run signal to a cancellation token', (): void => {
            const controller = new AbortController();
            const cancellation = cancellationTokenFromSignal(controller.signal);
            expect(cancellation.token.isCancellationRequested).toBe(false);
            controller.abort();
            expect(cancellation.token.isCancellationRequested).toBe(true);
            cancellation.dispose();
        });
    });

    describe('Azure resources (vCore)', (): void => {
        function item(): VCoreResourceItem {
            const cluster = {
                name: 'cluster',
                resourceGroup: 'rg',
                treeId: 'azure/cluster',
                clusterId: 'azure_cluster',
                dbExperience: DocumentDBExperience,
                viewId: Views.AzureResourcesView,
            } as unknown as TreeCluster<AzureClusterModel>;
            return new VCoreResourceItem(subscription, cluster);
        }

        it.each([403, 401, 404])(
            'turns an ARM %d into a typed failure without an error notification',
            async (status): Promise<void> => {
                const error = armError(status);
                azure.getClusterInformationFromAzure.mockRejectedValue(error);

                const pending = item().getCredentialsForDiagnostics(read());

                await expect(pending).rejects.toBeInstanceOf(ConnectionSourceUnavailableError);
                await expect(pending).rejects.toMatchObject({ source: 'azure', sourceError: error });
                expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
            },
        );

        it('keeps the ordinary read unchanged: it shows the error and returns undefined', async (): Promise<void> => {
            azure.getClusterInformationFromAzure.mockRejectedValue(armError(403));

            await expect(item().getCredentials()).resolves.toBeUndefined();
            expect(vscode.window.showErrorMessage).toHaveBeenCalledOnce();
            expect(telemetry.contexts[0].telemetry.maskEntireErrorMessage).toBeUndefined();
        });
    });

    describe('Azure VM port (decision 0035, refined)', (): void => {
        function item(connectionString: string | undefined = 'mongodb://vm.example:27017/'): AzureVMResourceItem {
            const cluster = {
                name: 'vm',
                treeId: 'discovery/vm',
                clusterId: 'azure-vm_vm',
                dbExperience: DocumentDBExperience,
                viewId: Views.DiscoveryView,
                azureResourceId: '/subscriptions/sub/vm',
                connectionString,
                fqdn: 'vm.example',
            } as unknown as TreeCluster<VirtualMachineModel>;
            return new AzureVMResourceItem('journey', subscription, cluster);
        }

        it('passes a cancellation token to the port prompt and uses the entered port', async (): Promise<void> => {
            vi.mocked(vscode.window.showInputBox).mockResolvedValue('10260');

            const credentials = await item().getCredentialsForDiagnostics(read());

            expect(credentials?.connectionString).toContain('vm.example:10260');
            expect(vscode.window.showInputBox).toHaveBeenCalledExactlyOnceWith(
                expect.objectContaining({ value: '27017' }),
                expect.objectContaining({ isCancellationRequested: false }),
            );
        });

        it('reports a dismissed prompt as cancelled input, not as a missing connection', async (): Promise<void> => {
            vi.mocked(vscode.window.showInputBox).mockResolvedValue(undefined);

            await expect(item().getCredentialsForDiagnostics(read())).rejects.toBeInstanceOf(
                ConnectionInputCancelledError,
            );
            expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
        });

        it('rejects as cancelled run, not cancelled input, when the run signal dismissed the prompt', async (): Promise<void> => {
            const controller = new AbortController();
            let cancelledByRun = false;
            vi.mocked(vscode.window.showInputBox).mockImplementation(async (_options, token): Promise<undefined> => {
                controller.abort();
                // VS Code closes the prompt when its token fires; the mock records that it would.
                cancelledByRun = token?.isCancellationRequested === true;
                return undefined;
            });

            const pending = item().getCredentialsForDiagnostics(read(controller.signal));

            await expect(pending).rejects.toThrow();
            await expect(pending).rejects.not.toBeInstanceOf(ConnectionInputCancelledError);
            expect(cancelledByRun).toBe(true);
        });

        it('reuses the port entered earlier in this session without prompting', async (): Promise<void> => {
            vi.mocked(CredentialCache.getCredentials).mockReturnValue({
                clusterId: 'azure-vm_vm',
                connectionString: 'mongodb://user@vm.example:27500/',
            });

            const credentials = await item().getCredentialsForDiagnostics(read());

            expect(credentials?.connectionString).toContain('vm.example:27500');
            expect(vscode.window.showInputBox).not.toHaveBeenCalled();
        });

        it('reports a VM without an address as a missing endpoint', async (): Promise<void> => {
            await expect(item('').getCredentialsForDiagnostics(read())).rejects.toMatchObject({
                name: 'ConnectionEndpointUnavailableError',
                source: 'azure',
                reason: 'notProvided',
            });
            expect(vscode.window.showInputBox).not.toHaveBeenCalled();
        });
    });

    describe('MongoDB Atlas', (): void => {
        function item(overrides: Partial<AtlasClusterModel> = {}): AtlasClusterItem {
            return new AtlasClusterItem('', {
                name: 'Cluster0',
                connectionString: 'mongodb+srv://cluster0.example.mongodb.net',
                dbExperience: DocumentDBExperience,
                clusterId: 'atlas_cluster0',
                treeId: 'atlas/org/project/Cluster0',
                viewId: Views.DiscoveryView,
                projectId: 'project',
                projectName: 'Project 0',
                paused: false,
                stateName: 'IDLE',
                ...overrides,
            } as TreeCluster<AtlasClusterModel>);
        }

        it('reports a paused cluster as not connectable, without the warning', async (): Promise<void> => {
            await expect(item({ paused: true }).getCredentialsForDiagnostics(read())).rejects.toMatchObject({
                name: 'ConnectionSourceUnavailableError',
                source: 'atlas',
                reason: 'notConnectable',
            });
            expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
        });

        it('reports an idle cluster without a connection string as a missing endpoint', async (): Promise<void> => {
            await expect(
                item({ connectionString: undefined }).getCredentialsForDiagnostics(read()),
            ).rejects.toMatchObject({
                name: 'ConnectionEndpointUnavailableError',
                source: 'atlas',
                reason: 'notProvided',
            });
            expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
        });

        it('returns the connection string of a connectable cluster', async (): Promise<void> => {
            await expect(item().getCredentialsForDiagnostics(read())).resolves.toMatchObject({
                connectionString: 'mongodb+srv://cluster0.example.mongodb.net',
            });
        });
    });
});
