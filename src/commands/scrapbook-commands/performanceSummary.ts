/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { findCommandAtPosition, getAllCommandsFromText } from '../../documentdb/scrapbook/ScrapbookHelpers';
import { ScrapbookService } from '../../documentdb/scrapbook/ScrapbookService';
import { analyzePerformance, type PerformanceAnalysisContext } from '../llmEnhancedCommands/performanceAnalysis';

/**
 * Input metadata for a single query execution
 */
export interface QueryMetadata {
    // Query execution plan
    executionPlan: Record<string, unknown>;
    // Query execution time in milliseconds
    executionTimeMs: number;
    // Collection indexes at the time of execution
    indexes: Array<Record<string, unknown>>;
}

/**
 * Generates a performance summary comparing before and after query executions
 * @param context Action context for telemetry
 * @param position Optional position to locate the command (when called from CodeLens)
 */
export async function generatePerformanceSummaryCommand(
    context: IActionContext,
    position?: vscode.Position,
): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        throw new Error(l10n.t('No active editor found. Please open a scrapbook file.'));
    }

    if (editor.document.languageId !== 'vscode-documentdb-scrapbook-language') {
        throw new Error(l10n.t('This command can only be run from a DocumentDB scrapbook.'));
    }

    if (!ScrapbookService.isConnected()) {
        throw new Error(
            l10n.t('No database connection selected. Please connect to a database first using the "Connect" command.'),
        );
    }

    // Get the selected text
    let selectedText: string;

    if (position) {
        // Called from CodeLens - get the command at the specific position
        const commands = getAllCommandsFromText(editor.document.getText());
        const command = findCommandAtPosition(commands, position);
        selectedText = command.text;
    } else {
        // Called manually - use selection or current line
        selectedText = editor.document.getText(editor.selection);
        if (!selectedText || selectedText.trim().length === 0) {
            // If no selection, try to get the current command/line
            const currentPosition = editor.selection.active;
            const lineText = editor.document.lineAt(currentPosition.line).text;
            selectedText = lineText;
        }
    }

    if (!selectedText || selectedText.trim().length === 0) {
        throw new Error(l10n.t('Please select a query or place the cursor on a query line.'));
    }

    // Prompt for before and after metadata
    const beforeMetadata = await promptForMetadata('before');
    const afterMetadata = await promptForMetadata('after');

    // Get connection information from ScrapbookService
    const clusterId = ScrapbookService.getClusterId();
    if (!clusterId) {
        throw new Error(l10n.t('Failed to get cluster connection information.'));
    }

    const databaseName = ScrapbookService.getDatabaseName();
    const collectionName = await promptForCollection();

    if (!databaseName || !collectionName) {
        throw new Error(l10n.t('Database and collection names are required for performance analysis.'));
    }

    // Build the performance analysis context
    const analysisContext: PerformanceAnalysisContext = {
        clusterId,
        databaseName,
        collectionName,
        query: selectedText.trim(),
        beforeMetadata,
        afterMetadata,
    };

    // Show progress while analyzing
    const result = await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: l10n.t('Analyzing performance changes...'),
            cancellable: false,
        },
        async () => {
            return analyzePerformance(context, analysisContext);
        },
    );

    // Display the summary
    await displayPerformanceSummary(result.summary, result.modelUsed, analysisContext);
}

/**
 * Prompts the user for query metadata (execution plan, time, and indexes)
 * @param label Label to identify the metadata (e.g., "before" or "after")
 * @returns Query metadata
 */
