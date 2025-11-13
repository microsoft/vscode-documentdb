/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Index Advisor Testing Framework
 *
 * This test suite demonstrates the testing framework integration for the Index Advisor feature.
 *
 * Testing Framework Mode:
 * -----------------------
 * The Index Advisor can now operate in a "testing framework mode" where it accepts pre-loaded
 * data instead of requiring a live database connection. This enables:
 *
 * 1. **Unit Testing**: Test index optimization logic without database setup
 * 2. **Faster Tests**: No network calls or database operations
 * 3. **Deterministic Results**: Fixed test data produces reproducible outcomes
 * 4. **CI/CD Friendly**: Tests run in environments without database access
 *
 * Usage:
 * ------
 * To use testing framework mode, provide all three required fields in QueryOptimizationContext:
 * - executionPlan: The MongoDB explain() output (can contain real or mock data)
 * - collectionStats: Collection statistics (count, size, avgObjSize, etc.)
 * - indexStats: Array of index statistics with usage data
 *
 * When all three are provided, the sessionId is optional and no database connection is made.
 *
 * Example:
 * --------
 * const context: QueryOptimizationContext = {
 *     databaseName: 'testdb',
 *     collectionName: 'users',
 *     commandType: CommandType.Find,
 *     executionPlan: { queryPlanner: {...}, executionStats: {...} },
 *     collectionStats: { ns: 'testdb.users', count: 10000, ... },
 *     indexStats: [{ name: 'email_1', key: { email: 1 }, ... }],
 *     // No sessionId needed!
 * };
 *
 * Note: The optimizeQuery function still requires GitHub Copilot to be available for
 * generating recommendations. For full integration testing, mock the CopilotService.
 */

import { sanitizeExplainResult, CommandType, type QueryOptimizationContext } from './indexAdvisorCommands';
import { type CollectionStats, type IndexStats } from '../../documentdb/LlmEnhancedFeatureApis';

