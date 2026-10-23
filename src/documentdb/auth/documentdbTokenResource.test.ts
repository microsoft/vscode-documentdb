/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// eslint-disable-next-line import/no-internal-modules
import { getConfiguredAzureEnv } from '@microsoft/vscode-azext-azureauth/out/src/utils/configuredAzureEnv';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import {
    getCloudCategory,
    resetTokenResourceCacheForTests,
    resolveInteractiveTokenResource,
    resolveManagedIdentityTokenResource,
    resolveTokenResourceForCopy,
    TokenResourceResolutionError,
    type TokenResourceResolverDeps,
} from './documentdbTokenResource';
import { DOCUMENTDB_TOKEN_RESOURCE, getTokenResourceForCloud } from './entraScopes';

vi.mock('../../extensionVariables', () => ({ ext: {} }));

const privateConnection = 'mongodb://cluster.private.example.com/';
const customResource = 'https://database.example.com';
const publicResource = DOCUMENTDB_TOKEN_RESOURCE;
const governmentResource = getTokenResourceForCloud('AzureUSGovernment');
const chinaResource = getTokenResourceForCloud('AzureChinaCloud');

function createDeps(): TokenResourceResolverDeps {
    return {
        getConfiguredCloud: vi.fn(() => ({ name: 'AzureCloud', isCustomCloud: false })),
        getCustomEnvironment: vi.fn(() => ({})),
        fetchArmMetadata: vi.fn().mockResolvedValue(undefined),
        readImdsAzEnvironment: vi.fn().mockResolvedValue(undefined),
        getSignInEnvironment: vi.fn(() => ({ authProvider: 'microsoft', brokerImplementation: undefined })),
        warn: vi.fn(),
    };
}

function useCustomCloud(deps: TokenResourceResolverDeps): void {
    vi.mocked(deps.getConfiguredCloud).mockReturnValue({
        name: 'custom',
        isCustomCloud: true,
        activeDirectoryEndpointUrl: 'https://login.example.com/',
        resourceManagerEndpointUrl: 'https://management.example.com/',
    });
}

beforeEach(() => {
    vi.restoreAllMocks();
    resetTokenResourceCacheForTests();
});

