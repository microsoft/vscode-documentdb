/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Configuration for AI enhanced feature tests
 */
export interface TestConfig {
    /**
     * Connection string for the cluster
     */
    connectionString: string;

    /**
     * Cluster ID (if connection already exists)
     */
    clusterId?: string;

    /**
     * Database name to test against
     */
    databaseName: string;

    /**
     * Preferred AI model to use
     */
    preferredModel?: string;

    /**
     * Path to custom prompt file (optional)
     */
    promptFilePath?: string;

    /**
     * Path to CSV file with test cases
     */
    csvFilePath: string;

    /**
     * Path to output CSV file for results
     */
    outputCsvPath: string;

    /**
     * Number of warm-up queries to run before measuring performance
     */
    warmupCount?: number;
}

/**
 * A single test case from the CSV file
 */
export interface TestCase {
    /**
     * Collection name to test
     */
    collectionName: string;

    /**
     * Query to test
     */
    query: string;

    /**
     * Expected result/behavior
     */
    expectedResult: string;
}

/**
 * Results from a single test execution
 */
export interface TestResult {
    /**
     * The test case that was executed
     */
    testCase: TestCase;

    /**
     * Collection statistics
     */
    collectionStats: string;

    /**
     * Index statistics
     */
    indexStats: string;

    /**
     * Execution plan from explain()
     */
    executionPlan: string;

    /**
     * Performance metrics of original query (in milliseconds)
     */
    queryPerformance: number;

    /**
     * AI suggestions for improvement
     */
    suggestions: string;

    /**
     * AI analysis
     */
    analysis: string;

    /**
     * Performance after applying suggestions (in milliseconds)
     */
    updatedPerformance?: number;

    /**
     * Notes or error messages
     */
    notes: string;

    /**
     * Whether the test passed
     */
    passed: boolean;
}
