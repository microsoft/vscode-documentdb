/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp';
import { z } from 'zod';
import { getDocumentDBContext } from '../context/documentdb';
import { withDbGuard } from './utils/dbGuard';
import { parseParams, parseUpdate } from './utils/paramParser';

/**
 * Register document-related tools
 */
export function registerDocumentTools(server: McpServer): void {
    // Find documents tool
    server.registerTool(
        'find_documents',
        {
            title: 'Find Documents',
            description:
                'Find documents in a collection. Supports consolidated "options" object (limit, skip, sort, projection).',
            inputSchema: {
                db_name: z.string().describe('Name of the database'),
                collection_name: z.string().describe('Name of the collection to query'),
                query: z
                    .union([z.record(z.unknown()), z.string()])
                    .default({})
                    .describe('Query filter in MongoDB style'),
                options: z
                    .union([z.record(z.unknown()), z.string()])
                    .optional()
                    .describe(
                        'Consolidated find options. Fields: limit (default 100), skip (default 0), sort, projection.',
                    ),
            },
        },
        withDbGuard(async ({ db_name, collection_name, query = {}, options }) => {
            try {
                const parsed = parseParams([
                    { raw: query, expected: 'object', outKey: 'query', options: { fieldName: 'query' } },
                    {
                        raw: options,
                        expected: 'object',
                        outKey: 'options',
                        options: { fieldName: 'options', optional: true, treatEmptyObjectAsUndefined: true },
                    },
                ]);
                const parsedQuery = parsed.query as Record<string, unknown>;
                const o: any = parsed.options || {};
                let limitVal = 100;
                let skipVal = 0;
                if (o.limit !== undefined) {
                    const lv = typeof o.limit === 'string' ? Number(o.limit) : o.limit;
                    if (Number.isFinite(lv) && lv >= 0) limitVal = lv;
                }
                if (o.skip !== undefined) {
                    const sv = typeof o.skip === 'string' ? Number(o.skip) : o.skip;
                    if (Number.isFinite(sv) && sv >= 0) skipVal = sv;
                }
                const sortVal = o.sort !== undefined ? o.sort : undefined;
                const projectionVal = o.projection !== undefined ? o.projection : undefined;
                const { client } = getDocumentDBContext();
                const collection = client!.db(db_name).collection(collection_name);
                const findOptions: any = {};
                if (sortVal !== undefined) findOptions.sort = sortVal;
                if (projectionVal !== undefined) findOptions.projection = projectionVal;
                if (skipVal) findOptions.skip = skipVal;
                if (limitVal) findOptions.limit = limitVal;
                const documents = await collection.find(parsedQuery, findOptions).toArray();
                const totalCount = await collection.countDocuments(parsedQuery);
                const response = {
                    documents,
                    total_count: totalCount,
                    returned_count: documents.length,
                    has_more: skipVal + documents.length < totalCount,
                    query: parsedQuery,
                    applied_options: { limit: limitVal, skip: skipVal, sort: sortVal, projection: projectionVal },
                };
                return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
            } catch (error) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(
                                { error: error instanceof Error ? error.message : String(error) },
                                null,
                                2,
                            ),
                        },
                    ],
                    isError: true,
                };
            }
        }),
    );

    // Count documents tool
    server.registerTool(
        'count_documents',
        {
            title: 'Count Documents',
            description: 'Count documents in a collection matching a query',
            inputSchema: {
                db_name: z.string().describe('Name of the database'),
                collection_name: z.string().describe('Name of the collection to query'),
                query: z
                    .union([z.record(z.unknown()), z.string()])
                    .default({})
                    .describe('Query filter in MongoDB style'),
            },
        },
        withDbGuard(async ({ db_name, collection_name, query = {} }) => {
            try {
                const parsed = parseParams([
                    { raw: query, expected: 'object', outKey: 'query', options: { fieldName: 'query' } },
                ]);
                const parsedQuery = parsed.query as Record<string, unknown>;
                const { client } = getDocumentDBContext();
                const collection = client!.db(db_name).collection(collection_name);
                const count = await collection.countDocuments(parsedQuery);
                return { content: [{ type: 'text', text: JSON.stringify({ count, query: parsedQuery }, null, 2) }] };
            } catch (error) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(
                                { error: error instanceof Error ? error.message : String(error) },
                                null,
                                2,
                            ),
                        },
                    ],
                    isError: true,
                };
            }
        }),
    );

    // Insert single document tool
    server.registerTool(
        'insert_document',
        {
            title: 'Insert Document',
            description: 'Insert a single document into a collection',
            inputSchema: {
                db_name: z.string().describe('Name of the database'),
                collection_name: z.string().describe('Name of the collection'),
                document: z.record(z.unknown()).describe('Document to insert'),
            },
        },
        withDbGuard(async ({ db_name, collection_name, document }) => {
            try {
                const parsed = parseParams([
                    { raw: document, expected: 'object', outKey: 'document', options: { fieldName: 'document' } },
                ]);
                const doc = parsed.document as Record<string, unknown>;
                const { client } = getDocumentDBContext();
                const collection = client!.db(db_name).collection(collection_name);
                const result = await collection.insertOne(doc);
                const response = {
                    inserted_id: result.insertedId,
                    acknowledged: result.acknowledged,
                    inserted_count: 1,
                };
                return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
            } catch (error) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(
                                { error: error instanceof Error ? error.message : String(error) },
                                null,
                                2,
                            ),
                        },
                    ],
                    isError: true,
                };
            }
        }),
    );

    // Insert many documents tool
    server.registerTool(
        'insert_many',
        {
            title: 'Insert Many Documents',
            description: 'Insert multiple documents into a collection',
            inputSchema: {
                db_name: z.string().describe('Name of the database'),
                collection_name: z.string().describe('Name of the collection'),
                documents: z
                    .union([z.array(z.record(z.unknown())), z.string()])
                    .describe('List of documents to insert'),
            },
        },
        withDbGuard(async ({ db_name, collection_name, documents }) => {
            try {
                const parsed = parseParams([
                    { raw: documents, expected: 'array', outKey: 'documents', options: { fieldName: 'documents' } },
                ]);
                const docs = parsed.documents as any;
                if (!Array.isArray(docs) || docs.some((d) => typeof d !== 'object' || d === null || Array.isArray(d))) {
                    throw new Error('documents must be an array of JSON objects');
                }
                const { client } = getDocumentDBContext();
                const collection = client!.db(db_name).collection(collection_name);
                const result = await collection.insertMany(docs);
                const insertedIds = Object.values(result.insertedIds).map((id) => String(id));
                const response = {
                    inserted_ids: insertedIds,
                    acknowledged: result.acknowledged,
                    inserted_count: insertedIds.length,
                };
                return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
            } catch (error) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(
                                { error: error instanceof Error ? error.message : String(error) },
                                null,
                                2,
                            ),
                        },
                    ],
                    isError: true,
                };
            }
        }),
    );

    // Update single document tool
    server.registerTool(
        'update_document',
        {
            title: 'Update Single Document',
            description: 'Update a document in a collection',
            inputSchema: {
                db_name: z.string().describe('Name of the database'),
                collection_name: z.string().describe('Name of the collection'),
                filter: z.union([z.record(z.unknown()), z.string()]).describe('Query filter to find the document'),
                update: z.union([z.record(z.unknown()), z.string()]).describe('Update operations ($set, $inc, etc.)'),
                upsert: z
                    .union([z.boolean(), z.string()])
                    .default(false)
                    .describe("Create document if it doesn't exist"),
            },
        },
        withDbGuard(async ({ db_name, collection_name, filter, update, upsert = false }) => {
            try {
                const parsed = parseParams([
                    { raw: filter, expected: 'object', outKey: 'filter', options: { fieldName: 'filter' } },
                    { raw: update, outKey: 'update', custom: (r) => parseUpdate(r, { fieldName: 'update' }).value },
                    { raw: upsert, expected: 'boolean', outKey: 'upsert', options: { fieldName: 'upsert' } },
                ]);
                const parsedFilter = parsed.filter as Record<string, unknown>;
                const parsedUpdate = parsed.update as Record<string, unknown>;
                const parsedUpsert = parsed.upsert as boolean;
                const { client } = getDocumentDBContext();
                const collection = client!.db(db_name).collection(collection_name);
                const result = await collection.updateOne(parsedFilter, parsedUpdate, { upsert: parsedUpsert });
                const response = {
                    matched_count: result.matchedCount,
                    modified_count: result.modifiedCount,
                    upserted_id: result.upsertedId ? String(result.upsertedId) : null,
                    acknowledged: result.acknowledged,
                };
                return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
            } catch (error) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(
                                { error: error instanceof Error ? error.message : String(error) },
                                null,
                                2,
                            ),
                        },
                    ],
                    isError: true,
                };
            }
        }),
    );

    // Update many documents tool
    server.registerTool(
        'update_many',
        {
            title: 'Update Many Documents',
            description: 'Update multiple documents in a collection',
            inputSchema: {
                db_name: z.string().describe('Name of the database'),
                collection_name: z.string().describe('Name of the collection'),
                filter: z.union([z.record(z.unknown()), z.string()]).describe('Query filter to find the documents'),
                update: z.union([z.record(z.unknown()), z.string()]).describe('Update operations ($set, $inc, etc.)'),
                upsert: z
                    .union([z.boolean(), z.string()])
                    .default(false)
                    .describe("Create document if it doesn't exist"),
            },
        },
        withDbGuard(async ({ db_name, collection_name, filter, update, upsert = false }) => {
            try {
                const parsed = parseParams([
                    { raw: filter, expected: 'object', outKey: 'filter', options: { fieldName: 'filter' } },
                    { raw: update, outKey: 'update', custom: (r) => parseUpdate(r, { fieldName: 'update' }).value },
                    { raw: upsert, expected: 'boolean', outKey: 'upsert', options: { fieldName: 'upsert' } },
                ]);
                const parsedFilter = parsed.filter as Record<string, unknown>;
                const parsedUpdate = parsed.update as Record<string, unknown>;
                const parsedUpsert = parsed.upsert as boolean;
                const { client } = getDocumentDBContext();
                const collection = client!.db(db_name).collection(collection_name);
                const result = await collection.updateMany(parsedFilter, parsedUpdate, { upsert: parsedUpsert });
                const response = {
                    matched_count: result.matchedCount,
                    modified_count: result.modifiedCount,
                    upserted_id: result.upsertedId ? String(result.upsertedId) : null,
                    acknowledged: result.acknowledged,
                };
                return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
            } catch (error) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(
                                { error: error instanceof Error ? error.message : String(error) },
                                null,
                                2,
                            ),
                        },
                    ],
                    isError: true,
                };
            }
        }),
    );

    // Delete one document tool
    server.registerTool(
        'delete_document',
        {
            title: 'Delete Document',
            description: 'Delete a document from a collection',
            inputSchema: {
                db_name: z.string().describe('Name of the database'),
                collection_name: z.string().describe('Name of the collection'),
                filter: z.union([z.record(z.unknown()), z.string()]).describe('Query filter to find the document'),
            },
        },
        withDbGuard(async ({ db_name, collection_name, filter }) => {
            try {
                const parsed = parseParams([
                    { raw: filter, expected: 'object', outKey: 'filter', options: { fieldName: 'filter' } },
                ]);
                const parsedFilter = parsed.filter as Record<string, unknown>;
                const { client } = getDocumentDBContext();
                const collection = client!.db(db_name).collection(collection_name);
                const result = await collection.deleteOne(parsedFilter);
                const response = { deleted_count: result.deletedCount, acknowledged: result.acknowledged };
                return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
            } catch (error) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(
                                { error: error instanceof Error ? error.message : String(error) },
                                null,
                                2,
                            ),
                        },
                    ],
                    isError: true,
                };
            }
        }),
    );

    // Delete many documents tool
    server.registerTool(
        'delete_many',
        {
            title: 'Delete Many Documents',
            description: 'Delete multiple documents from a collection',
            inputSchema: {
                db_name: z.string().describe('Name of the database'),
                collection_name: z.string().describe('Name of the collection'),
                filter: z.union([z.record(z.unknown()), z.string()]).describe('Query filter to find the documents'),
            },
        },
        withDbGuard(async ({ db_name, collection_name, filter }) => {
            try {
                const parsed = parseParams([
                    { raw: filter, expected: 'object', outKey: 'filter', options: { fieldName: 'filter' } },
                ]);
                const parsedFilter = parsed.filter as Record<string, unknown>;
                const { client } = getDocumentDBContext();
                const collection = client!.db(db_name).collection(collection_name);
                const result = await collection.deleteMany(parsedFilter);
                const response = { deleted_count: result.deletedCount, acknowledged: result.acknowledged };
                return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
            } catch (error) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(
                                { error: error instanceof Error ? error.message : String(error) },
                                null,
                                2,
                            ),
                        },
                    ],
                    isError: true,
                };
            }
        }),
    );

    // Aggregate pipeline tool
    server.registerTool(
        'aggregate',
        {
            title: 'Aggregate Pipeline',
            description: 'Run an aggregation pipeline on a collection',
            inputSchema: {
                db_name: z.string().describe('Name of the database'),
                collection_name: z.string().describe('Name of the collection'),
                pipeline: z.union([z.array(z.record(z.unknown())), z.string()]).describe('List of aggregation stages'),
                allow_disk_use: z
                    .union([z.boolean(), z.string()])
                    .default(false)
                    .describe('Allow pipeline stages to write to disk'),
            },
        },
        withDbGuard(async ({ db_name, collection_name, pipeline, allow_disk_use = false }) => {
            try {
                const parsed = parseParams([
                    { raw: pipeline, expected: 'array', outKey: 'pipeline', options: { fieldName: 'pipeline' } },
                    {
                        raw: allow_disk_use,
                        expected: 'boolean',
                        outKey: 'allow_disk_use',
                        options: { fieldName: 'allow_disk_use' },
                    },
                ]);
                const parsedPipeline = parsed.pipeline as any;
                if (!Array.isArray(parsedPipeline)) throw new Error('pipeline must be an array');
                const parsedAllowDisk = parsed.allow_disk_use as boolean;
                const { client } = getDocumentDBContext();
                const collection = client!.db(db_name).collection(collection_name);
                const cursor = collection.aggregate(parsedPipeline, { allowDiskUse: parsedAllowDisk });
                const results = await cursor.toArray();
                const response = { results, total_count: results.length };
                return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
            } catch (error) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(
                                { error: error instanceof Error ? error.message : String(error) },
                                null,
                                2,
                            ),
                        },
                    ],
                    isError: true,
                };
            }
        }),
    );

    // Explain aggregate query tool
    server.registerTool(
        'explain_aggregate_query',
        {
            title: 'Explain Aggregate Query',
            description:
                'Explain the execution plan with execution stats for an aggregation query on a given collection',
            inputSchema: {
                db_name: z.string().describe('Name of the database'),
                collection_name: z.string().describe('Name of the collection'),
                pipeline: z.union([z.array(z.record(z.unknown())), z.string()]).describe('List of aggregation stages'),
            },
        },
        withDbGuard(async ({ db_name, collection_name, pipeline }) => {
            try {
                const parsed = parseParams([
                    { raw: pipeline, expected: 'array', outKey: 'pipeline', options: { fieldName: 'pipeline' } },
                ]);
                const parsedPipeline = parsed.pipeline as any;
                const { client } = getDocumentDBContext();
                const db = client!.db(db_name);
                const command = {
                    explain: { aggregate: collection_name, pipeline: parsedPipeline, cursor: {} },
                    verbosity: 'executionStats',
                };
                const explainOutput = await db.command(command as any);
                return { content: [{ type: 'text', text: JSON.stringify(explainOutput, null, 2) }] };
            } catch (error) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(
                                { error: error instanceof Error ? error.message : String(error) },
                                null,
                                2,
                            ),
                        },
                    ],
                    isError: true,
                };
            }
        }),
    );

    // Explain count query tool
    server.registerTool(
        'explain_count_query',
        {
            title: 'Explain Count Query',
            description: 'Explain the execution plan with execution stats for count query on a given collection',
            inputSchema: {
                db_name: z.string().describe('Name of the database'),
                collection_name: z.string().describe('Name of the collection'),
                query: z
                    .union([z.record(z.unknown()), z.string()])
                    .default({})
                    .describe('Query filter in MongoDB style'),
            },
        },
        withDbGuard(async ({ db_name, collection_name, query = {} }) => {
            try {
                const parsed = parseParams([
                    { raw: query, expected: 'object', outKey: 'query', options: { fieldName: 'query' } },
                ]);
                const parsedQuery = parsed.query as Record<string, unknown>;
                const { client } = getDocumentDBContext();
                const db = client!.db(db_name);
                const command = {
                    explain: { count: collection_name, query: parsedQuery },
                    verbosity: 'executionStats',
                };
                const explainOutput = await db.command(command as any);
                return { content: [{ type: 'text', text: JSON.stringify(explainOutput, null, 2) }] };
            } catch (error) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(
                                { error: error instanceof Error ? error.message : String(error) },
                                null,
                                2,
                            ),
                        },
                    ],
                    isError: true,
                };
            }
        }),
    );

    // Explain find query tool
    server.registerTool(
        'explain_find_query',
        {
            title: 'Explain Find Query',
            description:
                'Explain the execution plan with execution stats for a find query using consolidated options (sort, projection, limit, skip).',
            inputSchema: {
                db_name: z.string().describe('Name of the database'),
                collection_name: z.string().describe('Name of the collection'),
                query: z
                    .union([z.record(z.unknown()), z.string()])
                    .default({})
                    .describe('Query filter in MongoDB style'),
                options: z
                    .union([z.record(z.unknown()), z.string()])
                    .optional()
                    .describe('Consolidated find options. Fields: sort, projection, limit, skip.'),
            },
        },
        withDbGuard(async ({ db_name, collection_name, query = {}, options }) => {
            try {
                const parsed = parseParams([
                    {
                        raw: query,
                        expected: 'object',
                        outKey: 'query',
                        options: { fieldName: 'query', defaultValue: {} },
                    },
                    {
                        raw: options,
                        expected: 'object',
                        outKey: 'options',
                        options: { fieldName: 'options', optional: true, treatEmptyObjectAsUndefined: true },
                    },
                ]);
                const parsedQuery = parsed.query as Record<string, unknown>;
                const o: any = parsed.options || {};
                const sortVal = o.sort !== undefined ? o.sort : undefined;
                const projectionVal = o.projection !== undefined ? o.projection : undefined;
                let limitVal: number | undefined;
                if (o.limit !== undefined) {
                    const lv = typeof o.limit === 'string' ? Number(o.limit) : o.limit;
                    if (Number.isFinite(lv) && lv >= 0) limitVal = lv;
                }
                let skipVal: number | undefined;
                if (o.skip !== undefined) {
                    const sv = typeof o.skip === 'string' ? Number(o.skip) : o.skip;
                    if (Number.isFinite(sv) && sv >= 0) skipVal = sv;
                }
                const { client } = getDocumentDBContext();
                const db = client!.db(db_name);
                const findCmd: any = { find: collection_name, filter: parsedQuery };
                if (sortVal !== undefined) findCmd.sort = sortVal;
                if (limitVal !== undefined) findCmd.limit = limitVal;
                if (skipVal !== undefined) findCmd.skip = skipVal;
                if (projectionVal !== undefined) findCmd.projection = projectionVal;
                const command = { explain: findCmd, verbosity: 'executionStats' };
                const explainOutput = await db.command(command as any);
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(
                                {
                                    options_applied: {
                                        sort: sortVal,
                                        projection: projectionVal,
                                        limit: limitVal,
                                        skip: skipVal,
                                    },
                                    explain: explainOutput,
                                },
                                null,
                                2,
                            ),
                        },
                    ],
                };
            } catch (error) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(
                                { error: error instanceof Error ? error.message : String(error) },
                                null,
                                2,
                            ),
                        },
                    ],
                    isError: true,
                };
            }
        }),
    );

    // Find and modify tool
    server.registerTool(
        'find_and_modify',
        {
            title: 'Find And Modify Document',
            description:
                "Find one document by filter and apply update; returns the document BEFORE modification (or null if it doesn't exist)",
            inputSchema: {
                db_name: z.string().describe('Name of the database'),
                collection_name: z.string().describe('Name of the collection to query'),
                query: z.union([z.record(z.unknown()), z.string()]).describe('Query filter in MongoDB style'),
                update: z.union([z.record(z.unknown()), z.string()]).describe('Update operations ($set, $inc, etc.)'),
                upsert: z
                    .union([z.boolean(), z.string()])
                    .default(false)
                    .describe('Create document if it does not exist'),
            },
        },
        withDbGuard(async ({ db_name, collection_name, query, update, upsert = false }) => {
            try {
                const parsed = parseParams([
                    { raw: query, expected: 'object', outKey: 'query', options: { fieldName: 'query' } },
                    { raw: update, outKey: 'update', custom: (r) => parseUpdate(r, { fieldName: 'update' }).value },
                    { raw: upsert, expected: 'boolean', outKey: 'upsert', options: { fieldName: 'upsert' } },
                ]);
                const parsedQuery = parsed.query as Record<string, unknown>;
                const parsedUpdate = parsed.update as Record<string, unknown>;
                const parsedUpsert = parsed.upsert as boolean;
                const { client } = getDocumentDBContext();
                const collection = client!.db(db_name).collection(collection_name);

                // findOneAndUpdate options: returnDocument: 'before' (default prior to driver v5 is 'before'; we set explicitly)
                const result = await collection.findOneAndUpdate(parsedQuery, parsedUpdate, {
                    upsert: parsedUpsert,
                    returnDocument: 'before',
                });

                const response = {
                    matched: result ? (result.lastErrorObject?.updatedExisting ?? false) : false,
                    upsertedId: result ? result.lastErrorObject?.upserted : undefined,
                    original_document: result ? (result.value ?? null) : null,
                    query: parsedQuery,
                    update: parsedUpdate,
                    upsert,
                };

                return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
            } catch (error) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(
                                { error: error instanceof Error ? error.message : String(error) },
                                null,
                                2,
                            ),
                        },
                    ],
                    isError: true,
                };
            }
        }),
    );
}
