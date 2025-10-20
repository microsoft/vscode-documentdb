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
    // Cluster connection ID (optional if connectionString is provided)
    clusterId?: string;
    // Connection string (optional if clusterId is provided)
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
    warmupQuery?: string;
    // Connection timeout in milliseconds
    connectionTimeout?: number;
    // Query timeout in milliseconds
    queryTimeout?: number;
}

/**
 * A single test case
 */
export interface TestCase {
    // Collection name
    collectionName: string;
    // Query to optimize
    query: string;
    // Expected result (Mongo shell command)
    expectedResult: string;
    // Notes about the test case
    notes?: string;
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
}

/**
 * Result from a single test case execution
 */
export interface TestResult {
    // Test case information
    collectionName: string;
    query: string;
    expectedResult: string;
    notes?: string;

    // Metadata collected
    collectionStats?: string; // JSON string
    indexStats?: string; // JSON string
    executionPlan?: string; // JSON string

    // Performance metrics
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

    // Timestamp
    timestamp?: string;
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
