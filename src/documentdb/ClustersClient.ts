/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * wrapper for mongodclient, with handling of supported operations, plus, as a workaround, access to the raw mongodbclient.
 * also, client-pool, that handles active connections, over time adds notificaitons on dropped conenctions etc.
 * singletone on a client with a getter from a connection pool..
 */

import {
    UserCancelledError,
    appendExtensionUserAgent,
    callWithTelemetryAndErrorHandling,
    parseError,
    type ITelemetryContext,
} from '@microsoft/vscode-azext-utils';
import { ParseMode, parse as parseShellBSON } from '@mongodb-js/shell-bson-parser';
import * as l10n from '@vscode/l10n';
import { randomUUID } from 'crypto';
import {
    MongoBulkWriteError,
    MongoClient,
    MongoError,
    MongoNetworkError,
    MongoNotConnectedError,
    MongoServerError,
    ObjectId,
    type ClientSession,
    type Collection,
    type DeleteResult,
    type Document,
    type Filter,
    type FindOptions,
    type InsertManyResult,
    type ListDatabasesResult,
    type MongoClientOptions,
    type OIDCResponse,
    type WithId,
    type WithoutId,
} from 'mongodb';
import { Links } from '../constants';
import { ext } from '../extensionVariables';
import { meterSilentCatch } from '../utils/accumulatingTelemetry';
import { type EmulatorConfiguration } from '../utils/emulatorConfiguration';
import { nonNullValue } from '../utils/nonNull';
import { type AuthHandlerResponse, type VerifiedEntraIdentity } from './auth/AuthHandler';
import { AuthMethodId, isSupportedAuthMethod } from './auth/AuthMethod';
import { createAuthHandler } from './auth/createAuthHandler';
import { EntraSignInRequiredError } from './auth/entraErrors/entraCallbackErrors';
import { getAzureHostSuffix } from './auth/oidcAllowedHosts';
import { readJwtTimes } from './auth/tokenExpiry';
import { QueryInsightsApis, type ExplainVerbosity } from './client/QueryInsightsApis';
import { classifyConnectionFailure, type ConnectionFailure } from './connectionFailures';
import { isRetiredConnectionBinding, retireConnectionBindings } from './connectionBindingRetirement';
import { computeConnectionFingerprint, type ConnectionPrincipal } from './connectionFingerprint';
import { ConnectionUnavailableError, type ConnectionUnavailableReason } from './ConnectionUnavailableError';
import { CredentialCache, type CachedClusterCredentials } from './CredentialCache';
import { QueryError } from './errors/QueryError';
import {
    llmEnhancedFeatureApis,
    type CollectionStats,
    type CreateIndexResult,
    type DropIndexResult,
    type ExplainOptions,
    type ExplainResult,
    type IndexSpecification,
    type IndexStats,
} from './LlmEnhancedFeatureApis';
import { SchemaStore } from './SchemaStore';
import { prepareDriverConnectionString } from './srv/prepareDriverConnectionString';
import { type SrvResolutionSummary } from './srv/srvResolutionSummary';
import { ConnectionStartupTimings } from './utils/ConnectionStartupTimings';
import { getHostsFromConnectionString, getUserNameFromConnectionString } from './utils/connectionStringHelpers';
import { fixupDocumentDbExplain } from './utils/fixupDocumentDbExplain';
import { getClusterMetadata, type ClusterMetadata } from './utils/getClusterMetadata';
import { parseDocumentId } from './utils/parseDocumentId';
import { applyStartupFailureTelemetry, type ClientStartupTrigger } from './utils/startupFailureTelemetry';
import { resolveAllowInvalidCertificates } from './utils/tlsException';
import { toFilterQueryObj } from './utils/toFilterQuery';

export interface DatabaseItemModel {
    name: string;
    sizeOnDisk?: number;
    empty?: boolean;
}

export interface ConnectionBinding {
    readonly clusterId: string;
    readonly fingerprint: string;
    readonly generation: number;
}

interface ConnectionStatsEntry {
    readonly client?: {
        readonly generation: number;
        readonly ageMs: number;
        readonly authMethod?: AuthMethodId;
        readonly startupId?: string;
        readonly state: 'cached' | 'closed' | 'replaceOnNextForeground' | 'replaceOnRecovery';
        readonly socketTrace: boolean;
        readonly lastEntraTokenExpiresAt?: string;
    };
    readonly pending?: { readonly startupId: string; readonly superseded: boolean };
    readonly held?: ConnectionUnavailableReason;
    readonly lastFailedStartupId?: string;
}

export type VerifiedIdentity = VerifiedEntraIdentity | Exclude<ConnectionPrincipal, { kind: 'entra' }>;

export interface CollectionItemModel {
    name: string;
    type?: string;
    shardKey?: Record<string, number | string>;
}

/**
 * Find query parameters for MongoDB find operations.
 * Each field accepts a JSON string representation of the MongoDB query syntax.
 */
export interface FindQueryParams {
    /**
     * The filter/query to match documents.
     * @default '{}'
     */
    filter?: string;

    /**
     * The projection to determine which fields to include/exclude.
     * @default '{}'
     */
    project?: string;

    /**
     * The sort specification for ordering results.
     * @default '{}'
     */
    sort?: string;

    /**
     * Number of documents to skip.
     * @default 0
     */
    skip?: number;

    /**
     * Maximum number of documents to return.
     * @default 0 (unlimited)
     */
    limit?: number;
}

export interface IndexItemModel {
    name: string;
    type: 'traditional' | 'search' | 'vectorSearch';
    key?: {
        [key: string]: number | string;
    };
    version?: number;
    unique?: boolean;
    sparse?: boolean;
    background?: boolean;
    hidden?: boolean;
    expireAfterSeconds?: number;
    partialFilterExpression?: Document;
    cosmosSearchOptions?: Document;
    status?: string;
    queryable?: boolean;
    fields?: unknown[];
    [key: string]: unknown; // Allow additional index properties
}

export type IndexExclusionReason = 'builtInId' | 'notCopyable';

export function getIndexExclusionReason(index: IndexItemModel): IndexExclusionReason | undefined {
    if (index.key && Object.keys(index.key).length === 1 && Object.prototype.hasOwnProperty.call(index.key, '_id')) {
        return 'builtInId';
    }

    return index.key === undefined ? 'notCopyable' : undefined;
}

export function isBulkWriteError(error: unknown): error is MongoBulkWriteError {
    return error instanceof MongoBulkWriteError;
}

type ClientStartupStage =
    | 'stage01PreparingCredentials'
    | 'stage02ConfiguringAuth'
    | 'stage03PreparingClient'
    | 'stage04ConnectingAndAuthenticating'
    | 'stage05InitializingApis';

interface ClientStartup {
    readonly id: string;
    readonly expectedFingerprint?: string;
    readonly startedAt: number;
    readonly costTimings: ConnectionStartupTimings;
    readonly telemetry: ITelemetryContext;
    readonly stageDurationsMs: Partial<Record<ClientStartupStage, number>>;
    stage: ClientStartupStage;
    stageStartedAt: number;
    /** Set when no cached credentials existed, so the failure category does not depend on a localized message. */
    credentialsMissing?: boolean;
}

interface PendingStartup {
    readonly id: string;
    readonly epoch: number;
    readonly promise: Promise<ClustersClient>;
}

async function waitForClient(
    promise: Promise<ClustersClient>,
    signal: AbortSignal | undefined,
    startupId: string | undefined,
): Promise<ClustersClient> {
    if (!signal) {
        return promise;
    }
    let onAbort!: () => void;
    try {
        return await new Promise<ClustersClient>((resolve, reject) => {
            onAbort = (): void => {
                ext.outputChannel.debug(
                    `[ClustersClient] startup=${startupId} wait canceled by user surface=extension`,
                );
                reject(new UserCancelledError('abortConnection'));
            };
            // Observe settlement even if this caller has already left.
            void promise.then(resolve, reject);
            if (signal.aborted) {
                onAbort();
            } else {
                signal.addEventListener('abort', onAbort, { once: true });
            }
        });
    } finally {
        signal.removeEventListener('abort', onAbort);
    }
}

/**
 * Validates that a parsed BSON value is a plain object (not a scalar, array, or null).
 * Throws a QueryError if the value is not a plain object.
 */
function assertDocumentObject(value: unknown, errorCode: 'INVALID_PROJECTION' | 'INVALID_SORT'): Document {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new QueryError(errorCode, l10n.t('Expected a document object like { field: 1 }, got: {0}', typeof value));
    }
    return value as Document;
}

function getVerifiedIdentity(
    authMethod: AuthMethodId,
    credentials: CachedClusterCredentials,
    configuredUri: string,
    verifiedIdentity: VerifiedEntraIdentity | undefined,
): VerifiedIdentity {
    switch (authMethod) {
        case AuthMethodId.NativeAuth:
            return { kind: 'native', username: getUserNameFromConnectionString(configuredUri) };
        case AuthMethodId.ManagedIdentity:
            return { kind: 'managedIdentity', clientId: credentials.managedIdentityConfig?.clientId };
        case AuthMethodId.MicrosoftEntraID:
            return nonNullValue(verifiedIdentity, 'verifiedIdentity', 'ClustersClient.ts');
        case AuthMethodId.NoAuth:
            return { kind: 'none' };
    }
}

