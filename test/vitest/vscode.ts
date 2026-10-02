/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Vitest counterpart of src/__mocks__/vscode.js. vitest.config.mts aliases `vscode` to this file for
// the extension project, so every test (and every source module it loads) gets a fresh mock per
// test file without calling vi.mock('vscode'). It lives outside `__mocks__/` so Jest's haste map
// does not see a second manual mock for `vscode` while both runners coexist.
//
// The module is ESM, so the members are exported by name below; `import * as vscode from 'vscode'`
// and `import { window } from 'vscode'` both resolve against that list. Add a name here when a
// test needs a `vscode` member that is not exported yet.

import { createVSCodeMock } from 'jest-mock-vscode';
import { vi } from 'vitest';

// Typed loosely on purpose: tests take their `vscode` types from @types/vscode, not from this file.
const vsCodeMock = createVSCodeMock(vi) as unknown as Record<string, unknown>;

vsCodeMock.l10n = {
    t: vi.fn((message: string, ...args: unknown[]) => {
        let result = message;
        args.forEach((arg, index) => {
            result = result.replace(`{${index}}`, String(arg));
        });
        return result;
    }),
};

// QuickPickItemKind enum (not provided by jest-mock-vscode)
if (!vsCodeMock.QuickPickItemKind) {
    vsCodeMock.QuickPickItemKind = { Separator: -1, Default: 0 };
}

// CancellationTokenSource mock for AzureWizard
vsCodeMock.CancellationTokenSource = class CancellationTokenSource {
    public token = {
        isCancellationRequested: false,
        onCancellationRequested: vi.fn(),
    };
    public cancel(): void {
        this.token.isCancellationRequested = true;
    }
    public dispose(): void {}
};

export default vsCodeMock;

export const {
    CallHierarchyIncomingCall,
    CallHierarchyItem,
    CallHierarchyOutgoingCall,
    CancellationTokenSource,
    CodeAction,
    CodeActionKind,
    CodeLens,
    Color,
    ColorInformation,
    ColorPresentation,
    ColorThemeKind,
    CommentMode,
    CommentThreadCollapsibleState,
    CompletionItem,
    CompletionItemKind,
    CompletionItemTag,
    CompletionList,
    CompletionTriggerKind,
    ConfigurationTarget,
    DebugAdapterInlineImplementation,
    DebugConfigurationProviderTriggerKind,
    DebugConsoleMode,
    DecorationRangeBehavior,
    Diagnostic,
    DiagnosticRelatedInformation,
    DiagnosticSeverity,
    DiagnosticTag,
    Disposable,
    DocumentHighlight,
    DocumentHighlightKind,
    DocumentLink,
    DocumentSymbol,
    EndOfLine,
    EnvironmentVariableMutatorType,
    EvaluatableExpression,
    EventEmitter,
    ExtensionKind,
    ExtensionMode,
    FileChangeType,
    FilePermission,
    FileSystemError,
    FileType,
    FoldingRange,
    FoldingRangeKind,
    LanguageModelDataPart,
    Location,
    LogLevel,
    MarkdownString,
    NotebookCellStatusBarAlignment,
    NotebookEditorRevealType,
    OverviewRulerLane,
    Position,
    ProgressLocation,
    QuickInputButtonLocation,
    QuickPickItemKind,
    Range,
    Selection,
    SelectionRange,
    SemanticTokens,
    SemanticTokensEdit,
    SemanticTokensEdits,
    SemanticTokensLegend,
    ShellQuoting,
    SignatureHelpTriggerKind,
    SnippetString,
    StatusBarAlignment,
    SymbolInformation,
    SymbolKind,
    SymbolTag,
    SyntaxTokenType,
    TaskGroup,
    TaskPanelKind,
    TaskRevealKind,
    TaskScope,
    TextDocumentSaveReason,
    TextEdit,
    TextEditorLineNumbersStyle,
    TextEditorRevealType,
    TextEditorSelectionChangeKind,
    ThemeColor,
    ThemeIcon,
    TreeItem,
    TreeItemCollapsibleState,
    TypeHierarchyItem,
    Uri,
    ViewColumn,
    WorkspaceEdit,
    commands,
    debug,
    l10n,
    languages,
    tasks,
    version,
    window,
    workspace,
} = vsCodeMock;
