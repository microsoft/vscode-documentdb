/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { modifierKey } from '../../constants';
import { PLAYGROUND_LANGUAGE_ID, PlaygroundCommandIds } from './constants';
import { PlaygroundService } from './PlaygroundService';
import { detectBlocks, findBlockAtLine } from './statementDetector';

/**
 * Provides CodeLens actions for Query Playground files:
 * 1. Connection status lens (line 0) — shows connected cluster/database or "Connect"
 * 2. Run All lens (line 0) — runs the entire file
 * 3. Per-block Run lens — shown only for the block containing the cursor
 *
 * The per-block lens follows the cursor: when the cursor moves to a different
 * block, we fire `onDidChangeCodeLenses` so VS Code re-requests lenses.
 */
export class PlaygroundCodeLensProvider implements vscode.CodeLensProvider, vscode.Disposable {
    private readonly _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
    readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChangeCodeLenses.event;

    private readonly _disposables: vscode.Disposable[] = [];

    /** Track which block the cursor is in to avoid unnecessary refreshes. */
    private _lastActiveBlockStart: number | undefined;

    /** OS-aware modifier key for shortcut labels. */
    private readonly _mod = modifierKey;

    constructor() {
        const service = PlaygroundService.getInstance();

        // Refresh lenses when connection/execution state changes
        this._disposables.push(
            service.onDidChangeState(() => {
                this._onDidChangeCodeLenses.fire();
            }),
        );

        // Refresh lenses when cursor moves to a different block
        this._disposables.push(
            vscode.window.onDidChangeTextEditorSelection((e) => {
                if (e.textEditor.document.languageId !== PLAYGROUND_LANGUAGE_ID) {
                    return;
                }
                const cursorLine = e.selections[0].active.line;
                const blocks = detectBlocks(e.textEditor.document);
                const newStart = this.resolveActiveBlock(blocks, cursorLine)?.startLine;

                if (newStart !== this._lastActiveBlockStart) {
                    this._lastActiveBlockStart = newStart;
                    this._onDidChangeCodeLenses.fire();
                }
            }),
        );
    }

    /**
     * Find the block at the cursor line. If the cursor is on a blank line
     * between blocks, fall back to the nearest preceding block to avoid
     * CodeLens flickering.
     */
    private resolveActiveBlock(
        blocks: ReturnType<typeof detectBlocks>,
        cursorLine: number,
    ): ReturnType<typeof findBlockAtLine> {
        const direct = findBlockAtLine(blocks, cursorLine);
        if (direct) {
            return direct;
        }
        // Fall back: find the last block that ends before the cursor
        for (let i = blocks.length - 1; i >= 0; i--) {
            if (blocks[i].endLine < cursorLine) {
                return blocks[i];
            }
        }
        return undefined;
    }

    provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
        const lenses: vscode.CodeLens[] = [];
        const service = PlaygroundService.getInstance();
        const topRange = new vscode.Range(0, 0, 0, 0);

        // 1. Connection status lens
        const displayName = service.getDisplayName(document.uri);
        if (displayName) {
            lenses.push(
                new vscode.CodeLens(topRange, {
                    title: `$(plug) ${displayName}`,
                    command: PlaygroundCommandIds.showConnectionInfo,
                    tooltip: l10n.t('Connected to {0}', displayName),
                }),
            );
        } else {
            lenses.push(
                new vscode.CodeLens(topRange, {
                    title: `$(warning) ${l10n.t('Not connected')}`,
                    command: PlaygroundCommandIds.showConnectionInfo,
                    tooltip: l10n.t('This playground has no connection'),
                }),
            );
        }

        // 2. Run All lens
        const isRunning = service.isExecutingForUri(document.uri);
        const runAllTitle = isRunning ? `$(loading~spin) ${l10n.t('Running…')}` : `$(run-all) ${l10n.t('Run All')}`;
        const runAllTooltip = isRunning
            ? l10n.t('The worker for this cluster is busy executing a playground')
            : l10n.t('Run the entire file ({0}+Shift+Enter)', this._mod);
        lenses.push(
            new vscode.CodeLens(topRange, {
                title: runAllTitle,
                command: PlaygroundCommandIds.runAll,
                tooltip: runAllTooltip,
            }),
        );

        // 3. Per-block Run lens — only for the block containing the cursor
        //    Falls back to the nearest preceding block when cursor is between blocks
        const editor = vscode.window.activeTextEditor;
        if (editor && editor.document === document) {
            const cursorLine = editor.selection.active.line;
            const blocks = detectBlocks(document);
            const activeBlock = this.resolveActiveBlock(blocks, cursorLine);

            if (activeBlock) {
                const blockRange = new vscode.Range(activeBlock.startLine, 0, activeBlock.startLine, 0);
                const runTitle = isRunning ? `$(loading~spin) ${l10n.t('Running…')}` : `$(play) ${l10n.t('Run')}`;
                const runTooltip = isRunning
                    ? l10n.t('The worker for this cluster is busy executing a playground')
                    : l10n.t('Run this block ({0}+Enter)', this._mod);
                lenses.push(
                    new vscode.CodeLens(blockRange, {
                        title: runTitle,
                        command: PlaygroundCommandIds.runSelected,
                        arguments: [activeBlock.startLine, activeBlock.endLine],
                        tooltip: runTooltip,
                    }),
                );

                // Navigation CodeLens — open this block in other surfaces
                if (displayName) {
                    lenses.push(
                        new vscode.CodeLens(blockRange, {
                            title: `$(files)  ${l10n.t('Collection View')}`,
                            command: PlaygroundCommandIds.openInCollectionView,
                            arguments: [document.uri, activeBlock.startLine, activeBlock.endLine],
                            tooltip: l10n.t('Open this query in Collection View'),
                        }),
                        new vscode.CodeLens(blockRange, {
                            title: `$(terminal)  ${l10n.t('Shell')}`,
                            command: PlaygroundCommandIds.openInShell,
                            arguments: [document.uri, activeBlock.startLine, activeBlock.endLine],
                            tooltip: l10n.t('Open this query in Interactive Shell'),
                        }),
                    );
                }
            }
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
