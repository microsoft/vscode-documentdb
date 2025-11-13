/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';
import { type TestCase, type TestConfig, type TestResult } from './types';

/**
 * Loads test configuration from a JSON file
 * @param configPath Path to the configuration file
 * @returns Test configuration
 */
export function loadConfig(configPath: string): TestConfig {
    const configContent = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(configContent) as TestConfig;

    return config;
}

/**
 * Loads test cases from a CSV file
 * Supports the new format with columns: Category, Test Case, Tags, Collection,
 * Positive/Negative, Query, Expected Index Advisor Suggestion, Explanation, Current Index, Comment
 * @param csvPath Path to the CSV file
 * @returns Array of test cases
 */
export function loadTestCases(csvPath: string): TestCase[] {
    const csvContent = fs.readFileSync(csvPath, 'utf-8');
    const lines = csvContent.trim().split('\n');

    if (lines.length < 2) {
        return [];
    }

    // Parse header - support both old and new format
    const header = lines[0].split(',').map((h) => h.trim().toLowerCase());

    // New format column indices
    const categoryIdx = header.findIndex((h) => h === 'category');
    const testCaseIdx = header.findIndex((h) => h === 'test case');
    const tagsIdx = header.findIndex((h) => h === 'tags');
    const collectionIdx = header.findIndex((h) => h === 'collection');
    const testTypeIdx = header.findIndex((h) => h === 'positive / negative' || h === 'positive/negative');
    const queryIdx = header.findIndex((h) => h === 'query');
    const expectedIdx = header.findIndex((h) => h === 'expected index advisor suggestion');
    const explanationIdx = header.findIndex((h) => h === 'explanation');
    const currentIndexIdx = header.findIndex((h) => h === 'current index');
    const commentIdx = header.findIndex((h) => h === 'comment');

    // Old format fallback column indices
    const oldColNameIdx = header.findIndex((h) => h === 'collectionname');
    const oldScenarioIdx = header.findIndex((h) => h === 'scenariodescription');
    const oldExpectedIdx = header.findIndex((h) => h === 'expectedresult');
    const oldNotesIdx = header.findIndex((h) => h === 'notes');

    // Parse rows
    const testCases: TestCase[] = [];
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (!line.trim()) {
            continue;
        }

        // Simple CSV parsing (handles quoted fields)
        const values = parseCSVLine(line);

        // Try new format first
        if (collectionIdx >= 0 && queryIdx >= 0) {
            testCases.push({
                testCaseName: testCaseIdx >= 0 ? values[testCaseIdx] || `test-${i}` : `test-${i}`,
                collectionName: values[collectionIdx] || '',
                category: categoryIdx >= 0 ? values[categoryIdx] || '' : '',
                scenarioDescription: explanationIdx >= 0 ? values[explanationIdx] || '' : '',
                query: values[queryIdx] || '',
                expectedResult: expectedIdx >= 0 ? values[expectedIdx] || '' : '',
                tags: tagsIdx >= 0 ? values[tagsIdx] || '' : undefined,
                testType: testTypeIdx >= 0 ? values[testTypeIdx] || '' : undefined,
                explanation: explanationIdx >= 0 ? values[explanationIdx] || '' : undefined,
                currentIndex: currentIndexIdx >= 0 ? values[currentIndexIdx] || '' : undefined,
                comment: commentIdx >= 0 ? values[commentIdx] || '' : undefined,
            });
        } else if (oldColNameIdx >= 0) {
            // Fall back to old format
            testCases.push({
                testCaseName: `test-${i}`,
                collectionName: values[oldColNameIdx] || '',
                category: categoryIdx >= 0 ? values[categoryIdx] || '' : '',
                scenarioDescription: oldScenarioIdx >= 0 ? values[oldScenarioIdx] || '' : '',
                executionPlan: {},
                collectionStats: {},
                indexStats: [],
                expectedResult: oldExpectedIdx >= 0 ? values[oldExpectedIdx] || '' : '',
                query: queryIdx >= 0 ? values[queryIdx] : undefined,
                notes: oldNotesIdx >= 0 ? values[oldNotesIdx] || '' : undefined,
            });
        }
    }

    return testCases;
}

/**
 * Loads test cases from a directory structure
 * @param rootPath Path to the root directory containing test case folders
 * @returns Array of test cases
 */
export function loadTestCasesFromDirectory(rootPath: string): TestCase[] {
    if (!fs.existsSync(rootPath)) {
        throw new Error(`Test cases directory not found: ${rootPath}`);
    }

    const testCases: TestCase[] = [];
    const entries = fs.readdirSync(rootPath, { withFileTypes: true });

    for (const entry of entries) {
        if (!entry.isDirectory()) {
            continue;
        }

        const testCasePath = path.join(rootPath, entry.name);

        try {
            const testCase = loadSingleTestCase(testCasePath, entry.name);
            testCases.push(testCase);
        } catch (error) {
            console.warn(`Failed to load test case from ${entry.name}:`, error);
        }
    }

    return testCases;
}

