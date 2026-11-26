/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type FieldEntry } from '@documentdb-js/schema-analyzer';
import { UserCancelledError } from '@microsoft/vscode-azext-utils';
import { ParseMode, parse as parseShellBSON } from '@mongodb-js/shell-bson-parser';
import * as l10n from '@vscode/l10n';
import { EJSON } from 'bson';
import { type Document, type Filter, type WithId } from 'mongodb';
import { ext } from '../extensionVariables';
import { getDataAtPath } from '../utils/slickgrid/mongo/toSlickGridTable';
import { toSlickGridTree, type TreeData } from '../utils/slickgrid/mongo/toSlickGridTree';
import { type QueryInsightsStage2Response } from '../webviews/documentdb/collectionView/types/queryInsights';
import { ClustersClient, type ConnectionBinding, type FindQueryParams } from './ClustersClient';
import { isRetiredConnectionBinding } from './connectionBindingRetirement';
import { classifyConnectionFailure } from './connectionFailures';
import { ConnectionUnavailableError } from './ConnectionUnavailableError';
import { runWithClient } from './runWithClient';
import { SchemaStore } from './SchemaStore';
import { fixupDocumentDbExplain } from './utils/fixupDocumentDbExplain';
import { parseDocumentId } from './utils/parseDocumentId';
import { toFilterQueryObj } from './utils/toFilterQuery';

export type TableDataEntry = {
    /**
     * The unique identifier for the entry. It is used to identify the document in the table.
     *
     * @remarks
     * The format of this identifier is a copy of the original '_id' value that is converted to EJSON and then stringified.
     * This conversion is necessary to facilitate the movement of data between the extension and the webview,
     * as webviews do not have access to the BSON library and require the identifier to be in string format.
     *
     * @type {string}
     * @optional
     */
    'x-objectid'?: string;
    [key: string]: unknown;
};

export interface TableData {
    path: string[];
    headers: string[];
    data: TableDataEntry[];
}

/**
 * Parsed query parameters with BSON objects
 * This extends FindQueryParams by providing parsed Document objects
 * in addition to the string representations
 */
export interface ParsedFindQueryParams extends FindQueryParams {
    /**
     * Parsed filter object with BSON types (UUID, Date, etc.) properly converted
     */
    filterObj: Filter<Document>;

    /**
     * Parsed projection object, or undefined if no projection
     */
    projectionObj?: Document;

    /**
     * Parsed sort object, or undefined if no sort
     */
    sortObj?: Document;
}

export class ClusterSession {
    // cache of active/existing sessions
    static _sessions: Map<string, ClusterSession> = new Map();

    /**
     * Private constructor to enforce the use of `initNewSession` for creating new sessions.
     * This ensures that sessions are properly initialized and managed.
     */
    private constructor(private readonly binding: ConnectionBinding) {}

    public getBinding(): ConnectionBinding {
        return this.binding;
    }

    public async getClient(): Promise<ClustersClient> {
        return ClustersClient.resolveBoundClient(this.binding, { trigger: 'collectionView' });
    }

    public getEpoch(): number {
        return ClustersClient.getEpoch(this.binding.clusterId);
    }

    private isCurrent(epoch: number): boolean {
        const { clusterId, fingerprint } = this.binding;
        return (
            epoch === ClustersClient.getEpoch(clusterId) &&
            !isRetiredConnectionBinding(this.binding) &&
            ClustersClient.getLatchReason(clusterId) === undefined &&
            ClustersClient.getBinding(clusterId)?.fingerprint === fingerprint
        );
    }

    public assertCurrent(epoch: number, signal?: AbortSignal): void {
        if (signal?.aborted || !this.isCurrent(epoch)) {
            throw new UserCancelledError('staleCollectionViewOperation');
        }
    }

    public assertAvailable(signal?: AbortSignal): void {
        if (signal?.aborted) {
            throw new UserCancelledError('staleCollectionViewOperation');
        }
        const reason = isRetiredConnectionBinding(this.binding)
            ? 'credentialsChanged'
            : ClustersClient.getLatchReason(this.binding.clusterId);
        if (reason) {
            throw new ConnectionUnavailableError(reason);
        }
        const current = ClustersClient.getBinding(this.binding.clusterId);
        if (current?.fingerprint !== this.binding.fingerprint) {
            throw new ConnectionUnavailableError(current ? 'identityChanged' : 'unreachable');
        }
    }