export class ClustersClient {
    /**
     * Cache of active MongoDB clients, keyed by clusterId.
     *
     * KEY: `clusterId` - The stable cluster identifier (NOT the tree item ID)
     *   - Connections View items: Use `cluster.clusterId` (= storageId, stable UUID)
     *   - Azure Resources View items: Use `cluster.clusterId` (= Sanitized Azure Resource ID)
     *
     * VALUE: ClustersClient instance wrapping a MongoClient
     *
     * ⚠️ WARNING: Do NOT use `treeId` as the cache key!
     * Tree IDs change when items are moved between folders, causing cache misses
     * and orphaned connections.
     */
    static _clients: Map<string, ClustersClient> = new Map();

    private static readonly _generations = new Map<string, number>();
    private static readonly _epochs = new Map<string, number>();
    private static readonly _latches = new Map<string, ConnectionUnavailableReason>();
    private static readonly _pendingStartups = new Map<string, PendingStartup>();
    private static readonly _lastVerifiedIdentities = new Map<string, Readonly<VerifiedIdentity>>();

    /** Last successfully published identity, retained when the client is evicted. */
    public static getLastVerifiedIdentity(clusterId: string): VerifiedIdentity | undefined {
        return ClustersClient._lastVerifiedIdentities.get(clusterId);
    }

    public static clearLastVerifiedIdentity(clusterId: string): void {
        ClustersClient._lastVerifiedIdentities.delete(clusterId);
    }

    /** A saved, explicit tenant change must not silently use the previous tenant's pin. */
    public static discardEntraPinForDifferentTenant(clusterId: string, tenantId: string | undefined): void {
        const identity = ClustersClient.getEntraPin(clusterId);
        if (identity && identity.tenantId !== tenantId) {
            ClustersClient._lastVerifiedIdentities.delete(clusterId);
        }
    }

    private static getEntraPin(clusterId: string): VerifiedEntraIdentity | undefined {
        const identity = ClustersClient.getLastVerifiedIdentity(clusterId);
        return identity?.kind === 'entra' ? identity : undefined;
    }

    public static getEpoch(clusterId: string): number {
        return ClustersClient._epochs.get(clusterId) ?? 0;
    }

    public static invalidate(clusterId: string): number {
        const epoch = ClustersClient.getEpoch(clusterId) + 1;
        ClustersClient._epochs.set(clusterId, epoch);
        return epoch;
    }

    public static latch(clusterId: string, reason: ConnectionUnavailableReason): void {
        ClustersClient._latches.set(clusterId, reason);
        ClustersClient.invalidate(clusterId);
    }

    public static unlatch(clusterId: string): void {
        ClustersClient._latches.delete(clusterId);
        ClustersClient.invalidate(clusterId);
    }

    public static getLatchReason(clusterId: string): ConnectionUnavailableReason | undefined {
        return ClustersClient._latches.get(clusterId);
    }

    public static clearCredentialRejection(clusterId: string, epoch: number): boolean {
        if (
            ClustersClient.getEpoch(clusterId) !== epoch ||
            ClustersClient.getLatchReason(clusterId) !== 'credentialsRejected'
        ) {
            return false;
        }
        ClustersClient.unlatch(clusterId);
        return true;
    }

    #startupCredentials: Readonly<CachedClusterCredentials>;
    #verifiedIdentity: VerifiedIdentity;
    private _fingerprint: string;
    private _binding: ConnectionBinding;
    private _createdAt: number;
    private _mongoClient: MongoClient;
    private _closed = false;
    private _replacement?: 'replaceOnNextForeground' | 'replaceOnRecovery';
    private _interactiveEntraStartupId?: string;
    private _lastEntraTokenExpiresAt?: string;
    private _llmEnhancedFeatureApis: llmEnhancedFeatureApis | null = null;
    private _queryInsightsApis: QueryInsightsApis | null = null;
    private _clusterMetadataPromise: Promise<ClusterMetadata> | null = null;
    private _srvResolution?: SrvResolutionSummary;

    /** In-memory cache for listDatabases results. */
    private _databasesCache: DatabaseItemModel[] | null = null;
    /** In-memory cache for listCollections results, keyed by database name. */
    private _collectionsCache = new Map<string, CollectionItemModel[]>();

    /**
     * This client's startup ID, also published as `startupCorrelationId`. Links `connect.startup`,
     * `connect.staticmetadata`, `connect.getmetadata` and SRV events. Generated once per cold startup.
     */
    public connectionCorrelationId?: string;

    /**
     * Per cluster, the `startupCorrelationId` of the last startup that failed and was not yet
     * followed by a successful one. Lets recovery actions (connection diagnosis, the next retry)
     * name the failure they follow up on. Random IDs only; cleared when a startup succeeds.
     */
    static readonly _lastFailedStartups = new Map<string, string>();

    public static getLastFailedStartupCorrelationId(clusterId: string): string | undefined {
        return ClustersClient._lastFailedStartups.get(clusterId);
    }

    public static getDiagnosticsSnapshot(): readonly ConnectionStatsEntry[] {
        const now = Date.now();
        const clusterIds = new Set([
            ...ClustersClient._clients.keys(),
            ...ClustersClient._pendingStartups.keys(),
            ...ClustersClient._latches.keys(),
            ...ClustersClient._lastFailedStartups.keys(),
        ]);
        return Array.from(clusterIds, (clusterId): ConnectionStatsEntry => {
            const client = ClustersClient._clients.get(clusterId);
            const pending = ClustersClient._pendingStartups.get(clusterId);
            const authMethod = client?.authMethod;
            return {
                client: client && {
                    generation: client.generation,
                    ageMs: Math.max(0, now - client.createdAt),
                    authMethod: isSupportedAuthMethod(authMethod) ? authMethod : undefined,
                    startupId: client.connectionCorrelationId,
                    state: client._replacement ?? (client._closed ? 'closed' : 'cached'),
                    socketTrace: client._interactiveEntraStartupId !== undefined,
                    lastEntraTokenExpiresAt: client._lastEntraTokenExpiresAt,
                },
                pending: pending && {
                    startupId: pending.id,
                    superseded: pending.epoch !== ClustersClient.getEpoch(clusterId),
                },
                held: ClustersClient.getLatchReason(clusterId),
                lastFailedStartupId: ClustersClient.getLastFailedStartupCorrelationId(clusterId),
            };
        });
    }

    /**
     * Private constructor - use getClient() instead.
     * Connections/Clients are being cached and reused.
     *
     * @param clusterId - The stable cluster ID used to look up credentials in CredentialCache.
     *   This is NOT the tree item ID - it's the clusterId that remains stable across folder moves.
     */
    private constructor(private readonly clusterId: string) {
        return;
    }

    public get binding(): ConnectionBinding {
        return this._binding;
    }

    public get createdAt(): number {
        return this._createdAt;
    }

    public get generation(): number {
        return this.binding.generation;
    }

    public get fingerprint(): string {
        return this.binding.fingerprint;
    }

    public get authMethod(): AuthMethodId {
        return this.#startupCredentials.authMechanism ?? AuthMethodId.NativeAuth;
    }

    // TODO: add support for single databases via connection string.
    //
    // const databaseInConnectionString = getDatabaseNameFromConnectionString(this.account.connectionString);
    // if (databaseInConnectionString && !this.isEmulator) {
    //     // emulator violates the connection string format
    //     // If the database is in the connection string, that's all we connect to (we might not even have permissions to list databases)
    //     databases = [
    //         {
    //             name: databaseInConnectionString,
    //             empty: false,
    //         },
    //     ];
    // }
    //
    // } catch (error) {
    //     const message = parseError(error).message;
    //     if (this.isEmulator && message.includes('ECONNREFUSED')) {
    //         // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    //         error.message = `Unable to reach emulator. See ${Links.LocalConnectionDebuggingTips} for debugging tips.\n${message}`;
    //     }
    //     throw error;
    // } finally {
    //     if (mongoClient) {
    //         void mongoClient.close();
    //     }
    // }

    /** Whether this client starts the Local Quick Start managed instance, as marked in its cached credentials. */
    private isLocalQuickStartInstance(): boolean {
        return CredentialCache.getCredentials(this.clusterId)?.localQuickStartInstance === true;
    }

