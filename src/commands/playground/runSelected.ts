/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { detectBlocks, getBlockText, resolveBlockAtLine } from '../../documentdb/playground/statementDetector';
import { executePlaygroundCode } from './executePlaygroundCode';
import { parsePlaygroundInvocation, resolvePlaygroundEditor } from './playgroundInvocation';

/**
 * Runs the block specified by CodeLens arguments or the current block
 * at the cursor position. Any active text selection is intentionally
 * ignored to avoid executing partial code left selected by autocomplete.
 *
 * CodeLens passes `[startLine, endLine]` as arguments so clicking
 * a per-block "▶ Run" lens executes exactly that block.
 */
export async function runSelected(context: IActionContext, ...args: unknown[]): Promise<void> {
    const invocation = parsePlaygroundInvocation(args);
    context.telemetry.properties.activationSource = invocation.activationSource;

    const editor = resolvePlaygroundEditor(invocation.uri);
    if (!editor) {
        return;
    }

    let codeToRun: string;
    let selectionSource: string;

    if (invocation.range) {
        // Invoked from CodeLens with explicit block range
        selectionSource = 'codeLens';
        codeToRun = getBlockText(editor.document, invocation.range);
    } else {
        // Run current block at cursor, fall back to preceding block.
        // Any active selection (e.g. from autocomplete) is intentionally
        // ignored so we always execute the full block.
        const resolved = resolveBlockAtLine(detectBlocks(editor.document), editor.selection.active.line);
        selectionSource = resolved?.match === 'preceding' ? 'fallback' : 'cursor';
        codeToRun = resolved ? getBlockText(editor.document, resolved.block) : '';
    }

    context.telemetry.properties.selectionSource = selectionSource;
    const blocks = detectBlocks(editor.document);
    context.telemetry.measurements.blockCount = blocks.length;

    if (!codeToRun.trim()) {
        void vscode.window.showInformationMessage(l10n.t('No code to run. Place the cursor in a code block.'));
        return;
    }

    await executePlaygroundCode(codeToRun, 'runSelected', editor.document.uri);
}