    // Keep the existing procedure return types until the routers map unavailable results.
    public async runWithClient<T>(
        operation: (client: ClustersClient, epoch: number) => Promise<T>,
        epoch = this.getEpoch(),
    ): Promise<T> {
        const result = await runWithClient(
            this.binding,
            async (client) => {
                this.assertCurrent(epoch);
                return { value: await operation(client, epoch) };
            },
            { trigger: 'collectionView' },
        );
        if ('unavailable' in result) {
            throw new ConnectionUnavailableError(result.unavailable.reason);
        }
        return result.value;
    }

    /**
     * Database name for the current collection view.
     * Set on the first runFindQueryWithCache call.
     */
    private _databaseName: string | undefined;

    /**
     * Collection name for the current collection view.
     * Set on the first runFindQueryWithCache call.
     */
    private _collectionName: string | undefined;

    /**
     * Stores the user's original query parameters (filter, project, sort, skip, limit).
     * This represents what the user actually queried for, independent of pagination.
     * Used for returning query info to consumers via getCurrentFindQueryParams().
     */
    private _currentUserQueryParams: FindQueryParams | null = null;

    /**
     * The page size used for the current accumulation strategy.
     * If this changes, we need to reset accumulated data since page boundaries differ.
     */
    private _currentPageSize: number | null = null;

    /**
     * Raw documents from the most recently fetched page.
     * This is NOT accumulated - it only contains the current page's data.
     */
    private _currentRawDocuments: WithId<Document>[] = [];

    /**
     * Query Insights caching
     *
     * Timestamps are included for potential future features:
     * - Time-based cache invalidation (e.g., expire after N seconds)
     * - Diagnostics (show when explain was collected)
     * - Performance monitoring
     *
     * Currently, cache invalidation is purely query-based via resetCachesIfQueryChanged()
     */
    private _queryPlannerCache?: { result: Document; timestamp: number };
    private _executionStatsCache?: { result: Document; timestamp: number };
    private _aiRecommendationsCache?: { result: unknown; timestamp: number };
    private _stage2ResponseCache?: { response: QueryInsightsStage2Response; totalCollectionDocs?: number };

    /**
     * Last query execution time in milliseconds
     * Measured server-side during runFindQueryWithCache execution
     */
    private _lastExecutionTimeMs?: number;

    /**
     * Resets internal caches when the user's query changes.
     * Only compares the semantic query parameters (filter, project, sort)
     * and the user's original skip/limit, NOT the pagination-derived skip/limit.
     *
     * @param userQueryParams - The user's original query parameters
     */
    private resetCachesIfUserQueryChanged(userQueryParams: FindQueryParams): void {
        // Create a stable key from user's query params (not pagination)
        const userQueryKey = JSON.stringify({
            filter: userQueryParams.filter || '{}',
            project: userQueryParams.project || '{}',
            sort: userQueryParams.sort || '{}',
            skip: userQueryParams.skip ?? 0,
            limit: userQueryParams.limit ?? 0,
        });

        // Check if this is the same query as before
        if (this._currentUserQueryParams) {
            const previousQueryKey = JSON.stringify({
                filter: this._currentUserQueryParams.filter || '{}',
                project: this._currentUserQueryParams.project || '{}',
                sort: this._currentUserQueryParams.sort || '{}',
                skip: this._currentUserQueryParams.skip ?? 0,
                limit: this._currentUserQueryParams.limit ?? 0,
            });

            if (previousQueryKey === userQueryKey) {
                // Same query, no need to reset caches
                return;
            }
        }

        // The user's query has changed, invalidate all caches.
        //
        // NOTE: We intentionally do NOT reset schema here.
        // Schema data is accumulated monotonically in the shared SchemaStore.
        // When a new query returns 0 results, preserving field knowledge from
        // previous queries is more valuable for autocompletion than having an
        // empty field list. Consumers should treat type frequency data as
        // approximate/relative (e.g., "mostly String").
        this._currentPageSize = null;
        this._currentRawDocuments = [];
        this._lastExecutionTimeMs = undefined;

        // Clear query insights caches
        this.clearQueryInsightsCaches();

        // Update the stored user query params
        this._currentUserQueryParams = { ...userQueryParams };
    }