describe('resolveInteractiveTokenResource', () => {
    it.each([
        [undefined, publicResource, 'public'],
        ['USGovernment', governmentResource, 'usgov'],
        ['ChinaCloud', chinaResource, 'china'],
    ])('uses the VS Code setting %s', async (setting, resource, category) => {
        vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({
            get: (key: string): unknown => (key === 'environment' ? setting : undefined),
        } as vscode.WorkspaceConfiguration);
        const deps = createDeps();
        deps.getConfiguredCloud = getConfiguredAzureEnv;

        expect(await resolveInteractiveTokenResource(privateConnection, deps)).toMatchObject({
            resource,
            scope: `${resource}/.default`,
            cloudCategory: category,
            reason: 'setting',
        });
        expect(deps.fetchArmMetadata).not.toHaveBeenCalled();
        expect(deps.readImdsAzEnvironment).not.toHaveBeenCalled();
    });

    it('records public interactive resolution details without host information', async () => {
        const resolution = await resolveInteractiveTokenResource(privateConnection, createDeps());

        expect(resolution.details).toMatchObject({
            flow: 'interactive',
            configuredCloud: 'AzureCloud',
            authProvider: 'microsoft',
            brokerImplementation: 'default',
            hostCloud: 'none',
            customOssrdbmsEndpointSet: false,
            customHostnameSuffixSet: false,
            armMetadata: 'notNeeded',
            imdsAzEnvironment: 'notQueried',
            cloudCategory: 'public',
            reason: 'setting',
            tokenResource: publicResource,
        });
        expect(JSON.stringify(resolution.details)).not.toContain('cluster.private.example.com');
    });

    it('records US Government interactive resolution details', async () => {
        const deps = createDeps();
        vi.mocked(deps.getConfiguredCloud).mockReturnValue({ name: 'AzureUSGovernment', isCustomCloud: false });
        vi.mocked(deps.getSignInEnvironment).mockReturnValue({
            authProvider: 'microsoft-sovereign-cloud',
            brokerImplementation: 'msal-no-broker',
        });

        const resolution = await resolveInteractiveTokenResource('mongodb://cluster.azure.us/', deps);

        expect(resolution.details).toMatchObject({
            configuredCloud: 'AzureUSGovernment',
            authProvider: 'microsoft-sovereign-cloud',
            brokerImplementation: 'msal-no-broker',
            hostCloud: 'AzureUSGovernment',
            tokenResource: governmentResource,
        });
    });

    it('uses a validated custom override before the login host or metadata', async () => {
        const deps = createDeps();
        useCustomCloud(deps);
        vi.mocked(deps.getCustomEnvironment).mockReturnValue({ ossrdbmsEndpoint: `${customResource}/` });

        expect(await resolveInteractiveTokenResource(privateConnection, deps)).toMatchObject({
            resource: customResource,
            scope: `${customResource}/.default`,
            cloudCategory: 'custom',
            reason: 'customOverride',
        });
        expect(deps.fetchArmMetadata).not.toHaveBeenCalled();
    });

    it('does not apply the custom override to a built-in interactive cloud', async () => {
        const deps = createDeps();
        vi.mocked(deps.getCustomEnvironment).mockReturnValue({ ossrdbmsEndpoint: customResource });
        expect(await resolveInteractiveTokenResource(privateConnection, deps)).toMatchObject({
            resource: publicResource,
            reason: 'setting',
        });
    });

    it.each([
        ['login.microsoftonline.com', publicResource],
        ['login.microsoftonline.us', governmentResource],
        ['login.chinacloudapi.cn', chinaResource],
        ['login.sovcloud-identity.fr', 'https://ossrdbms-aad.database.sovcloud-api.fr'],
        ['login.sovcloud-identity.de', 'https://ossrdbms-aad.database.sovcloud-api.de'],
    ])('recognizes the public Azure CLI login host %s', async (host, resource) => {
        const deps = createDeps();
        vi.mocked(deps.getConfiguredCloud).mockReturnValue({
            name: 'custom',
            isCustomCloud: true,
            activeDirectoryEndpointUrl: `https://${host.toUpperCase()}/`,
        });
        expect(await resolveInteractiveTokenResource(privateConnection, deps)).toMatchObject({
            resource,
            reason: 'customLoginHost',
        });
        expect(deps.fetchArmMetadata).not.toHaveBeenCalled();
    });

    it.each(['ossrDbmsResourceId', 'OSSRDBMSRESOURCEID'])('reads the ARM metadata key %s', async (key) => {
        const deps = createDeps();
        useCustomCloud(deps);
        vi.mocked(deps.fetchArmMetadata).mockResolvedValue({ [key]: `${customResource}/` });

        const resolution = await resolveInteractiveTokenResource(privateConnection, deps);
        expect(resolution).toMatchObject({
            resource: customResource,
            reason: 'armMetadata',
        });
        expect(resolution.details).toMatchObject({ armMetadata: 'found', configuredCloud: 'custom' });
        expect(deps.fetchArmMetadata).toHaveBeenCalledWith(
            'https://management.example.com/metadata/endpoints?api-version=2022-09-01',
        );
    });

    it.each([
        undefined,
        {},
        { ossrDbmsResourceId: 'http://database.example.com' },
        { ossrDbmsResourceId: 'https://database.example.com/path' },
        { ossrDbmsResourceId: 42 },
    ])('fails clearly for missing or invalid ARM metadata: %s', async (body) => {
        const deps = createDeps();
        useCustomCloud(deps);
        vi.mocked(deps.fetchArmMetadata).mockResolvedValue(body);
        await expect(resolveInteractiveTokenResource(privateConnection, deps)).rejects.toMatchObject({
            kind: 'customCloudUnresolved',
            message: expect.stringContaining('documentDB.customEnvironment.ossrdbmsEndpoint'),
        });
    });

    it.each(['http://database.example.com', 'https://database.example.com/path', 'not a URL'])(
        'does not use an invalid custom override: %s',
        async (override) => {
            const deps = createDeps();
            useCustomCloud(deps);
            vi.mocked(deps.getCustomEnvironment).mockReturnValue({ ossrdbmsEndpoint: override });
            await expect(resolveInteractiveTokenResource(privateConnection, deps)).rejects.toMatchObject({
                kind: 'customCloudUnresolved',
            });
        },
    );

    it('fails clearly when custom is selected without a custom cloud definition', async () => {
        const deps = createDeps();
        vi.mocked(deps.getConfiguredCloud).mockImplementation(() => {
            throw new Error('Custom cloud not configured');
        });
        await expect(resolveInteractiveTokenResource(privateConnection, deps)).rejects.toBeInstanceOf(
            TokenResourceResolutionError,
        );
        await expect(resolveInteractiveTokenResource(privateConnection, deps)).rejects.toMatchObject({
            kind: 'customCloudUnresolved',
        });
    });

    it('caches successful metadata per Resource Manager endpoint', async () => {
        const deps = createDeps();
        useCustomCloud(deps);
        vi.mocked(deps.fetchArmMetadata).mockResolvedValue({ ossrDbmsResourceId: customResource });
        await resolveInteractiveTokenResource(privateConnection, deps);
        await resolveInteractiveTokenResource(privateConnection, deps);
        expect(deps.fetchArmMetadata).toHaveBeenCalledTimes(1);

        vi.mocked(deps.getConfiguredCloud).mockReturnValue({
            name: 'custom',
            isCustomCloud: true,
            resourceManagerEndpointUrl: 'https://other-management.example.com',
        });
        await resolveInteractiveTokenResource(privateConnection, deps);
        expect(deps.fetchArmMetadata).toHaveBeenCalledTimes(2);
    });

    it('does not cache failed metadata lookups', async () => {
        const deps = createDeps();
        useCustomCloud(deps);
        await expect(resolveInteractiveTokenResource(privateConnection, deps)).rejects.toMatchObject({
            kind: 'customCloudUnresolved',
        });
        vi.mocked(deps.fetchArmMetadata).mockResolvedValue({ ossrDbmsResourceId: customResource });
        await expect(resolveInteractiveTokenResource(privateConnection, deps)).resolves.toMatchObject({
            resource: customResource,
        });
        expect(deps.fetchArmMetadata).toHaveBeenCalledTimes(2);
    });

    it.each([
        ['azure.us', 'AzureCloud', 'Azure US Government', 'Azure (public cloud)'],
        ['azure.com', 'AzureUSGovernment', 'Azure (public cloud)', 'Azure US Government'],
        ['azure.cn', 'AzureCloud', 'Azure China', 'Azure (public cloud)'],
        ['azure.com', 'AzureChinaCloud', 'Azure (public cloud)', 'Azure China'],
    ])('stops a %s host with the %s audience', async (suffix, name, hostDisplay, audienceDisplay) => {
        const deps = createDeps();
        vi.mocked(deps.getConfiguredCloud).mockReturnValue({ name, isCustomCloud: false });
        await expect(resolveInteractiveTokenResource(`mongodb://cluster.${suffix}/`, deps)).rejects.toMatchObject({
            kind: 'cloudMismatch',
            message: expect.stringContaining('microsoft-sovereign-cloud.environment'),
            details: expect.objectContaining({
                hostCloud:
                    suffix === 'azure.us'
                        ? 'AzureUSGovernment'
                        : suffix === 'azure.cn'
                          ? 'AzureChinaCloud'
                          : 'AzureCloud',
                errorKind: 'cloudMismatch',
            }),
        });
        await expect(resolveInteractiveTokenResource(`mongodb://cluster.${suffix}/`, deps)).rejects.toThrow(
            hostDisplay,
        );
        await expect(resolveInteractiveTokenResource(`mongodb://cluster.${suffix}/`, deps)).rejects.toThrow(
            audienceDisplay,
        );
    });

    it('does not check private hosts for a cloud mismatch', async () => {
        const deps = createDeps();
        vi.mocked(deps.getConfiguredCloud).mockReturnValue({ name: 'AzureUSGovernment', isCustomCloud: false });
        expect(await resolveInteractiveTokenResource(privateConnection, deps)).toMatchObject({
            resource: governmentResource,
        });
    });

    it('warns when a custom cloud explicitly overrides the resource to public', async () => {
        const deps = createDeps();
        useCustomCloud(deps);
        vi.mocked(deps.getCustomEnvironment).mockReturnValue({ ossrdbmsEndpoint: publicResource });
        await resolveInteractiveTokenResource(privateConnection, deps);
        expect(deps.warn).toHaveBeenCalledWith(expect.stringContaining('documentDB.customEnvironment.ossrdbmsEndpoint'));
    });
});

