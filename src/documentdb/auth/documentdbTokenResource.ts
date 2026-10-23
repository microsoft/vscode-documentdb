/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// eslint-disable-next-line import/no-internal-modules
import { getConfiguredAzureEnv } from '@microsoft/vscode-azext-azureauth/out/src/utils/configuredAzureEnv';
import * as l10n from '@vscode/l10n';
import * as http from 'http';
import * as vscode from 'vscode';
import { ext } from '../../extensionVariables';
import { settingsKeys } from '../../settingsKeys';
import {
    DOCUMENTDB_TOKEN_RESOURCE,
    getCloudForTokenResource,
    getTokenResourceForCloud,
    parseTokenResource,
    toEntraScope,
    type DocumentDBEntraCloud,
} from './entraScopes';
import { getAzureCloudFromHosts } from './oidcAllowedHosts';

/** Coarse cloud label. Safe for traces and telemetry; never carries an identifier. */
export type CloudCategory = 'public' | 'usgov' | 'china' | 'custom';

export type TokenResourceReason =
    | 'setting'
    | 'customOverride'
    | 'customLoginHost'
    | 'armMetadata'
    | 'host'
    | 'imds'
    | 'copyDefault';

export interface ResolvedTokenResource {
    readonly resource: string;
    readonly scope: string;
    readonly cloudCategory: CloudCategory;
    readonly reason: TokenResourceReason;
}

/** The parts of `getConfiguredAzureEnv()` this module reads. */
export interface ConfiguredCloud {
    readonly name: string;
    readonly isCustomCloud: boolean;
    readonly activeDirectoryEndpointUrl?: string;
    readonly resourceManagerEndpointUrl?: string;
}

/** `documentDB.customEnvironment`. */
export interface DocumentDBCustomEnvironment {
    readonly ossrdbmsEndpoint?: string;
    readonly mongoClusterHostnameSuffix?: string;
}

export interface TokenResourceResolverDeps {
    /** Throws when `custom` is selected without a usable `customEnvironment`. */
    getConfiguredCloud(): ConfiguredCloud;
    getCustomEnvironment(): DocumentDBCustomEnvironment;
    /** Returns the parsed JSON body, or `undefined` on any failure. */
    fetchArmMetadata(url: string): Promise<unknown>;
    /** Returns IMDS `compute.azEnvironment`, or `undefined` on any failure. */
    readImdsAzEnvironment(): Promise<string | undefined>;
    warn(message: string): void;
}

export type TokenResourceErrorKind = 'customCloudUnresolved' | 'cloudMismatch' | 'managedIdentityCloudUnknown';

/** A failure to choose a token audience. The message is user-facing and already actionable. */
export class TokenResourceResolutionError extends Error {
    constructor(
        message: string,
        public readonly kind: TokenResourceErrorKind,
    ) {
        super(message);
        this.name = 'TokenResourceResolutionError';
    }
}

const OSSRDBMS_ENDPOINT_SETTING = `${settingsKeys.customEnvironment}.ossrdbmsEndpoint`;
const SOVEREIGN_CLOUD_SETTING = 'microsoft-sovereign-cloud.environment';

/**
 * Entra login hosts of known clouds, for custom cloud definitions that point at one of them.
 * Source: Azure CLI `cloud.py` (`active_directory` and `ossrdbms_resource_id` per cloud).
 */
const TOKEN_RESOURCE_BY_LOGIN_HOST: ReadonlyMap<string, string> = new Map([
    ['login.microsoftonline.com', 'https://ossrdbms-aad.database.windows.net'],
    ['login.microsoftonline.us', 'https://ossrdbms-aad.database.usgovcloudapi.net'],
    ['login.chinacloudapi.cn', 'https://ossrdbms-aad.database.chinacloudapi.cn'],
    ['login.sovcloud-identity.fr', 'https://ossrdbms-aad.database.sovcloud-api.fr'],
    ['login.sovcloud-identity.de', 'https://ossrdbms-aad.database.sovcloud-api.de'],
]);

const ARM_METADATA_API_VERSION = '2022-09-01';
const ARM_METADATA_TIMEOUT_MS = 5_000;
const IMDS_TIMEOUT_MS = 2_000;

/** Successful ARM metadata lookups, keyed by Resource Manager endpoint. Failures are not cached. */
const armMetadataCache = new Map<string, string>();

/**
 * The token audience for interactive Entra ID sign-in (decisions D6 and D8).
 *
 * It follows `microsoft-sovereign-cloud.environment`, the same setting that chooses the sign-in
 * authority, so the two cannot disagree. A custom cloud is resolved from explicit configuration or
 * the cloud's own metadata and never falls back to the public audience.
 */