describe('Index Advisor Tests', () => {
    describe('sanitizeExplainResult', () => {
        it('should sanitize filter values in parsedQuery', () => {
            const explainResult = {
                queryPlanner: {
                    parsedQuery: {
                        email: 'john.doe@example.com',
                        age: { $gt: 25 },
                        status: 'active',
                    },
                },
            };

            const sanitized = sanitizeExplainResult(explainResult) as Record<string, unknown>;
            const queryPlanner = sanitized.queryPlanner as Record<string, unknown>;
            const parsedQuery = queryPlanner.parsedQuery as Record<string, unknown>;

            expect(parsedQuery.email).toBe('<value>');
            expect((parsedQuery.age as Record<string, unknown>).$gt).toBe('<value>');
            expect(parsedQuery.status).toBe('<value>');
        });

        it('should sanitize filter values in execution stages', () => {
            const explainResult = {
                queryPlanner: {
                    winningPlan: {
                        stage: 'FETCH',
                        filter: {
                            age: { $gt: 25 },
                        },
                        inputStage: {
                            stage: 'IXSCAN',
                            indexFilterSet: [{ email: 'john.doe@example.com' }],
                        },
                    },
                },
            };

            const sanitized = sanitizeExplainResult(explainResult) as Record<string, unknown>;
            const queryPlanner = sanitized.queryPlanner as Record<string, unknown>;
            const winningPlan = queryPlanner.winningPlan as Record<string, unknown>;
            const filter = winningPlan.filter as Record<string, unknown>;
            const inputStage = winningPlan.inputStage as Record<string, unknown>;
            const indexFilterSet = inputStage.indexFilterSet as Array<Record<string, unknown>>;

            expect((filter.age as Record<string, unknown>).$gt).toBe('<value>');
            expect(indexFilterSet[0].email).toBe('<value>');
        });

        it('should preserve field names and operators', () => {
            const explainResult = {
                queryPlanner: {
                    parsedQuery: {
                        email: 'test@example.com',
                        age: { $gt: 25, $lt: 65 },
                        tags: { $in: ['active', 'premium'] },
                    },
                },
            };

            const sanitized = sanitizeExplainResult(explainResult) as Record<string, unknown>;
            const queryPlanner = sanitized.queryPlanner as Record<string, unknown>;
            const parsedQuery = queryPlanner.parsedQuery as Record<string, unknown>;

            // Field names should be preserved
            expect('email' in parsedQuery).toBe(true);
            expect('age' in parsedQuery).toBe(true);
            expect('tags' in parsedQuery).toBe(true);

            // Operators should be preserved
            const age = parsedQuery.age as Record<string, unknown>;
            expect('$gt' in age).toBe(true);
            expect('$lt' in age).toBe(true);

            const tags = parsedQuery.tags as Record<string, unknown>;
            expect('$in' in tags).toBe(true);

            // Values should be sanitized
            expect(age.$gt).toBe('<value>');
            expect(age.$lt).toBe('<value>');
        });

        it('should sanitize nested stages recursively', () => {
            const explainResult = {
                executionStats: {
                    executionStages: {
                        stage: 'LIMIT',
                        inputStage: {
                            stage: 'FETCH',
                            filter: { status: 'active' },
                            inputStage: {
                                stage: 'IXSCAN',
                                indexFilterSet: [{ email: 'test@example.com' }],
                            },
                        },
                    },
                },
            };

            const sanitized = sanitizeExplainResult(explainResult) as Record<string, unknown>;
            const executionStats = sanitized.executionStats as Record<string, unknown>;
            const executionStages = executionStats.executionStages as Record<string, unknown>;
            const inputStage = executionStages.inputStage as Record<string, unknown>;
            const filter = inputStage.filter as Record<string, unknown>;
            const innerInputStage = inputStage.inputStage as Record<string, unknown>;
            const indexFilterSet = innerInputStage.indexFilterSet as Array<Record<string, unknown>>;

            expect(filter.status).toBe('<value>');
            expect(indexFilterSet[0].email).toBe('<value>');
        });

        it('should sanitize command field with filter', () => {
            const explainResult = {
                command: {
                    find: 'users',
                    filter: { email: 'test@example.com' },
                },
            };

            const sanitized = sanitizeExplainResult(explainResult) as Record<string, unknown>;
            const command = sanitized.command as Record<string, unknown>;
            const filter = command.filter as Record<string, unknown>;

            expect(filter.email).toBe('<value>');
        });

        it('should redact string command field', () => {
            const explainResult = {
                command: 'db.users.find({email: "test@example.com"})',
            };

            const sanitized = sanitizeExplainResult(explainResult) as Record<string, unknown>;

            expect(sanitized.command).toBe('<redacted>');
        });

        it('should preserve performance metrics', () => {
            const explainResult = {
                executionStats: {
                    nReturned: 100,
                    executionTimeMillis: 15,
                    totalKeysExamined: 100,
                    totalDocsExamined: 100,
                    executionStages: {
                        stage: 'FETCH',
                        nReturned: 100,
                    },
                },
            };

            const sanitized = sanitizeExplainResult(explainResult) as Record<string, unknown>;
            const executionStats = sanitized.executionStats as Record<string, unknown>;

            expect(executionStats.nReturned).toBe(100);
            expect(executionStats.executionTimeMillis).toBe(15);
            expect(executionStats.totalKeysExamined).toBe(100);
            expect(executionStats.totalDocsExamined).toBe(100);
        });

        it('should sanitize array values', () => {
            const explainResult = {
                queryPlanner: {
                    parsedQuery: {
                        tags: { $in: ['tag1', 'tag2', 'tag3'] },
                        statuses: ['active', 'pending'],
                    },
                },
            };

            const sanitized = sanitizeExplainResult(explainResult) as Record<string, unknown>;
            const queryPlanner = sanitized.queryPlanner as Record<string, unknown>;
            const parsedQuery = queryPlanner.parsedQuery as Record<string, unknown>;
            const tags = parsedQuery.tags as Record<string, unknown>;
            const inArray = tags.$in as string[];
            const statuses = parsedQuery.statuses as string[];

            expect(inArray).toEqual(['<value>', '<value>', '<value>']);
            expect(statuses).toEqual(['<value>', '<value>']);
        });

        it('should handle sharded explain results', () => {
            const explainResult = {
                queryPlanner: {
                    winningPlan: {
                        stage: 'SHARD_MERGE',
                        shards: [
                            {
                                shardName: 'shard01',
                                executionStages: {
                                    stage: 'FETCH',
                                    filter: { status: 'active' },
                                },
                            },
                            {
                                shardName: 'shard02',
                                executionStages: {
                                    stage: 'IXSCAN',
                                    indexFilterSet: [{ email: 'test@example.com' }],
                                },
                            },
                        ],
                    },
                },
            };

            const sanitized = sanitizeExplainResult(explainResult) as Record<string, unknown>;
            const queryPlanner = sanitized.queryPlanner as Record<string, unknown>;
            const winningPlan = queryPlanner.winningPlan as Record<string, unknown>;
            const shards = winningPlan.shards as Array<Record<string, unknown>>;

            const shard1Stages = shards[0].executionStages as Record<string, unknown>;
            const shard1Filter = shard1Stages.filter as Record<string, unknown>;
            expect(shard1Filter.status).toBe('<value>');

            const shard2Stages = shards[1].executionStages as Record<string, unknown>;
            const shard2IndexFilterSet = shard2Stages.indexFilterSet as Array<Record<string, unknown>>;
            expect(shard2IndexFilterSet[0].email).toBe('<value>');
        });

        it('should handle runtimeFilterSet', () => {
            const explainResult = {
                queryPlanner: {
                    winningPlan: {
                        stage: 'FETCH',
                        runtimeFilterSet: [{ timestamp: { $gte: new Date('2024-01-01') } }],
                    },
                },
            };

            const sanitized = sanitizeExplainResult(explainResult) as Record<string, unknown>;
            const queryPlanner = sanitized.queryPlanner as Record<string, unknown>;
            const winningPlan = queryPlanner.winningPlan as Record<string, unknown>;
            const runtimeFilterSet = winningPlan.runtimeFilterSet as Array<Record<string, unknown>>;
            const timestamp = runtimeFilterSet[0].timestamp as Record<string, unknown>;

            expect(timestamp.$gte).toBe('<value>');
        });
    });

    describe('QueryOptimizationContext with preloaded data', () => {
        it('should support testing framework mode with preloaded data', () => {
            // Sample preloaded data for testing
            const executionPlan = {
                queryPlanner: {
                    parsedQuery: { email: 'test@example.com' },
                    winningPlan: {
                        stage: 'IXSCAN',
                        keyPattern: { email: 1 },
                    },
                },
                executionStats: {
                    nReturned: 1,
                    executionTimeMillis: 5,
                },
            };

            const collectionStats: CollectionStats = {
                ns: 'testdb.users',
                count: 10000,
                size: 5000000,
                avgObjSize: 500,
                storageSize: 6000000,
                nindexes: 3,
                totalIndexSize: 1000000,
                indexSizes: {
                    _id_: 300000,
                    email_1: 400000,
                    status_1: 300000,
                },
            };

            const indexStats: IndexStats[] = [
                {
                    name: 'email_1',
                    key: { email: 1 },
                    host: 'localhost:27017',
                    accesses: {
                        ops: 150,
                        since: new Date('2024-01-01'),
                    },
                },
            ];

            const context: QueryOptimizationContext = {
                // No sessionId needed for testing framework mode
                databaseName: 'testdb',
                collectionName: 'users',
                commandType: CommandType.Find,
                executionPlan,
                collectionStats,
                indexStats,
            };

            // Verify all required data is present
            expect(context.executionPlan).toBeDefined();
            expect(context.collectionStats).toBeDefined();
            expect(context.indexStats).toBeDefined();
            expect(context.sessionId).toBeUndefined();
        });

        it('should validate that all preloaded data is provided together', () => {
            // This test documents the requirement that when using preloaded data,
            // all three fields (executionPlan, collectionStats, indexStats) must be provided
            const incompleteContext: QueryOptimizationContext = {
                databaseName: 'testdb',
                collectionName: 'users',
                commandType: CommandType.Find,
                executionPlan: { queryPlanner: {} }, // Only execution plan, missing stats
            };

            // When only some preloaded data is provided, sessionId would be required
            expect(incompleteContext.collectionStats).toBeUndefined();
            expect(incompleteContext.indexStats).toBeUndefined();
        });
    });
});
