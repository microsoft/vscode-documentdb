/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Test executor for AI-enhanced features
 * Coordinates test execution, performance measurement, and result collection
 */

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { detectCommandType } from '../commands/llmEnhancedCommands/optimizeCommands';
import { ClustersClient } from '../documentdb/ClustersClient';
import { type TestCase, type TestConfig } from './configParser';
import { testOptimizeQuery } from './llmTestingInterface';
import { type TestResult } from './resultFormatter';

/**
 * Executes a single test case for query optimization
 * @param context Action context for telemetry
 * @param config Test configuration
 * @param testCase Individual test case
 * @returns Test result
 */
export async function executeOptimizationTest(
    context: IActionContext,
    config: TestConfig,
    testCase: TestCase,
): Promise<TestResult> {
    const result: TestResult = {
        testId: testCase.id,
        collectionName: testCase.collectionName,
        query: testCase.query,
        expectedResult: testCase.expectedResult,
        success: false,
        notes: testCase.notes,
    };

    try {
        // Detect command type
        const commandType = detectCommandType(testCase.query);

        // Initialize connection with a lightweight command to ensure it's ready
        const client = await ClustersClient.getClient(config.connection.clusterId);
        await client.listCollections(config.connection.databaseName);

        // Measure query performance before optimization
        const perfBefore = await measureQueryPerformance(
            client,
            config.connection.databaseName,
            testCase.collectionName,
            testCase.query,
            commandType,
        );
        result.queryPerformance = perfBefore;

        // Execute optimization
        const optimizationResult = await testOptimizeQuery(context, {
            clusterId: config.connection.clusterId,
            databaseName: config.connection.databaseName,
            collectionName: testCase.collectionName,
            query: testCase.query,
            commandType,
        });

        // Parse optimization result to extract different sections
        const parsedResult = parseOptimizationResult(optimizationResult.recommendations);

        result.collectionStats = parsedResult.collectionStats;
        result.indexStats = parsedResult.indexStats;
        result.executionPlan = parsedResult.executionPlan;
        result.suggestions = parsedResult.suggestions;
        result.analysis = parsedResult.analysis;
        result.modelUsed = optimizationResult.modelUsed;

        // If suggestions are available, measure performance after applying them
        if (parsedResult.suggestions) {
            try {
                const perfAfter = await measureQueryPerformance(
                    client,
                    config.connection.databaseName,
                    testCase.collectionName,
                    parsedResult.suggestions,
                    commandType,
                );
                result.updatedPerformance = perfAfter;
            } catch (error) {
                // Performance measurement after suggestions might fail if suggestions are not executable queries
                console.warn(`Could not measure performance after optimization: ${error}`);
            }
        }

        result.success = true;
    } catch (error) {
        result.success = false;
        result.error = error instanceof Error ? error.message : String(error);
    }

    return result;
}

/**
 * Measures query execution performance
 * @param client MongoDB client
 * @param databaseName Database name
 * @param collectionName Collection name
 * @param query Query string
 * @param commandType Command type
 * @returns Execution time in milliseconds
 */
async function measureQueryPerformance(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client: any,
    databaseName: string,
    collectionName: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _query: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
    _commandType: any,
): Promise<number> {
    const startTime = Date.now();

    try {
        // Execute query based on command type
        // This is a simplified version - actual implementation would need to parse and execute the query
        const db = await client.getDatabase(databaseName);
        const collection = db.collection(collectionName);

        // Execute a simple find as a proxy for performance measurement
        // In a real implementation, this would parse and execute the actual query
        await collection.find({}).limit(1).toArray();

        const endTime = Date.now();
        return endTime - startTime;
    } catch (error) {
        console.warn(`Performance measurement failed: ${error}`);
        return -1;
    }
}

/**
 * Parses optimization result to extract different sections
 * @param recommendations Raw recommendations text
 * @returns Parsed sections
 */
function parseOptimizationResult(recommendations: string): {
    collectionStats?: string;
    indexStats?: string;
    executionPlan?: string;
    suggestions?: string;
    analysis?: string;
} {
    const result: {
        collectionStats?: string;
        indexStats?: string;
        executionPlan?: string;
        suggestions?: string;
        analysis?: string;
    } = {};

    try {
        // Try to parse as JSON first
        const jsonResult = JSON.parse(recommendations);

        result.collectionStats = JSON.stringify(jsonResult.collectionStats || jsonResult.collection_stats, null, 2);
        result.indexStats = JSON.stringify(jsonResult.indexStats || jsonResult.index_stats, null, 2);
        result.executionPlan = JSON.stringify(jsonResult.executionPlan || jsonResult.execution_plan, null, 2);
        result.analysis = jsonResult.analysis || jsonResult.recommendations;

        // Extract suggestions (improvements section with Mongo shell queries)
        if (jsonResult.improvements) {
            if (Array.isArray(jsonResult.improvements)) {
                result.suggestions = jsonResult.improvements
                    .map((imp: { query?: string; command?: string }) => imp.query || imp.command)
                    .filter(Boolean)
                    .join('\n');
            } else if (typeof jsonResult.improvements === 'string') {
                result.suggestions = jsonResult.improvements;
            }
        }
    } catch {
        // If not JSON, try to extract sections from markdown/text format
        result.analysis = recommendations;

        // Try to extract code blocks as suggestions
        const codeBlockRegex = /```(?:javascript|js|mongo)?\n([\s\S]*?)```/g;
        const codeBlocks: Array<string> = [];
        let match;

        while ((match = codeBlockRegex.exec(recommendations)) !== null) {
            codeBlocks.push(match[1].trim());
        }

        if (codeBlocks.length > 0) {
            result.suggestions = codeBlocks.join('\n\n');
        }
    }

    return result;
}

/**
 * Executes multiple test cases in batch
 * @param context Action context for telemetry
 * @param config Test configuration
 * @param testCases Array of test cases
 * @param progressCallback Optional callback for progress updates
 * @returns Array of test results
 */
export async function executeBatchTests(
    context: IActionContext,
    config: TestConfig,
    testCases: Array<TestCase>,
    progressCallback?: (current: number, total: number, testCase: TestCase) => void,
): Promise<Array<TestResult>> {
    const results: Array<TestResult> = [];

    for (let i = 0; i < testCases.length; i++) {
        const testCase = testCases[i];

        if (progressCallback) {
            progressCallback(i + 1, testCases.length, testCase);
        }

        const result = await executeOptimizationTest(context, config, testCase);
        results.push(result);

        // Add a small delay between tests to avoid overwhelming the system
        await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    return results;
}
