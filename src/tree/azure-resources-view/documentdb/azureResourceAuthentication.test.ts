/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    type AzureWizard,
    type AzureWizardPromptStep,
    type callWithTelemetryAndErrorHandling,
    type IActionContext,
} from '@microsoft/vscode-azext-utils';
import { type AzureSubscription } from '@microsoft/vscode-azureresources-api';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { AuthMethodId } from '../../../documentdb/auth/AuthMethod';
import { ClustersClient } from '../../../documentdb/ClustersClient';
import { CredentialCache } from '../../../documentdb/CredentialCache';
import { type AuthenticateWizardContext } from '../../../documentdb/wizards/authenticate/AuthenticateWizardContext';
import { DocumentDBExperience } from '../../../DocumentDBExperiences';
import { DocumentDBResourceItem } from '../../../plugins/service-azure-mongo-vcore/discovery-tree/documentdb/DocumentDBResourceItem';
import { type AzureClusterModel } from '../../azure-views/models/AzureClusterModel';
import { type TreeCluster } from '../../models/BaseClusterModel';
import { VCoreResourceItem } from './VCoreResourceItem';

interface PickerItem extends vscode.QuickPickItem {
    authMethod?: AuthMethodId;
    entraUnavailable?: boolean;
    choice?: string;
}

const { getCluster, wizardCreated, showQuickPick, showInputBox } = vi.hoisted(() => ({
    getCluster: vi.fn(),
    wizardCreated: vi.fn<(context: AuthenticateWizardContext) => void>(),
    showQuickPick: vi.fn<(items: PickerItem[]) => Promise<PickerItem>>(),
    showInputBox: vi.fn(),
}));

vi.mock('@microsoft/vscode-azext-utils', async (importOriginal) => ({
    ...(await importOriginal<{
        AzureWizard: typeof AzureWizard;
        callWithTelemetryAndErrorHandling: typeof callWithTelemetryAndErrorHandling;
    }>()),
    AzureWizard: class {
        constructor(
            private readonly context: AuthenticateWizardContext,
            private readonly options: { promptSteps: AzureWizardPromptStep<AuthenticateWizardContext>[] },
        ) {
            wizardCreated(context);
        }
        public async prompt(): Promise<void> {
            for (const step of this.options.promptSteps) {
                await step.configureBeforePrompt?.(this.context);
                if (step.shouldPrompt(this.context)) {
                    await step.prompt(this.context);
                }
            }
        }
    },
    callWithTelemetryAndErrorHandling: async (
        _name: string,
        callback: (context: IActionContext) => Promise<unknown>,
    ): Promise<unknown> =>
        callback({
            telemetry: { properties: {}, measurements: {} },
            errorHandling: {},
            valuesToMask: [],
            ui: { showQuickPick, showInputBox },
        } as unknown as IActionContext),
}));
vi.mock('../../../utils/azureClients', () => ({
    createMongoClustersManagementClient: vi.fn(() => ({ mongoClusters: { get: getCluster } })),
}));
vi.mock('../../../documentdb/ClustersClient', () => ({
    ClustersClient: { getClient: vi.fn(), deleteClient: vi.fn() },
}));
vi.mock('../../../documentdb/CredentialCache', () => ({
    CredentialCache: { hasCredentials: vi.fn(), setAuthCredentials: vi.fn(), deleteCredentials: vi.fn() },
}));
vi.mock('../../../extensionVariables', () => ({
    ext: {
        context: { asAbsolutePath: (path: string): string => path },
        outputChannel: { appendLine: vi.fn(), append: vi.fn(), debug: vi.fn(), info: vi.fn() },
    },
}));

const subscription = {
    tenantId: 'tenant-1',
    subscriptionId: 'subscription-1',
    isCustomCloud: false,
} as AzureSubscription;
const cluster: TreeCluster<AzureClusterModel> = {
    name: 'cluster',
    clusterId: 'stable-cluster-id',
    treeId: 'azure/stable-cluster-id',
    viewId: 'azure',
    azureResourceId:
        '/subscriptions/subscription-1/resourceGroups/group/providers/Microsoft.DocumentDB/mongoClusters/cluster',
    resourceGroup: 'group',
    dbExperience: DocumentDBExperience,
};

function setArmCluster(host: string, allowedModes: string[]): void {
    getCluster.mockResolvedValue({
        properties: {
            connectionString: `mongodb+srv://<user>:<password>@${host}/`,
            administrator: { userName: 'clusteradmin' },
            authConfig: { allowedModes },
        },
    });
}

