/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getConfiguredAuthProviderId, getConfiguredAzureEnv } from '@microsoft/vscode-azext-azureauth';
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
import { getAzureCloudFromHosts, normalizeCustomHostnameSuffix } from './oidcAllowedHosts';

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
    readonly details: Readonly<Record<string, string | boolean>>;
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
    getCustomHostnameSuffixSource(): 'user' | 'workspace' | 'none';
    /** Returns the parsed JSON body, or `undefined` on any failure. */
    fetchArmMetadata(url: string): Promise<unknown>;
    /** Returns IMDS `compute.azEnvironment`, or `undefined` on any failure. */
    readImdsAzEnvironment(): Promise<string | undefined>;
    getSignInEnvironment(): { authProvider: string; brokerImplementation: string | undefined };
    warn(message: string): void;
}

export type TokenResourceErrorKind =
    | 'customCloudUnresolved'
    | 'customCloudDefinitionInvalid'
    | 'invalidCustomOverride'
    | 'cloudMismatch'
    | 'managedIdentityCloudUnknown';

/** A failure to choose a token audience. The message is user-facing and already actionable. */
export class TokenResourceResolutionError extends Error {
    constructor(
        message: string,
        public readonly kind: TokenResourceErrorKind,
        public readonly details: Readonly<Record<string, string | boolean>>,
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
    const hostCloud = getAzureCloudFromHosts(connectionString);
    const customEnvironment = deps.getCustomEnvironment();
    const details = createResolutionDetails('interactive', customEnvironment, deps);
    details.hostCloud = hostCloud ?? 'none';
    const configured = getConfiguredCloudForDetails(deps, details);
    if (!configured) {
        throw resolutionError(
            l10n.t(
                'The VS Code custom cloud definition could not be read. Configure "microsoft-sovereign-cloud.customEnvironment" with all six required fields: name, portalUrl, managementEndpointUrl, resourceManagerEndpointUrl, activeDirectoryEndpointUrl, activeDirectoryResourceId. Then connect again.',
            ),
            'customCloudDefinitionInvalid',
            details,
        );
    }
    const resolved = configured.isCustomCloud
        ? await resolveCustomCloud(configured, customEnvironment, deps, details)
        : fromBuiltInCloud(toBuiltInCloud(configured.name), 'setting');

    if (
        configured?.isCustomCloud &&
        resolved.reason === 'customOverride' &&
        resolved.resource === DOCUMENTDB_TOKEN_RESOURCE
    ) {
        deps.warn(
            l10n.t('"{setting}" is the public-cloud value, but VS Code is signed in to a custom cloud.', {
                setting: OSSRDBMS_ENDPOINT_SETTING,
            }),
        );
    }

    const audienceCloud = getCloudForTokenResource(resolved.resource);
    if (hostCloud && hostCloud !== audienceCloud) {
        throw resolutionError(
            l10n.t(
                'This cluster is in {clusterCloud}, but VS Code is signed in to {signedInCloud}. Change the "{setting}" setting to the cloud of the cluster, then connect again.',
                {
                    clusterCloud: getCloudDisplayName(hostCloud),
                    signedInCloud: audienceCloud ? getCloudDisplayName(audienceCloud) : l10n.t('a custom cloud'),
                    setting: SOVEREIGN_CLOUD_SETTING,
                },
            ),
            'cloudMismatch',
            withDetails(resolved, details).details,
        );
    }

    return withDetails(resolved, details);
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
    const hostCloud = getAzureCloudFromHosts(connectionString);
    const customEnvironment = deps.getCustomEnvironment();
    const details = createResolutionDetails('managedIdentity', customEnvironment, deps);
    details.hostCloud = hostCloud ?? 'none';
    getConfiguredCloudForDetails(deps, details);
    const override = getApplicableOverride(customEnvironment, details);
    if (override) {
        return withDetails(fromResource(override, 'customOverride'), details);
    }

    if (hostCloud) {
        return withDetails(fromBuiltInCloud(hostCloud, 'host'), details);
    }

    const azEnvironment = await deps.readImdsAzEnvironment();
    details.imdsAzEnvironment = classifyImdsAzEnvironment(azEnvironment);
    if (azEnvironment?.trim().toUpperCase() === 'AZUREPUBLICCLOUD') {
        return withDetails(fromBuiltInCloud('AzureCloud', 'imds'), details);
    }

    throw resolutionError(
        l10n.t(
            'We could not determine which Azure cloud this virtual machine is in, so we do not know which Microsoft Entra resource to request a token for. Set "{setting}" to the open-source database resource of your cloud, for example "{example}".',
            { setting: OSSRDBMS_ENDPOINT_SETTING, example: getTokenResourceForCloud('AzureUSGovernment') },
        ),
        'managedIdentityCloudUnknown',
        details,
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
    deps: Pick<
        TokenResourceResolverDeps,
        'getConfiguredCloud' | 'getCustomEnvironment' | 'getCustomHostnameSuffixSource' | 'getSignInEnvironment' | 'warn'
    > = getDefaultDeps(),
): ResolvedTokenResource {
    const hostCloud = getAzureCloudFromHosts(connectionString);
    const customEnvironment = deps.getCustomEnvironment();
    const details = createResolutionDetails('copy', customEnvironment, deps);
    details.hostCloud = hostCloud ?? 'none';
    details.customOssrdbmsEndpointApplicable = true;
    const override = parseTokenResource(customEnvironment.ossrdbmsEndpoint);
    if (override) {
        return withDetails(fromResource(override, 'customOverride'), details);
    }
    if (details.customOssrdbmsEndpointState === 'invalid') {
        deps.warn(
            l10n.t('Ignoring invalid "{setting}" while copying the connection string; using the fallback resource.', {
                setting: OSSRDBMS_ENDPOINT_SETTING,
            }),
        );
    }

    if (hostCloud) {
        return withDetails(fromBuiltInCloud(hostCloud, 'host'), details);
    }

    const configured = getConfiguredCloudForDetails(deps, details);
    if (configured && !configured.isCustomCloud) {
        return withDetails(fromBuiltInCloud(toBuiltInCloud(configured.name), 'setting'), details);
    }

    return withDetails(fromBuiltInCloud('AzureCloud', 'copyDefault'), details);
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
    customEnvironment: DocumentDBCustomEnvironment,
    deps: TokenResourceResolverDeps,
    details: Record<string, string | boolean>,
): Promise<Omit<ResolvedTokenResource, 'details'>> {
    const override = getApplicableOverride(customEnvironment, details);
    if (override) {
        return fromResource(override, 'customOverride');
    }

    const loginHost = getHostname(configured.activeDirectoryEndpointUrl);
    const knownResource = loginHost ? TOKEN_RESOURCE_BY_LOGIN_HOST.get(loginHost) : undefined;
    if (knownResource) {
        return fromResource(knownResource, 'customLoginHost');
    }

    const fromMetadata = await lookUpArmMetadata(configured.resourceManagerEndpointUrl, deps);
    details.armMetadata = fromMetadata.status;
    if (fromMetadata.resource) {
        return fromResource(fromMetadata.resource, 'armMetadata');
    }

    throw resolutionError(
        l10n.t(
            'VS Code is signed in to a custom cloud, and we could not find which Microsoft Entra resource to request a token for. Set "{setting}" to the open-source database resource of your cloud, usually "https://ossrdbms-aad.database.<your-cloud-domain>". Your cloud operator or Azure administrator can tell you the exact value.',
            { setting: OSSRDBMS_ENDPOINT_SETTING },
        ),
        'customCloudUnresolved',
        details,
    );
}

function getApplicableOverride(
    customEnvironment: DocumentDBCustomEnvironment,
    details: Record<string, string | boolean>,
): string | undefined {
    details.customOssrdbmsEndpointApplicable = true;
    if (details.customOssrdbmsEndpointState === 'invalid') {
        throw resolutionError(
            l10n.t(
                '"{setting}" must be an HTTPS resource such as "https://ossrdbms-aad.database.usgovcloudapi.net", with no path or "/.default". Clear the setting to use automatic resource selection.',
                { setting: OSSRDBMS_ENDPOINT_SETTING },
            ),
            'invalidCustomOverride',
            details,
        );
    }
    return parseTokenResource(customEnvironment.ossrdbmsEndpoint);
}

async function lookUpArmMetadata(
    resourceManagerEndpointUrl: string | undefined,
    deps: TokenResourceResolverDeps,
): Promise<{ resource: string | undefined; status: 'cached' | 'found' | 'missingKey' | 'unavailable' }> {
    const base = parseTokenResource(resourceManagerEndpointUrl);
    if (!base) {
        return { resource: undefined, status: 'unavailable' };
    }

    const cached = armMetadataCache.get(base);
    if (cached) {
        return { resource: cached, status: 'cached' };
    }

    let body: unknown;
    try {
        body = await deps.fetchArmMetadata(`${base}/metadata/endpoints?api-version=${ARM_METADATA_API_VERSION}`);
    } catch {
        return { resource: undefined, status: 'unavailable' };
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return { resource: undefined, status: 'unavailable' };
    }

    const entry = Object.entries(body as Record<string, unknown>).find(
        ([key]) => key.toLowerCase() === 'ossrdbmsresourceid',
    );
    const resource = parseTokenResource(entry?.[1]);
    if (resource) {
        armMetadataCache.set(base, resource);
        return { resource, status: 'found' };
    }
    return { resource: undefined, status: 'missingKey' };
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

function fromBuiltInCloud(
    cloud: DocumentDBEntraCloud,
    reason: TokenResourceReason,
): Omit<ResolvedTokenResource, 'details'> {
    return fromResource(getTokenResourceForCloud(cloud), reason);
}

function fromResource(resource: string, reason: TokenResourceReason): Omit<ResolvedTokenResource, 'details'> {
    return { resource, scope: toEntraScope(resource), cloudCategory: getCloudCategory(resource), reason };
}

function withDetails(
    resolved: Omit<ResolvedTokenResource, 'details'>,
    details: Record<string, string | boolean>,
): ResolvedTokenResource {
    return {
        ...resolved,
        details: {
            ...details,
            cloudCategory: resolved.cloudCategory,
            reason: resolved.reason,
            tokenResource: resolved.resource,
        },
    };
}

function resolutionError(
    message: string,
    kind: TokenResourceErrorKind,
    details: Record<string, string | boolean>,
): TokenResourceResolutionError {
    return new TokenResourceResolutionError(message, kind, { ...details, errorKind: kind });
}

function createResolutionDetails(
    flow: 'interactive' | 'managedIdentity' | 'copy',
    customEnvironment: DocumentDBCustomEnvironment,
    deps: Pick<TokenResourceResolverDeps, 'getSignInEnvironment' | 'getCustomHostnameSuffixSource'>,
): Record<string, string | boolean> {
    let authProvider = 'unknown';
    let brokerImplementation = 'default';
    try {
        const signInEnvironment = deps.getSignInEnvironment();
        if (
            signInEnvironment.authProvider === 'microsoft' ||
            signInEnvironment.authProvider === 'microsoft-sovereign-cloud'
        ) {
            authProvider = signInEnvironment.authProvider;
        }
        brokerImplementation = normalizeBrokerImplementation(signInEnvironment.brokerImplementation);
    } catch {
        // Configuration can be read only as support diagnostics, never as an auth decision.
    }
    return {
        flow,
        configuredCloud: 'unreadable',
        authProvider,
        brokerImplementation,
        hostCloud: 'none',
        customOssrdbmsEndpointState: !customEnvironment.ossrdbmsEndpoint?.trim()
            ? 'absent'
            : parseTokenResource(customEnvironment.ossrdbmsEndpoint)
              ? 'valid'
              : 'invalid',
        customOssrdbmsEndpointApplicable: false,
        customHostnameSuffixSet: !!normalizeCustomHostnameSuffix(customEnvironment.mongoClusterHostnameSuffix),
        customHostnameSuffixSource: deps.getCustomHostnameSuffixSource(),
        armMetadata: 'notNeeded',
        imdsAzEnvironment: 'notQueried',
    };
}

function getConfiguredCloudForDetails(
    deps: Pick<TokenResourceResolverDeps, 'getConfiguredCloud'>,
    details: Record<string, string | boolean>,
): ConfiguredCloud | undefined {
    try {
        const configured = deps.getConfiguredCloud();
        details.configuredCloud = configured.isCustomCloud ? 'custom' : toConfiguredCloudTraceValue(configured.name);
        return configured;
    } catch {
        return undefined;
    }
}

function toConfiguredCloudTraceValue(name: string): string {
    switch (name) {
        case 'AzureCloud':
        case 'AzureUSGovernment':
        case 'AzureChinaCloud':
            return name;
        default:
            return 'custom';
    }
}

function normalizeBrokerImplementation(value: string | undefined): string {
    switch (value) {
        case undefined:
            return 'default';
        case 'msal':
        case 'msal-no-broker':
            return value;
        default:
            return 'other';
    }
}

function classifyImdsAzEnvironment(value: string | undefined): string {
    if (!value?.trim()) {
        return 'unavailable';
    }
    if (value.trim().toUpperCase() === 'AZUREPUBLICCLOUD') {
        return 'AZUREPUBLICCLOUD';
    }
    return value === value.trim() && /^Azure[A-Za-z]{1,40}$/.test(value) ? value : 'other';
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
        getCustomHostnameSuffixSource: () => {
            const inspected = vscode.workspace
                .getConfiguration()
                .inspect<DocumentDBCustomEnvironment>(settingsKeys.customEnvironment);
            if (inspected?.globalValue?.mongoClusterHostnameSuffix?.trim()) {
                return 'user';
            }
            if (
                inspected?.workspaceValue?.mongoClusterHostnameSuffix?.trim() ||
                inspected?.workspaceFolderValue?.mongoClusterHostnameSuffix?.trim()
            ) {
                return 'workspace';
            }
            return 'none';
        },
        fetchArmMetadata: fetchJson,
        readImdsAzEnvironment,
        getSignInEnvironment: () => ({
            authProvider: getConfiguredAuthProviderId(),
            brokerImplementation: vscode.workspace
                .getConfiguration('microsoft-authentication')
                .get<string>('implementation'),
        }),
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