    /**
     * Resets accumulated data when the page size changes.
     * This is necessary because page boundaries differ with different page sizes,
     * making previously accumulated pages incompatible.
     *
     * @param newPageSize - The new page size
     */
    private resetAccumulationIfPageSizeChanged(newPageSize: number): void {
        if (this._currentPageSize !== null && this._currentPageSize !== newPageSize) {
            // Page size changed — schema data in SchemaStore is still valid
            // (accumulated monotonically), just note the size change
            ext.outputChannel.trace('[SchemaStore] Page size changed');
        }
        this._currentPageSize = newPageSize;
    }

    /**
     * Clears all query insights caches
     * Called automatically by resetCachesIfQueryChanged()
     */
    private clearQueryInsightsCaches(): void {
        this._queryPlannerCache = undefined;
        this._executionStatsCache = undefined;
        this._aiRecommendationsCache = undefined;
        this._stage2ResponseCache = undefined;
    }

    /**
     * Executes a MongoDB find query with caching support and pagination.
     *
     * @param databaseName - The name of the database
     * @param collectionName - The name of the collection
     * @param queryParams - Find query parameters (filter, project, sort, skip, limit)
     * @param pageNumber - The page number (1-based) for pagination within the result window
     * @param pageSize - The number of documents per page
     * @param executionIntent - The intent of the query execution ('initial', 'refresh', or 'pagination')
     * @returns The number of documents returned
     *
     * @remarks
     * The skip/limit logic works as follows:
     * - Query skip/limit define the overall "window" of data (e.g., skip: 0, limit: 100)
     * - Pagination navigates within that window (e.g., page 1 with size 10 shows docs 0-9)
     * - If query limit is smaller than pageSize, it takes precedence (e.g., limit: 5 caps pageSize: 10)
     * - If query limit is 0 (no limit), pagination uses pageSize directly
     *
     * The executionIntent parameter controls cache behavior:
     * - 'initial': Clear query insights caches (user clicked "Find Query" button)
     * - 'refresh': Clear query insights caches (user clicked "Refresh" button)
     * - 'pagination': Preserve caches (user navigated to a different page)
     *
     * Examples:
     * 1. Query: skip=0, limit=100 | Page 1, size=10 → dbSkip=0, dbLimit=10
     * 2. Query: skip=0, limit=5  | Page 1, size=10 → dbSkip=0, dbLimit=5 (query limit caps it)
     * 3. Query: skip=20, limit=0 | Page 2, size=10 → dbSkip=30, dbLimit=10
     */
    public async runFindQueryWithCache(
        databaseName: string,
        collectionName: string,
        queryParams: FindQueryParams,
        pageNumber: number,
        pageSize: number,
        executionIntent: 'initial' | 'refresh' | 'pagination' = 'pagination',
        signal?: AbortSignal,
    ): Promise<number> {
        const querySkip = queryParams.skip ?? 0;
        const queryLimit = queryParams.limit ?? 0;

        // Calculate pagination offset within the query window
        const pageOffset = (pageNumber - 1) * pageSize;

        // Combine query skip with pagination offset
        const dbSkip = querySkip + pageOffset;

        // Early return if trying to skip beyond the query limit
        // Note: queryLimit=0 means no limit, so only check when queryLimit > 0
        if (queryLimit > 0 && pageOffset >= queryLimit) {
            return this.runWithClient((_client, epoch) => {
                this.assertCurrent(epoch, signal);
                this._currentRawDocuments = [];
                return Promise.resolve(0);
            });
        }

        // Calculate effective limit:
        // - If query has no limit (0), use pageSize
        // - If query has a limit, cap by remaining documents after pageOffset
        let dbLimit = pageSize;
        if (queryLimit > 0) {
            const remainingInWindow = queryLimit - pageOffset;
            dbLimit = Math.min(pageSize, remainingInWindow);
        }

        // Build final query parameters with computed skip/limit
        const paginatedQueryParams: FindQueryParams = {
            ...queryParams,
            skip: dbSkip,
            limit: dbLimit,
        };

        const epoch = this.getEpoch();
        let ran: ConnectionBinding | undefined;
        let ranAuthMethod: ClustersClient['authMethod'] | undefined;
        let queryResult: { documents: WithId<Document>[]; executionTimeMs: number };
        try {
            queryResult = await this.runWithClient(async (client) => {
                this.assertCurrent(epoch, signal);
                const startTime = performance.now();
                ran = client.binding;
                ranAuthMethod = client.authMethod;
                const documents = await client.runFindQuery(databaseName, collectionName, paginatedQueryParams);
                return { documents, executionTimeMs: performance.now() - startTime };
            }, epoch);
        } catch (error) {
            if (
                error instanceof Error &&
                ran !== undefined &&
                classifyConnectionFailure(error, ranAuthMethod).generation === 'replaceOnNextForeground' &&
                !signal?.aborted &&
                ClustersClient.getEpoch(ran.clusterId) === epoch &&
                ClustersClient.getBinding(ran.clusterId) === ran &&
                !ClustersClient.hasReusableClient(ran.clusterId) &&
                ClustersClient.getLatchReason(ran.clusterId) === undefined
            ) {
                throw new Error(
                    `${error.message} ${l10n.t('Run the query again to retry the connection.')}`,
                    { cause: error },
                );
            }
            throw error;
        }
        const { documents, executionTimeMs } = queryResult;

        this.assertCurrent(epoch, signal);
        this.resetCachesIfUserQueryChanged(queryParams);
        this.resetAccumulationIfPageSizeChanged(pageSize);
        if (executionIntent === 'initial' || executionIntent === 'refresh') {
            this.clearQueryInsightsCaches();
        }
        this._lastExecutionTimeMs = executionTimeMs;

        // Update current page documents (always replace, not accumulate)
        this._currentRawDocuments = documents;

        // Store database/collection context for schema operations
        this._databaseName = databaseName;
        this._collectionName = collectionName;

        // Feed documents to the shared SchemaStore
        if (documents.length > 0) {
            const store = SchemaStore.getInstance();
            const { clusterId } = this.binding;
            store.addDocuments(clusterId, databaseName, collectionName, documents);

            ext.outputChannel.trace(
                `[SchemaStore] Fed ${String(documents.length)} documents, ${String(store.getDocumentCount(clusterId, databaseName, collectionName))} total, ${String(store.getKnownFields(clusterId, databaseName, collectionName).length)} known fields`,
            );
        }

        return documents.length;
    }

