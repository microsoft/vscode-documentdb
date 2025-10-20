/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import {
    CommandType,
    detectCommandType,
    optimizeQuery,
    type QueryOptimizationContext,
} from '../../src/commands/llmEnhancedCommands/optimizeCommands';
import { ClustersClient } from '../../src/documentdb/ClustersClient';
import { type PerformanceMeasurement, type TestCase, type TestConfig, type TestResult } from './types';

/**
 * Progress callback function type
 */
export type ProgressCallback = (message: string) => void;

/**
 * Executes a single test case
 * @param testCase The test case to execute
 * @param config Test configuration
 * @param context Action context for telemetry
 * @param skipPerformance Whether to skip performance measurements
 * @param progress Optional progress callback
 * @returns Test result
 */
export async function executeTestCase(
    testCase: TestCase,
    config: TestConfig,
    context: IActionContext,
    skipPerformance: boolean = false,
    progress?: ProgressCallback,
): Promise<TestResult> {
    const result: TestResult = {
        collectionName: testCase.collectionName,
        query: testCase.query,
        expectedResult: testCase.expectedResult,
        notes: testCase.notes,
        timestamp: new Date().toISOString(),
    };

    try {
        progress?.(`Detecting command type...`);
        // Detect command type
        const commandType = detectCommandType(testCase.query);

        // Validate clusterId is provided
        if (!config.clusterId) {
            throw new Error('clusterId is required in configuration');
        }

        progress?.(`Building query context...`);
        // Build query optimization context
        const queryContext: QueryOptimizationContext = {
            clusterId: config.clusterId,
            databaseName: config.databaseName,
            collectionName: testCase.collectionName,
            query: testCase.query,
            commandType,
        };

        // Measure initial performance if not skipped
        if (!skipPerformance) {
            progress?.(`Measuring initial query performance...`);
            const initialPerf = await measureQueryPerformance(queryContext, config);
            result.queryPerformance = initialPerf.executionTime;
        }

        progress?.(`Gathering collection and index statistics...`);
        // Validate clusterId is provided (checked earlier, but TypeScript needs explicit check here too)
        if (!config.clusterId) {
            throw new Error('clusterId is required in configuration');
        }

        // Get collection stats and index stats before optimization
        const client = await ClustersClient.getClient(config.clusterId);
        const collectionStats = await client.getCollectionStats(config.databaseName, testCase.collectionName);
        const indexStats = await client.getIndexStats(config.databaseName, testCase.collectionName);

        result.collectionStats = JSON.stringify(collectionStats);
        result.indexStats = JSON.stringify(indexStats);

        progress?.(`Running AI optimization...`);
        // Run optimization
        const optimizationResult = await optimizeQuery(context, queryContext);

        progress?.(`Parsing AI recommendations...`);
        // Parse the optimization recommendations
        try {
            const recommendations = JSON.parse(optimizationResult.recommendations) as {
                metadata?: {
                    executionStats?: unknown;
                };
                analysis?: string;
                improvements?: Array<{
                    mongoShell?: string;
                }>;
            };

            // Extract execution plan
            if (recommendations.metadata?.executionStats) {
                result.executionPlan = JSON.stringify(recommendations.metadata.executionStats);
            }

            // Extract analysis
            result.analysis = recommendations.analysis || '';

            // Extract suggestions (Mongo shell commands)
            if (recommendations.improvements && recommendations.improvements.length > 0) {
                result.suggestions = recommendations.improvements
                    .map((imp) => imp.mongoShell)
                    .filter((cmd) => cmd)
                    .join('\n');

                progress?.(`Comparing with expected results...`);
                // Compare with expected result
                result.matchesExpected = compareWithExpected(result.suggestions, testCase.expectedResult);
            }
        } catch (parseError) {
            // If parsing fails, store raw recommendations
            result.suggestions = optimizationResult.recommendations;
            result.errors = `Failed to parse recommendations: ${parseError instanceof Error ? parseError.message : String(parseError)}`;
        }

        result.modelUsed = optimizationResult.modelUsed;

        progress?.(`✓ Test completed successfully`);
        // Measure performance after applying suggestions (if not skipped and suggestions exist)
        if (!skipPerformance && result.suggestions && result.matchesExpected) {
            try {
                // Note: This would require actually applying the index and re-measuring
                // For now, we'll skip this as it would modify the test database
                // In a real scenario, you might want to:
                // 1. Create the suggested index
                // 2. Measure performance
                // 3. Drop the index
                // result.updatedPerformance = await measureQueryPerformanceAfterIndex(...);

                // Calculate improvement if both measurements exist
                if (result.queryPerformance && result.updatedPerformance) {
                    result.performanceImprovement =
                        ((result.queryPerformance - result.updatedPerformance) / result.queryPerformance) * 100;
                }
            } catch (perfError) {
                // Non-fatal error for performance measurement
                console.warn('Performance measurement after optimization failed:', perfError);
            }
        }
    } catch (error) {
        result.errors = error instanceof Error ? error.message : String(error);
        progress?.(`✗ Test failed: ${result.errors}`);
    }

    return result;
}