describe('resolveManagedIdentityTokenResource', () => {
    it('uses the override before the host and never reads the VS Code cloud setting', async () => {
        const deps = createDeps();
        vi.mocked(deps.getCustomEnvironment).mockReturnValue({ ossrdbmsEndpoint: `${customResource}/` });
        expect(await resolveManagedIdentityTokenResource('mongodb://cluster.azure.us/', deps)).toMatchObject({
            resource: customResource,
            reason: 'customOverride',
        });
        expect(deps.getConfiguredCloud).toHaveBeenCalledTimes(1);
        expect(deps.readImdsAzEnvironment).not.toHaveBeenCalled();
    });

    it.each([
        ['azure.com', publicResource],
        ['azure.us', governmentResource],
        ['azure.cn', chinaResource],
    ])('uses the %s host before IMDS', async (suffix, resource) => {
        const deps = createDeps();
        expect(await resolveManagedIdentityTokenResource(`mongodb://cluster.${suffix}/`, deps)).toMatchObject({
            resource,
            scope: `${resource}/.default`,
            reason: 'host',
        });
        expect(deps.getConfiguredCloud).toHaveBeenCalledTimes(1);
        expect(deps.readImdsAzEnvironment).not.toHaveBeenCalled();
    });

    it.each(['AZUREPUBLICCLOUD', 'azurepubliccloud', ' AzurePublicCloud '])(
        'recognizes only the public IMDS environment, ignoring case: %s',
        async (environment) => {
            const deps = createDeps();
            vi.mocked(deps.readImdsAzEnvironment).mockResolvedValue(environment);
            expect(await resolveManagedIdentityTokenResource(privateConnection, deps)).toMatchObject({
                resource: publicResource,
                reason: 'imds',
            });
            expect(deps.getConfiguredCloud).toHaveBeenCalledTimes(1);
        },
    );

    it('records IMDS classification for managed identity resolution', async () => {
        const deps = createDeps();
        vi.mocked(deps.readImdsAzEnvironment).mockResolvedValue('azurepubliccloud');
        const resolution = await resolveManagedIdentityTokenResource(privateConnection, deps);

        expect(resolution.details).toMatchObject({
            flow: 'managedIdentity',
            configuredCloud: 'AzureCloud',
            hostCloud: 'none',
            imdsAzEnvironment: 'AZUREPUBLICCLOUD',
            tokenResource: publicResource,
        });
    });

    it.each([undefined, 'AZUREUSGOVERNMENT', 'AZURECHINACLOUD', 'unknown', ''])(
        'fails clearly for unknown or unavailable IMDS environment %s',
        async (environment) => {
            const deps = createDeps();
            vi.mocked(deps.readImdsAzEnvironment).mockResolvedValue(environment);
            await expect(resolveManagedIdentityTokenResource(privateConnection, deps)).rejects.toMatchObject({
                kind: 'managedIdentityCloudUnknown',
                message: expect.stringContaining('documentDB.customEnvironment.ossrdbmsEndpoint'),
            });
        },
    );
});

