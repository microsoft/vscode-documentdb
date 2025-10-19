/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { type DocumentDBExtensionApi } from '../../api/src';
import { CommandType } from '../../src/commands/llmEnhancedCommands/optimizeCommands';
import { ClustersClient } from '../../src/documentdb/ClustersClient';
import { readConfig, readTestCases, writeResultsCSV } from './csvUtils';
import { type TestCase, type TestConfig, type TestResult } from './types';

/**
 * Gets the DocumentDB extension API with testing support
 * @returns The extension API with testing methods
 */
async function getTestingApi(): Promise<DocumentDBExtensionApi> {
    const extension = vscode.extensions.getExtension('ms-azuretools.vscode-documentdb');
    if (!extension) {
        throw new Error('DocumentDB extension not found');
    }

    if (!extension.isActive) {
        await extension.activate();
    }

    const api = extension.exports as DocumentDBExtensionApi;
    if (!api.testing) {
        throw new Error('Testing API is not available. Set VSCODE_DOCUMENTDB_TESTING_API=true');
    }

    return api;
}

/**
 * Measures the execution time of a query
 * @param clusterId Cluster ID
 * @param databaseName Database name
 * @param collectionName Collection name
 * @param query Query string
 * @param commandType Type of command (find, aggregate, count)
 * @returns Execution time in milliseconds
 */
async function measureQueryPerformance(
    clusterId: string,
    databaseName: string,
    collectionName: string,
    query: string,
    commandType: CommandType,
): Promise<number> {
    const client = await ClustersClient.getClient(clusterId);
    const startTime = Date.now();

    try {
        // Execute the query based on type
        if (commandType === CommandType.Find) {
            // Use runQuery method which handles find operations
            await client.runQuery(databaseName, collectionName, query, 0, 100);
        } else if (commandType === CommandType.Aggregate) {
            // For aggregation, we need to use the MongoDB client directly
            // This is a simplified approach - in real scenarios, we'd need better parsing
            const mongoClient = (
                client as unknown as {
                    _mongoClient: {
                        db: (name: string) => {
                            collection: (name: string) => {
                                aggregate: (pipeline: unknown[]) => { toArray: () => Promise<unknown[]> };
                            };
                        };
                    };
                }
            )._mongoClient;
            const collection = mongoClient.db(databaseName).collection(collectionName);

            // Simple parse for aggregation pipeline
            const pipelineMatch = query.match(/\.aggregate\s*\(\s*(\[[\s\S]*\])\s*\)/);
            const pipeline: unknown[] = pipelineMatch ? (JSON.parse(pipelineMatch[1]) as unknown[]) : [];
            await collection.aggregate(pipeline).toArray();
        } else if (commandType === CommandType.Count) {
            // For count, use MongoDB client directly
            const mongoClient = (
                client as unknown as {
                    _mongoClient: {
                        db: (name: string) => {
                            collection: (name: string) => { countDocuments: (filter: unknown) => Promise<number> };
                        };
                    };
                }
            )._mongoClient;
            const collection = mongoClient.db(databaseName).collection(collectionName);

            // Parse the filter from count query
            const filterMatch = query.match(/\.count(?:Documents)?\s*\(\s*(\{[\s\S]*?\})\s*\)/);
            const filter = filterMatch ? JSON.parse(filterMatch[1]) : {};
            await collection.countDocuments(filter);
        }
    } catch (error) {
        // Log error but still return the time
        console.error(`Error executing query: ${error instanceof Error ? error.message : String(error)}`);
    }

    const endTime = Date.now();
    return endTime - startTime;
}

/**
 * Warm up the connection by running a simple query
 * @param clusterId Cluster ID
 * @param databaseName Database name
 * @param collectionName Collection name
 * @param warmupCount Number of warm-up queries to run
 */
async function warmupConnection(
    clusterId: string,
    databaseName: string,
    collectionName: string,
    warmupCount: number,
): Promise<void> {
    const client = await ClustersClient.getClient(clusterId);

    for (let i = 0; i < warmupCount; i++) {
        try {
            await client.runQuery(databaseName, collectionName, '{}', 0, 1);
        } catch {
            // Ignore errors during warmup
        }
    }
}

/**
 * Extracts suggestions from the AI recommendations
 * Looks for MongoDB shell queries in the recommendations
 * @param recommendations Full AI recommendations text
 * @returns Extracted suggestions
 */
function extractSuggestions(recommendations: string): string {
    // Try to find code blocks with MongoDB queries
    const codeBlockRegex = /```(?:javascript|js|mongodb)?\n([\s\S]*?)\n```/g;
    const matches = [...recommendations.matchAll(codeBlockRegex)];

    if (matches.length > 0) {
        return matches.map((match) => match[1].trim()).join('\n\n');
    }

    // If no code blocks, look for create index commands
    const createIndexRegex = /db\.[^.]+\.createIndex\([^)]+\)/g;
    const indexMatches = [...recommendations.matchAll(createIndexRegex)];

    if (indexMatches.length > 0) {
        return indexMatches.map((match) => match[0]).join('\n');
    }

    // Return a section of the recommendations if no specific patterns found
    return recommendations.substring(0, 500);
}