    private async initClient(
        startupId: string,
        trigger: ClientStartupTrigger,
        epoch: number,
        allowInteractive: boolean,
        expectedFingerprint?: string,
        recoveredAuth?: AuthHandlerResponse,
    ): Promise<void> {
        this.connectionCorrelationId = startupId;
        let originalFailure: { error: unknown } | undefined;

        try {
            await callWithTelemetryAndErrorHandling('connect.startup', async (context) => {
                context.errorHandling.suppressDisplay = true;
                context.errorHandling.rethrow = true;
                context.telemetry.maskEntireErrorMessage = true;
                context.telemetry.properties.connectionCorrelationId = startupId;
                context.telemetry.properties.startupCorrelationId = startupId;
                context.telemetry.properties.surface = 'extension';
                context.telemetry.properties.startupTrigger = trigger;
                context.telemetry.properties.localQuickStartInstance = this.isLocalQuickStartInstance()
                    ? 'true'
                    : 'false';
                const previousFailedStartupId = ClustersClient._lastFailedStartups.get(this.clusterId);
                if (previousFailedStartupId) {
                    context.telemetry.properties.previousFailedStartupCorrelationId = previousFailedStartupId;
                }
                const startedAt = Date.now();
                const startup: ClientStartup = {
                    id: startupId,
                    expectedFingerprint,
                    startedAt,
                    costTimings: new ConnectionStartupTimings(),
                    telemetry: context.telemetry,
                    stageDurationsMs: {},
                    stage: 'stage01PreparingCredentials',
                    stageStartedAt: startedAt,
                };

                try {
                    await this.initializeClient(startup, epoch, allowInteractive, recoveredAuth);
                    this.finishClientStartup(startup, 'succeeded');
                } catch (error) {
                    const canceled = error instanceof UserCancelledError;
                    if (!canceled) {
                        // Computed from the original error: the masked telemetry error carries no cause.
                        applyStartupFailureTelemetry(context.telemetry.properties, error, {
                            credentialsMissing: startup.credentialsMissing,
                        });
                    }
                    this.finishClientStartup(startup, canceled ? 'canceled' : 'failed');
                    originalFailure = { error };
                    if (canceled) {
                        throw new UserCancelledError('connectionStartup');
                    }
                    const telemetryError = new Error('Connection startup failed');
                    telemetryError.stack = undefined;
                    throw telemetryError;
                }
            });
        } catch (error) {
            throw originalFailure ? originalFailure.error : error;
        }

        if (originalFailure) {
            throw originalFailure.error;
        }
    }

    private recordClientStartupStage(startup: ClientStartup): number {
        const durationMs = Date.now() - startup.stageStartedAt;
        const accumulatedDurationMs = (startup.stageDurationsMs[startup.stage] ?? 0) + durationMs;
        startup.stageDurationsMs[startup.stage] = accumulatedDurationMs;
        startup.telemetry.measurements[`${startup.stage}DurationMs`] = accumulatedDurationMs;
        return durationMs;
    }

    private advanceClientStartup(startup: ClientStartup, stage: ClientStartupStage): void {
        this.recordClientStartupStage(startup);
        startup.stage = stage;
        startup.stageStartedAt = Date.now();
    }

    private finishClientStartup(startup: ClientStartup, outcome: 'succeeded' | 'failed' | 'canceled'): void {
        startup.telemetry.properties.startupOutcome = outcome;
        startup.telemetry.properties.lastStage = startup.stage;
        startup.telemetry.measurements.lastStageDurationMs = this.recordClientStartupStage(startup);
        const costTimingsMs = startup.costTimings.finish();
        Object.assign(startup.telemetry.measurements, costTimingsMs);
        const level = outcome === 'failed' ? 'error' : 'trace';
        ext.outputChannel?.[level](
            `[ClustersClient] startup=${startup.id} ${outcome} surface=extension auth=${startup.telemetry.properties.authMethod ?? 'unknown'} lastStage=${startup.stage} elapsedMs=${String(Date.now() - startup.startedAt)} stageDurationsMs=${JSON.stringify(startup.stageDurationsMs)} costTimingsMs=${JSON.stringify(costTimingsMs)}`,
        );
    }

    private async initializeClient(
        startup: ClientStartup,
        epoch: number,
        allowInteractive: boolean,
        recoveredAuth?: AuthHandlerResponse,
    ): Promise<void> {
        const cachedCredentials = CredentialCache.getCredentials(this.clusterId);
        if (!cachedCredentials) {
            startup.credentialsMissing = true;
            throw new ConnectionUnavailableError('credentialsMissing');
        }
        const credentials = structuredClone(cachedCredentials);
        this.#startupCredentials = credentials;

        const reason = ClustersClient.getLatchReason(this.clusterId);
        if (reason) {
            throw new ConnectionUnavailableError(reason);
        }
        if (epoch !== ClustersClient.getEpoch(this.clusterId)) {
            throw new Error(l10n.t('The connection changed while it was opening. Try again.'));
        }

        // default to NativeAuth if nothing is configured
        const authMethod = this.authMethod;
        startup.telemetry.properties.authMethod = authMethod;

        const pinnedEntraIdentity =
            authMethod === AuthMethodId.MicrosoftEntraID ? ClustersClient.getEntraPin(this.clusterId) : undefined;
        if (authMethod === AuthMethodId.MicrosoftEntraID && !pinnedEntraIdentity && !allowInteractive) {
            throw new EntraSignInRequiredError('noSession');
        }
        const authHandler = createAuthHandler(authMethod, credentials, {
            interactive: allowInteractive && !pinnedEntraIdentity,
            ...(pinnedEntraIdentity ? { pinnedEntraIdentity } : {}),
        });

        // Configure auth and get connection options
        this.advanceClientStartup(startup, 'stage02ConfiguringAuth');
        const { connectionString, options, verifiedIdentity } =
            recoveredAuth ??
            (await authHandler.configureAuth(startup.costTimings, {
                startupCorrelationId: startup.id,
                surface: 'extension',
                startupProperties: startup.telemetry.properties,
            }));

        this.advanceClientStartup(startup, 'stage03PreparingClient');
        this.#verifiedIdentity = getVerifiedIdentity(authMethod, credentials, connectionString, verifiedIdentity);
        this._fingerprint = computeConnectionFingerprint({
            connectionString: credentials.connectionString,
            principal: this.#verifiedIdentity,
        });
        if (startup.expectedFingerprint !== undefined && this._fingerprint !== startup.expectedFingerprint) {
            throw new ConnectionUnavailableError('identityChanged');
        }
        const hosts = getHostsFromConnectionString(connectionString);
        const userAgentString = hosts.some((host) => getAzureHostSuffix(host)) ? appendExtensionUserAgent() : undefined;
        if (userAgentString) {
            options.appName = userAgentString;
        }

        // Emit static metadata (domain info) BEFORE the connection attempt.
        // This ensures destination telemetry is available even when connections fail.
        const correlationId = startup.id;
        const localQuickStartInstance = credentials.localQuickStartInstance === true ? 'true' : 'false';
        void callWithTelemetryAndErrorHandling('connect.staticmetadata', async (context) => {
            const { getDomainMetadata } = await import('./utils/getClusterMetadata');
            const domainMetadata = getDomainMetadata(hosts);
            context.telemetry.properties = {
                startupCorrelationId: correlationId,
                connectionCorrelationId: correlationId,
                localQuickStartInstance,
                ...context.telemetry.properties,
                ...domainMetadata,
            };
        });

        const prepared = await prepareDriverConnectionString({
            connectionString,
            options,
            surface: 'extension',
            correlation: {
                startupCorrelationId: startup.id,
                connectionCorrelationId: startup.id,
            },
            startupTelemetry: startup.telemetry,
        });
        if (recoveredAuth && epoch !== ClustersClient.getEpoch(this.clusterId)) {
            throw new UserCancelledError('signInAgain');
        }
        this._srvResolution = prepared.summary;
        await this.connect(
            startup,
            prepared.connectionString,
            prepared.options,
            authMethod === AuthMethodId.MicrosoftEntraID,
            credentials.emulatorConfiguration,
            connectionString,
        );
        if (recoveredAuth && epoch !== ClustersClient.getEpoch(this.clusterId)) {
            throw new UserCancelledError('signInAgain');
        }

        // Start metadata collection and store the promise
        this._clusterMetadataPromise = getClusterMetadata(this._mongoClient, hosts);

        // Collect telemetry (non-blocking) - reuses the same promise
        void callWithTelemetryAndErrorHandling('connect.getmetadata', async (context) => {
            const metadata: ClusterMetadata = await this._clusterMetadataPromise!;
            context.telemetry.properties = {
                authmethod: authMethod,
                startupCorrelationId: correlationId,
                connectionCorrelationId: correlationId,
                localQuickStartInstance,
                ...context.telemetry.properties,
                ...metadata,
            };
        });
    }

    private traceInteractiveEntraPool(startupId: string): void {
        const log = (event: string, connectionId?: number | '<monitor>', reason?: string): void => {
            const idField = typeof connectionId === 'number' ? ` connectionId=${connectionId}` : '';
            const reasonField = reason === undefined ? '' : ` reason=${reason}`;
            ext.outputChannel?.debug(`[ClustersClient] startup=${startupId} ${event}${idField}${reasonField}`);
        };
        this._mongoClient.on('connectionCreated', ({ connectionId }) => log('connectionCreated', connectionId));
        this._mongoClient.on('connectionReady', ({ connectionId }) => log('connectionReady', connectionId));
        this._mongoClient.on('connectionClosed', ({ connectionId, reason }) => {
            log(
                'connectionClosed',
                connectionId,
                ['idle', 'stale', 'poolClosed', 'error'].includes(reason) ? reason : undefined,
            );
        });
        this._mongoClient.on('connectionCheckOutFailed', ({ reason }) => {
            log(
                'connectionCheckOutFailed',
                undefined,
                ['poolClosed', 'timeout', 'connectionError'].includes(reason) ? reason : undefined,
            );
        });
    }