export async function resolveInteractiveTokenResource(
    connectionString: string,
    deps: TokenResourceResolverDeps = getDefaultDeps(),
): Promise<ResolvedTokenResource> {
    let configured: ConfiguredCloud;
    try {
        configured = deps.getConfiguredCloud();
    } catch {
        // `custom` without a usable `customEnvironment`: still a custom cloud, never the public one.
        configured = { name: 'custom', isCustomCloud: true };
    }

    const resolved = configured.isCustomCloud
        ? await resolveCustomCloud(configured, deps)
        : fromBuiltInCloud(toBuiltInCloud(configured.name), 'setting');

    if (
        configured.isCustomCloud &&
        resolved.reason === 'customOverride' &&
        resolved.resource === DOCUMENTDB_TOKEN_RESOURCE
    ) {
        deps.warn(
            l10n.t('"{setting}" is the public-cloud value, but VS Code is signed in to a custom cloud.', {
                setting: OSSRDBMS_ENDPOINT_SETTING,
            }),
        );
    }

    const hostCloud = getAzureCloudFromHosts(connectionString);
    const audienceCloud = getCloudForTokenResource(resolved.resource);
    if (hostCloud && hostCloud !== audienceCloud) {
        throw new TokenResourceResolutionError(
            l10n.t(
                'This cluster is in {clusterCloud}, but VS Code is signed in to {signedInCloud}. Change the "{setting}" setting to the cloud of the cluster, then connect again.',
                {
                    clusterCloud: getCloudDisplayName(hostCloud),
                    signedInCloud: audienceCloud ? getCloudDisplayName(audienceCloud) : l10n.t('a custom cloud'),
                    setting: SOVEREIGN_CLOUD_SETTING,
                },
            ),
            'cloudMismatch',
        );
    }

    return resolved;
}

/**
 * The token audience for managed identity (decision D7).
 *
 * The token comes from the VM, not from VS Code's sign-in, so the VS Code cloud setting is not a
 * signal here. The cluster host is: managed identity needs the VM and the cluster in the same
 * tenant, so they are in the same cloud.
 */
export async function resolveManagedIdentityTokenResource(
    connectionString: string,
    deps: TokenResourceResolverDeps = getDefaultDeps(),
): Promise<ResolvedTokenResource> {
    const override = parseTokenResource(deps.getCustomEnvironment().ossrdbmsEndpoint);
    if (override) {
        return fromResource(override, 'customOverride');
    }

    const hostCloud = getAzureCloudFromHosts(connectionString);
    if (hostCloud) {
        return fromBuiltInCloud(hostCloud, 'host');
    }

    const azEnvironment = await deps.readImdsAzEnvironment();
    if (azEnvironment?.trim().toUpperCase() === 'AZUREPUBLICCLOUD') {
        return fromBuiltInCloud('AzureCloud', 'imds');
    }

    throw new TokenResourceResolutionError(
        l10n.t(
            'We could not determine which Azure cloud this virtual machine is in, so we do not know which Microsoft Entra resource to request a token for. Set "{setting}" to the open-source database resource of your cloud, for example "{example}".',
            { setting: OSSRDBMS_ENDPOINT_SETTING, example: getTokenResourceForCloud('AzureUSGovernment') },
        ),
        'managedIdentityCloudUnknown',
    );
}

/**
 * Best-effort `TOKEN_RESOURCE` for a copied managed identity connection string.
 *
 * Synchronous and offline on purpose: copying must not wait on the instance metadata service. The
 * copied string is a starting point the user can edit, so the public value is an acceptable last
 * resort here, unlike at connect time.
 */
export function resolveTokenResourceForCopy(
    connectionString: string,
    deps: Pick<TokenResourceResolverDeps, 'getConfiguredCloud' | 'getCustomEnvironment'> = getDefaultDeps(),
): ResolvedTokenResource {
    const override = parseTokenResource(deps.getCustomEnvironment().ossrdbmsEndpoint);
    if (override) {
        return fromResource(override, 'customOverride');
    }

    const hostCloud = getAzureCloudFromHosts(connectionString);
    if (hostCloud) {
        return fromBuiltInCloud(hostCloud, 'host');
    }

    try {
        const configured = deps.getConfiguredCloud();
        if (!configured.isCustomCloud) {
            return fromBuiltInCloud(toBuiltInCloud(configured.name), 'setting');
        }
    } catch {
        // Misconfigured custom cloud: fall through to the default below.
    }

    return fromBuiltInCloud('AzureCloud', 'copyDefault');
}

export function getCloudCategory(resource: string): CloudCategory {
    switch (getCloudForTokenResource(resource)) {
        case 'AzureCloud':
            return 'public';
        case 'AzureUSGovernment':
            return 'usgov';
        case 'AzureChinaCloud':
            return 'china';
        default:
            return 'custom';
    }
}

export function getCloudDisplayName(cloud: DocumentDBEntraCloud): string {
    switch (cloud) {
        case 'AzureUSGovernment':
            return l10n.t('Azure US Government');
        case 'AzureChinaCloud':
            return l10n.t('Azure China');
        default:
            return l10n.t('Azure (public cloud)');
    }
}