    public getCurrentPageAsJson(): string[] {
        return this._currentRawDocuments.map((doc) => JSON.stringify(doc, null, 4));
    }

    public getCurrentPageAsTree(): TreeData[] {
        return toSlickGridTree(this._currentRawDocuments);
    }

    public async deleteDocuments(
        databaseName: string,
        collectionName: string,
        documentIds: string[],
        epoch = this.getEpoch(),
    ): Promise<boolean> {
        const acknowledged = await this.runWithClient(
            (client) => client.deleteDocuments(databaseName, collectionName, documentIds),
            epoch,
        );

        // Acknowledge a completed write, but don't update the page from an old operation.
        if (acknowledged && this.isCurrent(epoch)) {
            this._currentRawDocuments = this._currentRawDocuments.filter((doc) => {
                return !documentIds.some((id) => {
                    const parsedId = parseDocumentId(id);

                    const docIdStr = EJSON.stringify(doc._id, { relaxed: false }, 0);
                    const parsedIdStr = EJSON.stringify(parsedId as Document, { relaxed: false }, 0);

                    return docIdStr === parsedIdStr;
                });
            });
        }

        return acknowledged;
    }

    public getCurrentPageAsTable(path: string[]): TableData {
        const store = SchemaStore.getInstance();
        const responsePack: TableData = {
            path: path,
            headers:
                this._databaseName && this._collectionName
                    ? store.getPropertyNamesAtLevel(
                          this.binding.clusterId,
                          this._databaseName,
                          this._collectionName,
                          path,
                      )
                    : [],
            data: getDataAtPath(this._currentRawDocuments, path),
        };

        return responsePack;
    }