    private async connect(
        startup: ClientStartup,
        connectionString: string,
        options: MongoClientOptions,
        interactiveEntra: boolean,
        emulatorConfiguration?: EmulatorConfiguration,
        originalConnectionString: string = connectionString,
    ): Promise<void> {
        const authProperties = options.authMechanismProperties;
        const callback = authProperties?.OIDC_CALLBACK;
        if (interactiveEntra && callback) {
            options = {
                ...options,
                authMechanismProperties: {
                    ...authProperties,
                    OIDC_CALLBACK: async (params): Promise<OIDCResponse> => {
                        const response = await callback(params);
                        const { expSec } = readJwtTimes(response.accessToken);
                        this._lastEntraTokenExpiresAt =
                            expSec === undefined ? undefined : (new Date(expSec * 1000).toJSON() ?? undefined);
                        return response;
                    },
                },
            };
        }
        this._mongoClient = new MongoClient(connectionString, options);
        this._mongoClient.once('topologyClosed', (): void => {
            this._closed = true;
        });
        if (interactiveEntra) {
            this._interactiveEntraStartupId = startup.id;
            this.traceInteractiveEntraPool(startup.id);
        }

        try {
            this.advanceClientStartup(startup, 'stage04ConnectingAndAuthenticating');
            const stopDatabaseConnect = startup.costTimings.startDatabaseConnect();
            try {
                await this._mongoClient.connect();
            } finally {
                stopDatabaseConnect();
            }
            this.advanceClientStartup(startup, 'stage05InitializingApis');
            this._llmEnhancedFeatureApis = new llmEnhancedFeatureApis(this._mongoClient);
            this._queryInsightsApis = new QueryInsightsApis(this._mongoClient);
        } catch (error) {
            const message = parseError(error).message;
            // Surface the friendly local-connection tips only for a genuinely local-ish connection
            // (emulator, OR a local connection that opted into the TLS exception — host-gated the
            // same way as the TLS option). An orphaned flag on a PUBLIC host must NOT make a public
            // ECONNREFUSED/self-signed failure show "local instance" troubleshooting copy.
            const isLocalish =
                !!emulatorConfiguration?.isEmulator ||
                !!resolveAllowInvalidCertificates(
                    emulatorConfiguration?.disableEmulatorSecurity,
                    originalConnectionString,
                );
            if (isLocalish && message.includes('ECONNREFUSED')) {
                // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
                error.message = l10n.t(
                    'Unable to connect to the local instance. Make sure it is started correctly. See {link} for tips.',
                    { link: Links.LocalConnectionDebuggingTips },
                );
            } else if (isLocalish && message.includes('self-signed certificate')) {
                // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
                error.message = l10n.t(
                    'The local instance is using a self-signed certificate. To connect, you must import the appropriate TLS/SSL certificate. See {link} for tips.',
                    { link: Links.LocalConnectionDebuggingTips },
                );
            }
            throw error;
        }
    }

    /**
     * Returns the underlying MongoClient instance.
     * Used by the query playground evaluator to create a `@mongosh` ServiceProvider
     * that reuses the existing, authenticated connection.
     */
    public getMongoClient(): MongoClient {
        return this._mongoClient;
    }

    /**
     * Retrieves an instance of `ClustersClient` without opening sign-in UI.
     *
     * @param clusterId - A required string used to find the cached connection string to connect.
     * It is also used as a key to reuse existing clients.
     * @param abortSignal - Optional signal that rejects the call with `UserCancelledError` on abort.
     * Cancellation stops only this caller's wait, not the underlying connection.
     * @param onStartup - Called with the startup correlation ID of the attempt this call joins.
     * @param trigger - Which code path asks for the client; recorded as `startupTrigger` when this
     * call starts a new `connect.startup`. Callers that do not pass it are recorded as `other`.
     * @param options - Background callers may reuse a client or join a startup, but never start one.
     * @returns A promise that resolves to an instance of `ClustersClient`.
     */
    public static async getClient(
        clusterId: string,
        abortSignal?: AbortSignal,
        onStartup?: (id: string) => void,
        trigger: ClientStartupTrigger = 'other',
        options?: { readonly background?: boolean },
    ): Promise<ClustersClient> {
        return ClustersClient.acquireClient(
            clusterId,
            abortSignal,
            onStartup,
            trigger,
            false,
            options?.background === true,
        );
    }

    /** A deliberate connect may open sign-in only when there is no verified Entra identity. */
    public static async connectInteractive(
        clusterId: string,
        abortSignal?: AbortSignal,
        onStartup?: (id: string) => void,
        trigger: ClientStartupTrigger = 'treeConnect',
    ): Promise<ClustersClient> {
        return ClustersClient.acquireClient(clusterId, abortSignal, onStartup, trigger, true, false);
    }

    /** A surface can follow new generations, but never start or use a client for a different identity. */
    public static async resolveBoundClient(
        binding: ConnectionBinding,
        options?: { readonly background?: boolean; readonly trigger?: ClientStartupTrigger },
    ): Promise<ClustersClient> {
        if (isRetiredConnectionBinding(binding)) {
            throw new ConnectionUnavailableError('credentialsChanged');
        }
        const client = await ClustersClient.acquireClient(
            binding.clusterId,
            undefined,
            undefined,
            options?.trigger ?? 'other',
            false,
            options?.background === true,
            binding.fingerprint,
        );
        if (isRetiredConnectionBinding(binding)) {
            throw new ConnectionUnavailableError('credentialsChanged');
        }
        return client;
    }

    public static retireBoundViews(clusterId: string): void {
        retireConnectionBindings(clusterId, ClustersClient._generations.get(clusterId) ?? 0);
    }

    /** Publish only after explicit sign-in and database startup succeed. The prior pin stays intact until then. */
    public static async startAfterSignIn(
        clusterId: string,
        epoch: number,
        credentials: CachedClusterCredentials,
        auth: AuthHandlerResponse,
    ): Promise<ClustersClient | undefined> {
        const reason = ClustersClient.getLatchReason(clusterId);
        if (
            epoch !== ClustersClient.getEpoch(clusterId) ||
            CredentialCache.getCredentials(clusterId) !== credentials ||
            credentials.authMechanism !== AuthMethodId.MicrosoftEntraID ||
            (reason && reason !== 'credentialsRejected')
        ) {
            return undefined;
        }
        if (reason && !ClustersClient.clearCredentialRejection(clusterId, epoch)) {
            return undefined;
        }
        void ClustersClient.deleteClient(clusterId).catch(() => {
            ext.outputChannel.debug('[ClustersClient] failed to close a client during sign-in recovery');
        });
        const startupEpoch = ClustersClient.getEpoch(clusterId);
        try {
            const { promise } = ClustersClient.getOrStartClient(
                clusterId,
                startupEpoch,
                'treeConnect',
                false,
                false,
                undefined,
                auth,
            );
            const client = await promise;
            return startupEpoch === ClustersClient.getEpoch(clusterId) ? client : undefined;
        } catch (error) {
            if (startupEpoch !== ClustersClient.getEpoch(clusterId)) {
                return undefined;
            }
            if (
                reason === 'credentialsRejected' ||
                classifyConnectionFailure(error, AuthMethodId.MicrosoftEntraID).kind === 'credentialsRejected'
            ) {
                ClustersClient.latch(clusterId, 'credentialsRejected');
            }
            throw error;
        }
    }

    private static async acquireClient(
        clusterId: string,
        abortSignal: AbortSignal | undefined,
        onStartup: ((id: string) => void) | undefined,
        trigger: ClientStartupTrigger,
        allowInteractive: boolean,
        background: boolean,
        boundFingerprint?: string,
    ): Promise<ClustersClient> {
        for (let attempt = 0; ; attempt++) {
            const reason = ClustersClient.getLatchReason(clusterId);
            if (reason) {
                throw new ConnectionUnavailableError(reason);
            }
            if (abortSignal?.aborted) {
                throw new UserCancelledError('abortConnection');
            }
            if (attempt === 2) {
                throw new Error(l10n.t('The connection changed while it was opening. Try again.'));
            }

            const epoch = ClustersClient.getEpoch(clusterId);
            const cached = ClustersClient._clients.get(clusterId);
            if (cached && boundFingerprint !== undefined && cached.fingerprint !== boundFingerprint) {
                throw new ConnectionUnavailableError('identityChanged');
            }
            if (cached?._replacement === 'replaceOnRecovery') {
                throw new ConnectionUnavailableError('signInRequired');
            }
            if (cached?.canReuse()) {
                const id = cached.connectionCorrelationId;
                if (id) {
                    onStartup?.(id);
                }
                if (epoch !== ClustersClient.getEpoch(clusterId)) {
                    continue;
                }
                if (abortSignal?.aborted) {
                    ext.outputChannel.debug(`[ClustersClient] startup=${id} wait canceled by user surface=extension`);
                    throw new UserCancelledError('abortConnection');
                }
                if (cached.canReuse()) {
                    return cached;
                }
            }

            // Until a replacement succeeds, the old entry still pins the connection identity.
            const { id, promise } = ClustersClient.getOrStartClient(
                clusterId,
                epoch,
                trigger,
                allowInteractive,
                background,
                boundFingerprint ?? cached?.fingerprint,
            );
            onStartup?.(id);
            try {
                const client = await waitForClient(promise, abortSignal, id);
                if (epoch === ClustersClient.getEpoch(clusterId) && client.canReuse()) {
                    if (boundFingerprint !== undefined && client.fingerprint !== boundFingerprint) {
                        throw new ConnectionUnavailableError('identityChanged');
                    }
                    return client;
                }
            } catch (error) {
                if (epoch === ClustersClient.getEpoch(clusterId)) {
                    throw error;
                }
            }
            // Both a stale success and a stale failure use the same retry, after checking the latch.
        }
    }