/**
 * Loads a single test case from a directory
 * @param testCasePath Path to the test case directory
 * @param testCaseName Name of the test case
 * @returns Test case
 */
function loadSingleTestCase(testCasePath: string, testCaseName: string): TestCase {
    // Load required files
    const executionPlanPath = path.join(testCasePath, 'executionPlan.json');
    const collectionStatsPath = path.join(testCasePath, 'collectionStats.json');
    const indexStatsPath = path.join(testCasePath, 'indexStats.json');
    const descriptionPath = path.join(testCasePath, 'description.json');

    let collectionStats: unknown;
    let indexStats: unknown[] | undefined;

    // Validate required files exist
    if (!fs.existsSync(executionPlanPath)) {
        throw new Error(`Missing executionPlan.json in ${testCaseName}`);
    }
    if (fs.existsSync(collectionStatsPath)) {
        collectionStats = JSON.parse(fs.readFileSync(collectionStatsPath, 'utf-8')) as unknown;
    }
    if (fs.existsSync(indexStatsPath)) {
        indexStats = JSON.parse(fs.readFileSync(indexStatsPath, 'utf-8')) as unknown[];
    }
    if (!fs.existsSync(descriptionPath)) {
        throw new Error(`Missing description.json in ${testCaseName}`);
    }

    // Load and parse JSON files
    const executionPlan = JSON.parse(fs.readFileSync(executionPlanPath, 'utf-8')) as unknown;
    const description = JSON.parse(fs.readFileSync(descriptionPath, 'utf-8')) as {
        collectionName?: string;
        category?: string;
        description?: string;
        expectedResults?: string;
    };

    return {
        testCaseName,
        collectionName: description.collectionName || testCaseName,
        category: description.category || 'unknown',
        scenarioDescription: description.description || '',
        executionPlan,
        collectionStats,
        indexStats,
        expectedResult: description.expectedResults || '',
    };
}

/**
 * Simple CSV line parser that handles quoted fields
 * @param line CSV line to parse
 * @returns Array of values
 */
function parseCSVLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        const nextChar = i < line.length - 1 ? line[i + 1] : '';

        if (char === '"') {
            if (inQuotes && nextChar === '"') {
                // Escaped quote
                current += '"';
                i++; // Skip next quote
            } else {
                // Toggle quote mode
                inQuotes = !inQuotes;
            }
        } else if (char === ',' && !inQuotes) {
            // Field separator
            result.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }

    // Add last field
    result.push(current.trim());

    return result;
}

/**
 * Saves test results to both CSV and JSON files
 * @param results Array of test results
 * @param outputPath Path to the output file (CSV)
 */
export function saveResults(results: TestResult[], outputPath: string): void {
    // Ensure directory exists
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    // Save as CSV
    saveResultsAsCSV(results, outputPath);

    // Save as JSON
    const jsonOutputPath = outputPath.replace(/\.csv$/, '.json');
    saveResultsAsJSON(results, jsonOutputPath);
}

/**
 * Saves test results to a CSV file
 * @param results Array of test results
 * @param outputPath Path to the output CSV file
 */
function saveResultsAsCSV(results: TestResult[], outputPath: string): void {
    const header = [
        'Category',
        'Test Case',
        'Tags',
        'Collection',
        'Positive / Negative',
        'Query',
        'Expected Index Advisor Suggestion',
        'Explanation',
        'Current Index',
        'Comment',
        'Suggested Indexes',
        'If Matches Expected',
        'Analysis',
        'Execution Plan (Sanitized)',
        'Updated Execution Plan',
        'Query Performance (ms)',
        'Updated Performance (ms)',
        'Performance Improvement (%)',
        'Collection Stats',
        'Index Stats',
        'Model Used',
        'Errors',
        'Timestamp',
    ];

    const rows = results.map((result) => [
        escapeCSV(result.category), // Category
        escapeCSV(result.testCaseName), // Test Case
        escapeCSV(result.tags || ''), // Tags
        escapeCSV(result.collectionName), // Collection
        escapeCSV(result.testType || ''), // Positive / Negative
        escapeCSV(result.query || ''), // Query
        escapeCSV(result.expectedResult), // Expected Index Advisor Suggestion
        escapeCSV(result.explanation || result.scenarioDescription), // Explanation
        escapeCSV(result.currentIndex || ''), // Current Index
        escapeCSV(result.comment || result.notes || ''), // Comment
        escapeCSV(result.suggestions || ''), // Suggested Indexes
        result.matchesExpected !== undefined ? result.matchesExpected.toString() : '', // If Matches Expected
        escapeCSV(result.analysis || ''), // Analysis
        escapeCSV(result.executionPlan || ''), // Execution Plan
        escapeCSV(result.updatedExecutionPlan || ''), // Updated Execution Plan
        result.queryPerformance !== undefined ? result.queryPerformance.toFixed(2) : '', // Query Performance
        result.updatedPerformance !== undefined ? result.updatedPerformance.toFixed(2) : '', // Updated Performance
        result.performanceImprovement !== undefined ? result.performanceImprovement.toFixed(2) : '', // Performance Improvement
        escapeCSV(result.collectionStats || ''), // Collection Stats
        escapeCSV(result.indexStats || ''), // Index Stats
        result.modelUsed || '', // Model Used
        escapeCSV(result.errors || ''), // Errors
        result.timestamp || '', // Timestamp
    ]);

    const csvContent = [header.join(','), ...rows.map((row) => row.join(','))].join('\n');
    fs.writeFileSync(outputPath, csvContent, 'utf-8');
}

