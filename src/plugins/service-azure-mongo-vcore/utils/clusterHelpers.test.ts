/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

jest.mock('vscode', () => ({
    l10n: { t: jest.fn((message: string) => message) },
}));

// The module under test imports the Azure management client factory, which drags in the whole
// azext toolchain. Only the pure credential extraction is exercised here.
jest.mock('../../../utils/azureClients', () => ({
    createMongoClustersManagementClient: jest.fn(),
}));

import { type MongoCluster } from '@azure/arm-mongocluster';
import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { type AzureSubscription } from '@microsoft/vscode-azureresources-api';
import { AuthMethodId } from '../../../documentdb/auth/AuthMethod';
import { extractCredentialsFromCluster } from './clusterHelpers';

function makeContext(): IActionContext {
    return {
        telemetry: { properties: {}, measurements: {} },
        errorHandling: {},
        valuesToMask: [],
    } as unknown as IActionContext;
}

function makeCluster(allowedModes: string[]): MongoCluster {
    return {
        properties: {
            connectionString: 'mongodb+srv://<user>:<password>@my-cluster.mongocluster.cosmos.azure.com/',
            administrator: { userName: 'clusteradmin' },
            authConfig: { allowedModes },
        },
    } as unknown as MongoCluster;
}

const subscription = { tenantId: 'tenant-1', subscriptionId: 'sub-1', isCustomCloud: false } as AzureSubscription;

describe('extractCredentialsFromCluster', () => {
    it('offers managed identity wherever Entra ID is offered', () => {
        const context = makeContext();

        const credentials = extractCredentialsFromCluster(
            context,
            makeCluster(['NativeAuth', 'MicrosoftEntraID']),
            subscription,
        );

        expect(credentials.availableAuthMethods).toContain(AuthMethodId.ManagedIdentity);
        expect(credentials.entraIdAuthConfig).toEqual({ tenantId: 'tenant-1', subscriptionId: 'sub-1' });
    });

    it('does not offer managed identity when the cluster does not allow Entra ID', () => {
        const context = makeContext();

        const credentials = extractCredentialsFromCluster(context, makeCluster(['NativeAuth']), subscription);

        expect(credentials.availableAuthMethods).not.toContain(AuthMethodId.ManagedIdentity);
    });

    it('keeps the synthesized entry out of the raw allowedModes telemetry', () => {
        const context = makeContext();

        extractCredentialsFromCluster(context, makeCluster(['NativeAuth', 'MicrosoftEntraID']), subscription);

        // Service-side telemetry must reflect what Azure reported, not what we added.
        expect(context.telemetry.properties.receivedAuthMethods).toBe('NativeAuth,MicrosoftEntraID');
        expect(context.telemetry.measurements.receivedAuthMethodsCount).toBe(2);
        expect(context.telemetry.properties.unknownAuthMethods).toBe('');
    });
});
