/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'node:fs';
import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { MongoClient } from 'mongodb';
import {
    optimizeQuery,
    CommandType,
    type QueryOptimizationContext,
    type OptimizationResult,
} from './indexAdvisorCommands';
import { ClusterSession } from '../../documentdb/ClusterSession';
import { ClustersClient } from '../../documentdb/ClustersClient';
import { type CollectionStats, type IndexStats } from '../../documentdb/LlmEnhancedFeatureApis';

/**
 * Configuration for CSV batch testing
 */
export interface CSVTestConfig {
    // MongoDB connection string
    connectionString: string;
    // Database name where test collections are located
    databaseName: string;
    // Optional: preferred LLM model for testing
    preferredModel?: string;
    // Optional: fallback LLM models
    fallbackModels?: string[];
}

/**
 * A single test case from the CSV file
 */
export interface CSVTestCase {
    // Category of the test
    category: string;
    // Name of the test case
    testCase: string;
    // Tags for grouping/filtering tests
    tags: string;
    // Collection name to test against
    collection: string;
    // Whether this is a positive or negative test case
    positiveNegative: string;
    // MongoDB query to execute
    query: string;
    // Expected index advisor suggestion
    expectedSuggestion: string;
    // Explanation of why this suggestion is expected
    explanation: string;
    // Additional comments
    comment: string;
}

/**
 * Results from running a test case
 */
export interface CSVTestResult extends CSVTestCase {
    // Actual execution plan retrieved
    executionPlan: string;
    // Actual suggestion from Index Advisor
    actualSuggestion: string;
    // Whether the test passed (actual matches expected)
    testPassed: boolean;
    // Any error that occurred during testing
    error?: string;
}

/**
 * Parse CSV line into fields, handling quoted fields with commas
 */
function parseCSVLine(line: string): string[] {
    const fields: string[] = [];
    let currentField = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const char = line[i];

        if (char === '"') {
            inQuotes = !inQuotes;
        } else if (char === '|' && !inQuotes) {
            fields.push(currentField.trim());
            currentField = '';
        } else {
            currentField += char;
        }
    }

    // Add the last field
    fields.push(currentField.trim());

    return fields;
}

/**
 * Parse CSV file into test cases
 */
export function parseCSVTestCases(csvContent: string): CSVTestCase[] {
    const lines = csvContent.split('\n').filter((line) => line.trim() !== '');

    if (lines.length === 0) {
        throw new Error('CSV file is empty');
    }

    // Skip header line
    const dataLines = lines.slice(1);

    const testCases: CSVTestCase[] = [];

    for (const line of dataLines) {
        const fields = parseCSVLine(line);

        if (fields.length < 9) {
            console.warn(`Skipping malformed line: ${line}`);
            continue;
        }

        testCases.push({
            category: fields[0],
            testCase: fields[1],
            tags: fields[2],
            collection: fields[3],
            positiveNegative: fields[4],
            query: fields[5],
            expectedSuggestion: fields[6],
            explanation: fields[7],
            comment: fields[8],
        });
    }

    return testCases;
}

/**
 * Format test results as CSV output
 */
export function formatTestResultsAsCSV(results: CSVTestResult[]): string {
    const header =
        'Category | Test Case | Tags | Collection | Positive/Negative | Query | Expected Index Advisor Suggestion | Explanation | Comment | Execution Plan | Actual Suggestion | Test Passed | Error\n';

    const rows = results.map((result) => {
        const fields = [
            result.category,
            result.testCase,
            result.tags,
            result.collection,
            result.positiveNegative,
            result.query,
            result.expectedSuggestion,
            result.explanation,
            result.comment,
            result.executionPlan.replace(/\n/g, ' ').replace(/\|/g, '\\|'),
            result.actualSuggestion.replace(/\n/g, ' ').replace(/\|/g, '\\|'),
            result.testPassed ? 'PASS' : 'FAIL',
            result.error || '',
        ];

        return fields.join(' | ');
    });

    return header + rows.join('\n');
}

/**
 * Run a single test case
 */
async function runTestCase(
    context: IActionContext,
    testCase: CSVTestCase,
    config: CSVTestConfig,
    sessionId: string,
): Promise<CSVTestResult> {
    let executionPlan = '';
    let actualSuggestion = '';
    let testPassed = false;
    let error: string | undefined;

    try {
        // Parse the query to determine command type
        const commandType = detectCommandTypeFromQuery(testCase.query);

        // Build query optimization context
        const queryContext: QueryOptimizationContext = {
            sessionId,
            databaseName: config.databaseName,
            collectionName: testCase.collection,
            commandType,
            query: testCase.query,
            preferredModel: config.preferredModel,
            fallbackModels: config.fallbackModels,
        };

        // Run query optimization
        const result: OptimizationResult = await optimizeQuery(context, queryContext);

        actualSuggestion = result.recommendations;

        // Get execution plan for recording
        const session = ClusterSession.getSession(sessionId);
        const client = session.getClient();

        try {
            const explainData = await executeQueryWithExplain(
                client,
                config.databaseName,
                testCase.collection,
                testCase.query,
                commandType,
            );
            executionPlan = JSON.stringify(explainData, null, 2);
        } catch (explainError) {
            executionPlan = `Error getting execution plan: ${explainError instanceof Error ? explainError.message : String(explainError)}`;
        }

        // Compare actual suggestion with expected
        testPassed = compareSuggestions(actualSuggestion, testCase.expectedSuggestion);
    } catch (err) {
        error = err instanceof Error ? err.message : String(err);
        testPassed = false;
    }

    return {
        ...testCase,
        executionPlan,
        actualSuggestion,
        testPassed,
        error,
    };
}