    /**
     * Returns the cached list of known fields from the shared SchemaStore.
     * Delegates to SchemaStore which provides cross-tab schema sharing.
     */
    public getKnownFields(): FieldEntry[] {
        if (!this._databaseName || !this._collectionName) {
            return [];
        }
        return SchemaStore.getInstance().getKnownFields(
            this.binding.clusterId,
            this._databaseName,
            this._collectionName,
        );
    }

    // ============================================================================
    // Query Insights Methods
    // ============================================================================

    /**
     * Gets query planner information - uses explain("queryPlanner")
     * Caches the result until the query changes
     *
     * Note: This method intentionally excludes skip/limit to get insights for the full query scope,
     * not just a single page. For page-specific explain plans, use client.queryInsightsApis.explainFind() directly.
     *
     * @param databaseName - Database name
     * @param collectionName - Collection name
     * @param filter - Query filter
     * @param options - Query options (sort, projection, skip, limit)
     * @returns Explain output from queryPlanner verbosity
     */
    public async getQueryPlannerInfo(
        client: ClustersClient,
        epoch: number,
        databaseName: string,
        collectionName: string,
        filter: Document,
        options?: {
            sort?: Document;
            projection?: Document;
            skip?: number;
            limit?: number;
        },
        signal?: AbortSignal,
    ): Promise<Document> {
        this.assertCurrent(epoch, signal);
        // Check cache
        if (this._queryPlannerCache) {
            return this._queryPlannerCache.result;
        }

        // Execute explain("queryPlanner") using QueryInsightsApis from ClustersClient
        const rawResult = await client.queryInsightsApis.explainFind(databaseName, collectionName, filter, {
            verbosity: 'queryPlanner',
            sort: options?.sort,
            projection: options?.projection,
            skip: options?.skip,
            limit: options?.limit,
        });

        // Apply Azure DocumentDB explain fixup (see fixupDocumentDbExplain for details)
        const clusterMetadata = await client.getClusterMetadata();
        const explainResult = fixupDocumentDbExplain(rawResult, clusterMetadata) ?? rawResult;

        // Cache result
        this.assertCurrent(epoch, signal);
        this._queryPlannerCache = {
            result: explainResult,
            timestamp: Date.now(),
        };

        return explainResult;
    }

    /**
     * Gets execution statistics - uses explain with appropriate verbosity based on cluster type
     * Re-runs the query with execution stats and caches the result
     *
     * For Azure DocumentDB clusters: uses "allPlansExecution" verbosity for richer plan data
     * For other clusters: uses "executionStats" verbosity
     *
     * Note: This method intentionally excludes skip/limit to get insights for the full query scope,
     * not just a single page. For page-specific explain plans, use client.queryInsightsApis.explainFind() directly.
     *
     * @param databaseName - Database name
     * @param collectionName - Collection name
     * @param filter - Query filter
     * @param options - Query options (sort, projection, skip, limit)
     * @returns Explain output with executionStats
     */
    public async getExecutionStats(
        client: ClustersClient,
        epoch: number,
        databaseName: string,
        collectionName: string,
        filter: Document,
        options?: {
            sort?: Document;
            projection?: Document;
            skip?: number;
            limit?: number;
        },
        signal?: AbortSignal,
    ): Promise<Document> {
        this.assertCurrent(epoch, signal);
        // Check cache
        if (this._executionStatsCache) {
            return this._executionStatsCache.result;
        }

        // Determine verbosity based on cluster type
        // Azure DocumentDB clusters support allPlansExecution for richer plan data
        const clusterMetadata = await client.getClusterMetadata();
        const verbosity =
            clusterMetadata.domainInfo_isAzure === 'true' && clusterMetadata.domainInfo_api === 'vCore'
                ? 'allPlansExecution'
                : 'executionStats';

        // Execute explain using QueryInsightsApis from ClustersClient
        // This re-runs the query to get authoritative execution metrics
        this.assertCurrent(epoch, signal);
        const rawResult = await client.queryInsightsApis.explainFind(databaseName, collectionName, filter, {
            verbosity,
            sort: options?.sort,
            projection: options?.projection,
            skip: options?.skip,
            limit: options?.limit,
        });

        // Apply Azure DocumentDB explain fixup (see fixupDocumentDbExplain for details)
        const explainResult = fixupDocumentDbExplain(rawResult, clusterMetadata) ?? rawResult;

        // Cache result
        this.assertCurrent(epoch, signal);
        this._executionStatsCache = {
            result: explainResult,
            timestamp: Date.now(),
        };

        return explainResult;
    }

