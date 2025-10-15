/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { ClustersClient } from '../../documentdb/ClustersClient';
import { ScrapbookService } from '../../documentdb/scrapbook/ScrapbookService';
import {
    generateQuery,
    QueryGenerationContext,
    QueryGenerationType,
} from '../llmEnhancedCommands/generateCommands';

/**
 * Generates a MongoDB query from natural language input
 * @param context Action context for telemetry
 * @param position Optional position to locate the command (when called from CodeLens)
 */
export async function generateQueryCommand(context: IActionContext, position?: vscode.Position): Promise<void> {
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

    const databaseName = ScrapbookService.getDatabaseName();
    if (!databaseName) {
        throw new Error(l10n.t('Database name is required. Please connect to a database first.'));
    }

    // Determine insertion position (next line after the position/selection)
    let insertPosition: vscode.Position;
    if (position) {
        // Called from CodeLens - insert below the line with the description
        insertPosition = new vscode.Position(position.line + 1, 0);
    } else {
        // Called from command palette - insert below current selection/cursor
        insertPosition = new vscode.Position(editor.selection.active.line + 1, 0);
    }

    // Get natural language query from the line text at the position (if called from CodeLens)
    // or from user selection (if called from command palette)
    let naturalLanguageQuery: string = '';

    if (position) {
        // Called from CodeLens - get the text at the specific line
        // Remove comment markers if present
        let lineText = editor.document.lineAt(position.line).text.trim();

        // Remove leading comment markers (// or #)
        if (lineText.startsWith('//')) {
            lineText = lineText.substring(2).trim();
        } else if (lineText.startsWith('#')) {
            lineText = lineText.substring(1).trim();
        }

        naturalLanguageQuery = lineText;
    }

    // If still no text found, prompt user for input
    if (naturalLanguageQuery.trim().length === 0) {
        const userInput = await vscode.window.showInputBox({
            prompt: l10n.t('Describe the query you want to generate'),
            placeHolder: l10n.t('e.g., Find all users who signed up in the last 7 days'),
            ignoreFocusOut: true,
            validateInput: (value) => {
                if (!value || value.trim().length === 0) {
                    return l10n.t('Please enter a query description');
                }
                return undefined;
            },
        });

        if (!userInput) {
            return; // User cancelled
        }

        naturalLanguageQuery = userInput.trim();
    }

    // Ask if user wants to specify a collection
    const collectionChoice = await vscode.window.showQuickPick(
        [
            {
                label: l10n.t('$(database) All collections'),
                description: l10n.t('Generate query that may work across multiple collections'),
                collectionName: undefined,
            },
            {
                label: l10n.t('$(folder) Specific collection'),
                description: l10n.t('Generate query for a specific collection'),
                collectionName: 'SELECT',
            },
        ],
        {
            placeHolder: l10n.t('Choose query scope'),
            ignoreFocusOut: true,
        },
    );

    if (!collectionChoice) {
        return; // User cancelled
    }

    let collectionName: string | undefined;
    let generationType: QueryGenerationType;

    if (collectionChoice.collectionName === 'SELECT') {
        // Get list of collections
        const client = await ClustersClient.getClient(clusterId);
        const collections = await client.listCollections(databaseName);

        if (collections.length === 0) {
            throw new Error(l10n.t('No collections found in database {db}', { db: databaseName }));
        }

        // Prompt user to select a collection
        const selectedCollection = await vscode.window.showQuickPick(
            collections.map((col) => ({
                label: col.name,
                description: col.type,
            })),
            {
                placeHolder: l10n.t('Select a collection'),
                ignoreFocusOut: true,
            },
        );

        if (!selectedCollection) {
            return; // User cancelled
        }

        collectionName = selectedCollection.label;
        generationType = QueryGenerationType.SingleCollection;
    } else {
        // Cross-collection query
        collectionName = undefined;
        generationType = QueryGenerationType.CrossCollection;
    }

    // Build the query generation context
    const queryContext: QueryGenerationContext = {
        clusterId,
        databaseName,
        collectionName,
        naturalLanguageQuery: naturalLanguageQuery.trim(),
        generationType,
    };

    // Show progress while generating
    const result = await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: l10n.t('Generating query...'),
            cancellable: false,
        },
        async () => {
            return generateQuery(context, queryContext);
        },
    );

    // Insert the generated query into the editor at the determined position
    await insertGeneratedQuery(editor, result.generatedQuery, result.explanation, insertPosition);

    // Show success message
    void vscode.window.showInformationMessage(
        l10n.t('Query generated successfully using {model}', { model: result.modelUsed }),
    );
}

/**
 * Inserts the generated query into the editor
 * @param editor The text editor
 * @param generatedQuery The generated query
 * @param explanation Explanation of the query
 * @param insertPosition The position to insert the query
 */
async function insertGeneratedQuery(
    editor: vscode.TextEditor,
    generatedQuery: string,
    explanation: string,
    insertPosition: vscode.Position,
): Promise<void> {
    // Format the query with a comment explaining what it does
    const queryWithComment = `// ${explanation}\n${generatedQuery}\n`;

    await editor.edit((editBuilder) => {
        // Insert at the beginning of the line
        editBuilder.insert(insertPosition, queryWithComment);
    });
}