/**
 * Runs a single test case
 * @param api Testing API
 * @param config Test configuration
 * @param testCase Test case to run
 * @param context Action context
 * @returns Test result
 */
async function runTestCase(
    api: DocumentDBExtensionApi,
    config: TestConfig,
    testCase: TestCase,
    context: IActionContext,
): Promise<TestResult> {
    const result: TestResult = {
        testCase,
        collectionStats: '',
        indexStats: '',
        executionPlan: '',
        queryPerformance: 0,
        suggestions: '',
        analysis: '',
        updatedPerformance: undefined,
        notes: '',
        passed: false,
    };

    try {
        // Detect command type
        const commandType = api.testing!.detectCommandType(testCase.query);

        // Get cluster client
        const client = await ClustersClient.getClient(config.clusterId!);

        // Warm up connection
        await warmupConnection(
            config.clusterId!,
            config.databaseName,
            testCase.collectionName,
            config.warmupCount || 3,
        );

        // Measure original query performance
        result.queryPerformance = await measureQueryPerformance(
            config.clusterId!,
            config.databaseName,
            testCase.collectionName,
            testCase.query,
            commandType,
        );

        // Get collection and index stats
        const collectionStats = await client.getCollectionStats(config.databaseName, testCase.collectionName);
        const indexStats = await client.getIndexStats(config.databaseName, testCase.collectionName);

        result.collectionStats = JSON.stringify(collectionStats, null, 2);
        result.indexStats = JSON.stringify(indexStats, null, 2);

        // Run optimization
        const optimizationResult = await api.testing!.optimizeQuery(context, {
            clusterId: config.clusterId!,
            databaseName: config.databaseName,
            collectionName: testCase.collectionName,
            query: testCase.query,
            commandType,
        });

        // Extract execution plan from the recommendations (it's embedded in the explain output)
        result.executionPlan = 'See full recommendations for execution plan details';
        result.suggestions = extractSuggestions(optimizationResult.recommendations);
        result.analysis = optimizationResult.recommendations;

        // TODO: Apply suggestions and measure updated performance
        // This would require parsing and executing the suggestions
        result.updatedPerformance = undefined;
        result.notes = `Successfully executed. Model used: ${optimizationResult.modelUsed}`;
        result.passed = true;
    } catch (error) {
        result.notes = `Error: ${error instanceof Error ? error.message : String(error)}`;
        result.passed = false;
    }

    return result;
}

/**
 * Runs all test cases from the configuration
 * @param configPath Path to the configuration file
 */
export async function runAIEnhancedTests(configPath: string): Promise<void> {
    console.log('Starting AI Enhanced Tests...');

    // Read configuration
    const config = readConfig(configPath);
    console.log(`Configuration loaded from: ${configPath}`);

    // Read test cases
    const testCases = readTestCases(config.csvFilePath);
    console.log(`Loaded ${testCases.length} test cases from: ${config.csvFilePath}`);

    // Get testing API
    const api = await getTestingApi();
    console.log('Testing API ready');

    // Set up cluster connection if needed
    if (!config.clusterId) {
        throw new Error('Cluster ID must be provided in the configuration');
    }

    // Create action context
    const context: IActionContext = {
        telemetry: {
            properties: {},
            measurements: {},
        },
        errorHandling: {
            suppressDisplay: false,
            rethrow: true,
            suppressReportIssue: true,
            issueProperties: {},
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
        valuesToMask: [] as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
        ui: {} as any,
    };

    // Run all test cases
    const results: TestResult[] = [];
    for (let i = 0; i < testCases.length; i++) {
        const testCase = testCases[i];
        console.log(`Running test ${i + 1}/${testCases.length}: ${testCase.collectionName} - ${testCase.query}`);

        const result = await runTestCase(api, config, testCase, context);
        results.push(result);

        console.log(`  Result: ${result.passed ? 'PASSED' : 'FAILED'}`);
        if (!result.passed) {
            console.log(`  Notes: ${result.notes}`);
        }
    }

    // Write results to CSV
    const csvResults = results.map((r) => ({
        collectionName: r.testCase.collectionName,
        query: r.testCase.query,
        expectedResult: r.testCase.expectedResult,
        collectionStats: r.collectionStats,
        indexStats: r.indexStats,
        executionPlan: r.executionPlan,
        queryPerformance: r.queryPerformance,
        suggestions: r.suggestions,
        analysis: r.analysis,
        updatedPerformance: r.updatedPerformance,
        notes: r.notes,
    }));

    writeResultsCSV(csvResults, config.outputCsvPath);
    console.log(`Results written to: ${config.outputCsvPath}`);

    // Summary
    const passedCount = results.filter((r) => r.passed).length;
    console.log(`\nSummary: ${passedCount}/${results.length} tests passed`);
}