    /**
     * Gets the last query execution time in milliseconds
     * This is tracked during runFindQueryWithCache execution
     *
     * @returns Execution time in milliseconds, or 0 if no query has been executed yet
     */
    public getLastExecutionTimeMs(): number {
        return this._lastExecutionTimeMs ?? 0;
    }

    /**
     * Gets the current query parameters from the session
     * This returns the user's original query parameters (not pagination-derived values)
     *
     * @returns FindQueryParams object containing the user's original filter, project, sort, skip, and limit
     *
     * @remarks
     * Returns the query parameters exactly as provided by the user when calling runFindQueryWithCache().
     * This does NOT include internal pagination calculations (those are tracked separately in _currentDataCacheKey).
     * If no query has been executed yet, returns default empty values.
     */
    public getCurrentFindQueryParams(): FindQueryParams {
        if (!this._currentUserQueryParams) {
            return {
                filter: '{}',
                project: '{}',
                sort: '{}',
                skip: 0,
                limit: 0,
            };
        }

        return { ...this._currentUserQueryParams };
    }

    /**
     * Gets the current query parameters with parsed BSON objects
     * This returns both the string representations AND the parsed Document objects
     *
     * @returns ParsedFindQueryParams object containing string params plus parsed filterObj, projectionObj, sortObj
     * @throws Error if the current query text cannot be parsed
     *
     * @remarks
     * This method uses the same BSON parsing logic as ClustersClient.runFindQuery():
     * - filter is parsed with toFilterQueryObj() which handles UUID(), Date(), MinKey(), MaxKey() constructors
     * - projection and sort are parsed with parseShellBSON() in Loose mode
     *
     * Use this method when you need the actual MongoDB Document objects for query execution.
     * Use getCurrentFindQueryParams() when you only need the string representations.
     */
    public getCurrentFindQueryParamsWithObjects(): ParsedFindQueryParams {
        const stringParams = this.getCurrentFindQueryParams();

        // Parse filter using toFilterQueryObj (handles BSON constructors like UUID, Date, etc.)
        const filterObj: Filter<Document> = toFilterQueryObj(stringParams.filter ?? '{}');

        // Parse projection if present and not empty
        let projectionObj: Document | undefined;
        if (stringParams.project && stringParams.project.trim() !== '{}') {
            try {
                projectionObj = parseShellBSON(stringParams.project, {
                    mode: ParseMode.Loose,
                }) as Document;
            } catch (error) {
                throw new Error(
                    l10n.t('Invalid projection syntax: {0}', error instanceof Error ? error.message : String(error)),
                );
            }
        }

        // Parse sort if present and not empty
        let sortObj: Document | undefined;
        if (stringParams.sort && stringParams.sort.trim() !== '{}') {
            try {
                sortObj = parseShellBSON(stringParams.sort, {
                    mode: ParseMode.Loose,
                }) as Document;
            } catch (error) {
                throw new Error(
                    l10n.t('Invalid sort syntax: {0}', error instanceof Error ? error.message : String(error)),
                );
            }
        }

        return {
            ...stringParams,
            filterObj,
            projectionObj,
            sortObj,
        };
    }

    /**
     * Gets the raw explain output from the most recent execution stats call
     * Used for displaying the complete explain plan in JSON format
     *
     * @param _databaseName - Database name (for future use)
     * @param _collectionName - Collection name (for future use)
     * @returns Raw explain output document, or null if not available
     */
    public getRawExplainOutput(_databaseName: string, _collectionName: string): Document | null {
        // If we have cached execution stats, return it
        if (this._executionStatsCache) {
            return this._executionStatsCache.result;
        }

        // No cached data available
        return null;
    }