    private static getOrStartClient(
        clusterId: string,
        epoch: number,
        trigger: ClientStartupTrigger,
        allowInteractive: boolean,
        background: boolean,
        expectedFingerprint?: string,
        recoveredAuth?: AuthHandlerResponse,
    ): PendingStartup {
        const existing = ClustersClient._pendingStartups.get(clusterId);
        if (existing?.epoch === epoch) {
            return existing;
        }

        const credentials = CredentialCache.getCredentials(clusterId);
        if (background) {
            if (!credentials) {
                throw new ConnectionUnavailableError('credentialsMissing');
            }
            // This caller didn't run anything on a client. Don't treat this as a driver close.
            throw new ConnectionUnavailableError('unreachable');
        }
        if (
            !allowInteractive &&
            credentials?.authMechanism === AuthMethodId.MicrosoftEntraID &&
            !ClustersClient.getEntraPin(clusterId)
        ) {
            throw new EntraSignInRequiredError('noSession');
        }

        const id = randomUUID();
        // Register before initialization or a caller's onStartup callback can re-enter getClient.
        const promise = Promise.resolve().then(() =>
            ClustersClient.establishClient(
                clusterId,
                epoch,
                id,
                trigger,
                allowInteractive,
                expectedFingerprint,
                recoveredAuth,
            ),
        );
        const pending = { id, epoch, promise };
        ClustersClient._pendingStartups.set(clusterId, pending);
        const clear = (): void => {
            if (ClustersClient._pendingStartups.get(clusterId) === pending) {
                ClustersClient._pendingStartups.delete(clusterId);
            }
        };
        void promise.then(clear, clear);
        return pending;
    }

