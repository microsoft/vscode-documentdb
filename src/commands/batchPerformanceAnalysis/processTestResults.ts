/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { processBatchPerformanceAnalysis, type TestResults } from '../llmEnhancedCommands/batchPerformanceAnalysis';

/**
 * Processes a test results JSON file and generates performance summaries for all test cases
 * @param context Action context for telemetry
 */
export async function processTestResultsCommand(context: IActionContext): Promise<void> {
    // Prompt user to select a JSON file
    const fileUris = await vscode.window.showOpenDialog({
        canSelectMany: false,
        filters: {
            'JSON Files': ['json'],
            'All Files': ['*'],
        },
        openLabel: l10n.t('Select Test Results File'),
    });

    if (!fileUris || fileUris.length === 0) {
        throw new Error(l10n.t('No file selected'));
    }

    const fileUri = fileUris[0];

    // Read and parse the JSON file
    let testResults: TestResults;
    try {
        const fileContent = await vscode.workspace.fs.readFile(fileUri);
        const textContent = Buffer.from(fileContent).toString('utf8');
        testResults = JSON.parse(textContent) as TestResults;
    } catch (error) {
        throw new Error(
            l10n.t('Failed to read or parse JSON file: {error}', {
                error: error instanceof Error ? error.message : String(error),
            }),
        );
    }

    // Validate the structure
    if (!testResults.results || !Array.isArray(testResults.results)) {
        throw new Error(l10n.t('Invalid test results file format. Expected "results" array.'));
    }

    // Show progress while processing
    const results = await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: l10n.t('Processing test results...'),
            cancellable: false,
        },
        async (progress) => {
            const totalTests = testResults.results.length;
            const analysisResults: Array<{
                testCase: (typeof testResults.results)[0];
                result: Awaited<ReturnType<typeof processBatchPerformanceAnalysis>>[0]['result'];
                error?: string;
            }> = [];

            for (let i = 0; i < testResults.results.length; i++) {
                progress.report({
                    message: l10n.t('Analyzing test case {current}/{total}', {
                        current: (i + 1).toString(),
                        total: totalTests.toString(),
                    }),
                    increment: 100 / totalTests,
                });

                const testCase = testResults.results[i];

                // Check if all required fields are present
                if (
                    !testCase.executionPlan ||
                    !testCase.updatedExecutionPlan ||
                    testCase.queryPerformance === undefined ||
                    testCase.updatedPerformance === undefined ||
                    testCase.updatedPerformance === null ||
                    !testCase.indexStats
                ) {
                    analysisResults.push({
                        testCase,
                        result: null,
                        error: 'Missing required fields for performance analysis',
                    });
                    continue;
                }

                // Process this test case
                const batch = await processBatchPerformanceAnalysis(context, {
                    metadata: testResults.metadata,
                    results: [testCase],
                });

                analysisResults.push(batch[0]);
            }

            return analysisResults;
        },
    );

    // Generate a summary report
    await displayBatchResults(results, fileUri.fsPath);
}

/**
 * Displays the batch analysis results in a markdown document
 * @param results Analysis results
 * @param sourceFile Source file path
 */
async function displayBatchResults(
    results: Array<{
        testCase: {
            collectionName: string;
            query: string;
            queryPerformance: number;
            updatedPerformance?: number | null;
        };
        result: {
            summary: string;
            performanceChange: number;
            performanceChangePercent: number;
            modelUsed: string;
        } | null;
        error?: string;
    }>,
    sourceFile: string,
): Promise<void> {
    let successCount = 0;
    let skipCount = 0;
    let errorCount = 0;

    const markdownContent = `# Batch Performance Analysis Report

**Source File:** \`${sourceFile}\`
**Total Test Cases:** ${results.length}
**Generated:** ${new Date().toISOString()}

---

## Summary

${results
    .map((item, index) => {
        if (item.result) {
            successCount++;
            const status =
                item.result.performanceChange < 0
                    ? '✅ Improved'
                    : item.result.performanceChange > 0
                      ? '⚠️ Degraded'
                      : '➖ No Change';
            return `### Test Case ${index + 1}: ${item.testCase.collectionName}

**Query:**
\`\`\`javascript
${item.testCase.query}
\`\`\`

**Performance Change:** ${status}
- Before: ${item.testCase.queryPerformance.toFixed(2)} ms
- After: ${item.testCase.updatedPerformance?.toFixed(2) ?? 'N/A'} ms
- Difference: ${item.result.performanceChange > 0 ? '+' : ''}${item.result.performanceChange.toFixed(2)} ms (${item.result.performanceChangePercent > 0 ? '+' : ''}${item.result.performanceChangePercent.toFixed(1)}%)

**Analysis:**

${item.result.summary}

**Model Used:** ${item.result.modelUsed}

---
`;
        } else if (item.error) {
            if (item.error.includes('Missing required fields')) {
                skipCount++;
                return `### Test Case ${index + 1}: ${item.testCase.collectionName} ⏭️ SKIPPED

**Query:**
\`\`\`javascript
${item.testCase.query}
\`\`\`

**Reason:** ${item.error}

---
`;
            } else {
                errorCount++;
                return `### Test Case ${index + 1}: ${item.testCase.collectionName} ❌ ERROR

**Query:**
\`\`\`javascript
${item.testCase.query}
\`\`\`

**Error:** ${item.error}

---
`;
            }
        }
        return '';
    })
    .join('\n')}

## Statistics

| Metric | Count |
|--------|-------|
| Total Test Cases | ${results.length} |
| Successfully Analyzed | ${successCount} |
| Skipped (Missing Data) | ${skipCount} |
| Errors | ${errorCount} |

---

*Generated by DocumentDB Performance Analyzer powered by GitHub Copilot*
`;

    const document = await vscode.workspace.openTextDocument({
        content: markdownContent,
        language: 'markdown',
    });

    await vscode.window.showTextDocument(document, {
        viewColumn: vscode.ViewColumn.Beside,
        preview: false,
    });

    void vscode.window.showInformationMessage(
        l10n.t('Batch performance analysis complete: {success} analyzed, {skipped} skipped, {errors} errors', {
            success: successCount.toString(),
            skipped: skipCount.toString(),
            errors: errorCount.toString(),
        }),
    );
}