describe.each([
    ['Azure Resources', (): VCoreResourceItem => new VCoreResourceItem(subscription, cluster)],
    ['Azure Discovery', (): DocumentDBResourceItem => new DocumentDBResourceItem('journey-1', subscription, cluster)],
] as const)('%s destination-aware authentication', (_name, makeItem) => {
    beforeEach((): void => {
        vi.clearAllMocks();
        vi.mocked(CredentialCache.hasCredentials).mockReturnValue(false);
        vi.mocked(ClustersClient.getClient).mockResolvedValue({ connectionCorrelationId: 'attempt' } as ClustersClient);
        vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
            inspect: vi.fn(),
        } as unknown as vscode.WorkspaceConfiguration);
        showInputBox.mockImplementation(
            async (options: vscode.InputBoxOptions): Promise<string> =>
                options.password ? 'test-password' : 'clusteradmin',
        );
    });

    describe.each([
        ['native and Entra', [AuthMethodId.NativeAuth, AuthMethodId.MicrosoftEntraID]],
        ['Entra only', [AuthMethodId.MicrosoftEntraID]],
    ])('ARM allows %s', (_modesName, allowedModes) => {
        it.each([
            ['account', AuthMethodId.MicrosoftEntraID],
            ['systemAssigned', AuthMethodId.ManagedIdentity],
        ] as const)('offers and connects with %s on an approved destination', async (choice, method): Promise<void> => {
            setArmCluster('cluster.mongocluster.cosmos.azure.com', allowedModes);
            showQuickPick.mockImplementation(async (items): Promise<PickerItem> => {
                const selected =
                    items.find((item) => item.choice === choice) ??
                    items.find((item) => item.authMethod === AuthMethodId.MicrosoftEntraID);
                expect(selected).toBeDefined();
                return selected!;
            });

            await expect(makeItem().connect()).resolves.toMatchObject({ connectionCorrelationId: 'attempt' });

            expect(getCluster).toHaveBeenCalledWith('group', 'cluster');
            expect(wizardCreated).toHaveBeenCalledWith(
                expect.objectContaining({
                    connectionString: 'mongodb+srv://cluster.mongocluster.cosmos.azure.com/',
                    availableAuthMethods: [...allowedModes, AuthMethodId.ManagedIdentity],
                    selectedAuthMethod: method,
                }),
            );
            const pickerItems = showQuickPick.mock.calls.map(([items]) => items);
            const identities = pickerItems.find((items) => items.some((item) => item.choice === 'account'));
            expect(identities?.map((item) => item.choice)).toEqual(
                expect.arrayContaining(['account', 'systemAssigned', 'manual']),
            );
            if (allowedModes.includes(AuthMethodId.NativeAuth)) {
                expect(pickerItems[0].some((item) => item.authMethod === AuthMethodId.MicrosoftEntraID)).toBe(true);
            } else {
                expect(showQuickPick).toHaveBeenCalledOnce();
            }
            expect(CredentialCache.setAuthCredentials).toHaveBeenCalledWith(
                cluster.clusterId,
                method,
                'mongodb+srv://cluster.mongocluster.cosmos.azure.com/',
                undefined,
                undefined,
                { tenantId: subscription.tenantId, subscriptionId: subscription.subscriptionId },
                method === AuthMethodId.ManagedIdentity ? { tenantId: subscription.tenantId } : undefined,
            );
            expect(showInputBox).not.toHaveBeenCalled();
        });

        it('does not trust a rejected Azure endpoint just because ARM returned it', async (): Promise<void> => {
            setArmCluster('cluster.eastus.cloudapp.azure.com', allowedModes);
            showQuickPick.mockImplementation(async (items): Promise<PickerItem> => {
                expect(items.some((item) => item.authMethod === AuthMethodId.MicrosoftEntraID)).toBe(false);
                expect(items.some((item) => item.authMethod === AuthMethodId.ManagedIdentity)).toBe(false);
                expect(items.some((item) => item.entraUnavailable)).toBe(true);
                return items.find((item) => item.authMethod === AuthMethodId.NativeAuth)!;
            });

            await expect(makeItem().connect()).resolves.toMatchObject({ connectionCorrelationId: 'attempt' });

            expect(showQuickPick).toHaveBeenCalledOnce();
            expect(wizardCreated.mock.calls[0][0].selectedAuthMethod).toBe(AuthMethodId.NativeAuth);
            expect(showQuickPick.mock.calls[0][0].some((item) => item.choice)).toBe(false);
        });
    });

    it('preserves native-only authentication on a rejected destination', async (): Promise<void> => {
        setArmCluster('cluster.eastus.cloudapp.azure.com', [AuthMethodId.NativeAuth]);

        await expect(makeItem().connect()).resolves.toMatchObject({ connectionCorrelationId: 'attempt' });

        expect(showQuickPick).not.toHaveBeenCalled();
        expect(showInputBox).toHaveBeenCalledTimes(2);
        expect(CredentialCache.setAuthCredentials).toHaveBeenCalledWith(
            cluster.clusterId,
            AuthMethodId.NativeAuth,
            'mongodb+srv://cluster.eastus.cloudapp.azure.com/',
            { connectionUser: 'clusteradmin', connectionPassword: 'test-password' },
            undefined,
            undefined,
            undefined,
        );
    });
});
