/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type CosmosDBManagementClient } from '@azure/arm-cosmosdb';
import { type MongoCluster } from '@azure/arm-mongocluster';
import { type AzureSubscription } from '@microsoft/vscode-azext-azureauth';
import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getClusterInformationFromAzure } from '../plugins/service-azure-mongo-vcore/utils/clusterHelpers';
import { createCosmosDBManagementClient } from '../utils/azureClients';
import { readAzureResource, type AzureResourceReadRequest } from './azureResource';

vi.mock('../plugins/service-azure-mongo-vcore/utils/clusterHelpers', () => ({
    getClusterInformationFromAzure: vi.fn(),
}));
vi.mock('../utils/azureClients', () => ({
    createCosmosDBManagementClient: vi.fn(),
}));

const context = {} as IActionContext;
const subscription = { name: 'My subscription' } as AzureSubscription;
const request: AzureResourceReadRequest = { kind: 'vcore', resourceGroup: 'my-group', name: 'my-resource' };
const getAccount = vi.fn();

describe('readAzureResource', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        vi.mocked(createCosmosDBManagementClient).mockResolvedValue({
            databaseAccounts: { get: getAccount },
        } as unknown as CosmosDBManagementClient);
    });

    it('returns the ARM casing for a vCore cluster', async () => {
        vi.mocked(getClusterInformationFromAzure).mockResolvedValue({ name: 'My-Resource' } as MongoCluster);

        await expect(readAzureResource(context, subscription, request)).resolves.toEqual({ name: 'My-Resource' });
        expect(getClusterInformationFromAzure).toHaveBeenCalledWith(context, subscription, 'my-group', 'my-resource');
        expect(createCosmosDBManagementClient).not.toHaveBeenCalled();
    });

    it('returns the ARM casing for a MongoDB RU account, regardless of kind casing', async () => {
        getAccount.mockResolvedValue({ name: 'My-Resource', kind: 'mongoDB' });

        await expect(readAzureResource(context, subscription, { ...request, kind: 'ru' })).resolves.toEqual({
            name: 'My-Resource',
        });
        expect(createCosmosDBManagementClient).toHaveBeenCalledWith(context, subscription);
        expect(getAccount).toHaveBeenCalledWith('my-group', 'my-resource');
        expect(getClusterInformationFromAzure).not.toHaveBeenCalled();
    });

    it.each(['vcore', 'ru'] as const)('uses the requested name when the %s ARM name is missing', async (kind) => {
        vi.mocked(getClusterInformationFromAzure).mockResolvedValue({} as MongoCluster);
        getAccount.mockResolvedValue({ kind: 'MongoDB' });

        await expect(readAzureResource(context, subscription, { ...request, kind })).resolves.toEqual({
            name: 'my-resource',
        });
    });

    it.each(['GlobalDocumentDB', undefined])('refuses an RU account with kind %s', async (kind) => {
        getAccount.mockResolvedValue({ name: 'My-Resource', kind });

        await expect(readAzureResource(context, subscription, { ...request, kind: 'ru' })).rejects.toThrow(
            'This Azure Cosmos DB account does not use the MongoDB API.',
        );
    });

    it.each([
        ['ResourceNotFound', 'The Azure resource my-resource was not found in subscription My subscription.'],
        ['ResourceGroupNotFound', 'The Azure resource my-resource was not found in subscription My subscription.'],
        ['AuthorizationFailed', 'Your Azure account cannot read the Azure resource my-resource.'],
    ])('maps %s from vCore', async (code, message) => {
        vi.mocked(getClusterInformationFromAzure).mockRejectedValue({ code });

        await expect(readAzureResource(context, subscription, request)).rejects.toThrow(message);
    });

    it.each([
        ['ResourceNotFound', 'The Azure resource my-resource was not found in subscription My subscription.'],
        ['ResourceGroupNotFound', 'The Azure resource my-resource was not found in subscription My subscription.'],
        ['AuthorizationFailed', 'Your Azure account cannot read the Azure resource my-resource.'],
    ])('maps %s from the RU account read', async (code, message) => {
        getAccount.mockRejectedValue({ code });

        await expect(readAzureResource(context, subscription, { ...request, kind: 'ru' })).rejects.toThrow(message);
    });

    it('maps errors from creating the RU client', async () => {
        vi.mocked(createCosmosDBManagementClient).mockRejectedValue({ code: 'AuthorizationFailed' });

        await expect(readAzureResource(context, subscription, { ...request, kind: 'ru' })).rejects.toThrow(
            'Your Azure account cannot read the Azure resource my-resource.',
        );
    });

    it.each(['vcore', 'ru'] as const)('rethrows an unknown %s error unchanged', async (kind) => {
        const error = { code: 'Unknown', message: 'unexpected' };
        vi.mocked(getClusterInformationFromAzure).mockRejectedValue(error);
        getAccount.mockRejectedValue(error);

        await expect(readAzureResource(context, subscription, { ...request, kind })).rejects.toBe(error);
    });
});
