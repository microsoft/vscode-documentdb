/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { EJSON } from 'bson';
import { ObjectId, type Document, type WithId } from 'mongodb';
import { type JSONSchema } from '../utils/json/JSONSchema';
import { getPropertyNamesAtLevel, updateSchemaWithDocument } from '../utils/json/mongo/SchemaAnalyzer';
import { getDataAtPath } from '../utils/slickgrid/mongo/toSlickGridTable';
import { toSlickGridTree, type TreeData } from '../utils/slickgrid/mongo/toSlickGridTree';
import { ClustersClient, type FindQueryParams } from './ClustersClient';

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
     * Tracks the known JSON schema for the current query
     * and updates it with everything we see until the query text changes.
     */
    private _currentJsonSchema: JSONSchema = {};
    private _currentQueryText: string = '';
    private _currentRawDocuments: WithId<Document>[] = [];

    /**
     * This is a basic approach for now, we can improve this later.
     * It's important to react to an updated query and to invalidate local caches if the query has changed.
     * @param query
     * @returns
     */
    private resetCachesIfQueryChanged(query: string) {
        if (this._currentQueryText.localeCompare(query.trim(), undefined, { sensitivity: 'base' }) === 0) {
            return;
        }

        // the query text has changed, caches are now invalid and have to be purged
        this._currentJsonSchema = {};
        this._currentRawDocuments = [];

        this._currentQueryText = query.trim();
    }

    /**
     * Executes a MongoDB find query with caching support and pagination.
     *
     * @param databaseName - The name of the database
     * @param collectionName - The name of the collection
     * @param queryParams - Find query parameters (filter, project, sort, skip, limit)
     * @param pageNumber - The page number (1-based) for pagination within the result window
     * @param pageSize - The number of documents per page
     * @returns The number of documents returned
     *
     * @remarks
     * The skip/limit logic works as follows:
     * - Query skip/limit define the overall "window" of data (e.g., skip: 0, limit: 100)
     * - Pagination navigates within that window (e.g., page 1 with size 10 shows docs 0-9)
     * - If query limit is smaller than pageSize, it takes precedence (e.g., limit: 5 caps pageSize: 10)
     * - If query limit is 0 (no limit), pagination uses pageSize directly
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

        // Create cache key from all query parameters to detect any changes
        const cacheKey = JSON.stringify({
            filter: queryParams.filter || '{}',
            project: queryParams.project || '{}',
            sort: queryParams.sort || '{}',
            skip: dbSkip,
            limit: dbLimit,
        });
        this.resetCachesIfQueryChanged(cacheKey);

        // Build final query parameters with computed skip/limit
        const paginatedQueryParams: FindQueryParams = {
            ...queryParams,
            skip: dbSkip,
            limit: dbLimit,
        };

        const documents: WithId<Document>[] = await this._client.runFindQuery(
            databaseName,
            collectionName,
            paginatedQueryParams,
        );

        // Cache the results and update schema
        this._currentRawDocuments = documents;
        this._currentRawDocuments.map((doc) => updateSchemaWithDocument(this._currentJsonSchema, doc));

        return documents.length;
    }

    /**
     * @deprecated Use runFindQueryWithCache() instead which supports filter, projection, and sort parameters.
     * This method will be removed in a future version.
     */
    public async runQueryWithCache(
        databaseName: string,
        collectionName: string,
        query: string,
        pageNumber: number,
        pageSize: number,
    ) {
        this.resetCachesIfQueryChanged(query);

        const documents: WithId<Document>[] = await this._client.runQuery(
            databaseName,
            collectionName,
            query,
            (pageNumber - 1) * pageSize, // converting page number to amount of documents to skip
            pageSize,
        );

        // now, here we can do caching, data conversions, schema tracking and everything else we need to do
        // the client can be simplified and we can move some of the logic here, especially all data conversions
        this._currentRawDocuments = documents;

        // JSON Schema
        this._currentRawDocuments.map((doc) => updateSchemaWithDocument(this._currentJsonSchema, doc));

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
            headers: getPropertyNamesAtLevel(this._currentJsonSchema, path),
            data: getDataAtPath(this._currentRawDocuments, path),
        };

        return responsePack;
    }

    public getCurrentSchema(): JSONSchema {
        return this._currentJsonSchema;
    }

    /**
     * Initializes a new session for the MongoDB vCore cluster.
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
