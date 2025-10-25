/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { getAllCommandsFromText } from '../ScrapbookHelpers';
import { ScrapbookService } from '../ScrapbookService';

/**
 * Provides Code Lens functionality for the Mongo Scrapbook editor.
 *
 * @remarks
 * This provider enables several helpful actions directly within the editor:
 *
 * 1. **Connection Status Lens**:
 *    - Displays the current database connection state (e.g., connecting, connected).
 *    - Offers the ability to connect to a MongoDB database if one is not yet connected.
 *
 * 2. **Execute All Commands Lens**:
 *    - Runs all detected MongoDB commands in the scrapbook document at once when triggered.
 *
 * 3. **Execute Single Command Lens**:
 *    - Appears for each individual MongoDB command found in the scrapbook.
 *    - Invokes execution of the command located at the specified range in the document.
 *
 * 4. **Index Advisor Lens**:
 *    - Generates index optimization suggestions for the query at the specified range.
 *    - Uses AI to analyze query performance and recommend index improvements.
 *
 * 5. **Generate Query Lens**:
 *    - Generates MongoDB queries from natural language descriptions.
 *    - Supports both single-collection and cross-collection query generation.
 *    - Only visible when connected to a database.
 *
 * 6. **Performance Summary Lens**:
 *    - Analyzes performance changes between two query executions.
 *    - Compares execution plans, times, and index changes.
 *    - Provides AI-powered insights into performance improvements or degradations.
 */
export class MongoCodeLensProvider implements vscode.CodeLensProvider {
    private _onDidChangeEmitter: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();

    /**
     * An event to signal that the code lenses from this provider have changed.
     */
    public get onDidChangeCodeLenses(): vscode.Event<void> {
        return this._onDidChangeEmitter.event;
    }

    public updateCodeLens(): void {
        this._onDidChangeEmitter.fire();
    }
    public provideCodeLenses(
        document: vscode.TextDocument,
        _token: vscode.CancellationToken,
    ): vscode.ProviderResult<vscode.CodeLens[]> {
        return callWithTelemetryAndErrorHandling('scrapbook.provideCodeLenses', (context: IActionContext) => {
            context.telemetry.suppressIfSuccessful = true;

            const lenses: vscode.CodeLens[] = [];

            // Create connection status lens
            lenses.push(this.createConnectionStatusLens());

            // Create run-all lens
            lenses.push(this.createRunAllCommandsLens());

            // Create lenses for each individual command
            const commands = getAllCommandsFromText(document.getText());
            lenses.push(...this.createIndividualCommandLenses(commands));

            return lenses;
        });
    }

    private createConnectionStatusLens(): vscode.CodeLens {
        const title = ScrapbookService.isConnected()
            ? l10n.t('Connected to "{name}"', { name: ScrapbookService.getDisplayName() ?? '' })
            : l10n.t('Connect to a database');

        const shortenedTitle =
            title.length > 64 ? title.slice(0, 64 / 2) + '…' + title.slice(-(64 - 3 - 64 / 2)) : title;

        return <vscode.CodeLens>{
            command: {
                title: '🌐 ' + shortenedTitle,
                tooltip: title,
                command: 'vscode-documentdb.command.scrapbook.connect',
            },
            range: new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 0)),
        };
    }

    private createRunAllCommandsLens(): vscode.CodeLens {
        const title = ScrapbookService.isExecutingAllCommands() ? l10n.t('⏳ Running All…') : l10n.t('⏩ Run All');

        return <vscode.CodeLens>{
            command: {
                title,
                command: 'vscode-documentdb.command.scrapbook.executeAllCommands',
            },
            range: new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 0)),
        };
    }

    private createIndividualCommandLenses(commands: { range: vscode.Range }[]): vscode.CodeLens[] {
        const currentCommandInExectution = ScrapbookService.getSingleCommandInExecution();

        const lenses: vscode.CodeLens[] = [];

        commands.forEach((cmd) => {
            const running = currentCommandInExectution && cmd.range.isEqual(currentCommandInExectution.range);
            const title = running ? l10n.t('⏳ Running Command…') : l10n.t('▶️ Run Command');

            // Run Command lens
            lenses.push(<vscode.CodeLens>{
                command: {
                    title,
                    command: 'vscode-documentdb.command.scrapbook.executeCommand',
                    arguments: [cmd.range.start],
                },
                range: cmd.range,
            });

            // Generate Index Suggestions lens
            lenses.push(<vscode.CodeLens>{
                command: {
                    title: l10n.t('💡 Index Advisor'),
                    tooltip: l10n.t('Generate index optimization suggestions for this query'),
                    command: 'vscode-documentdb.command.scrapbook.generateIndexSuggestions',
                    arguments: [cmd.range.start],
                },
                range: cmd.range,
            });

            // Generate Query lens
            lenses.push(<vscode.CodeLens>{
                command: {
                    title: l10n.t('✨ Generate Query'),
                    tooltip: l10n.t('Generate MongoDB query from natural language'),
                    command: 'vscode-documentdb.command.scrapbook.generateQuery',
                    arguments: [cmd.range.start],
                },
                range: cmd.range,
            });

            // Performance Summary lens
            lenses.push(<vscode.CodeLens>{
                command: {
                    title: l10n.t('📊 Performance Summary'),
                    tooltip: l10n.t('Analyze performance changes between query executions'),
                    command: 'vscode-documentdb.command.scrapbook.generatePerformanceSummary',
                    arguments: [cmd.range.start],
                },
                range: cmd.range,
            });
        });

        return lenses;
    }
}