/** Test-only: clears the ARM metadata cache. */
export function resetTokenResourceCacheForTests(): void {
    armMetadataCache.clear();
}

async function resolveCustomCloud(
    configured: ConfiguredCloud,
    deps: TokenResourceResolverDeps,
): Promise<ResolvedTokenResource> {
    const override = parseTokenResource(deps.getCustomEnvironment().ossrdbmsEndpoint);
    if (override) {
        return fromResource(override, 'customOverride');
    }

    const loginHost = getHostname(configured.activeDirectoryEndpointUrl);
    const knownResource = loginHost ? TOKEN_RESOURCE_BY_LOGIN_HOST.get(loginHost) : undefined;
    if (knownResource) {
        return fromResource(knownResource, 'customLoginHost');
    }

    const fromMetadata = await lookUpArmMetadata(configured.resourceManagerEndpointUrl, deps);
    if (fromMetadata) {
        return fromResource(fromMetadata, 'armMetadata');
    }

    throw new TokenResourceResolutionError(
        l10n.t(
            'VS Code is signed in to a custom cloud, and we could not find which Microsoft Entra resource to request a token for. Set "{setting}" to the open-source database resource of your cloud, usually "https://ossrdbms-aad.database.<your-cloud-domain>". Your cloud operator or Azure administrator can tell you the exact value.',
            { setting: OSSRDBMS_ENDPOINT_SETTING },
        ),
        'customCloudUnresolved',
    );
}

async function lookUpArmMetadata(
    resourceManagerEndpointUrl: string | undefined,
    deps: TokenResourceResolverDeps,
): Promise<string | undefined> {
    const base = parseTokenResource(resourceManagerEndpointUrl);
    if (!base) {
        return undefined;
    }

    const cached = armMetadataCache.get(base);
    if (cached) {
        return cached;
    }

    const body = await deps.fetchArmMetadata(`${base}/metadata/endpoints?api-version=${ARM_METADATA_API_VERSION}`);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return undefined;
    }

    const entry = Object.entries(body as Record<string, unknown>).find(
        ([key]) => key.toLowerCase() === 'ossrdbmsresourceid',
    );
    const resource = parseTokenResource(entry?.[1]);
    if (resource) {
        armMetadataCache.set(base, resource);
    }
    return resource;
}

function toBuiltInCloud(name: string): DocumentDBEntraCloud {
    switch (name) {
        case 'AzureUSGovernment':
            return 'AzureUSGovernment';
        case 'AzureChinaCloud':
            return 'AzureChinaCloud';
        default:
            return 'AzureCloud';
    }
}

function fromBuiltInCloud(cloud: DocumentDBEntraCloud, reason: TokenResourceReason): ResolvedTokenResource {
    return fromResource(getTokenResourceForCloud(cloud), reason);
}

function fromResource(resource: string, reason: TokenResourceReason): ResolvedTokenResource {
    return { resource, scope: toEntraScope(resource), cloudCategory: getCloudCategory(resource), reason };
}

function getHostname(url: string | undefined): string | undefined {
    if (!url) {
        return undefined;
    }
    try {
        return new URL(url).hostname.toLowerCase();
    } catch {
        return undefined;
    }
}

function getDefaultDeps(): TokenResourceResolverDeps {
    return {
        getConfiguredCloud: () => getConfiguredAzureEnv(),
        getCustomEnvironment: () =>
            vscode.workspace.getConfiguration().get<DocumentDBCustomEnvironment>(settingsKeys.customEnvironment) ?? {},
        fetchArmMetadata: fetchJson,
        readImdsAzEnvironment,
        warn: (message) => ext.outputChannel?.warn(`[Authentication] ${message}`),
    };
}

async function fetchJson(url: string): Promise<unknown> {
    try {
        const response = await fetch(url, { signal: AbortSignal.timeout(ARM_METADATA_TIMEOUT_MS) });
        return response.ok ? ((await response.json()) as unknown) : undefined;
    } catch {
        return undefined;
    }
}

function readImdsAzEnvironment(): Promise<string | undefined> {
    return new Promise((resolve) => {
        const request = http.get(
            'http://169.254.169.254/metadata/instance/compute/azEnvironment?api-version=2021-02-01&format=text',
            { headers: { Metadata: 'true' }, timeout: IMDS_TIMEOUT_MS },
            (response) => {
                if (response.statusCode !== 200) {
                    response.resume();
                    resolve(undefined);
                    return;
                }
                let body = '';
                response.setEncoding('utf8');
                response.on('data', (chunk: string) => (body += chunk));
                response.on('end', () => resolve(body.trim() || undefined));
                response.on('error', () => resolve(undefined));
            },
        );
        request.on('timeout', () => request.destroy());
        request.on('error', () => resolve(undefined));
    });
}