    /**
     * Caches the transformed Stage 2 response and total collection docs
     * for use by Stage 3 when building the static analysis summary.
     */
    public setStage2Response(
        epoch: number,
        response: QueryInsightsStage2Response,
        totalCollectionDocs?: number,
        signal?: AbortSignal,
    ): void {
        this.assertCurrent(epoch, signal);
        this._stage2ResponseCache = { response, totalCollectionDocs };
    }

    /**
     * Gets the cached Stage 2 response, or null if not available.
     */
    public getStage2Response(): { response: QueryInsightsStage2Response; totalCollectionDocs?: number } | null {
        return this._stage2ResponseCache ?? null;
    }

    /**
     * Gets AI-powered query optimization recommendations
     * Caches the result until the query changes
     *
     * This method follows the same pattern as getQueryPlannerInfo() and getExecutionStats():
     * - Check cache first
     * - If not cached, call the AI service via ClustersClient
     * - Cache the result with timestamp
     * - Return typed recommendations
     *
     * @param _databaseName - Database name (unused in mock, will be used in Phase 3)
     * @param _collectionName - Collection name (unused in mock, will be used in Phase 3)
     * @param _filter - Query filter (unused in mock, will be used in Phase 3)
     * @param _executionStats - Execution statistics from Stage 2 (unused in mock, will be used in Phase 3)
     * @returns AI recommendations for query optimization
     *
     * @remarks
     * This method will be implemented in Phase 3. The AI service is accessed via
     * the resolved client's Query Insights service.
     */
    public getAIRecommendations(
        _databaseName: string,
        _collectionName: string,
        _filter: Document,
        _executionStats: Document,
    ): unknown {
        // Check cache
        if (this._aiRecommendationsCache) {
            return this._aiRecommendationsCache.result;
        }

        // TODO: Phase 3 implementation
        // const recommendations = await client.queryInsightsAIService.generateRecommendations(
        //     databaseName,
        //     collectionName,
        //     filter,
        //     executionStats
        // );

        // Temporary mock implementation
        const recommendations = {
            analysis: 'AI recommendations not yet implemented',
            suggestions: [],
        };

        // Cache result
        this._aiRecommendationsCache = {
            result: recommendations,
            timestamp: Date.now(),
        };

        return recommendations;
    }

    // ============================================================================
    // Static Session Management Methods
    // ============================================================================

    /**
     * Initializes a new session for the MongoDB DocumentDB cluster.
     *
     * @param clusterId - The stable cluster identifier used to
     *   look up credentials and create a MongoDB client.
     *   - Connections View: storageId (UUID from ConnectionStorageService)
     *   - Azure Resources View: Azure Resource ID
     *   ⚠️ This is NOT the tree item ID - it must be the stable clusterId.
     * @returns A promise that resolves to the session ID of the newly created session.
     *
     * @throws Will throw an error if the client cannot be obtained using the provided cluster ID.
     */
    public static async initNewSession(clusterId: string): Promise<string> {
        const client = await ClustersClient.getClient(clusterId, undefined, undefined, 'collectionView');

        const sessionId = Math.random().toString(16).substring(2, 15) + Math.random().toString(36).substring(2, 15);

        const session = new ClusterSession(client.binding);

        ClusterSession._sessions.set(sessionId, session);

        return sessionId;
    }

    /**
     * Retrieves a ClusterSession by its session ID.
     *
     * @param sessionId - The unique identifier for the session.
     * @returns The ClusterSession associated with the given session ID, or undefined if no session exists.
     *
     * @remarks
     * Sessions must be created using the `initNewSession` function before they can be retrieved with this method.
     */
    public static getSession(sessionId: string): ClusterSession {
        const session = this._sessions.get(sessionId);
        if (session === undefined) {
            throw new Error(l10n.t('No session found for id {sessionId}', { sessionId }));
        }

        return session;
    }

    public static closeSession(sessionId: string) {
        if (!this._sessions.has(sessionId)) {
            return;
        }

        this._sessions.delete(sessionId);
    }
}
