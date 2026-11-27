/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { type AzureSubscription } from '@microsoft/vscode-azureresources-api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { DocumentDBExperience } from '../../../../DocumentDBExperiences';
import { ClustersClient } from '../../../../documentdb/ClustersClient';
import { CredentialCache, type CachedClusterCredentials } from '../../../../documentdb/CredentialCache';
import { showClusterConnectFailure } from '../../../../documentdb/showClusterConnectFailure';
import * as unauthenticatedEndpoint from '../../../../documentdb/shell/unauthenticatedEndpoint';
import { DocumentDBConnectionString } from '../../../../documentdb/utils/DocumentDBConnectionString';
import { Views } from '../../../../documentdb/Views';
import { type AuthenticateWizardContext } from '../../../../documentdb/wizards/authenticate/AuthenticateWizardContext';
import { type TreeCluster } from '../../../../tree/models/BaseClusterModel';
import { AzureVMResourceItem, type VirtualMachineModel } from './AzureVMResourceItem';

const prompts = vi.hoisted(() => ({
    port: vi.fn(),
    credentials: vi.fn<(context: AuthenticateWizardContext) => Promise<void>>(),
}));

vi.mock('@microsoft/vscode-azext-utils', async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    return {
        ...actual,
        AzureWizard: class {
            public constructor(private readonly context: AuthenticateWizardContext) {}

            public async prompt(): Promise<void> {
                await prompts.credentials(this.context);
            }
        },
        callWithTelemetryAndErrorHandling: vi.fn(
            async <T>(_name: string, callback: (context: IActionContext) => Promise<T>): Promise<T | undefined> => {
                const context = {
                    telemetry: { properties: {}, measurements: {} },
                    errorHandling: {},
                    valuesToMask: [],
                    ui: { showInputBox: prompts.port },
                } as unknown as IActionContext;
                try {
                    return await callback(context);
                } catch (error) {
                    if (context.errorHandling.rethrow) {
                        throw error;
                    }
                    return undefined;
                }
            },
        ),
    };
});

vi.mock('../../../../documentdb/ClustersClient', () => ({
    addEstablishedConnectionContext: vi.fn(),
    ClustersClient: {
        connectInteractive: vi.fn(),
        exists: vi.fn(() => false),
        getExistingClient: vi.fn(),
        getEpoch: vi.fn(() => 0),
        getLatchReason: vi.fn(),
        getLastVerifiedIdentity: vi.fn(),
        deleteClient: vi.fn(),
    },
}));

vi.mock('../../../../documentdb/showClusterConnectFailure', () => ({
    showClusterConnectFailure: vi.fn(),
}));

vi.mock('../../../../extensionVariables', () => ({
    ext: {
        outputChannel: { append: vi.fn(), appendLine: vi.fn(), debug: vi.fn() },
    },
}));

class TestAzureVMResourceItem extends AzureVMResourceItem {
    public override authenticateAndConnect(): Promise<ClustersClient | null> {
        return super.authenticateAndConnect();
    }
}

const subscription = { subscriptionId: 'sub', tenantId: 'tenant' } as unknown as AzureSubscription;
const clusterId = 'azure-vm_vm';

function item(connectionString: string = 'mongodb://vm.example:27017/'): TestAzureVMResourceItem {
    return new TestAzureVMResourceItem('journey', subscription, {
        name: 'vm',
        treeId: 'discovery/vm',
        clusterId,
        dbExperience: DocumentDBExperience,
        viewId: Views.DiscoveryView,
        azureResourceId: '/subscriptions/sub/vm',
        connectionString,
        fqdn: 'vm.example',
    } as TreeCluster<VirtualMachineModel>);
}