async function promptForMetadata(label: string): Promise<QueryMetadata> {
    // Prompt for execution plan
    const planInput = await vscode.window.showInputBox({
        prompt: l10n.t('Enter the {label} query execution plan (JSON format)', { label }),
        placeHolder: l10n.t('{"executionStats": {...}}'),
        ignoreFocusOut: true,
        validateInput: (value) => {
            if (!value || value.trim().length === 0) {
                return l10n.t('Execution plan cannot be empty');
            }
            try {
                JSON.parse(value);
            } catch {
                return l10n.t('Execution plan must be valid JSON');
            }
            return undefined;
        },
    });

    if (!planInput) {
        throw new Error(l10n.t('Execution plan is required'));
    }

    // Prompt for execution time
    const timeInput = await vscode.window.showInputBox({
        prompt: l10n.t('Enter the {label} query execution time in milliseconds', { label }),
        placeHolder: l10n.t('150'),
        ignoreFocusOut: true,
        validateInput: (value) => {
            if (!value || value.trim().length === 0) {
                return l10n.t('Execution time cannot be empty');
            }
            const num = parseFloat(value);
            if (isNaN(num) || num < 0) {
                return l10n.t('Execution time must be a positive number');
            }
            return undefined;
        },
    });

    if (!timeInput) {
        throw new Error(l10n.t('Execution time is required'));
    }

    // Prompt for indexes
    const indexesInput = await vscode.window.showInputBox({
        prompt: l10n.t('Enter the {label} collection indexes (JSON array format)', { label }),
        placeHolder: l10n.t('[{"name": "idx_name", "key": {"field": 1}}]'),
        ignoreFocusOut: true,
        validateInput: (value) => {
            if (!value || value.trim().length === 0) {
                return l10n.t('Indexes cannot be empty');
            }
            try {
                const parsed: unknown = JSON.parse(value);
                if (!Array.isArray(parsed)) {
                    return l10n.t('Indexes must be a JSON array');
                }
            } catch {
                return l10n.t('Indexes must be valid JSON');
            }
            return undefined;
        },
    });

    if (!indexesInput) {
        throw new Error(l10n.t('Indexes are required'));
    }

    return {
        executionPlan: JSON.parse(planInput) as Record<string, unknown>,
        executionTimeMs: parseFloat(timeInput),
        indexes: JSON.parse(indexesInput) as Array<Record<string, unknown>>,
    };
}

/**
 * Prompts the user for a collection name
 * @returns Collection name
 */
async function promptForCollection(): Promise<string> {
    const collectionName = await vscode.window.showInputBox({
        prompt: l10n.t('Enter the collection name'),
        placeHolder: l10n.t('myCollection'),
        ignoreFocusOut: true,
        validateInput: (value) => {
            if (!value || value.trim().length === 0) {
                return l10n.t('Collection name cannot be empty');
            }
            return undefined;
        },
    });

    if (!collectionName) {
        throw new Error(l10n.t('Collection name is required'));
    }

    return collectionName.trim();
}

/**
 * Displays the performance summary
 * @param summary The performance summary text
 * @param modelUsed The model that was used
 * @param analysisContext The analysis context
 */
async function displayPerformanceSummary(
    summary: string,
    modelUsed: string,
    analysisContext: PerformanceAnalysisContext,
): Promise<void> {
    // Calculate performance change
    const timeDiff = analysisContext.afterMetadata.executionTimeMs - analysisContext.beforeMetadata.executionTimeMs;
    const percentChange =
        ((analysisContext.afterMetadata.executionTimeMs - analysisContext.beforeMetadata.executionTimeMs) /
            analysisContext.beforeMetadata.executionTimeMs) *
        100;

    const performanceStatus = timeDiff < 0 ? '✅ Improved' : timeDiff > 0 ? '⚠️ Degraded' : '➖ No Change';

    // Create a markdown document with the summary
    const markdownContent = `# Performance Analysis Summary

**Database:** \`${analysisContext.databaseName}\`
**Collection:** \`${analysisContext.collectionName}\`
**Model Used:** ${modelUsed}

---

## Performance Change

| Metric | Before | After | Change |
|--------|--------|-------|--------|
| Execution Time | ${analysisContext.beforeMetadata.executionTimeMs.toFixed(2)} ms | ${analysisContext.afterMetadata.executionTimeMs.toFixed(2)} ms | ${timeDiff > 0 ? '+' : ''}${timeDiff.toFixed(2)} ms (${percentChange > 0 ? '+' : ''}${percentChange.toFixed(1)}%) |
| Status | - | - | ${performanceStatus} |

---

## Analysis

${summary}

---

## Query

\`\`\`javascript
${analysisContext.query}
\`\`\`

---

## Before Execution Plan

<details>
<summary>Click to expand</summary>

\`\`\`json
${JSON.stringify(analysisContext.beforeMetadata.executionPlan, null, 2)}
\`\`\`

</details>

## After Execution Plan

<details>
<summary>Click to expand</summary>

\`\`\`json
${JSON.stringify(analysisContext.afterMetadata.executionPlan, null, 2)}
\`\`\`

</details>

---

## Index Changes

### Before Indexes

<details>
<summary>Click to expand</summary>

\`\`\`json
${JSON.stringify(analysisContext.beforeMetadata.indexes, null, 2)}
\`\`\`

</details>

### After Indexes

<details>
<summary>Click to expand</summary>

\`\`\`json
${JSON.stringify(analysisContext.afterMetadata.indexes, null, 2)}
\`\`\`

</details>

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
        l10n.t('Performance analysis generated successfully using {model}', { model: modelUsed }),
    );
}
