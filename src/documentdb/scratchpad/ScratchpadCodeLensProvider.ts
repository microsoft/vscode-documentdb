/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { ScratchpadCommandIds } from './constants';
import { ScratchpadService } from './ScratchpadService';
import { detectBlocks } from './statementDetector';

/**
 * Provides CodeLens actions for DocumentDB Scratchpad files:
 * 1. Connection status lens (line 0) — shows connected cluster/database or "Connect"
 * 2. Run All lens (line 0) — runs the entire file
 * 3. Per-block Run lens — one "▶ Run" per blank-line-separated code block
 */
export class ScratchpadCodeLensProvider implements vscode.CodeLensProvider, vscode.Disposable {
    private readonly _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
    readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChangeCodeLenses.event;

    private readonly _disposables: vscode.Disposable[] = [];

    constructor() {
        // Refresh lenses when connection/execution state changes
        const service = ScratchpadService.getInstance();
        this._disposables.push(
            service.onDidChangeState(() => {
                this._onDidChangeCodeLenses.fire();
            }),
        );
    }

    provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
        const lenses: vscode.CodeLens[] = [];
        const service = ScratchpadService.getInstance();
        const topRange = new vscode.Range(0, 0, 0, 0);

        // 1. Connection status lens
        if (service.isConnected()) {
            const displayName = service.getDisplayName()!;
            lenses.push(
                new vscode.CodeLens(topRange, {
                    title: `$(plug) ${displayName}`,
                    command: ScratchpadCommandIds.connect,
                    tooltip: l10n.t('Connected to {0}', displayName),
                }),
            );
        } else {
            lenses.push(
                new vscode.CodeLens(topRange, {
                    title: `$(plug) ${l10n.t('Connect to a database')}`,
                    command: ScratchpadCommandIds.connect,
                    tooltip: l10n.t('Click to learn how to connect'),
                }),
            );
        }

        // 2. Run All lens
        const runAllTitle = service.isExecuting
            ? `$(loading~spin) ${l10n.t('Running…')}`
            : `$(run-all) ${l10n.t('Run All')}`;
        lenses.push(
            new vscode.CodeLens(topRange, {
                title: runAllTitle,
                command: ScratchpadCommandIds.runAll,
                tooltip: l10n.t('Run the entire file (Ctrl+Shift+Enter)'),
            }),
        );

        // 3. Per-block Run lenses
        const blocks = detectBlocks(document);
        for (const block of blocks) {
            const blockRange = new vscode.Range(block.startLine, 0, block.startLine, 0);
            const runTitle = service.isExecuting ? `$(loading~spin) ${l10n.t('Running…')}` : `$(play) ${l10n.t('Run')}`;
            lenses.push(
                new vscode.CodeLens(blockRange, {
                    title: runTitle,
                    command: ScratchpadCommandIds.runSelected,
                    arguments: [block.startLine, block.endLine],
                    tooltip: l10n.t('Run this block (Ctrl+Enter)'),
                }),
            );
        }

        return lenses;
    }

    dispose(): void {
        this._onDidChangeCodeLenses.dispose();
        for (const d of this._disposables) {
            d?.dispose();
        }
    }
}
