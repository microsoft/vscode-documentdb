/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Type definitions for the Index Advisor testing framework
 */

/**
 * Configuration for the test runner
 */
export interface TestConfig {
    // Cluster connection ID
    clusterId?: string;
    // Connection string
    connectionString?: string;
    // Target database name
    databaseName: string;
    // Preferred LLM model
    preferredModel?: string;
    // Fallback models
    fallbackModels?: string[];
    // Path to custom prompt template
    promptTemplatePath?: string;
    // Query to warm up the connection
    shouldWarmup?: boolean;
    // Connection timeout in milliseconds
    connectionTimeout?: number;
    // Query timeout in milliseconds
    queryTimeout?: number;
}

/**
 * A single test case
 */
export interface TestCase {
    // Test case name (directory name or from CSV)
    testCaseName: string;
    // Collection name
    collectionName: string;
    // Category of the test case
    category: string;
    // Scenario description
    scenarioDescription: string;
    // Pre-loaded execution plan (directory-based mode)
    executionPlan?: unknown;
    // Pre-loaded collection stats (directory-based mode)
    collectionStats?: unknown;
    // Pre-loaded index stats (directory-based mode)
    indexStats?: unknown[];
    // Query string (csv-based mode)
    query?: string;
    // Additional notes
    notes?: string;
    // Expected result (Mongo shell command)
    expectedResult: string;
    // Tags (CSV mode)
    tags?: string;
    // Positive/Negative test type (CSV mode)
    testType?: string;
    // Explanation (CSV mode)
    explanation?: string;
    // Current Index (CSV mode)
    currentIndex?: string;
    // Comment (CSV mode)
    comment?: string;
}

/**
 * Performance measurement result
 */
export interface PerformanceMeasurement {
    // Execution time in milliseconds
    executionTime: number;
    // Number of documents examined
    docsExamined?: number;
    // Number of keys examined
    keysExamined?: number;
    // Whether index was used
    indexUsed?: string;
    // Execution plan (JSON string)
    executionPlan?: string;
}

/**
 * Result from a single test case execution
 */
export interface TestResult {
    // Test case information
    testCaseName: string;
    collectionName: string;
    category: string;
    scenarioDescription: string;
    expectedResult: string;
    query?: string; // csv-based mode query

    // Metadata collected
    collectionStats?: string; // JSON string
    indexStats?: string; // JSON string
    executionPlan?: string; // JSON string
    updatedExecutionPlan?: string; // JSON string (csv-based mode with performance measurement)

    // Performance metrics (csv-based mode only)
    queryPerformance?: number; // ms
    updatedPerformance?: number; // ms
    performanceImprovement?: number; // percentage

    // AI-generated results
    suggestions?: string; // Mongo shell commands
    analysis?: string;
    modelUsed?: string;

    // Validation
    matchesExpected?: boolean;

    // Errors
    errors?: string;

    // Additional notes
    notes?: string;

    // Timestamp
    timestamp?: string;

    // CSV mode additional fields
    tags?: string;
    testType?: string;
    explanation?: string;
    currentIndex?: string;
    comment?: string;
}

/**
 * Summary statistics for a test run
 */
export interface TestRunSummary {
    totalTests: number;
    successfulTests: number;
    failedTests: number;
    averagePerformanceImprovement: number;
    matchRate: number; // Percentage of tests matching expected results
    totalDuration: number; // ms
    modelUsage: Record<string, number>; // Model -> count
}
