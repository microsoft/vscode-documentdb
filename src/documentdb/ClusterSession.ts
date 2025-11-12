/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { EJSON } from 'bson';
import { ObjectId, type Document, type Filter, type WithId } from 'mongodb';
import { type JSONSchema } from '../utils/json/JSONSchema';
import { getPropertyNamesAtLevel, updateSchemaWithDocument } from '../utils/json/mongo/SchemaAnalyzer';
import { getDataAtPath } from '../utils/slickgrid/mongo/toSlickGridTable';
import { toSlickGridTree, type TreeData } from '../utils/slickgrid/mongo/toSlickGridTree';
import { ClustersClient, type FindQueryParams } from './ClustersClient';
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
    private constructor(private _client: ClustersClient) {
        return;
    }

    public getClient(): ClustersClient {
        return this._client;
    }

    /**
     * Accumulated JSON schema across all pages seen for the current query.
     * Updates progressively as users navigate through different pages.
     * Reset when the query or page size changes.
     */
    private _accumulatedJsonSchema: JSONSchema = {};

    /**
     * Tracks the highest page number that has been accumulated into the schema.
     * Users navigate sequentially starting from page 1, so any page ≤ this value
     * has already been accumulated and should be skipped.
     * Reset when the query or page size changes.
     */
    private _highestPageAccumulated: number = 0;

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
     * Note: QueryInsightsApis instance is accessed via this._client.queryInsightsApis
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

            if (previousQueryKey.localeCompare(userQueryKey, undefined, { sensitivity: 'base' }) === 0) {
                // Same query, no need to reset caches
                return;
            }
        }

        // The user's query has changed, invalidate all caches
        this._accumulatedJsonSchema = {};
        this._highestPageAccumulated = 0;
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
            // Page size changed, reset accumulation tracking
            this._accumulatedJsonSchema = {};
            this._highestPageAccumulated = 0;
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
            // We're trying to page beyond the query's limit - return empty results
            this._currentRawDocuments = [];
            return 0;
        }

        // Calculate effective limit:
        // - If query has no limit (0), use pageSize
        // - If query has a limit, cap by remaining documents after pageOffset
        let dbLimit = pageSize;
        if (queryLimit > 0) {
            const remainingInWindow = queryLimit - pageOffset;
            dbLimit = Math.min(pageSize, remainingInWindow);
        }

        // Check if the user's query has changed (not pagination, just the actual query)
        this.resetCachesIfUserQueryChanged(queryParams);

        // Check if page size has changed (invalidates accumulation strategy)
        this.resetAccumulationIfPageSizeChanged(pageSize);

        // Force clear query insights caches for initial/refresh operations
        // This ensures fresh performance data when user explicitly requests it
        if (executionIntent === 'initial' || executionIntent === 'refresh') {
            this.clearQueryInsightsCaches();
        }

        // Build final query parameters with computed skip/limit
        const paginatedQueryParams: FindQueryParams = {
            ...queryParams,
            skip: dbSkip,
            limit: dbLimit,
        };

        // Track execution time for query insights
        const startTime = performance.now();
        const documents: WithId<Document>[] = await this._client.runFindQuery(
            databaseName,
            collectionName,
            paginatedQueryParams,
        );
        this._lastExecutionTimeMs = performance.now() - startTime;

        // Update current page documents (always replace, not accumulate)
        this._currentRawDocuments = documents;

        // Accumulate schema only if this page hasn't been seen before
        // Since navigation is sequential and starts at page 1, we only need to track
        // the highest page number accumulated
        if (pageNumber > this._highestPageAccumulated) {
            this._currentRawDocuments.map((doc) => updateSchemaWithDocument(this._accumulatedJsonSchema, doc));
            this._highestPageAccumulated = pageNumber;
        }

        return documents.length;
    }

    public getCurrentPageAsJson(): string[] {
        return this._currentRawDocuments.map((doc) => JSON.stringify(doc, null, 4));
    }

    public getCurrentPageAsTree(): TreeData[] {
        return toSlickGridTree(this._currentRawDocuments);
    }

    async deleteDocuments(databaseName: string, collectionName: string, documentIds: string[]): Promise<boolean> {
        const acknowledged = await this._client.deleteDocuments(databaseName, collectionName, documentIds);

        if (acknowledged) {
            this._currentRawDocuments = this._currentRawDocuments.filter((doc) => {
                // Convert documentIds to BSON types and compare them with doc._id
                return !documentIds.some((id) => {
                    let parsedId;
                    try {
                        // eslint-disable-next-line
                        parsedId = EJSON.parse(id);
                    } catch {
                        if (ObjectId.isValid(id)) {
                            parsedId = new ObjectId(id);
                        } else {
                            parsedId = id;
                        }
                    }

                    /**
                     * deep equality for _id is tricky as we'd have to consider embedded objects,
                     * arrays, etc. For now, we'll just stringify the _id and compare the strings.
                     * The reasoning here is that this operation is used during interactive work
                     * and were not expecting to delete a large number of documents at once.
                     * Hence, the performance impact of this approach is negligible, and it's more
                     * about simplicity here.
                     */

                    const docIdStr = EJSON.stringify(doc._id, { relaxed: false }, 0);
                    const parsedIdStr = EJSON.stringify(parsedId, { relaxed: false }, 0);

                    return docIdStr === parsedIdStr;
                });
            });
        }

        return acknowledged;
    }

    public getCurrentPageAsTable(path: string[]): TableData {
        const responsePack: TableData = {
            path: path,
            headers: getPropertyNamesAtLevel(this._accumulatedJsonSchema, path),
            data: getDataAtPath(this._currentRawDocuments, path),
        };

        return responsePack;
    }

    public getCurrentSchema(): JSONSchema {
        return this._accumulatedJsonSchema;
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
        databaseName: string,
        collectionName: string,
        filter: Document,
        options?: {
            sort?: Document;
            projection?: Document;
            skip?: number;
            limit?: number;
        },
    ): Promise<Document> {
        // Check cache
        if (this._queryPlannerCache) {
            return this._queryPlannerCache.result;
        }

        // Execute explain("queryPlanner") using QueryInsightsApis from ClustersClient
        const explainResult = await this._client.queryInsightsApis.explainFind(databaseName, collectionName, filter, {
            verbosity: 'queryPlanner',
            sort: options?.sort,
            projection: options?.projection,
            skip: options?.skip,
            limit: options?.limit,
        });

        // Cache result
        this._queryPlannerCache = {
            result: explainResult,
            timestamp: Date.now(),
        };

        return explainResult;
    }

    /**
     * Gets execution statistics - uses explain("executionStats")
     * Re-runs the query with execution stats and caches the result
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
        databaseName: string,
        collectionName: string,
        filter: Document,
        options?: {
            sort?: Document;
            projection?: Document;
            skip?: number;
            limit?: number;
        },
    ): Promise<Document> {
        // Check cache
        if (this._executionStatsCache) {
            return this._executionStatsCache.result;
        }

        // Execute explain("executionStats") using QueryInsightsApis from ClustersClient
        // This re-runs the query to get authoritative execution metrics
        const explainResult = await this._client.queryInsightsApis.explainFind(databaseName, collectionName, filter, {
            verbosity: 'executionStats',
            sort: options?.sort,
            projection: options?.projection,
            skip: options?.skip,
            limit: options?.limit,
        });

        // Cache result
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
     * - projection and sort are parsed with EJSON.parse()
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
                projectionObj = EJSON.parse(stringParams.project) as Document;
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
                sortObj = EJSON.parse(stringParams.sort) as Document;
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
     * this._client.queryInsightsAIService (similar to queryInsightsApis pattern).
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
        // const recommendations = await this._client.queryInsightsAIService.generateRecommendations(
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
     * @param credentialId - The ID of the credentials used to authenticate the MongoDB client.
     * @returns A promise that resolves to the session ID of the newly created session.
     *
     * @throws Will throw an error if the client cannot be obtained using the provided credential ID.
     */
    public static async initNewSession(credentialId: string): Promise<string> {
        const client = await ClustersClient.getClient(credentialId);

        const sessionId = Math.random().toString(16).substring(2, 15) + Math.random().toString(36).substring(2, 15);

        const session = new ClusterSession(client);

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
