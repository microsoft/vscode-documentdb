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
 * Metadata for a single query execution
 */
export interface QueryMetadata {
    executionPlan: Record<string, unknown>;
    executionTimeMs: number;
    indexes: Array<Record<string, unknown>>;
}

/**
 * Context for performance analysis
 */
export interface PerformanceAnalysisContext {
    clusterId: string;
    databaseName: string;
    collectionName: string;
    query: string;
    beforeMetadata: QueryMetadata;
    afterMetadata: QueryMetadata;
}

/**
 * Result from performance analysis
 */
export interface PerformanceAnalysisResult {
    summary: string;
    modelUsed: string;
}

/**
 * Analyzes performance changes between two query executions
 * @param context Action context for telemetry
 * @param analysisContext Performance analysis context
 * @returns Performance analysis result
 */
export async function analyzePerformance(
    context: IActionContext,
    analysisContext: PerformanceAnalysisContext,
): Promise<PerformanceAnalysisResult> {
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
    const promptContent = buildPerformanceAnalysisPrompt(analysisContext);

    // Send to Copilot with configured models
    const response = await CopilotService.sendMessage([vscode.LanguageModelChatMessage.User(promptContent)], {
        preferredModel: PREFERRED_MODEL,
        fallbackModels: FALLBACK_MODELS,
    });

    // Check if the preferred model was used
    if (response.modelUsed !== PREFERRED_MODEL && PREFERRED_MODEL) {
        // Show warning if not using preferred model
        void vscode.window.showWarningMessage(
            l10n.t(
                'Performance analysis is using model "{actualModel}" instead of preferred "{preferredModel}". Analysis may be less optimal.',
                {
                    actualModel: response.modelUsed,
                    preferredModel: PREFERRED_MODEL,
                },
            ),
        );
    }

    // Add telemetry for the model used
    context.telemetry.properties.modelUsed = response.modelUsed;

    return {
        summary: response.text,
        modelUsed: response.modelUsed,
    };
}

/**
 * Builds the prompt for performance analysis
 * @param context Performance analysis context
 * @returns The prompt string
 */
function buildPerformanceAnalysisPrompt(context: PerformanceAnalysisContext): string {
    const timeDiff = context.afterMetadata.executionTimeMs - context.beforeMetadata.executionTimeMs;
    const percentChange =
        ((context.afterMetadata.executionTimeMs - context.beforeMetadata.executionTimeMs) /
            context.beforeMetadata.executionTimeMs) *
        100;

    const performanceChange = timeDiff < 0 ? 'improved' : timeDiff > 0 ? 'degraded' : 'remained the same';

    const indexChanges = analyzeIndexChanges(context.beforeMetadata.indexes, context.afterMetadata.indexes);

    return `You are a MongoDB performance analysis expert. Analyze the performance change between two query executions and provide a concise summary.

## Query Information
**Database:** ${context.databaseName}
**Collection:** ${context.collectionName}
**Query:**
\`\`\`javascript
${context.query}
\`\`\`

## Performance Metrics
**Before Execution Time:** ${context.beforeMetadata.executionTimeMs.toFixed(2)} ms
**After Execution Time:** ${context.afterMetadata.executionTimeMs.toFixed(2)} ms
**Time Difference:** ${timeDiff > 0 ? '+' : ''}${timeDiff.toFixed(2)} ms (${percentChange > 0 ? '+' : ''}${percentChange.toFixed(1)}%)
**Performance Change:** ${performanceChange}

## Before Execution Plan
\`\`\`json
${JSON.stringify(context.beforeMetadata.executionPlan, null, 2)}
\`\`\`

## After Execution Plan
\`\`\`json
${JSON.stringify(context.afterMetadata.executionPlan, null, 2)}
\`\`\`

## Index Changes
${indexChanges}

## Instructions
Analyze the performance change and provide a concise summary in **1-2 sentences** that explains:

1. **If performance improved (execution time decreased):** Explain why the index changes or query plan changes resulted in better performance. Focus on specific improvements like better index utilization, reduced document scans, or more efficient query plan stages.

2. **If performance remained the same (difference less than 5% percentage):** Explain why the changes did not impact performance. This could be due to the query already being optimized, the indexes not being used by the query, or the dataset being too small to show meaningful differences.

3. **If performance degraded (execution time increased):** Explain why the changes resulted in worse performance. This could be due to index overhead, suboptimal index selection, or other factors that increased query execution time.

**Format requirements:**
- Analyze the performance change based on the indexes changes
- Reference specific metrics from the execution plans (e.g., "keysExamined", "docsExamined", "executionTimeMillis")
- Keep the summary concise (1-2 sentences maximum)
- Focus on the most important factor(s) affecting performance
- Use markdown formatting for readability
- Calculate the performance gain percentage. If the updated execution time is smaller, then the percentage is positive.

**Output only the summary text - no additional explanation or headers.**
`;
}

/**
 * Analyzes changes between two sets of indexes
 * @param beforeIndexes Indexes before
 * @param afterIndexes Indexes after
 * @returns Description of index changes
 */
function analyzeIndexChanges(
    beforeIndexes: Array<Record<string, unknown>>,
    afterIndexes: Array<Record<string, unknown>>,
): string {
    const beforeIndexNames = new Set(beforeIndexes.map((idx) => (idx.name as string) || ''));
    const afterIndexNames = new Set(afterIndexes.map((idx) => (idx.name as string) || ''));

    const added: string[] = [];
    const removed: string[] = [];

    // Find added indexes
    afterIndexNames.forEach((name) => {
        if (!beforeIndexNames.has(name)) {
            added.push(name);
        }
    });

    // Find removed indexes
    beforeIndexNames.forEach((name) => {
        if (!afterIndexNames.has(name)) {
            removed.push(name);
        }
    });

    if (added.length === 0 && removed.length === 0) {
        return 'No index changes detected.';
    }

    let result = '';
    if (added.length > 0) {
        result += `**Added indexes:** ${added.join(', ')}\n`;
    }
    if (removed.length > 0) {
        result += `**Removed indexes:** ${removed.join(', ')}\n`;
    }

    return result;
}
