/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { ext } from '../../extensionVariables';
import { getBatchSizeSetting } from '../../utils/workspacUtils';

const PLAYGROUND_LANGUAGE_ID = 'documentdb-playground';
const DIAGNOSTIC_SOURCE = 'DocumentDB';

/**
 * Pattern to detect `.limit(N)` calls in playground code.
 * Captures the numeric argument and the full match range.
 */
const LIMIT_CALL_PATTERN = /\.limit\(\s*(\d+)\s*\)/g;

/**
 * Provides diagnostics and code actions for DocumentDB playground files.
 *
 * Currently handles:
 * - Warning when `.limit(N)` exceeds the configured display batch size,
 *   since cursor iteration will only return `displayBatchSize` documents
 *   unless `.toArray()` is used.
 */
export class PlaygroundDiagnostics implements vscode.Disposable {
    private readonly _diagnosticCollection: vscode.DiagnosticCollection;
    private readonly _disposables: vscode.Disposable[] = [];

    constructor() {
        this._diagnosticCollection = vscode.languages.createDiagnosticCollection('documentdb-playground');
        this._disposables.push(this._diagnosticCollection);

        // Analyze on document open and edit
        this._disposables.push(
            vscode.workspace.onDidChangeTextDocument((e) => {
                if (e.document.languageId === PLAYGROUND_LANGUAGE_ID) {
                    this.analyzeDocument(e.document);
                }
            }),
        );

        this._disposables.push(
            vscode.workspace.onDidOpenTextDocument((doc) => {
                if (doc.languageId === PLAYGROUND_LANGUAGE_ID) {
                    this.analyzeDocument(doc);
                }
            }),
        );

        this._disposables.push(
            vscode.workspace.onDidCloseTextDocument((doc) => {
                this._diagnosticCollection.delete(doc.uri);
            }),
        );

        // Re-analyze when the batch size setting changes
        this._disposables.push(
            vscode.workspace.onDidChangeConfiguration((e) => {
                if (e.affectsConfiguration(ext.settingsKeys.batchSize)) {
                    for (const editor of vscode.window.visibleTextEditors) {
                        if (editor.document.languageId === PLAYGROUND_LANGUAGE_ID) {
                            this.analyzeDocument(editor.document);
                        }
                    }
                }
            }),
        );

        // Register code action provider for the playground language
        this._disposables.push(
            vscode.languages.registerCodeActionsProvider(
                { language: PLAYGROUND_LANGUAGE_ID },
                new PlaygroundCodeActionProvider(),
                { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] },
            ),
        );

        // Analyze any already-open playground documents
        for (const doc of vscode.workspace.textDocuments) {
            if (doc.languageId === PLAYGROUND_LANGUAGE_ID) {
                this.analyzeDocument(doc);
            }
        }
    }

    /**
     * Analyze a playground document for `.limit(N)` calls that exceed
     * the configured display batch size.
     */
    private analyzeDocument(document: vscode.TextDocument): void {
        const batchSize = getBatchSizeSetting();
        const diagnostics: vscode.Diagnostic[] = [];
        const text = document.getText();

        let match: RegExpExecArray | null;
        LIMIT_CALL_PATTERN.lastIndex = 0;

        while ((match = LIMIT_CALL_PATTERN.exec(text)) !== null) {
            const limitValue = parseInt(match[1], 10);
            if (limitValue > batchSize) {
                const startPos = document.positionAt(match.index);
                const endPos = document.positionAt(match.index + match[0].length);
                const range = new vscode.Range(startPos, endPos);

                const diagnostic = new vscode.Diagnostic(
                    range,
                    l10n.t(
                        '.limit({0}) exceeds display batch size ({1}) — only {1} documents will be shown. Use .toArray() to get all {0}.',
                        limitValue,
                        batchSize,
                    ),
                    vscode.DiagnosticSeverity.Warning,
                );
                diagnostic.source = DIAGNOSTIC_SOURCE;
                diagnostic.code = 'limit-exceeds-batch-size';
                diagnostics.push(diagnostic);
            }
        }

        this._diagnosticCollection.set(document.uri, diagnostics);
    }

    dispose(): void {
        for (const d of this._disposables) {
            d.dispose();
        }
    }
}

/**
 * Provides quick-fix code actions for playground diagnostics.
 */
class PlaygroundCodeActionProvider implements vscode.CodeActionProvider {
    provideCodeActions(
        document: vscode.TextDocument,
        _range: vscode.Range | vscode.Selection,
        context: vscode.CodeActionContext,
    ): vscode.CodeAction[] {
        const actions: vscode.CodeAction[] = [];

        for (const diagnostic of context.diagnostics) {
            if (diagnostic.code !== 'limit-exceeds-batch-size') {
                continue;
            }

            // Extract the limit value from the diagnostic range
            const limitText = document.getText(diagnostic.range);
            const limitMatch = /\.limit\(\s*(\d+)\s*\)/.exec(limitText);
            if (!limitMatch) {
                continue;
            }

            const limitValue = parseInt(limitMatch[1], 10);

            // Action 1: Insert .toArray() after the expression
            const toArrayAction = new vscode.CodeAction(
                l10n.t('Insert .toArray() to get all {0} documents', limitValue),
                vscode.CodeActionKind.QuickFix,
            );
            toArrayAction.diagnostics = [diagnostic];
            toArrayAction.isPreferred = true;
            toArrayAction.edit = new vscode.WorkspaceEdit();

            // Find the end of the statement — insert .toArray() right after .limit(N)
            const insertPosition = diagnostic.range.end;
            toArrayAction.edit.insert(document.uri, insertPosition, '.toArray()');
            actions.push(toArrayAction);

            // Action 2: Open batch size setting
            const settingsAction = new vscode.CodeAction(
                l10n.t('Change display batch size ({0}) in settings', getBatchSizeSetting()),
                vscode.CodeActionKind.QuickFix,
            );
            settingsAction.diagnostics = [diagnostic];
            settingsAction.command = {
                title: l10n.t('Open batch size setting'),
                command: 'workbench.action.openSettings',
                arguments: [ext.settingsKeys.batchSize],
            };
            actions.push(settingsAction);
        }

        return actions;
    }
}
