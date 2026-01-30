/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * wrapper for mongodclient, with handling of supported operations, plus, as a workaround, access to the raw mongodbclient.
 * also, client-pool, that handles active connections, over time adds notificaitons on dropped conenctions etc.
 * singletone on a client with a getter from a connection pool..
 */

import { appendExtensionUserAgent, callWithTelemetryAndErrorHandling, parseError } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { EJSON } from 'bson';
import {
    MongoBulkWriteError,
    MongoClient,
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
    type WithId,
    type WithoutId,
} from 'mongodb';
import { Links } from '../constants';
import { type EmulatorConfiguration } from '../utils/emulatorConfiguration';
import { type AuthHandler } from './auth/AuthHandler';
import { AuthMethodId } from './auth/AuthMethod';
import { MicrosoftEntraIDAuthHandler } from './auth/MicrosoftEntraIDAuthHandler';
import { NativeAuthHandler } from './auth/NativeAuthHandler';
import { QueryInsightsApis, type ExplainVerbosity } from './client/QueryInsightsApis';
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
import { getHostsFromConnectionString, hasAzureDomain } from './utils/connectionStringHelpers';
import { getClusterMetadata, type ClusterMetadata } from './utils/getClusterMetadata';
import { toFilterQueryObj } from './utils/toFilterQuery';

export interface DatabaseItemModel {
    name: string;
    sizeOnDisk?: number;
    empty?: boolean;
}

export interface CollectionItemModel {
    name: string;
    type?: string;
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
    type: 'traditional' | 'search';
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
    status?: string;
    queryable?: boolean;
    fields?: unknown[];
    [key: string]: unknown; // Allow additional index properties
}

export function isBulkWriteError(error: unknown): error is MongoBulkWriteError {
    return error instanceof MongoBulkWriteError;
}

export class ClustersClient {
    /**
     * Cache of active MongoDB clients, keyed by clusterId.
     *
     * KEY: `clusterId` - The stable cluster identifier (NOT the tree item ID)
     *   - Connections View items: Use `cluster.clusterId` (= storageId, stable UUID)
     *   - Azure Resources View items: Use `cluster.clusterId` (= Azure Resource ID)
     *
     * VALUE: ClustersClient instance wrapping a MongoClient
     *
     * ⚠️ WARNING: Do NOT use `treeId` as the cache key!
     * Tree IDs change when items are moved between folders, causing cache misses
     * and orphaned connections.
     */
    static _clients: Map<string, ClustersClient> = new Map();

    private _mongoClient: MongoClient;
    private _llmEnhancedFeatureApis: llmEnhancedFeatureApis | null = null;
    private _queryInsightsApis: QueryInsightsApis | null = null;
    private _clusterMetadataPromise: Promise<ClusterMetadata> | null = null;