describe('Azure VM attempted unauthenticated endpoint', (): void => {
    beforeEach((): void => {
        vi.clearAllMocks();
        CredentialCache.deleteCredentials(clusterId);
        vi.spyOn(console, 'warn').mockImplementation((): void => {});
        prompts.port.mockReset().mockResolvedValue('27017');
        prompts.credentials.mockReset().mockImplementation(async (context): Promise<void> => {
            context.selectedUserName = 'entered-user';
            context.password = 'entered-password';
        });
        vi.mocked(ClustersClient.connectInteractive).mockReset().mockRejectedValue(new Error('Connection refused'));
        vi.mocked(vscode.window.showInputBox).mockReset();
    });

    afterEach((): void => {
        CredentialCache.deleteCredentials(clusterId);
        vi.restoreAllMocks();
    });

    it.each(['27017', '10260'])(
        'retains the actually attempted port %s after failure evicts credentials',
        async (port): Promise<void> => {
            const vm = item();
            prompts.port.mockResolvedValue(port);
            let endpointAtConnect: string | undefined;
            let credentialsAtConnect: CachedClusterCredentials | undefined;
            vi.mocked(ClustersClient.connectInteractive).mockImplementationOnce(async (): Promise<never> => {
                endpointAtConnect = await vm.getUnauthenticatedEndpoint();
                credentialsAtConnect = CredentialCache.getCredentials(clusterId);
                throw new Error('Connection refused');
            });

            await expect(vm.authenticateAndConnect()).resolves.toBeNull();
            expect(endpointAtConnect).toBe(`mongodb://vm.example:${port}/`);
            expect(credentialsAtConnect).toMatchObject({
                connectionString: `mongodb://entered-user@vm.example:${port}/`,
                nativeAuthConfig: { connectionUser: 'entered-user', connectionPassword: 'entered-password' },
            });
            expect(ClustersClient.connectInteractive).toHaveBeenCalledOnce();
            expect(showClusterConnectFailure).toHaveBeenCalledOnce();
            expect(CredentialCache.getCredentials(clusterId)).toBeUndefined();

            const cacheRead = vi.spyOn(CredentialCache, 'getCredentials');
            const cachePasswordRead = vi.spyOn(CredentialCache, 'getConnectionStringWithPassword');
            const credentialsRead = vi.spyOn(vm, 'getCredentials');
            const diagnosticsRead = vi.spyOn(vm, 'getCredentialsForDiagnostics');
            prompts.port.mockClear();
            prompts.credentials.mockClear();
            vi.mocked(ClustersClient.connectInteractive).mockClear();

            await expect(vm.getUnauthenticatedEndpoint()).resolves.toBe(`mongodb://vm.example:${port}/`);

            expect(cacheRead).not.toHaveBeenCalled();
            expect(cachePasswordRead).not.toHaveBeenCalled();
            expect(credentialsRead).not.toHaveBeenCalled();
            expect(diagnosticsRead).not.toHaveBeenCalled();
            expect(prompts.port).not.toHaveBeenCalled();
            expect(prompts.credentials).not.toHaveBeenCalled();
            expect(vscode.window.showInputBox).not.toHaveBeenCalled();
            expect(ClustersClient.connectInteractive).not.toHaveBeenCalled();
        },
    );

    it('re-reads a later connection attempt rather than freezing the first port', async (): Promise<void> => {
        const vm = item();
        const reread = (): Promise<string | undefined> => vm.getUnauthenticatedEndpoint();
        prompts.port.mockResolvedValueOnce('10260').mockResolvedValueOnce('27500');

        await vm.authenticateAndConnect();
        await expect(reread()).resolves.toBe('mongodb://vm.example:10260/');
        await vm.authenticateAndConnect();
        await expect(reread()).resolves.toBe('mongodb://vm.example:27500/');
        expect(vm.cluster.connectionString).toBe('mongodb://vm.example:27017/');
        expect(CredentialCache.getCredentials(clusterId)).toBeUndefined();
    });

    it('fails closed for a new or recreated node even when the model and cache have endpoints', async (): Promise<void> => {
        const attempted = item();
        prompts.port.mockResolvedValue('10260');
        await attempted.authenticateAndConnect();
        await expect(attempted.getUnauthenticatedEndpoint()).resolves.toBe('mongodb://vm.example:10260/');
        CredentialCache.setCredentials(clusterId, 'mongodb://cached.example:27500/', 'cached-user', 'cached-password');
        const recreated = item();
        const cacheRead = vi.spyOn(CredentialCache, 'getCredentials');
        const credentialsRead = vi.spyOn(recreated, 'getCredentials');
        prompts.port.mockClear();
        prompts.credentials.mockClear();
        vi.mocked(ClustersClient.connectInteractive).mockClear();

        await expect(recreated.getUnauthenticatedEndpoint()).resolves.toBeUndefined();

        expect(cacheRead).not.toHaveBeenCalled();
        expect(credentialsRead).not.toHaveBeenCalled();
        expect(prompts.port).not.toHaveBeenCalled();
        expect(prompts.credentials).not.toHaveBeenCalled();
        expect(vscode.window.showInputBox).not.toHaveBeenCalled();
        expect(ClustersClient.connectInteractive).not.toHaveBeenCalled();
    });

    it('strips original and prompted credentials and authentication options but preserves transport settings', async (): Promise<void> => {
        const vm = item(
            'mongodb://original-user:original-password@vm.example:27017/db?' +
                'authMechanism=SCRAM-SHA-256&authSource=admin&authMechanismProperties=private&' +
                'proxyUsername=proxy-user&proxyPassword=proxy-password&tlsCertificateKeyFile=private.pem&' +
                'tlsCertificateKeyFilePassword=private&tls=true&tlsCAFile=trust.pem&directConnection=true',
        );
        prompts.port.mockResolvedValue('10260');

        await vm.authenticateAndConnect();

        const endpoint = await vm.getUnauthenticatedEndpoint();
        expect(endpoint).toBe('mongodb://vm.example:10260/db?tls=true&tlsCAFile=trust.pem&directConnection=true');
        const parsed = new DocumentDBConnectionString(endpoint ?? '');
        expect(parsed.username).toBe('');
        expect(parsed.password).toBe('');
    });

    it('does not record a port when the credential wizard stops before connecting', async (): Promise<void> => {
        const vm = item();
        prompts.port.mockResolvedValue('10260');
        prompts.credentials.mockImplementationOnce(async (context): Promise<void> => {
            context.aborted = true;
        });

        await expect(vm.authenticateAndConnect()).resolves.toBeNull();

        await expect(vm.getUnauthenticatedEndpoint()).resolves.toBeUndefined();
        expect(ClustersClient.connectInteractive).not.toHaveBeenCalled();
        expect(CredentialCache.getCredentials(clusterId)).toBeUndefined();
    });

    it('does not record or replace an endpoint from a diagnostics-only port prompt', async (): Promise<void> => {
        const vm = item();
        vi.mocked(vscode.window.showInputBox).mockResolvedValue('27500');
        const read = { signal: new AbortController().signal };

        await expect(vm.getCredentialsForDiagnostics(read)).resolves.toMatchObject({
            connectionString: 'mongodb://vm.example:27500/',
        });
        await expect(vm.getUnauthenticatedEndpoint()).resolves.toBeUndefined();

        prompts.port.mockResolvedValue('10260');
        await vm.authenticateAndConnect();
        await expect(vm.getCredentialsForDiagnostics(read)).resolves.toMatchObject({
            connectionString: 'mongodb://vm.example:27500/',
        });
        await expect(vm.getUnauthenticatedEndpoint()).resolves.toBe('mongodb://vm.example:10260/');
    });

    it('clears the old endpoint and reports a bounded sanitizer failure before starting a client', async (): Promise<void> => {
        const vm = item();
        prompts.port.mockResolvedValueOnce('10260').mockResolvedValueOnce('27500');
        await vm.authenticateAndConnect();
        await expect(vm.getUnauthenticatedEndpoint()).resolves.toBe('mongodb://vm.example:10260/');
        const error = new Error('Invalid connection string.');
        vi.spyOn(unauthenticatedEndpoint, 'toUnauthenticatedConnectionString').mockImplementationOnce((): never => {
            throw error;
        });

        await expect(vm.authenticateAndConnect()).resolves.toBeNull();

        expect(ClustersClient.connectInteractive).toHaveBeenCalledOnce();
        await expect(vm.getUnauthenticatedEndpoint()).resolves.toBeUndefined();
        expect(showClusterConnectFailure).toHaveBeenLastCalledWith(
            expect.objectContaining({ error }),
        );
        expect(CredentialCache.getCredentials(clusterId)).toBeUndefined();
        expect(ClustersClient.deleteClient).toHaveBeenCalledTimes(2);
    });
});
