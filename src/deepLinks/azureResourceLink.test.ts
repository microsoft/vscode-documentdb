/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';

import { parseAzureResourceLink } from './azureResourceLink';

const subscriptionId = '12345678-1234-1234-1234-123456789abc';
const tenantId = 'abcdef01-2345-6789-abcd-ef0123456789';
const prefix = `/subscriptions/${subscriptionId}/resourceGroups/MyGroup/providers`;
const vcoreResourceId = `${prefix}/Microsoft.DocumentDB/mongoClusters/MyCluster`;
const ruResourceId = `${prefix}/Microsoft.DocumentDB/databaseAccounts/MyAccount`;
const invalidResourceId = 'This DocumentDB link has an invalid Azure resource ID.';
const unsupportedResourceType = 'This link points to an Azure resource type the DocumentDB extension cannot open.';
const invalidTenantId = 'This DocumentDB link has an invalid Azure tenant ID.';

describe('parseAzureResourceLink', () => {
    it('parses a vCore cluster', () => {
        expect(parseAzureResourceLink(vcoreResourceId)).toEqual({
            resourceId: vcoreResourceId,
            subscriptionId,
            resourceGroup: 'MyGroup',
            name: 'MyCluster',
            kind: 'vcore',
            providerId: 'azure-mongo-vcore-discovery',
        });
    });

    it('parses an RU account', () => {
        expect(parseAzureResourceLink(ruResourceId)).toEqual({
            resourceId: ruResourceId,
            subscriptionId,
            resourceGroup: 'MyGroup',
            name: 'MyAccount',
            kind: 'ru',
            providerId: 'azure-mongo-ru-discovery',
        });
    });

    it('matches keywords, provider and type case-insensitively while preserving input values', () => {
        const resourceId = `/SuBsCrIpTiOnS/${subscriptionId.toUpperCase()}/ReSoUrCeGrOuPs/MyGroup/PrOvIdErS/mIcRoSoFt.DoCuMeNtDb/MoNgOcLuStErS/MyCluster`;
        expect(parseAzureResourceLink(resourceId)).toEqual({
            resourceId,
            subscriptionId: subscriptionId.toUpperCase(),
            resourceGroup: 'MyGroup',
            name: 'MyCluster',
            kind: 'vcore',
            providerId: 'azure-mongo-vcore-discovery',
        });
    });

    it('matches the RU type case-insensitively', () => {
        const resourceId = `${prefix}/microsoft.documentdb/DaTaBaSeAcCoUnTs/MyAccount`;
        expect(parseAzureResourceLink(resourceId)).toMatchObject({
            resourceId,
            resourceGroup: 'MyGroup',
            name: 'MyAccount',
            kind: 'ru',
            providerId: 'azure-mongo-ru-discovery',
        });
    });

    it.each([
        `${vcoreResourceId}/`,
        `${vcoreResourceId}/databases/db1`,
        `${prefix}/Microsoft.Storage/storageAccounts/MyAccount`,
        `${prefix}/Microsoft.DocumentDB/otherType/MyAccount`,
        `${prefix}/Microsoft.DocumentDB/mongoClusters`,
    ])('refuses unsupported types or extra segments: %s', (resourceId) => {
        expect(() => parseAzureResourceLink(resourceId)).toThrow(unsupportedResourceType);
    });

    it.each([
        `/subscriptions/not-a-guid/resourceGroups/MyGroup/providers/Microsoft.DocumentDB/mongoClusters/MyCluster`,
        `/subscriptions/${subscriptionId}/resourceGroups//providers/Microsoft.DocumentDB/mongoClusters/MyCluster`,
        `${prefix}/Microsoft.DocumentDB/mongoClusters/`,
        `/subscription/${subscriptionId}/resourceGroups/MyGroup/providers/Microsoft.DocumentDB/mongoClusters/MyCluster`,
        `subscriptions/${subscriptionId}/resourceGroups/MyGroup/providers/Microsoft.DocumentDB/mongoClusters/MyCluster`,
    ])('refuses malformed resource IDs: %s', (resourceId) => {
        expect(() => parseAzureResourceLink(resourceId)).toThrow(invalidResourceId);
    });

    it('preserves a valid tenant ID', () => {
        expect(parseAzureResourceLink(vcoreResourceId, tenantId)).toMatchObject({ tenantId });
    });

    it.each(['not-a-guid', ''])('refuses an invalid tenant ID: %s', (invalidTenant) => {
        expect(() => parseAzureResourceLink(vcoreResourceId, invalidTenant)).toThrow(invalidTenantId);
    });
});
