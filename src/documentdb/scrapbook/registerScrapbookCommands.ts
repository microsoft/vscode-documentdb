/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    callWithTelemetryAndErrorHandling,
    registerCommandWithTreeNodeUnwrapping,
    registerErrorHandler,
    registerEvent,
    type IActionContext,
    type IErrorHandlerContext,
} from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { processTestResultsCommand } from '../../commands/batchPerformanceAnalysis/processTestResults';
import { connectCluster } from '../../commands/scrapbook-commands/connectCluster';
import { createScrapbook } from '../../commands/scrapbook-commands/createScrapbook';
import { executeAllCommand } from '../../commands/scrapbook-commands/executeAllCommand';
import { executeCommand } from '../../commands/scrapbook-commands/executeCommand';
import { generateQueryCommand } from '../../commands/scrapbook-commands/generateQuery';
import { generateIndexSuggestionCommand } from '../../commands/scrapbook-commands/indexAdvisor';
import { generatePerformanceSummaryCommand } from '../../commands/scrapbook-commands/performanceSummary';
import { ext } from '../../extensionVariables';
import { MongoConnectError } from './connectToClient';
import { MongoDBLanguageClient } from './languageClient';
import { getAllErrorsFromTextDocument } from './ScrapbookHelpers';
import { ScrapbookService } from './ScrapbookService';

let diagnosticsCollection: vscode.DiagnosticCollection;
const scrapbookLanguageId: string = 'vscode-documentdb-scrapbook-language';

export function registerScrapbookCommands(): void {
    ext.mongoLanguageClient = new MongoDBLanguageClient();

    ext.context.subscriptions.push(
        vscode.languages.registerCodeLensProvider(scrapbookLanguageId, ScrapbookService.getCodeLensProvider()),
    );

    diagnosticsCollection = vscode.languages.createDiagnosticCollection('documentDB.vscode-documentdb-scrapbook');
    ext.context.subscriptions.push(diagnosticsCollection);

    setUpErrorReporting();

    registerCommandWithTreeNodeUnwrapping('vscode-documentdb.command.scrapbook.new', createScrapbook);
    registerCommandWithTreeNodeUnwrapping('vscode-documentdb.command.scrapbook.executeCommand', executeCommand);
    registerCommandWithTreeNodeUnwrapping('vscode-documentdb.command.scrapbook.executeAllCommands', executeAllCommand);
    registerCommandWithTreeNodeUnwrapping(
        'vscode-documentdb.command.scrapbook.generateIndexSuggestions',
        generateIndexSuggestionCommand,
    );
    registerCommandWithTreeNodeUnwrapping('vscode-documentdb.command.scrapbook.generateQuery', generateQueryCommand);
    registerCommandWithTreeNodeUnwrapping(
        'vscode-documentdb.command.scrapbook.generatePerformanceSummary',
        generatePerformanceSummaryCommand,
    );

    registerCommandWithTreeNodeUnwrapping('vscode-documentdb.command.processTestResults', processTestResultsCommand);

    // #region Database command

    registerCommandWithTreeNodeUnwrapping('vscode-documentdb.command.scrapbook.connect', connectCluster);

    // #endregion
}

function setUpErrorReporting(): void {
    // Update errors immediately in case a scrapbook is already open
    void callWithTelemetryAndErrorHandling(
        'scrapbook.initialUpdateErrorsInActiveDocument',
        async (context: IActionContext) => {
            updateErrorsInScrapbook(context, vscode.window.activeTextEditor?.document);
        },
    );

    // Update errors when document opened/changed
    registerEvent(
        'vscode.workspace.onDidOpenTextDocument',
        vscode.workspace.onDidOpenTextDocument,
        updateErrorsInScrapbook,
    );
    registerEvent(
        'vscode.workspace.onDidChangeTextDocument',
        vscode.workspace.onDidChangeTextDocument,
        async (context: IActionContext, event: vscode.TextDocumentChangeEvent) => {
            // Always suppress success telemetry - event happens on every keystroke
            context.telemetry.suppressIfSuccessful = true;

            updateErrorsInScrapbook(context, event.document);
        },
    );
    registerEvent(
        'vscode.workspace.onDidCloseTextDocument',
        vscode.workspace.onDidCloseTextDocument,
        async (context: IActionContext, document: vscode.TextDocument) => {
            // Remove errors when closed
            if (document?.languageId === scrapbookLanguageId) {
                diagnosticsCollection.set(document.uri, []);
            } else {
                context.telemetry.suppressIfSuccessful = true;
            }
        },
    );

    registerErrorHandler((context: IErrorHandlerContext) => {
        if (context.error instanceof MongoConnectError) {
            context.errorHandling.suppressReportIssue = true;
        }
    });
}

function updateErrorsInScrapbook(context: IActionContext, document: vscode.TextDocument | undefined): void {
    if (document?.languageId === scrapbookLanguageId) {
        const errors = getAllErrorsFromTextDocument(document);
        diagnosticsCollection.set(document.uri, errors);
    } else {
        context.telemetry.suppressIfSuccessful = true;
    }
}
