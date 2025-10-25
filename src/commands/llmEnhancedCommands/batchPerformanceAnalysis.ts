/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { CopilotService } from '../../services/copilotService';
import { FALLBACK_MODELS, PREFERRED_MODEL } from './promptTemplates';

/**
 * Simplified input parameters for performance analysis
 */
export interface SimplifiedPerformanceInput {
    query: string;
    collectionName: string;
    beforeExecutionPlan: Record<string, unknown>;
    beforeExecutionTimeMs: number;
    beforeIndexes: Array<Record<string, unknown>>;
    afterExecutionPlan: Record<string, unknown>;
    afterExecutionTimeMs: number;
    indexSuggestions: string;
}

/**
 * Result from simplified performance analysis
 */
export interface SimplifiedPerformanceResult {
    summary: string;
    modelUsed: string;
    performanceChange: number;
    performanceChangePercent: number;
}

/**
 * Test case from the test results JSON
 */
export interface TestCase {
    collectionName: string;
    query: string;
    queryPerformance: number;
    updatedPerformance?: number | null;
    executionPlan: Record<string, unknown>;
    updatedExecutionPlan?: Record<string, unknown> | null;
    indexStats: Array<Record<string, unknown>>;
    suggestions?: string | null;
}

/**
 * Test results file structure
 */
export interface TestResults {
    metadata: {
        totalTests: number;
        successfulTests: number;
        failedTests: number;
    };
    results: TestCase[];
}

/**
 * Analyzes performance for a single test case with simplified inputs
 * @param context Action context for telemetry
 * @param input Simplified performance input
 * @returns Performance analysis result
 */
export async function analyzePerformanceSimplified(
    context: IActionContext,
    input: SimplifiedPerformanceInput,
): Promise<SimplifiedPerformanceResult> {
    // Check if Copilot is available
    const copilotAvailable = await CopilotService.isAvailable();
    if (!copilotAvailable) {
        throw new Error(
            l10n.t(
                'GitHub Copilot is not available. Please install the GitHub Copilot extension and ensure you have an active subscription.',
            ),
        );
    }

    // Build the prompt
    const promptContent = buildSimplifiedPrompt(input);

    // Send to Copilot with configured models
    const response = await CopilotService.sendMessage([vscode.LanguageModelChatMessage.User(promptContent)], {
        preferredModel: PREFERRED_MODEL,
        fallbackModels: FALLBACK_MODELS,
    });

    // Calculate performance metrics
    const timeDiff = input.afterExecutionTimeMs - input.beforeExecutionTimeMs;
    const percentChange = (timeDiff / input.beforeExecutionTimeMs) * 100;

    // Add telemetry
    context.telemetry.properties.modelUsed = response.modelUsed;
    context.telemetry.measurements.performanceChange = timeDiff;

    return {
        summary: response.text,
        modelUsed: response.modelUsed,
        performanceChange: timeDiff,
        performanceChangePercent: percentChange,
    };
}

/**
 * Builds a simplified prompt for performance analysis
 * @param input Simplified performance input
 * @returns The prompt string
 */
function buildSimplifiedPrompt(input: SimplifiedPerformanceInput): string {
    const timeDiff = input.afterExecutionTimeMs - input.beforeExecutionTimeMs;
    const percentChange = (timeDiff / input.beforeExecutionTimeMs) * 100;
    const performanceChange = timeDiff < 0 ? 'improved' : timeDiff > 0 ? 'degraded' : 'remained the same';

    return `You are a MongoDB performance analysis expert. Analyze the performance change between two query executions and provide a concise summary.

## Query Information
**Collection:** ${input.collectionName}
**Query:**
\`\`\`javascript
${input.query}
\`\`\`

## Performance Metrics
**Before Execution Time:** ${input.beforeExecutionTimeMs.toFixed(2)} ms
**After Execution Time:** ${input.afterExecutionTimeMs.toFixed(2)} ms
**Time Difference:** ${timeDiff > 0 ? '+' : ''}${timeDiff.toFixed(2)} ms (${percentChange > 0 ? '+' : ''}${percentChange.toFixed(1)}%)
**Performance Change:** ${performanceChange}

## Before Execution Plan
\`\`\`json
${JSON.stringify(input.beforeExecutionPlan, null, 2)}
\`\`\`

## After Execution Plan
\`\`\`json
${JSON.stringify(input.afterExecutionPlan, null, 2)}
\`\`\`

## Index Changes Applied
${input.indexSuggestions || 'No index changes specified'}

## Before Indexes
\`\`\`json
${JSON.stringify(input.beforeIndexes, null, 2)}
\`\`\`

## Instructions
Analyze the performance change and provide a concise summary in **1-2 sentences** that explains:

1. **If performance improved (execution time decreased):** Explain why the index changes or query plan changes resulted in better performance. Focus on specific improvements like better index utilization, reduced document scans, or more efficient query plan stages.

2. **If performance remained the same:** Explain why the changes did not impact performance. This could be due to the query already being optimized, the indexes not being used by the query, or the dataset being too small to show meaningful differences.

3. **If performance degraded (execution time increased):** Explain why the changes resulted in worse performance. This could be due to index overhead, suboptimal index selection, planning overhead, or other factors that increased query execution time.

**Format requirements:**
- Use clear, technical language
- Reference specific metrics from the execution plans (e.g., "totalKeysExamined", "totalDocsExamined", "executionTimeMillis")
- Keep the summary concise (1-2 sentences maximum)
- Focus on the most important factor(s) affecting performance
- Use markdown formatting for readability

**Output only the summary text - no additional explanation or headers.**
`;
}

/**
 * Processes a test results file and generates performance summaries for all valid test cases
 * @param context Action context for telemetry
 * @param testResults Test results object
 * @returns Array of performance analysis results with test case info
 */
export async function processBatchPerformanceAnalysis(
    context: IActionContext,
    testResults: TestResults,
): Promise<
    Array<{
        testCase: TestCase;
        result: SimplifiedPerformanceResult | null;
        error?: string;
    }>
> {
    const results: Array<{
        testCase: TestCase;
        result: SimplifiedPerformanceResult | null;
        error?: string;
    }> = [];

    for (const testCase of testResults.results) {
        // Check if all required fields are present
        if (
            !testCase.executionPlan ||
            !testCase.updatedExecutionPlan ||
            testCase.queryPerformance === undefined ||
            testCase.updatedPerformance === undefined ||
            testCase.updatedPerformance === null ||
            !testCase.indexStats
        ) {
            results.push({
                testCase,
                result: null,
                error: 'Missing required fields for performance analysis',
            });
            continue;
        }

        try {
            const input: SimplifiedPerformanceInput = {
                query: testCase.query,
                collectionName: testCase.collectionName,
                beforeExecutionPlan: testCase.executionPlan,
                beforeExecutionTimeMs: testCase.queryPerformance,
                beforeIndexes: testCase.indexStats,
                afterExecutionPlan: testCase.updatedExecutionPlan,
                afterExecutionTimeMs: testCase.updatedPerformance,
                indexSuggestions: testCase.suggestions || 'No suggestions provided',
            };

            const result = await analyzePerformanceSimplified(context, input);
            results.push({
                testCase,
                result,
            });
        } catch (error) {
            results.push({
                testCase,
                result: null,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    return results;
}