    private static async establishClient(
        clusterId: string,
        epoch: number,
        id: string,
        trigger: ClientStartupTrigger,
        allowInteractive: boolean,
        expectedFingerprint?: string,
        recoveredAuth?: AuthHandlerResponse,
    ): Promise<ClustersClient> {
        const client = new ClustersClient(clusterId);
        try {
            await client.initClient(id, trigger, epoch, allowInteractive, expectedFingerprint, recoveredAuth);
            if (client._closed) {
                throw new MongoNotConnectedError(l10n.t('The connection is unavailable.'));
            }
        } catch (error) {
            if (!(error instanceof UserCancelledError) && epoch === ClustersClient.getEpoch(clusterId)) {
                ClustersClient._lastFailedStartups.set(clusterId, id);
                const previous = ClustersClient._clients.get(clusterId);
                if (
                    previous?.authMethod === AuthMethodId.MicrosoftEntraID &&
                    previous.fingerprint === expectedFingerprint
                ) {
                    const failure = classifyConnectionFailure(error, previous.authMethod);
                    if (failure.kind === 'credentialsRejected' && failure.generation === 'evict') {
                        ClustersClient.reportFailure(previous.binding, error);
                    }
                }
            }
            client._closed = true;
            void client._mongoClient?.close().catch(() => {
                // Ignore close errors during cleanup
            });
            throw error;
        }

        if (epoch !== ClustersClient.getEpoch(clusterId)) {
            client._closed = true;
            void client._mongoClient.close().catch(() => {
                ext.outputChannel.debug(
                    `[ClustersClient] startup=${id} superseded client cleanup failed surface=extension`,
                );
            });
        } else {
            const previous = ClustersClient._clients.get(clusterId);
            const generation = (ClustersClient._generations.get(clusterId) ?? 0) + 1;
            client._binding = Object.freeze({ clusterId, fingerprint: client._fingerprint, generation });
            client._createdAt = Date.now();
            ClustersClient._generations.set(clusterId, generation);
            ClustersClient._lastVerifiedIdentities.set(clusterId, Object.freeze({ ...client.#verifiedIdentity }));
            ClustersClient._clients.set(clusterId, client);
            ClustersClient._lastFailedStartups.delete(clusterId);
            if (previous && !previous._closed) {
                previous._closed = true;
                void previous._mongoClient.close(true).catch(() => {
                    // Closing a retired driver must not affect its replacement.
                });
            }
        }
        return client;
    }

    private canReuse(): boolean {
        return !this._closed && this._replacement === undefined;
    }

    public static hasReusableClient(clusterId: string): boolean {
        return ClustersClient._clients.get(clusterId)?.canReuse() ?? false;
    }

    /** Reports an operation's failure against the generation that actually ran it. */
    public static reportFailure(binding: ConnectionBinding, error: unknown): ConnectionFailure['kind'] | undefined {
        const { clusterId, fingerprint, generation } = binding;
        const client = ClustersClient._clients.get(clusterId);
        if (
            !client ||
            client.generation !== generation ||
            client.fingerprint !== fingerprint ||
            ClustersClient.getLatchReason(clusterId)
        ) {
            return undefined;
        }

        const failure = classifyConnectionFailure(error, client.authMethod);
        if (client._replacement === 'replaceOnRecovery') {
            return failure.kind;
        }
        switch (failure.generation) {
            case 'replaceOnNextForeground':
                client._replacement = failure.generation;
                break;
            case 'replaceOnRecovery':
                client._replacement = failure.generation;
                // An already-started replacement must not bypass explicit recovery.
                ClustersClient.invalidate(clusterId);
                break;
            case 'evict':
                if (failure.kind === 'credentialsRejected') {
                    ClustersClient.latch(clusterId, 'credentialsRejected');
                }
                void ClustersClient.deleteClient(clusterId).catch(() => {
                    ext.outputChannel.debug('[ClustersClient] failed to close an evicted client');
                });
                break;
        }
        return failure.kind;
    }

    /**
     * Retrieves cluster metadata for this client instance.
     *
     * @returns A promise that resolves to cluster metadata.
     */
    public async getClusterMetadata(): Promise<ClusterMetadata> {
        if (this._clusterMetadataPromise) {
            return this._clusterMetadataPromise;
        }

        // This should not happen as the promise is initialized in initClient,
        // but if it does, we throw an error rather than trying to recover
        throw new Error(l10n.t('Cluster metadata not initialized. Client may not be properly connected.'));
    }

    /**
     * Determines whether a client for the given cluster ID is present in the internal cache.
     */
    public static exists(clusterId: string): boolean {
        return ClustersClient._clients.has(clusterId);
    }

    /**
     * Returns an existing client synchronously if it is already in the client cache.
     * Returns `undefined` if the client is not yet connected. This is useful for
     * accessing cached data (e.g., cached collection/database listings) without
     * triggering a connection or blocking on async operations.
     */
    public static getExistingClient(clusterId: string): ClustersClient | undefined {
        return ClustersClient._clients.get(clusterId);
    }

    public static getBinding(clusterId: string): ConnectionBinding | undefined {
        return ClustersClient.getExistingClient(clusterId)?.binding;
    }

    public static getSrvResolution(clusterId: string): SrvResolutionSummary | undefined {
        return ClustersClient._clients.get(clusterId)?._srvResolution;
    }

    public static async deleteClient(
        clusterId: string,
        options?: { readonly alreadyInvalidated: boolean },
    ): Promise<void> {
        if (!options?.alreadyInvalidated) {
            ClustersClient.invalidate(clusterId);
        }
        const client = ClustersClient._clients.get(clusterId);
        if (client) {
            ClustersClient._clients.delete(clusterId);
            client._closed = true;
        }
        if (client || options?.alreadyInvalidated) {
            SchemaStore.getInstance().clearCluster(clusterId);
        }
        if (client) {
            await client._mongoClient.close(true);
        }
    }

    startTransaction(): ClientSession {
        try {
            const session = this._mongoClient.startSession();
            session.startTransaction();
            return session;
        } catch (error) {
            throw new Error(l10n.t('Failed to start a transaction: {0}', parseError(error).message));
        }
    }

    startTransactionWithSession(session: ClientSession): void {
        try {
            session.startTransaction();
        } catch (error) {
            throw new Error(
                l10n.t('Failed to start a transaction with the provided session: {0}', parseError(error).message),
            );
        }
    }

    async commitTransaction(session: ClientSession): Promise<void> {
        try {
            await session.commitTransaction();
        } catch (error) {
            throw new Error(l10n.t('Failed to commit transaction: {0}', parseError(error).message));
        } finally {
            this.endSession(session);
        }
    }

    async abortTransaction(session: ClientSession): Promise<void> {
        try {
            await session.abortTransaction();
        } catch (error) {
            throw new Error(l10n.t('Failed to abort transaction: {0}', parseError(error).message));
        } finally {
            this.endSession(session);
        }
    }

    startSession(): ClientSession {
        try {
            return this._mongoClient.startSession();
        } catch (error) {
            throw new Error(l10n.t('Failed to start a session: {0}', parseError(error).message));
        }
    }

    endSession(session: ClientSession): void {
        session.endSession().catch((error) => {
            throw new Error(l10n.t('Failed to end session: {0}', parseError(error).message));
        });
    }

    getUserName() {
        return CredentialCache.getConnectionUser(this.clusterId);
    }

    /**
     * @deprecated Use getCredentials() which returns a CachedClusterCredentials object instead.
     */
    getConnectionString(): string | undefined {
        return this.getCredentials()?.connectionString;
    }

    /**
     * @deprecated Use getCredentials() which returns a CachedClusterCredentials object instead.
     */
    getConnectionStringWithPassword(): string | undefined {
        return CredentialCache.getConnectionStringWithPassword(this.clusterId);
    }

    public getCredentials(): CachedClusterCredentials | undefined {
        return CredentialCache.getCredentials(this.clusterId) as CachedClusterCredentials | undefined;
    }

    /**
     * Gets the Query Insights APIs instance for explain operations
     * @returns QueryInsightsApis instance or throws if not initialized
     */
    public get queryInsightsApis(): QueryInsightsApis {
        if (!this._queryInsightsApis) {
            throw new Error(l10n.t('Query Insights APIs not initialized. Client may not be properly connected.'));
        }
        return this._queryInsightsApis;
    }

    getCollection(databaseName: string, collectionName: string): Collection<Document> {
        try {
            return this._mongoClient.db(databaseName).collection(collectionName);
        } catch (error) {
            throw new Error(
                l10n.t(
                    'Failed to get collection {0} in database {1}: {2}',
                    collectionName,
                    databaseName,
                    parseError(error).message,
                ),
            );
        }
    }

    async listDatabases(useCached?: boolean): Promise<DatabaseItemModel[]> {
        if (useCached && this._databasesCache) {
            return this._databasesCache;
        }

        // Note: we intentionally do NOT pass `{ nameOnly: true }` here. The empty-`admin`
        // filter below relies on the `empty` field, which `nameOnly` omits (along with
        // `sizeOnDisk`). Keeping the full listing ensures an empty `admin` database stays
        // hidden while a non-empty `admin` (user-managed roles/collections) remains visible.
        let rawDatabases: ListDatabasesResult;
        try {
            rawDatabases = await this._mongoClient.db().admin().listDatabases();
        } catch (error) {
            if (this._interactiveEntraStartupId) {
                let kind = 'other';
                if (error instanceof MongoServerError) {
                    kind = 'MongoServerError';
                } else if (error instanceof MongoNetworkError) {
                    kind = 'MongoNetworkError';
                }
                const code = error instanceof MongoError && typeof error.code === 'number' ? ` code=${error.code}` : '';
                ext.outputChannel?.debug(
                    `[ClustersClient] startup=${this._interactiveEntraStartupId} listDatabases.failed kind=${kind}${code}`,
                );
            }
            throw error;
        }
        const databases: DatabaseItemModel[] = rawDatabases.databases.filter(
            // Filter out the 'admin' database if it's empty
            (databaseInfo) => !(databaseInfo.name && databaseInfo.name.toLowerCase() === 'admin' && databaseInfo.empty),
        );

        /**
         * this code in the comment is from older mongo implementation in the extension, review and test whether it's still relevant for us:
         * const databaseInConnectionString = getDatabaseNameFromConnectionString(this.connectionString);
                             if (databaseInConnectionString && !this.root.isEmulator) {
                                 // emulator violates the connection string format
                                 // If the database is in the connection string, that's all we connect to (we might not even have permissions to list databases)
                                 databases = [
                                     {
                                         name: databaseInConnectionString,
                                         empty: false,
                                     },
                                 ];
                             } else {
                                 // https://mongodb.github.io/node-mongodb-native/3.1/api/index.html
                                 // eslint-disable-next-line
                                 const result: { databases: IDatabaseInfo[] } = await mongoClient
                                     .db(testDb)
                                     .admin()
                                     .listDatabases();
                                 databases = result.databases;
                             }
         */

        this._databasesCache = databases;

        return databases;
    }

    async listCollections(databaseName: string, useCached?: boolean): Promise<CollectionItemModel[]> {
        if (useCached) {
            const cached = this._collectionsCache.get(databaseName);
            if (cached) {
                return cached;
            }
        }

        const rawCollections = await this._mongoClient.db(databaseName).listCollections().toArray();
        const collections: CollectionItemModel[] = rawCollections.map((c) => ({
            name: c.name,
            type: c.type,
            shardKey:
                'options' in c
                    ? (c.options as { shardKey?: Record<string, number | string> } | undefined)?.shardKey
                    : undefined,
        }));

        this._collectionsCache.set(databaseName, collections);

        return collections;
    }

    /**
     * Counts collections in a database using a cursor with `nameOnly: true`.
     * Fetches at most `limit + 1` items and closes the cursor early.
     *
     * @returns An object with `count` (capped at `limit`) and `hasMore`
     *          (`true` when the database has more than `limit` collections).
     */
    async countCollections(databaseName: string, limit: number): Promise<{ count: number; hasMore: boolean }> {
        const cursor = this._mongoClient
            .db(databaseName)
            .listCollections({}, { nameOnly: true })
            .batchSize(limit + 1);

        try {
            let count = 0;
            while (count <= limit && (await cursor.hasNext())) {
                await cursor.next();
                count++;
            }

            if (count > limit) {
                return { count: limit, hasMore: true };
            }
            return { count, hasMore: false };
        } finally {
            await cursor.close();
        }
    }

    /**
     * Returns cached collection names for the given database, if available.
     * Does NOT trigger a network request. Returns `undefined` if no cache exists.
     */
    getCachedCollections(databaseName: string): CollectionItemModel[] | undefined {
        return this._collectionsCache.get(databaseName);
    }

    /**
     * Returns cached database list, if available.
     * Does NOT trigger a network request. Returns `undefined` if no cache exists.
     */
    getCachedDatabases(): DatabaseItemModel[] | undefined {
        return this._databasesCache ?? undefined;
    }

    async listIndexes(databaseName: string, collectionName: string, signal?: AbortSignal): Promise<IndexItemModel[]> {
        signal?.throwIfAborted();
        const collection = this._mongoClient.db(databaseName).collection(collectionName);
        const indexes = await collection.indexes();
        signal?.throwIfAborted();

        let i = 0;
        return indexes.map((index) => {
            const { v, ...indexWithoutV } = index;
            return {
                ...indexWithoutV,
                name: index.name ?? 'idx_' + (i++).toString(),
                version: v,
                type: 'traditional' as const,
            };
        });
    }

    async listSearchIndexesForAtlas(
        databaseName: string,
        collectionName: string,
        signal?: AbortSignal,
    ): Promise<IndexItemModel[]> {
        try {
            const collection = this._mongoClient.db(databaseName).collection(collectionName);
            const searchIndexes = await collection.aggregate([{ $listSearchIndexes: {} }], { signal }).toArray();
            let i = 0; // backup for indexes with no names
            return searchIndexes.map((index: Document) => ({
                ...index,
                name: (index.name as string | undefined) ?? 'search_idx_' + (i++).toString(),
                type: index.type === 'vectorSearch' ? 'vectorSearch' : 'search',
                fields: index.fields as unknown[] | undefined,
            }));
        } catch {
            if (signal?.aborted) {
                throw signal.reason instanceof Error ? signal.reason : new Error('Operation aborted');
            }
            meterSilentCatch('ClustersClient_listSearchIndexes');
            // $listSearchIndexes not supported on this platform (e.g., non-Atlas deployments)
            // Return empty array silently
            return [];
        }
    }

    /**
     * Executes a MongoDB find query with support for filter, projection, sort, skip, and limit.
     *
     * @param databaseName - The name of the database
     * @param collectionName - The name of the collection
     * @param queryParams - Find query parameters (filter, project, sort, skip, limit)
     * @returns Array of matching documents
     */
    async runFindQuery(
        databaseName: string,
        collectionName: string,
        queryParams: FindQueryParams,
    ): Promise<WithId<Document>[]> {
        // Parse filter query
        const filterStr = queryParams.filter?.trim() || '{}';
        const filterObj: Filter<Document> = toFilterQueryObj(filterStr);

        // Build find options
        const options: FindOptions = {
            skip: queryParams.skip ?? 0,
            limit: queryParams.limit ?? 0,
        };

        // Parse and add projection if provided
        if (queryParams.project && queryParams.project.trim() !== '{}') {
            try {
                const parsed: unknown = parseShellBSON(queryParams.project, {
                    mode: ParseMode.Loose,
                });
                options.projection = assertDocumentObject(parsed, 'INVALID_PROJECTION');
            } catch (error) {
                if (error instanceof QueryError) throw error;
                const cause = error instanceof Error ? error : new Error(String(error));
                throw new QueryError(
                    'INVALID_PROJECTION',
                    l10n.t(
                        'Invalid projection syntax: {0}. Please use valid JSON or a DocumentDB API expression, for example: { fieldName: 1 }',
                        cause.message,
                    ),
                    cause,
                );
            }
        }

        // Parse and add sort if provided
        if (queryParams.sort && queryParams.sort.trim() !== '{}') {
            try {
                const parsed: unknown = parseShellBSON(queryParams.sort, {
                    mode: ParseMode.Loose,
                });
                options.sort = assertDocumentObject(parsed, 'INVALID_SORT');
            } catch (error) {
                if (error instanceof QueryError) throw error;
                const cause = error instanceof Error ? error : new Error(String(error));
                throw new QueryError(
                    'INVALID_SORT',
                    l10n.t(
                        'Invalid sort syntax: {0}. Please use valid JSON or a DocumentDB API expression, for example: { fieldName: 1 }',
                        cause.message,
                    ),
                    cause,
                );
            }
        }

        const collection = this._mongoClient.db(databaseName).collection(collectionName);
        const documents = await collection.find(filterObj, options).toArray();

        return documents;
    }

    /**
     * @deprecated Use runFindQuery() instead which supports filter, projection, sort, skip, and limit parameters.
     * This method will be removed in a future version.
     */
    //todo: this is just a to see how it could work, we need to use a cursor here for paging
    async runQuery(
        databaseName: string,
        collectionName: string,
        findQuery: string,
        skip: number,
        limit: number,
    ): Promise<WithId<Document>[]> {
        if (findQuery === undefined || findQuery.trim().length === 0) {
            findQuery = '{}';
        }

        const findQueryObj: Filter<Document> = toFilterQueryObj(findQuery);

        const options: FindOptions = {
            skip: skip,
            limit: limit,
        };

        const collection = this._mongoClient.db(databaseName).collection(collectionName);
        const documents = await collection.find(findQueryObj, options).toArray();

        //TODO: add the FindCursor to the return type for paging

        return documents;
    }

    /**
     * Counts documents in a collection matching the given filter query.
     *
     * @param databaseName - The name of the database
     * @param collectionName - The name of the collection
     * @param findQuery - Optional filter query string (defaults to '{}')
     * @returns Number of documents matching the filter
     *
     * @throws {QueryError} with code 'INVALID_FILTER' if findQuery contains invalid JSON/BSON syntax.
     *         Callers should handle this error appropriately - currently this error will propagate
     *         up the call stack. TODO: Revisit error handling strategy when this function is used
     *         in more contexts (e.g., UI count displays may want graceful fallback).
     */
    async countDocuments(databaseName: string, collectionName: string, findQuery: string = '{}'): Promise<number> {
        if (findQuery === undefined || findQuery.trim().length === 0) {
            findQuery = '{}';
        }
        // NOTE: toFilterQueryObj throws QueryError on invalid input - see JSDoc above
        const findQueryObj: Filter<Document> = toFilterQueryObj(findQuery);
        const collection = this._mongoClient.db(databaseName).collection(collectionName);

        const count = await collection.countDocuments(findQueryObj, {
            // Use a read preference of 'primary' to ensure we get the most up-to-date
            // count, especially important for sharded clusters.
            readPreference: 'primary',
        });
        return count;
    }

    async estimateDocumentCount(databaseName: string, collectionName: string): Promise<number> {
        const collection = this._mongoClient.db(databaseName).collection(collectionName);

        try {
            return await collection.estimatedDocumentCount();
        } catch (error) {
            // Fall back to countDocuments if estimatedDocumentCount is not supported
            // This can happen with certain MongoDB configurations or versions
            if (
                // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
                error.code === 115 /* CommandNotSupported */ ||
                // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
                error.code === 235 /* InternalErrorNotSupported */
            ) {
                return await this.countDocuments(databaseName, collectionName);
            }
            throw error;
        }
    }

    /**
     * Streams documents from a collection with full query support (filter, projection, sort, skip, limit).
     *
     * @param databaseName - The name of the database
     * @param collectionName - The name of the collection
     * @param abortSignal - Signal to abort the streaming operation
     * @param queryParams - Find query parameters (filter, project, sort, skip, limit)
     * @returns AsyncGenerator yielding documents one at a time
     */
    async *streamDocumentsWithQuery(
        databaseName: string,
        collectionName: string,
        abortSignal: AbortSignal,
        queryParams: FindQueryParams = {},
    ): AsyncGenerator<Document, void, unknown> {
        /**
         * Configuration
         */

        // Parse filter query
        const filterStr = queryParams.filter?.trim() || '{}';
        const filterObj: Filter<Document> = toFilterQueryObj(filterStr);

        // Build find options
        const options: FindOptions = {
            skip: queryParams.skip && queryParams.skip > 0 ? queryParams.skip : undefined,
            limit: queryParams.limit && queryParams.limit > 0 ? queryParams.limit : undefined,
        };

        // Parse and add projection if provided
        if (queryParams.project && queryParams.project.trim() !== '{}') {
            try {
                const parsed: unknown = parseShellBSON(queryParams.project, {
                    mode: ParseMode.Loose,
                });
                options.projection = assertDocumentObject(parsed, 'INVALID_PROJECTION');
            } catch (error) {
                if (error instanceof QueryError) throw error;
                const cause = error instanceof Error ? error : new Error(String(error));
                throw new QueryError(
                    'INVALID_PROJECTION',
                    l10n.t(
                        'Invalid projection syntax: {0}. Please use valid JSON or a DocumentDB API expression, for example: { fieldName: 1 }',
                        cause.message,
                    ),
                    cause,
                );
            }
        }

        // Parse and add sort if provided
        if (queryParams.sort && queryParams.sort.trim() !== '{}') {
            try {
                const parsed: unknown = parseShellBSON(queryParams.sort, {
                    mode: ParseMode.Loose,
                });
                options.sort = assertDocumentObject(parsed, 'INVALID_SORT');
            } catch (error) {
                if (error instanceof QueryError) throw error;
                const cause = error instanceof Error ? error : new Error(String(error));
                throw new QueryError(
                    'INVALID_SORT',
                    l10n.t(
                        'Invalid sort syntax: {0}. Please use valid JSON or a DocumentDB API expression, for example: { fieldName: 1 }',
                        cause.message,
                    ),
                    cause,
                );
            }
        }

        const collection = this._mongoClient.db(databaseName).collection(collectionName);

        /**
         * Streaming
         */

        const cursor = collection.find(filterObj, options).batchSize(100);

        try {
            while (await cursor.hasNext()) {
                if (abortSignal.aborted) {
                    console.debug('streamDocumentsWithQuery: Aborted by an abort signal.');
                    return;
                }

                // Fetch the next document and yield it to the consumer
                const doc = await cursor.next();
                if (doc !== null) {
                    yield doc;
                }
            }
        } finally {
            // Ensure the cursor is properly closed when done
            await cursor.close();
        }
    }

    // TODO: revisit, maybe we can work on BSON here for the documentIds, and the conversion from string etc.,
    // will remain in the ClusterSession class
    async deleteDocuments(databaseName: string, collectionName: string, documentIds: string[]): Promise<boolean> {
        const parsedDocumentIds = documentIds.map((id) => parseDocumentId(id));

        // Connect and execute
        const collection = this._mongoClient.db(databaseName).collection(collectionName);
        const deleteResult: DeleteResult = await collection.deleteMany({
            _id: { $in: parsedDocumentIds },
        } as Filter<Document>);

        return deleteResult.acknowledged;
    }

    async pointRead(databaseName: string, collectionName: string, documentId: string) {
        const parsedDocumentId = parseDocumentId(documentId);

        // connect and execute
        const collection = this._mongoClient.db(databaseName).collection(collectionName);

        const documentContent = await collection.findOne({ _id: parsedDocumentId } as Filter<Document>);

        return documentContent;
    }

    // TODO: add a dedicated insert function. The original idea of keeping it in upsert was to avoid code duplication,
    // however it leads to issues with the upsert logic.
    async upsertDocument(
        databaseName: string,
        collectionName: string,
        documentId: string,
        document: Document,
    ): Promise<{ documentId: unknown; document: WithId<Document> | null }> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let parsedId: any;

        if (documentId === '') {
            // TODO: do not rely on empty string, use null or undefined
            parsedId = new ObjectId();
        } else {
            parsedId = parseDocumentId(documentId);
        }

        // connect and execute
        const collection = this._mongoClient.db(databaseName).collection(collectionName);

        delete document._id;

        const replaceResult = await collection.replaceOne(
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            { _id: parsedId },

            document as WithoutId<Document>,
            { upsert: true },
        );

        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any
        const newDocumentId = (replaceResult.upsertedId as any) ?? parsedId;

        // eslint-disable-next-line
        const newDocument = await collection.findOne({ _id: newDocumentId });

        return { documentId: newDocumentId, document: newDocument };
    }

    async dropCollection(databaseName: string, collectionName: string): Promise<boolean> {
        const result = await this._mongoClient.db(databaseName).collection(collectionName).drop();
        this._collectionsCache.delete(databaseName);
        return result;
    }

    async dropDatabase(databaseName: string): Promise<boolean> {
        const result = await this._mongoClient.db(databaseName).dropDatabase();
        this._databasesCache = null;
        this._collectionsCache.delete(databaseName);
        return result;
    }

    async createCollection(databaseName: string, collectionName: string): Promise<Collection<Document>> {
        const result = await this._mongoClient.db(databaseName).createCollection(collectionName);
        this._collectionsCache.delete(databaseName);
        return result;
    }

    async createDatabase(databaseName: string, collectionName?: string): Promise<void> {
        // TODO: add logging of failures to the telemetry somewhere in the call chain
        // In MongoDB, databases are created implicitly when their first collection is created.
        if (collectionName) {
            await this._mongoClient.db(databaseName).createCollection(collectionName);
        } else {
            const newCollection = await this._mongoClient
                .db(databaseName)
                .createCollection('_dummy_collection_creation_forces_db_creation');
            await newCollection.drop({ writeConcern: { w: 'majority', wtimeoutMS: 5000 } });
        }
        this._databasesCache = null;
    }

    async insertDocuments(
        databaseName: string,
        collectionName: string,
        documents: Document[],
        ordered: boolean = true,
    ): Promise<InsertManyResult> {
        if (documents.length === 0) {
            return { acknowledged: false, insertedIds: {}, insertedCount: 0 };
        }
        const collection = this._mongoClient.db(databaseName).collection(collectionName);

        try {
            const insertManyResults = await collection.insertMany(documents, {
                forceServerObjectId: true,

                // Setting `ordered` to be false allows MongoDB to continue inserting remaining documents even if previous fails.
                // More details: https://www.mongodb.com/docs/manual/reference/method/db.collection.insertMany/#syntax
                ordered: ordered,
            });
            return insertManyResults;
        } catch (error) {
            // Log error messages to the console
            if (error instanceof MongoBulkWriteError) {
                throw error;
            } else if (error instanceof Error) {
                throw error;
            }

            throw new Error(l10n.t('An unknown error occurred while inserting documents.'));
        }
    }

    // ==========================================
    // LLM Enhanced Feature APIs
    // ==========================================

    /**
     * Get detailed index statistics for a collection
     * @param databaseName - Name of the database
     * @param collectionName - Name of the collection
     * @returns Array of index statistics including usage information
     */
    async getIndexStats(databaseName: string, collectionName: string): Promise<IndexStats[]> {
        if (!this._llmEnhancedFeatureApis) {
            throw new Error('LLM Enhanced Feature APIs not initialized. Ensure the client is connected.');
        }
        return this._llmEnhancedFeatureApis.getIndexStats(databaseName, collectionName);
    }

    /**
     * Get detailed collection statistics
     * @param databaseName - Name of the database
     * @param collectionName - Name of the collection
     * @returns Collection statistics including size, count, and index information
     */
    async getCollectionStats(databaseName: string, collectionName: string): Promise<CollectionStats> {
        if (!this._llmEnhancedFeatureApis) {
            throw new Error('LLM Enhanced Feature APIs not initialized. Ensure the client is connected.');
        }
        return this._llmEnhancedFeatureApis.getCollectionStats(databaseName, collectionName);
    }

    /**
     * Explain a find query with full execution statistics
     * Supports sort, projection, skip, and limit options
     * @param databaseName - Name of the database
     * @param collectionName - Name of the collection
     * @param verbosity - Explain verbosity level ('queryPlanner', 'executionStats', 'allPlansExecution')
     * @param options - Query options including filter, sort, projection, skip, and limit
     * @returns Detailed explain result with execution statistics
     */
    async explainFind(
        databaseName: string,
        collectionName: string,
        verbosity: ExplainVerbosity,
        options: ExplainOptions = {},
    ): Promise<ExplainResult> {
        if (!this._llmEnhancedFeatureApis) {
            throw new Error('LLM Enhanced Feature APIs not initialized. Ensure the client is connected.');
        }
        const result = await this._llmEnhancedFeatureApis.explainFind(databaseName, collectionName, verbosity, options);
        const metadata = await this.getClusterMetadata();
        return (fixupDocumentDbExplain(result, metadata) as ExplainResult) ?? result;
    }

    /**
     * Explain an aggregation pipeline with full execution statistics
     * @param databaseName - Name of the database
     * @param collectionName - Name of the collection
     * @param pipeline - Aggregation pipeline stages
     * @returns Detailed explain result with execution statistics
     */
    async explainAggregate(databaseName: string, collectionName: string, pipeline: Document[]): Promise<ExplainResult> {
        if (!this._llmEnhancedFeatureApis) {
            throw new Error('LLM Enhanced Feature APIs not initialized. Ensure the client is connected.');
        }
        const result = await this._llmEnhancedFeatureApis.explainAggregate(databaseName, collectionName, pipeline);
        const metadata = await this.getClusterMetadata();
        return (fixupDocumentDbExplain(result, metadata) as ExplainResult) ?? result;
    }

    /**
     * Explain a count operation with full execution statistics
     * @param databaseName - Name of the database
     * @param collectionName - Name of the collection
     * @param filter - Query filter for the count operation
     * @returns Detailed explain result with execution statistics
     */
    async explainCount(databaseName: string, collectionName: string, filter: Filter<Document> = {}): Promise<Document> {
        if (!this._llmEnhancedFeatureApis) {
            throw new Error('LLM Enhanced Feature APIs not initialized. Ensure the client is connected.');
        }
        const result = await this._llmEnhancedFeatureApis.explainCount(databaseName, collectionName, filter);
        const metadata = await this.getClusterMetadata();
        return fixupDocumentDbExplain(result, metadata) ?? result;
    }

    /**
     * Create an index on a collection
     * Supports both simple and composite indexes with various options
     * @param databaseName - Name of the database
     * @param collectionName - Name of the collection
     * @param indexSpec - Index specification including key and options
     * @returns Result of the index creation operation
     */
    async createIndex(
        databaseName: string,
        collectionName: string,
        indexSpec: IndexSpecification,
    ): Promise<CreateIndexResult> {
        if (!this._llmEnhancedFeatureApis) {
            throw new Error('LLM Enhanced Feature APIs not initialized. Ensure the client is connected.');
        }
        return this._llmEnhancedFeatureApis.createIndex(databaseName, collectionName, indexSpec);
    }

    /**
     * Drop an index from a collection
     * @param databaseName - Name of the database
     * @param collectionName - Name of the collection
     * @param indexName - Name of the index to drop (use "*" to drop all non-_id indexes)
     * @returns Result of the index drop operation
     */
    async dropIndex(databaseName: string, collectionName: string, indexName: string): Promise<DropIndexResult> {
        if (!this._llmEnhancedFeatureApis) {
            throw new Error('LLM Enhanced Feature APIs not initialized. Ensure the client is connected.');
        }
        return this._llmEnhancedFeatureApis.dropIndex(databaseName, collectionName, indexName);
    }

    /**
     * Get sample documents from a collection using random sampling
     * @param databaseName - Name of the database
     * @param collectionName - Name of the collection
     * @param limit - Maximum number of documents to sample (default: 10)
     * @returns Array of sample documents
     */
    async getSampleDocuments(databaseName: string, collectionName: string, limit: number = 10): Promise<Document[]> {
        if (!this._llmEnhancedFeatureApis) {
            throw new Error('LLM Enhanced Feature APIs not initialized. Ensure the client is connected.');
        }
        return this._llmEnhancedFeatureApis.getSampleDocuments(databaseName, collectionName, limit);
    }

    /**
     * Hide an index in a collection
     * @param databaseName - Name of the database
     * @param collectionName - Name of the collection
     * @param indexName - Name of the index to hide
     * @returns Result of the hide index operation
     */
    async hideIndex(databaseName: string, collectionName: string, indexName: string): Promise<Document> {
        if (!this._llmEnhancedFeatureApis) {
            throw new Error('LLM Enhanced Feature APIs not initialized. Ensure the client is connected.');
        }
        return this._llmEnhancedFeatureApis.hideIndex(databaseName, collectionName, indexName);
    }

    /**
     * Unhide an index in a collection
     * @param databaseName - Name of the database
     * @param collectionName - Name of the collection
     * @param indexName - Name of the index to unhide
     * @returns Result of the unhide index operation
     */
    async unhideIndex(databaseName: string, collectionName: string, indexName: string): Promise<Document> {
        if (!this._llmEnhancedFeatureApis) {
            throw new Error('LLM Enhanced Feature APIs not initialized. Ensure the client is connected.');
        }
        return this._llmEnhancedFeatureApis.unhideIndex(databaseName, collectionName, indexName);
    }
}

export function addEstablishedConnectionContext(context: ITelemetryContext, cluster: string | ClustersClient): void {
    const client = typeof cluster === 'string' ? ClustersClient.getExistingClient(cluster) : cluster;
    if (!client || ClustersClient.getExistingClient(client.binding.clusterId) !== client) {
        return;
    }

    context.properties.authMethod = client.authMethod;
    context.properties.connectionCorrelationId = client.connectionCorrelationId;
    context.measurements.connectionAgeMs = Math.max(0, Date.now() - client.createdAt);
    context.measurements.clientGeneration = client.generation;
}