/**
 * Detect command type from query string
 */
function detectCommandTypeFromQuery(query: string): CommandType {
    const trimmed = query.trim().toLowerCase();

    if (trimmed.includes('.aggregate(') || trimmed.startsWith('[')) {
        return CommandType.Aggregate;
    }

    if (trimmed.includes('.count(') || trimmed.includes('.countdocuments(')) {
        return CommandType.Count;
    }

    if (trimmed.includes('.find(')) {
        return CommandType.Find;
    }

    // Default to Find
    return CommandType.Find;
}

/**
 * Execute query and get explain plan
 */
async function executeQueryWithExplain(
    client: ClustersClient,
    databaseName: string,
    collectionName: string,
    query: string,
    commandType: CommandType,
): Promise<unknown> {
    // For now, we'll use a simplified approach
    // In a real implementation, you'd parse the query properly
    const queryObj = parseQueryForExplain(query);

    if (commandType === CommandType.Find) {
        return await client.explainFind(databaseName, collectionName, queryObj);
    } else if (commandType === CommandType.Aggregate) {
        const pipeline = queryObj.pipeline || [];
        return await client.explainAggregate(databaseName, collectionName, pipeline);
    } else if (commandType === CommandType.Count) {
        const filter = queryObj.filter || {};
        return await client.explainCount(databaseName, collectionName, filter);
    }

    throw new Error(`Unsupported command type: ${commandType}`);
}

/**
 * Parse query string to extract filter, sort, etc.
 * This is a simplified parser - in production you'd use a proper parser
 */
function parseQueryForExplain(query: string): {
    filter?: unknown;
    sort?: unknown;
    projection?: unknown;
    pipeline?: unknown[];
} {
    // Simple regex-based parsing
    // This is a placeholder - you should use proper MongoDB query parsing
    const findMatch = query.match(/\.find\((.*?)\)/s);
    if (findMatch) {
        try {
            const args = findMatch[1].split(',').map((arg) => arg.trim());
            return {
                filter: args[0] ? JSON.parse(args[0]) : {},
                projection: args[1] ? JSON.parse(args[1]) : undefined,
            };
        } catch {
            return { filter: {} };
        }
    }

    return { filter: {} };
}

/**
 * Compare actual suggestion with expected suggestion
 * This is a simple comparison - you might want to make it more sophisticated
 */
function compareSuggestions(actual: string, expected: string): boolean {
    // Normalize strings for comparison
    const normalizeString = (s: string) =>
        s
            .toLowerCase()
            .replace(/\s+/g, ' ')
            .trim();

    const normalizedActual = normalizeString(actual);
    const normalizedExpected = normalizeString(expected);

    // Check if expected is a substring of actual (allows for more detailed responses)
    return normalizedActual.includes(normalizedExpected) || normalizedExpected.includes(normalizedActual);
}

/**
 * Run batch tests from CSV file
 */
export async function runCSVBatchTests(
    context: IActionContext,
    configPath: string,
    inputCSVPath: string,
    outputCSVPath: string,
): Promise<void> {
    // Read and parse config
    const configContent = fs.readFileSync(configPath, 'utf-8');
    const config: CSVTestConfig = JSON.parse(configContent);

    // Read and parse CSV test cases
    const csvContent = fs.readFileSync(inputCSVPath, 'utf-8');
    const testCases = parseCSVTestCases(csvContent);

    console.log(`Loaded ${testCases.length} test cases from ${inputCSVPath}`);

    // Create MongoDB session
    let sessionId: string | undefined;
    try {
        // Create a session with the connection string
        const client = new MongoClient(config.connectionString);
        await client.connect();

        // Create a cluster session (simplified - in production use proper session management)
        sessionId = `csv-test-${Date.now()}`;

        // Initialize ClustersClient with the connection
        // Note: This is a simplified approach - in production you'd properly integrate with ClusterSession

        const results: CSVTestResult[] = [];

        // Run each test case
        for (let i = 0; i < testCases.length; i++) {
            const testCase = testCases[i];
            console.log(`Running test ${i + 1}/${testCases.length}: ${testCase.testCase}`);

            try {
                const result = await runTestCase(context, testCase, config, sessionId);
                results.push(result);

                console.log(`  ${result.testPassed ? '✓ PASS' : '✗ FAIL'}`);
            } catch (err) {
                const error = err instanceof Error ? err.message : String(err);
                console.error(`  Error running test: ${error}`);

                results.push({
                    ...testCase,
                    executionPlan: '',
                    actualSuggestion: '',
                    testPassed: false,
                    error,
                });
            }
        }

        // Write results to output CSV
        const outputCSV = formatTestResultsAsCSV(results);
        fs.writeFileSync(outputCSVPath, outputCSV, 'utf-8');

        console.log(`\nResults written to ${outputCSVPath}`);

        // Print summary
        const passCount = results.filter((r) => r.testPassed).length;
        const failCount = results.length - passCount;
        console.log(`\nSummary: ${passCount} passed, ${failCount} failed out of ${results.length} tests`);

        await client.close();
    } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        throw new Error(`Failed to run batch tests: ${error}`);
    }
}
