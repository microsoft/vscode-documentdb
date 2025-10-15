/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { findCommandAtPosition, getAllCommandsFromText } from '../../documentdb/scrapbook/ScrapbookHelpers';
import { ScrapbookService } from '../../documentdb/scrapbook/ScrapbookService';
import {
    detectCommandType,
    optimizeQuery,
    type QueryOptimizationContext,
} from '../llmEnhancedCommands/optimizeCommands';

/**
 * Structure of the JSON recommendations returned by the optimization service
 */
interface OptimizationRecommendations {
    metadata: {
        collectionName: string;
        collectionStats: Record<string, unknown>;
        indexStats: Array<Record<string, unknown>>;
        executionStats: Record<string, unknown>;
        derived: {
            totalKeysExamined: number | null;
            totalDocsExamined: number | null;
            keysToDocsRatio: number | null;
            usedIndex: string | null;
        };
    };
    analysis: string;
    improvements: Array<{
        action: 'create' | 'drop' | 'none' | 'modify';
        indexSpec: Record<string, number>;
        indexOptions?: Record<string, unknown>;
        mongoShell: string;
        justification: string;
        priority: 'high' | 'medium' | 'low';
        risks?: string;
    }>;
    verification: string[];
}

/**
 * Generates index optimization suggestions for the selected query in a scrapbook
 * @param context Action context for telemetry
 * @param position Optional position to locate the command (when called from CodeLens)
 */
export async function generateIndexSuggestions(context: IActionContext, position?: vscode.Position): Promise<void> {
    // Get the active text editor
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        throw new Error(l10n.t('No active editor found. Please open a scrapbook file.'));
    }

    // Ensure this is a scrapbook document
    if (editor.document.languageId !== 'vscode-documentdb-scrapbook-language') {
        throw new Error(l10n.t('This command can only be run from a DocumentDB scrapbook.'));
    }

    // Check if scrapbook is connected
    if (!ScrapbookService.isConnected()) {
        throw new Error(
            l10n.t('No database connection selected. Please connect to a database first using the "Connect" command.'),
        );
    }

    // Get connection information from ScrapbookService
    const clusterId = ScrapbookService.getClusterId();
    if (!clusterId) {
        throw new Error(l10n.t('Failed to get cluster connection information.'));
    }

    // Get the selected text (query) or the command at the specified position
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

    // Detect the command type
    try {
        detectCommandType(selectedText);
    } catch {
        throw new Error(
            l10n.t(
                'Unable to detect query type. Please ensure the query is a valid find, aggregate, or count command.',
            ),
        );
    }

    const databaseName = ScrapbookService.getDatabaseName();

    // Try to parse collection name from the query first
    let collectionName = parseCollectionNameFromQuery(selectedText.trim());

    // If parsing failed, prompt the user for collection name
    if (!collectionName) {
        collectionName = await promptForCollection();
    }

    if (!databaseName || !collectionName) {
        throw new Error(l10n.t('Database and collection names are required for optimization.'));
    }

    // Build the query optimization context
    const queryContext: QueryOptimizationContext = {
        clusterId,
        databaseName,
        collectionName,
        query: selectedText.trim(),
        commandType: detectCommandType(selectedText.trim()),
    };

    // Show progress while optimizing
    const result = await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: l10n.t('Generating index suggestions...'),
            cancellable: false,
        },
        async () => {
            return optimizeQuery(context, queryContext);
        },
    );

    // Display the recommendations
    await displayRecommendations(result.recommendations, result.modelUsed, queryContext);
}

/**
 * Attempts to parse the collection name from a MongoDB query string
 * @param query The MongoDB query string
 * @returns The collection name if found, otherwise undefined
 */
function parseCollectionNameFromQuery(query: string): string | undefined {
    const trimmed = query.trim();

    // Pattern 1: db.collectionName.method(...)
    // Matches: db.users.find(...), db.orders.aggregate(...), etc.
    const dbPattern = /db\.([a-zA-Z_][a-zA-Z0-9_]*)\.(?:find|aggregate|count|countDocuments)/;
    const dbMatch = trimmed.match(dbPattern);
    if (dbMatch && dbMatch[1]) {
        return dbMatch[1];
    }

    // Pattern 2: collectionName.method(...) without db prefix
    // Matches: users.find(...), orders.aggregate(...), etc.
    const collectionPattern = /^([a-zA-Z_][a-zA-Z0-9_]*)\.(?:find|aggregate|count|countDocuments)/;
    const collectionMatch = trimmed.match(collectionPattern);
    if (collectionMatch && collectionMatch[1]) {
        return collectionMatch[1];
    }

    // Unable to parse collection name
    return undefined;
}