    /**
     * Private constructor - use getClient() instead.
     * Connections/Clients are being cached and reused.
     *
     * @param credentialId - The stable cluster ID used to look up credentials in CredentialCache.
     *   This is NOT the tree item ID - it's the clusterId that remains stable across folder moves.
     */
    private constructor(private readonly credentialId: string) {
        return;
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

    private async initClient(): Promise<void> {
        const credentials = CredentialCache.getCredentials(this.credentialId);
        if (!credentials) {
            throw new Error(l10n.t('No credentials found for id {credentialId}', { credentialId: this.credentialId }));
        }

        // default to NativeAuth if nothing is configured
        const authMethod = credentials?.authMechanism ?? AuthMethodId.NativeAuth;

        // TODO: add a proper factory pattern here when more methods are added
        let authHandler: AuthHandler;
        switch (authMethod) {
            case AuthMethodId.NativeAuth:
                authHandler = new NativeAuthHandler(credentials);
                break;
            case AuthMethodId.MicrosoftEntraID:
                authHandler = new MicrosoftEntraIDAuthHandler(credentials);
                break;
            default:
                throw new Error(l10n.t('Unsupported authentication method: {0}', authMethod));
        }

        // Configure auth and get connection options
        const { connectionString, options } = await authHandler.configureAuth();

        const hosts = getHostsFromConnectionString(connectionString);
        const userAgentString = hasAzureDomain(...hosts) ? appendExtensionUserAgent() : undefined;
        if (userAgentString) {
            options.appName = userAgentString;
        }

        // Connect with the configured options
        await this.connect(connectionString, options, credentials.emulatorConfiguration);

        // Start metadata collection and store the promise
        this._clusterMetadataPromise = getClusterMetadata(this._mongoClient, hosts);

        // Collect telemetry (non-blocking) - reuses the same promise
        void callWithTelemetryAndErrorHandling('connect.getmetadata', async (context) => {
            const metadata: ClusterMetadata = await this._clusterMetadataPromise!;
            context.telemetry.properties = {
                authmethod: authMethod,
                ...context.telemetry.properties,
                ...metadata,
            };
        });
    }

    private async connect(
        connectionString: string,
        options: MongoClientOptions,
        emulatorConfiguration?: EmulatorConfiguration,
    ): Promise<void> {
        try {
            this._mongoClient = await MongoClient.connect(connectionString, options);
            this._llmEnhancedFeatureApis = new llmEnhancedFeatureApis(this._mongoClient);
            this._queryInsightsApis = new QueryInsightsApis(this._mongoClient);
        } catch (error) {
            const message = parseError(error).message;
            if (emulatorConfiguration?.isEmulator && message.includes('ECONNREFUSED')) {
                // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
                error.message = l10n.t(
                    'Unable to connect to the local instance. Make sure it is started correctly. See {link} for tips.',
                    { link: Links.LocalConnectionDebuggingTips },
                );
            } else if (emulatorConfiguration?.isEmulator && message.includes('self-signed certificate')) {
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
     * Retrieves an instance of `ClustersClient` based on the provided `credentialId`.
     *
     * @param credentialId - A required string used to find the cached connection string to connect.
     * It is also used as a key to reuse existing clients.
     * @returns A promise that resolves to an instance of `ClustersClient`.
     */
    public static async getClient(credentialId: string): Promise<ClustersClient> {
        let client: ClustersClient;

        if (ClustersClient._clients.has(credentialId)) {
            client = ClustersClient._clients.get(credentialId) as ClustersClient;

            // if the client is already connected, it's a NOOP.
            await client._mongoClient.connect();
        } else {
            client = new ClustersClient(credentialId);
            // Cluster metadata is set in initClient
            await client.initClient();
            ClustersClient._clients.set(credentialId, client);
        }

        return client;
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
     * Determines whether a client for the given credential identifier is present in the internal cache.
     */
    public static exists(credentialId: string): boolean {
        return ClustersClient._clients.has(credentialId);
    }

    public static async deleteClient(credentialId: string): Promise<void> {
        if (ClustersClient._clients.has(credentialId)) {
            const client = ClustersClient._clients.get(credentialId) as ClustersClient;
            await client._mongoClient.close(true);
            ClustersClient._clients.delete(credentialId);
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
        return CredentialCache.getConnectionUser(this.credentialId);
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
        return CredentialCache.getConnectionStringWithPassword(this.credentialId);
    }

    public getCredentials(): CachedClusterCredentials | undefined {
        return CredentialCache.getCredentials(this.credentialId) as CachedClusterCredentials | undefined;
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

    async listDatabases(): Promise<DatabaseItemModel[]> {
        const rawDatabases: ListDatabasesResult = await this._mongoClient.db().admin().listDatabases();
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

        return databases;
    }

    async listCollections(databaseName: string): Promise<CollectionItemModel[]> {
        const rawCollections = await this._mongoClient.db(databaseName).listCollections().toArray();
        const collections: CollectionItemModel[] = rawCollections;

        return collections;
    }

    async listIndexes(databaseName: string, collectionName: string): Promise<IndexItemModel[]> {
        const collection = this._mongoClient.db(databaseName).collection(collectionName);
        const indexes = await collection.indexes();

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

    async listSearchIndexesForAtlas(databaseName: string, collectionName: string): Promise<IndexItemModel[]> {
        try {
            const collection = this._mongoClient.db(databaseName).collection(collectionName);
            const searchIndexes = await collection.aggregate([{ $listSearchIndexes: {} }]).toArray();
            let i = 0; // backup for indexes with no names
            return searchIndexes.map((index: Document) => ({
                ...index,
                name: (index.name as string | undefined) ?? 'search_idx_' + (i++).toString(),
                type: ((index.type as string | undefined) ?? 'search') as 'traditional' | 'search',
                fields: index.fields as unknown[] | undefined,
            }));
        } catch {
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
                options.projection = EJSON.parse(queryParams.project) as Document;
            } catch (error) {
                const cause = error instanceof Error ? error : new Error(String(error));
                throw new QueryError(
                    'INVALID_PROJECTION',
                    l10n.t(
                        'Invalid projection syntax: {0}. Please use valid JSON, for example: { "fieldName": 1 }',
                        cause.message,
                    ),
                    cause,
                );
            }
        }

        // Parse and add sort if provided
        if (queryParams.sort && queryParams.sort.trim() !== '{}') {
            try {
                options.sort = EJSON.parse(queryParams.sort) as Document;
            } catch (error) {
                const cause = error instanceof Error ? error : new Error(String(error));
                throw new QueryError(
                    'INVALID_SORT',
                    l10n.t(
                        'Invalid sort syntax: {0}. Please use valid JSON, for example: { "fieldName": 1 }',
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
                options.projection = EJSON.parse(queryParams.project) as Document;
            } catch (error) {
                const cause = error instanceof Error ? error : new Error(String(error));
                throw new QueryError(
                    'INVALID_PROJECTION',
                    l10n.t(
                        'Invalid projection syntax: {0}. Please use valid JSON, for example: { "fieldName": 1 }',
                        cause.message,
                    ),
                    cause,
                );
            }
        }

        // Parse and add sort if provided
        if (queryParams.sort && queryParams.sort.trim() !== '{}') {
            try {
                options.sort = EJSON.parse(queryParams.sort) as Document;
            } catch (error) {
                const cause = error instanceof Error ? error : new Error(String(error));
                throw new QueryError(
                    'INVALID_SORT',
                    l10n.t(
                        'Invalid sort syntax: {0}. Please use valid JSON, for example: { "fieldName": 1 }',
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
        // Convert input data to BSON types
        const parsedDocumentIds = documentIds.map((id) => {
            let parsedId;
            try {
                // eslint-disable-next-line
                parsedId = EJSON.parse(id);
            } catch {
                if (ObjectId.isValid(id)) {
                    parsedId = new ObjectId(id);
                } else {
                    throw new Error(l10n.t('Invalid document ID: {0}', id));
                }
            }
            // eslint-disable-next-line @typescript-eslint/no-unsafe-return
            return parsedId;
        });

        // Connect and execute
        const collection = this._mongoClient.db(databaseName).collection(collectionName);
        const deleteResult: DeleteResult = await collection.deleteMany({ _id: { $in: parsedDocumentIds } });

        return deleteResult.acknowledged;
    }

    async pointRead(databaseName: string, collectionName: string, documentId: string) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let parsedDocumentId: any;
        try {
            // eslint-disable-next-line
            parsedDocumentId = EJSON.parse(documentId);
        } catch (error) {
            if (ObjectId.isValid(documentId)) {
                parsedDocumentId = new ObjectId(documentId);
            } else {
                throw error;
            }
        }

        // connect and execute
        const collection = this._mongoClient.db(databaseName).collection(collectionName);

        // eslint-disable-next-line
        const documentContent = await collection.findOne({ _id: parsedDocumentId });

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
            // TODO: do not rely in empty string, use null or undefined
            parsedId = new ObjectId();
        } else {
            try {
                // eslint-disable-next-line
                parsedId = EJSON.parse(documentId);
            } catch {
                if (ObjectId.isValid(documentId)) {
                    parsedId = new ObjectId(documentId);
                }
            }
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
        return this._mongoClient.db(databaseName).collection(collectionName).drop();
    }

    async dropDatabase(databaseName: string): Promise<boolean> {
        return this._mongoClient.db(databaseName).dropDatabase();
    }

    async createCollection(databaseName: string, collectionName: string): Promise<Collection<Document>> {
        return this._mongoClient.db(databaseName).createCollection(collectionName);
    }

    async createDatabase(databaseName: string): Promise<void> {
        // TODO: add logging of failures to the telemetry somewhere in the call chain
        const newCollection = await this._mongoClient
            .db(databaseName)
            .createCollection('_dummy_collection_creation_forces_db_creation');
        await newCollection.drop({ writeConcern: { w: 'majority', wtimeoutMS: 5000 } });
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
        return this._llmEnhancedFeatureApis.explainFind(databaseName, collectionName, verbosity, options);
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
        return this._llmEnhancedFeatureApis.explainAggregate(databaseName, collectionName, pipeline);
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
        return this._llmEnhancedFeatureApis.explainCount(databaseName, collectionName, filter);
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
