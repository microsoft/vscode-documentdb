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
     *
     * Skips matches inside comments, strings, and chains that already
     * include `.toArray()`.
     */
    private analyzeDocument(document: vscode.TextDocument): void {
        const batchSize = getBatchSizeSetting();
        const diagnostics: vscode.Diagnostic[] = [];
        const text = document.getText();
        const commentRanges = computeCommentAndStringRanges(text);

        let match: RegExpExecArray | null;
        LIMIT_CALL_PATTERN.lastIndex = 0;

        while ((match = LIMIT_CALL_PATTERN.exec(text)) !== null) {
            const limitValue = parseInt(match[1], 10);
            if (limitValue <= batchSize) {
                continue;
            }

            // Skip matches inside comments or string literals
            if (isInsideCommentOrString(match.index, commentRanges)) {
                continue;
            }

            // Skip if the same line already contains .toArray()
            const startPos = document.positionAt(match.index);
            const lineText = document.lineAt(startPos.line).text;
            if (lineText.includes('.toArray()')) {
                continue;
            }

            const endPos = document.positionAt(match.index + match[0].length);
            const range = new vscode.Range(startPos, endPos);

            const diagnostic = new vscode.Diagnostic(
                range,
                l10n.t(
                    '.limit({0}) exceeds the display batch size ({1}), so only {1} documents will be shown. Use .toArray() to retrieve all {0}, or increase "{2}" in Settings.',
                    limitValue,
                    batchSize,
                    ext.settingsKeys.batchSize,
                ),
                vscode.DiagnosticSeverity.Warning,
            );
            diagnostic.source = DIAGNOSTIC_SOURCE;
            diagnostic.code = 'limit-exceeds-batch-size';
            diagnostics.push(diagnostic);
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
        _document: vscode.TextDocument,
        _range: vscode.Range | vscode.Selection,
        context: vscode.CodeActionContext,
    ): vscode.CodeAction[] {
        const actions: vscode.CodeAction[] = [];

        for (const diagnostic of context.diagnostics) {
            if (diagnostic.code !== 'limit-exceeds-batch-size') {
                continue;
            }

            // Quick fix: open the batch size setting
            const settingsAction = new vscode.CodeAction(
                l10n.t('Change display batch size (currently {0}) in settings', getBatchSizeSetting()),
                vscode.CodeActionKind.QuickFix,
            );
            settingsAction.diagnostics = [diagnostic];
            settingsAction.isPreferred = true;
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

// ─── Comment/string range detection ──────────────────────────────────────────

interface TextRange {
    readonly start: number;
    readonly end: number;
}

/**
 * Compute the character ranges of line comments (`//`), block comments,
 * and string literals (single/double/backtick) in the given source text.
 * Used to suppress diagnostics inside non-code regions.
 */
function computeCommentAndStringRanges(text: string): TextRange[] {
    const ranges: TextRange[] = [];
    let i = 0;
    while (i < text.length) {
        const ch = text[i];

        // Line comment
        if (ch === '/' && text[i + 1] === '/') {
            const start = i;
            i += 2;
            while (i < text.length && text[i] !== '\n') {
                i++;
            }
            ranges.push({ start, end: i });
            continue;
        }

        // Block comment
        if (ch === '/' && text[i + 1] === '*') {
            const start = i;
            i += 2;
            while (i < text.length - 1 && !(text[i] === '*' && text[i + 1] === '/')) {
                i++;
            }
            i += 2; // skip */
            ranges.push({ start, end: i });
            continue;
        }

        // String literals (single, double, backtick)
        if (ch === "'" || ch === '"' || ch === '`') {
            const start = i;
            const quote = ch;
            i++;
            while (i < text.length) {
                if (text[i] === '\\') {
                    i += 2; // skip escaped character
                    continue;
                }
                if (text[i] === quote) {
                    i++;
                    break;
                }
                i++;
            }
            ranges.push({ start, end: i });
            continue;
        }

        i++;
    }
    return ranges;
}

/**
 * Check if an offset falls inside any of the computed comment/string ranges.
 */
function isInsideCommentOrString(offset: number, ranges: TextRange[]): boolean {
    return ranges.some((r) => offset >= r.start && offset < r.end);
}