/**
 * Measures query performance
 * @param queryContext Query context
 * @param config Test configuration
 * @returns Performance measurement
 */
async function measureQueryPerformance(
    queryContext: QueryOptimizationContext,
    config: TestConfig,
): Promise<PerformanceMeasurement> {
    // Validate clusterId is provided
    if (!queryContext.clusterId) {
        throw new Error('clusterId is required in query context');
    }

    const client = await ClustersClient.getClient(queryContext.clusterId);

    // Warm up connection by listing collections (simple, non-intrusive operation)
    if (config.warmupQuery) {
        try {
            await client.listCollections(config.databaseName);
        } catch {
            // Ignore warmup errors
        }
    }

    const startTime = performance.now();

    try {
        // Execute the query with explain to get execution stats
        let explainResult;

        if (queryContext.commandType === CommandType.Find) {
            explainResult = await client.explainFind(
                queryContext.databaseName,
                queryContext.collectionName,
                { filter: {} }, // This should be parsed from the query
            );
        } else if (queryContext.commandType === CommandType.Aggregate) {
            explainResult = await client.explainAggregate(
                queryContext.databaseName,
                queryContext.collectionName,
                [], // This should be parsed from the query
            );
        } else if (queryContext.commandType === CommandType.Count) {
            explainResult = await client.explainCount(
                queryContext.databaseName,
                queryContext.collectionName,
                {}, // This should be parsed from the query
            );
        }

        const endTime = performance.now();
        const executionTime = endTime - startTime;

        return {
            executionTime,
            docsExamined: explainResult?.executionStats?.totalDocsExamined as number | undefined,
            keysExamined: explainResult?.executionStats?.totalKeysExamined as number | undefined,
        };
    } catch (error) {
        throw new Error(`Performance measurement failed: ${error instanceof Error ? error.message : String(error)}`);
    }
}

/**
 * Compares AI-generated suggestions with expected result
 * @param suggestions AI-generated suggestions
 * @param expected Expected result
 * @returns True if they match
 */
function compareWithExpected(suggestions: string, expected: string): boolean {
    // Normalize both strings for comparison
    const normalizeSuggestion = (str: string) => str.replace(/\s+/g, '').replace(/'/g, '"').toLowerCase();

    const normalizedSuggestions = normalizeSuggestion(suggestions);
    const normalizedExpected = normalizeSuggestion(expected);

    // Check if suggestions contain the expected result
    return normalizedSuggestions.includes(normalizedExpected) || normalizedExpected.includes(normalizedSuggestions);
}

/**
 * Runs warm-up to initialize cluster connection
 * @param config Test configuration
 * @param progress Optional progress callback
 */
export async function warmupConnection(config: TestConfig, progress?: ProgressCallback): Promise<void> {
    if (!config.warmupQuery) {
        return;
    }

    try {
        progress?.(`Warming up connection to ${config.databaseName}...`);

        // Validate clusterId is provided
        if (!config.clusterId) {
            throw new Error('clusterId is required in configuration');
        }

        const client = await ClustersClient.getClient(config.clusterId);
        // Use a simple, non-intrusive operation to warm up the connection
        await client.listCollections(config.databaseName);
        progress?.(`✓ Connection warmed up successfully`);
    } catch (error) {
        progress?.(`⚠ Connection warmup failed: ${error instanceof Error ? error.message : String(error)}`);
    }
}
