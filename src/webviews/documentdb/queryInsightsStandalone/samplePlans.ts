/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type SampleCommand = 'find' | 'aggregate' | 'count';

/** Small, realistic `explain("executionStats")` results for trying the explorer without a database. */
const samples: Record<SampleCommand, unknown> = {
    find: {
        queryPlanner: {
            namespace: 'shop.orders',
            parsedQuery: { $and: [{ customerId: { $eq: 1042 } }, { status: { $eq: 'shipped' } }] },
            winningPlan: {
                stage: 'SORT',
                sortPattern: { orderDate: -1 },
                inputStage: {
                    stage: 'FETCH',
                    filter: { customerId: { $eq: 1042 } },
                    inputStage: { stage: 'IXSCAN', keyPattern: { status: 1 }, indexName: 'status_1' },
                },
            },
        },
        executionStats: {
            executionSuccess: true,
            nReturned: 18,
            executionTimeMillis: 37,
            totalKeysExamined: 2412,
            totalDocsExamined: 2412,
            executionStages: {
                stage: 'SORT',
                nReturned: 18,
                inputStage: {
                    stage: 'FETCH',
                    nReturned: 18,
                    docsExamined: 2412,
                    inputStage: { stage: 'IXSCAN', nReturned: 2412, keysExamined: 2412, indexName: 'status_1' },
                },
            },
        },
        command: {
            find: 'orders',
            filter: { status: 'shipped', customerId: 1042 },
            sort: { orderDate: -1 },
            $db: 'shop',
        },
    },
    aggregate: {
        stages: [
            {
                $cursor: {
                    queryPlanner: {
                        namespace: 'shop.orders',
                        parsedQuery: { status: { $eq: 'shipped' } },
                        winningPlan: { stage: 'COLLSCAN', filter: { status: { $eq: 'shipped' } }, direction: 'forward' },
                    },
                    executionStats: {
                        executionSuccess: true,
                        nReturned: 5120,
                        executionTimeMillis: 84,
                        totalKeysExamined: 0,
                        totalDocsExamined: 48210,
                        executionStages: { stage: 'COLLSCAN', nReturned: 5120, docsExamined: 48210 },
                    },
                },
                nReturned: 5120,
                executionTimeMillisEstimate: 61,
            },
            {
                $group: { _id: '$customerId', total: { $sum: '$amount' } },
                nReturned: 312,
                executionTimeMillisEstimate: 80,
            },
            { $sort: { sortKey: { total: -1 }, limit: 10 }, nReturned: 10, executionTimeMillisEstimate: 82 },
        ],
        command: {
            aggregate: 'orders',
            pipeline: [
                { $match: { status: 'shipped' } },
                { $group: { _id: '$customerId', total: { $sum: '$amount' } } },
                { $sort: { total: -1 } },
                { $limit: 10 },
            ],
            cursor: {},
            $db: 'shop',
        },
    },
    count: {
        queryPlanner: {
            namespace: 'shop.orders',
            parsedQuery: { status: { $eq: 'pending' } },
            winningPlan: {
                stage: 'COUNT',
                inputStage: { stage: 'COUNT_SCAN', keyPattern: { status: 1 }, indexName: 'status_1' },
            },
        },
        executionStats: {
            executionSuccess: true,
            nReturned: 0,
            executionTimeMillis: 3,
            totalKeysExamined: 1290,
            totalDocsExamined: 0,
            executionStages: {
                stage: 'COUNT',
                nReturned: 0,
                nCounted: 1289,
                inputStage: { stage: 'COUNT_SCAN', nReturned: 1289, keysExamined: 1290, indexName: 'status_1' },
            },
        },
        command: { count: 'orders', query: { status: 'pending' }, $db: 'shop' },
    },
};

export function samplePlan(command: SampleCommand): string {
    return JSON.stringify(samples[command], undefined, 2);
}

export interface ShellSnippet {
    readonly id: string;
    /** Command name shown beside the snippet; not translated, it is shell syntax. */
    readonly label: string;
    readonly code: string;
}

/** What to run in the DocumentDB shell or mongosh. Shell syntax, so never localized. */
export const explainSnippets: readonly ShellSnippet[] = [
    { id: 'find', label: 'find', code: 'db.orders.find({ status: "shipped" }).sort({ orderDate: -1 }).explain("executionStats")' },
    {
        id: 'aggregate',
        label: 'aggregate',
        code: 'db.orders.explain("executionStats").aggregate([\n  { $match: { status: "shipped" } },\n  { $group: { _id: "$customerId", total: { $sum: "$amount" } } }\n])',
    },
    { id: 'count', label: 'count', code: 'db.orders.explain("executionStats").count({ status: "pending" })' },
];

export const contextSnippets: readonly ShellSnippet[] = [
    { id: 'stats', label: 'stats', code: 'db.orders.stats()' },
    { id: 'indexes', label: 'getIndexes', code: 'db.orders.getIndexes()' },
];
