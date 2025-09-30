/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp';
import { z } from 'zod';
import { getDocumentDBContext } from '../context/documentdb';
import { withDbGuard } from './utils/dbGuard';
import { analyzeFindExplain } from './utils/explainAnalyzer';
import { parseParams } from './utils/paramParser';

/**
 * Register workflow-related tools
 */
export function registerWorkflowTools(server: McpServer): void {
    // Optimize find query tool
    server.registerTool(
        'optimize_find_query',
        {
            title: 'Optimize Find Query',
            description:
                'Provide all the information needed for optimizing a find query (execution plan with metrics, index info, collection stats). Accepts a consolidated "options" object that can include sort, projection, limit, skip.',
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
                    .describe('Consolidated find options that may include sort, projection, limit, skip.'),
            },
        },
        withDbGuard(async ({ db_name, collection_name, query, options }) => {
            try {
                // Batch parse parameters with new optional semantics
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

                const parsedQuery = parsed.query || {};
                // Build findOptions strictly from consolidated options
                const findOptions: any = {};
                if (parsed.options) {
                    const o: any = parsed.options;
                    if (o.sort !== undefined) findOptions.sort = o.sort;
                    if (o.projection !== undefined) findOptions.projection = o.projection;
                    if (o.limit !== undefined) {
                        const lim = typeof o.limit === 'string' ? Number(o.limit) : o.limit;
                        if (Number.isFinite(lim)) findOptions.limit = lim;
                    }
                    if (o.skip !== undefined) {
                        const sk = typeof o.skip === 'string' ? Number(o.skip) : o.skip;
                        if (Number.isFinite(sk)) findOptions.skip = sk;
                    }
                }

                const { client } = getDocumentDBContext();
                const collection = client!.db(db_name).collection(collection_name);

                const explainResult = await collection.find(parsedQuery, findOptions).explain('executionStats');

                const indexesStats = await collection.aggregate([{ $indexStats: {} }]).toArray();
                const collectionStats = await client!.db(db_name).command({ collStats: collection_name });

                // Compute metrics-only analysis from explain result
                const analysis = analyzeFindExplain(explainResult);
                const response = {
                    query: parsedQuery,
                    applied_options: findOptions,
                    metrics: analysis.metrics,
                    plan_shape: analysis.shape,
                    indexes_stats: indexesStats,
                    collection_stats: collectionStats,
                    explain: explainResult,
                };

                return {
                    content: [{ type: 'text', text: JSON.stringify(response, null, 2) }],
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

    // List databases for generation tool
    server.registerTool(
        'list_databases_for_generation',
        {
            title: 'List Databases for Generation',
            description: 'List all databases with basic info for query generation purposes',
        },
        withDbGuard(async () => {
            try {
                const { client } = getDocumentDBContext();
                const adminDb = client!.db().admin();
                const databaseInfos = await adminDb.listDatabases();

                const response = {
                    databases: databaseInfos.databases.map((db) => ({
                        name: db.name,
                        sizeOnDisk: db.sizeOnDisk,
                        empty: db.empty,
                    })),
                };

                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(response, null, 2),
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

    // Get database info for generation tool
    server.registerTool(
        'get_db_info_for_generation',
        {
            title: 'Get Database Info for Generation',
            description:
                'Get detailed database information for query generation, including collections, sample documents and schema',
            inputSchema: {
                db_name: z.string().describe('Name of the database'),
                include_sample_documents: z
                    .union([z.boolean(), z.string()])
                    .default(true)
                    .describe('Include sample documents from collections (boolean or boolean-like string)'),
                sample_size: z
                    .union([z.number(), z.string()])
                    .default(3)
                    .describe('Number of sample documents per collection (number or numeric string)'),
            },
        },
        withDbGuard(async ({ db_name, include_sample_documents = true, sample_size = 3 }) => {
            try {
                const { client } = getDocumentDBContext();
                const db = client!.db(db_name);
                const collections = await db.listCollections().toArray();

                // Use batch parser for parameters
                const parsed = parseParams([
                    {
                        raw: include_sample_documents,
                        outKey: 'includeSamples',
                        expected: 'boolean',
                        options: { fieldName: 'include_sample_documents', defaultValue: true },
                    },
                    {
                        raw: sample_size,
                        outKey: 'sampleSize',
                        expected: 'int',
                        options: { fieldName: 'sample_size', nonNegative: true, defaultValue: 3 },
                    },
                ]);
                const includeSamples: boolean = parsed.includeSamples;
                const sampleSize: number = parsed.sampleSize;

                const collectionInfos = await Promise.all(
                    collections.map(async (collection) => {
                        try {
                            const count = await db.collection(collection.name).estimatedDocumentCount();
                            let sampleDocuments: any[] = [];

                            if (includeSamples && count > 0) {
                                const pipeline = [{ $sample: { size: Math.min(sampleSize, count) } }];
                                sampleDocuments = await db.collection(collection.name).aggregate(pipeline).toArray();
                            }

                            return {
                                name: collection.name,
                                count,
                                sampleDocuments: includeSamples ? sampleDocuments : undefined,
                            };
                        } catch (error) {
                            return {
                                name: collection.name,
                                count: 0,
                                error: error instanceof Error ? error.message : String(error),
                                sampleDocuments: includeSamples ? [] : undefined,
                            };
                        }
                    }),
                );

                const dbInfo = {
                    database_name: db_name,
                    collections: collectionInfos,
                };

                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(dbInfo, null, 2),
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
}