/**
 * Prompts the user for a collection name
 * @returns Collection name
 */
async function promptForCollection(): Promise<string> {
    // Get the collection name from user input
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
 * Displays the optimization recommendations in a new editor tab
 * @param recommendations The recommendations text
 * @param modelUsed The model that was used
 * @param queryContext The query context
 */
async function displayRecommendations(
    recommendations: string,
    modelUsed: string,
    queryContext: QueryOptimizationContext,
): Promise<void> {
    const jsonRecommendations: OptimizationRecommendations = JSON.parse(recommendations) as OptimizationRecommendations;

    // Format improvements section
    const improvementsMarkdown = jsonRecommendations.improvements
        .map((improvement, index) => {
            let section = `### Improvement ${index + 1}: ${improvement.action.toUpperCase()} Index\n\n`;

            section += `**Priority:** ${improvement.priority}\n\n`;
            section += `**Index Specification:**\n\`\`\`javascript\n${JSON.stringify(improvement.indexSpec, null, 2)}\n\`\`\`\n\n`;

            if (improvement.indexOptions && Object.keys(improvement.indexOptions).length > 0) {
                section += `**Index Options:**\n\`\`\`javascript\n${JSON.stringify(improvement.indexOptions, null, 2)}\n\`\`\`\n\n`;
            }

            section += `**Justification:** ${improvement.justification}\n\n`;

            if (improvement.risks) {
                section += `**Risks:** ${improvement.risks}\n\n`;
            }

            section += `**MongoDB Shell Command:**\n\`\`\`javascript\n${improvement.mongoShell}\n\`\`\`\n\n`;

            return section;
        })
        .join('---\n\n');

    // Format verification commands
    const verificationMarkdown = jsonRecommendations.verification
        .map((cmd) => `\`\`\`javascript\n${cmd}\n\`\`\``)
        .join('\n\n');

    // Create a markdown document with the recommendations
    const markdownContent = `# Index Optimization Suggestions

**Database:** \`${queryContext.databaseName}\`
**Collection:** \`${queryContext.collectionName}\`
**Query Type:** \`${queryContext.commandType}\`
**Model Used:** ${modelUsed}

---

## Performance Metrics

| Metric | Value |
|--------|-------|
| Total Keys Examined | ${jsonRecommendations.metadata.derived.totalKeysExamined ?? 'N/A'} |
| Total Docs Examined | ${jsonRecommendations.metadata.derived.totalDocsExamined ?? 'N/A'} |
| Keys to Docs Ratio | ${jsonRecommendations.metadata.derived.keysToDocsRatio?.toFixed(2) ?? 'N/A'} |
| Current Index Used | \`${jsonRecommendations.metadata.derived.usedIndex ?? 'COLLSCAN'}\` |

---

## Analysis

${jsonRecommendations.analysis}

---

## Recommended Improvements

${improvementsMarkdown}

---

## Verification Steps

After applying the changes, use these commands to verify the improvements:

${verificationMarkdown}

---

## Collection Statistics

<details>
<summary>Click to expand collection stats</summary>

\`\`\`json
${JSON.stringify(jsonRecommendations.metadata.collectionStats, null, 2)}
\`\`\`

</details>

## Current Index Statistics

<details>
<summary>Click to expand index stats</summary>

\`\`\`json
${JSON.stringify(jsonRecommendations.metadata.indexStats, null, 2)}
\`\`\`

</details>

## Execution Statistics

<details>
<summary>Click to expand execution stats</summary>

\`\`\`json
${JSON.stringify(jsonRecommendations.metadata.executionStats, null, 2)}
\`\`\`

</details>

---

*Generated by DocumentDB Index Advisor powered by GitHub Copilot*
`;

    // Create a new untitled document
    const document = await vscode.workspace.openTextDocument({
        content: markdownContent,
        language: 'markdown',
    });

    // Show the document in a new editor
    await vscode.window.showTextDocument(document, {
        viewColumn: vscode.ViewColumn.Beside,
        preview: false,
    });

    // Show a success message
    void vscode.window.showInformationMessage(
        l10n.t('Index suggestions generated successfully using {model}', { model: modelUsed }),
    );
}
