/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Result formatter for AI-enhanced feature testing
 */

import * as fs from 'fs';
import * as path from 'path';

/**
 * Test execution result for a single test case
 */
export interface TestResult {
    // Test case ID
    testId: string;
    // Collection name
    collectionName: string;
    // Original query
    query: string;
    // Expected result (if provided)
    expectedResult?: string;
    // Success status
    success: boolean;
    // Error message (if failed)
    error?: string;
    // Collection statistics (from optimization result)
    collectionStats?: string;
    // Index statistics (from optimization result)
    indexStats?: string;
    // Execution plan (from optimization result)
    executionPlan?: string;
    // Query performance before optimization (milliseconds)
    queryPerformance?: number;
    // AI-generated suggestions
    suggestions?: string;
    // AI-generated analysis
    analysis?: string;
    // Query performance after applying suggestions (milliseconds)
    updatedPerformance?: number;
    // Additional notes
    notes?: string;
    // Model used for AI generation
    modelUsed?: string;
}

/**
 * Formats test results as CSV
 * @param results Array of test results
 * @returns CSV string
 */
export function formatResultsAsCSV(results: Array<TestResult>): string {
    const headers = [
        'Test ID',
        'Collection Name',
        'Query',
        'Expected Result',
        'Success',
        'Error',
        'Collection Stats',
        'Index Stats',
        'Execution Plan',
        'Query Performance (ms)',
        'Suggestions',
        'Analysis',
        'Updated Performance (ms)',
        'Model Used',
        'Notes',
    ];

    const rows: Array<string> = [headers.join(',')];

    for (const result of results) {
        const row = [
            escapeCSV(result.testId),
            escapeCSV(result.collectionName),
            escapeCSV(result.query),
            escapeCSV(result.expectedResult || ''),
            result.success ? 'PASS' : 'FAIL',
            escapeCSV(result.error || ''),
            escapeCSV(result.collectionStats || ''),
            escapeCSV(result.indexStats || ''),
            escapeCSV(result.executionPlan || ''),
            result.queryPerformance?.toFixed(2) || '',
            escapeCSV(result.suggestions || ''),
            escapeCSV(result.analysis || ''),
            result.updatedPerformance?.toFixed(2) || '',
            escapeCSV(result.modelUsed || ''),
            escapeCSV(result.notes || ''),
        ];

        rows.push(row.join(','));
    }

    return rows.join('\n');
}

/**
 * Escapes a value for CSV format
 * @param value Value to escape
 * @returns Escaped value
 */
function escapeCSV(value: string): string {
    if (value === null || value === undefined) {
        return '';
    }

    const stringValue = String(value);

    // If the value contains comma, newline, or quotes, wrap it in quotes
    if (stringValue.includes(',') || stringValue.includes('\n') || stringValue.includes('"')) {
        // Escape quotes by doubling them
        return `"${stringValue.replace(/"/g, '""')}"`;
    }

    return stringValue;
}

/**
 * Writes test results to a CSV file
 * @param results Array of test results
 * @param outputPath Path to the output file
 */
export function writeResultsToFile(results: Array<TestResult>, outputPath: string): void {
    try {
        const csvContent = formatResultsAsCSV(results);
        const absolutePath = path.resolve(outputPath);

        // Ensure output directory exists
        const outputDir = path.dirname(absolutePath);
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        fs.writeFileSync(absolutePath, csvContent, 'utf-8');
        console.log(`Test results written to: ${absolutePath}`);
    } catch (error) {
        throw new Error(`Failed to write results to file: ${error instanceof Error ? error.message : String(error)}`);
    }
}

/**
 * Formats test results as a summary report
 * @param results Array of test results
 * @returns Summary report string
 */
export function formatSummaryReport(results: Array<TestResult>): string {
    const total = results.length;
    const passed = results.filter((r) => r.success).length;
    const failed = total - passed;
    const passRate = total > 0 ? ((passed / total) * 100).toFixed(2) : '0.00';

    const lines: Array<string> = [
        '='.repeat(60),
        'AI-Enhanced Feature Test Summary',
        '='.repeat(60),
        `Total Tests: ${total}`,
        `Passed: ${passed}`,
        `Failed: ${failed}`,
        `Pass Rate: ${passRate}%`,
        '='.repeat(60),
    ];

    if (failed > 0) {
        lines.push('', 'Failed Tests:');
        for (const result of results.filter((r) => !r.success)) {
            lines.push(`  - ${result.testId}: ${result.error || 'Unknown error'}`);
        }
    }

    // Performance statistics for index advisor tests
    const perfResults = results.filter((r) => r.success && r.queryPerformance !== undefined);
    if (perfResults.length > 0) {
        lines.push('', 'Performance Statistics:');

        const avgBefore = perfResults.reduce((sum, r) => sum + (r.queryPerformance || 0), 0) / perfResults.length;
        lines.push(`  Average Query Performance (before): ${avgBefore.toFixed(2)} ms`);

        const withImprovement = perfResults.filter((r) => r.updatedPerformance !== undefined);
        if (withImprovement.length > 0) {
            const avgAfter =
                withImprovement.reduce((sum, r) => sum + (r.updatedPerformance || 0), 0) / withImprovement.length;
            const improvement = avgBefore > 0 ? (((avgBefore - avgAfter) / avgBefore) * 100).toFixed(2) : '0.00';
            lines.push(`  Average Query Performance (after): ${avgAfter.toFixed(2)} ms`);
            lines.push(`  Average Improvement: ${improvement}%`);
        }
    }

    lines.push('='.repeat(60));

    return lines.join('\n');
}