describe('resolveTokenResourceForCopy', () => {
    it('prefers the override to the host', () => {
        const deps = createDeps();
        vi.mocked(deps.getCustomEnvironment).mockReturnValue({ ossrdbmsEndpoint: customResource });
        expect(resolveTokenResourceForCopy('mongodb://cluster.azure.us/', deps)).toMatchObject({
            resource: customResource,
            reason: 'customOverride',
        });
    });

    it('prefers the host to the VS Code setting', () => {
        const deps = createDeps();
        expect(resolveTokenResourceForCopy('mongodb://cluster.azure.us/', deps)).toMatchObject({
            resource: governmentResource,
            reason: 'host',
        });
    });

    it.each([
        ['AzureCloud', publicResource],
        ['AzureUSGovernment', governmentResource],
        ['AzureChinaCloud', chinaResource],
    ])('uses the built-in VS Code cloud %s for private hosts', (name, resource) => {
        const deps = createDeps();
        vi.mocked(deps.getConfiguredCloud).mockReturnValue({ name, isCustomCloud: false });
        expect(resolveTokenResourceForCopy(privateConnection, deps)).toMatchObject({ resource, reason: 'setting' });
    });

    it('defaults to public for a custom cloud, without consulting metadata or IMDS', () => {
        const deps = createDeps();
        useCustomCloud(deps);
        expect(resolveTokenResourceForCopy(privateConnection, deps)).toMatchObject({
            resource: publicResource,
            reason: 'copyDefault',
        });
        expect(deps.fetchArmMetadata).not.toHaveBeenCalled();
        expect(deps.readImdsAzEnvironment).not.toHaveBeenCalled();
    });
});

describe('getCloudCategory', () => {
    it.each([
        [publicResource, 'public'],
        [governmentResource, 'usgov'],
        [chinaResource, 'china'],
        [customResource, 'custom'],
    ])('categorizes %s without including identifiers', (resource, category) => {
        expect(getCloudCategory(resource)).toBe(category);
    });
});