/**
 * Saves test results to a JSON file
 * @param results Array of test results
 * @param outputPath Path to the output JSON file
 */
function saveResultsAsJSON(results: TestResult[], outputPath: string): void {
    // Parse JSON strings back to objects for the specified fields
    const parsedResults = results.map((result) => ({
        testCaseName: result.testCaseName,
        collectionName: result.collectionName,
        category: result.category,
        scenarioDescription: result.scenarioDescription,
        query: result.query || null,
        expectedResult: result.expectedResult,
        suggestions: result.suggestions || null,
        matchesExpected: result.matchesExpected ?? null,
        collectionStats: result.collectionStats ? JSON.parse(result.collectionStats) : null,
        indexStats: result.indexStats ? JSON.parse(result.indexStats) : null,
        sanitizedExecutionPlan: result.executionPlan ? JSON.parse(result.executionPlan) : null,
        updatedExecutionPlan: result.updatedExecutionPlan ? JSON.parse(result.updatedExecutionPlan) : null,
        queryPerformance: result.queryPerformance ?? null,
        updatedPerformance: result.updatedPerformance ?? null,
        performanceImprovement: result.performanceImprovement ?? null,
        modelUsed: result.modelUsed || null,
        errors: result.errors || null,
        timestamp: result.timestamp || null,
        analysis: result.analysis || null,
        notes: result.notes || null,
    }));

    const jsonContent = {
        metadata: {
            totalTests: results.length,
            successfulTests: results.filter((r) => !r.errors).length,
            failedTests: results.filter((r) => r.errors).length,
            matchingTests: results.filter((r) => r.matchesExpected).length,
            generatedAt: new Date().toISOString(),
        },
        results: parsedResults,
    };

    fs.writeFileSync(outputPath, JSON.stringify(jsonContent, null, 2), 'utf-8');
}

/**
 * Escapes a CSV field value
 * @param value Value to escape
 * @returns Escaped value
 */
function escapeCSV(value: string): string {
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
        return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
}

/**
 * Generates a timestamped output filename
 * @param basePath Base path for the output file
 * @returns Full path with timestamp
 */
export function generateOutputPath(basePath?: string): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const defaultPath = path.join(process.cwd(), `test-results-${timestamp}.csv`);
    return basePath || defaultPath;
}

/**
 * Loads custom prompt template if specified
 * @param promptPath Path to the prompt template file
 * @returns Prompt template content or undefined
 */
export function loadCustomPrompt(promptPath?: string): string | undefined {
    if (!promptPath) {
        return undefined;
    }

    if (!fs.existsSync(promptPath)) {
        throw new Error(`Prompt template file not found: ${promptPath}`);
    }

    return fs.readFileSync(promptPath, 'utf-8');
}

/**
 * Normalizes a Mongo shell command for comparison
 * Removes whitespace and formatting differences
 * @param command Mongo shell command
 * @returns Normalized command
 */
export function normalizeMongoCommand(command: string): string {
    return command
        .replace(/\s+/g, '') // Remove all whitespace
        .replace(/'/g, '"') // Normalize quotes
        .toLowerCase();
}

/**
 * Compares two Mongo shell commands for equality
 * @param actual Actual command
 * @param expected Expected command
 * @returns True if commands match
 */
export function compareMongoCommands(actual: string, expected: string): boolean {
    const normalizedActual = normalizeMongoCommand(actual);
    const normalizedExpected = normalizeMongoCommand(expected);

    return normalizedActual.includes(normalizedExpected) || normalizedExpected.includes(normalizedActual);
}
