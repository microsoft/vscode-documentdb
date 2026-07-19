/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';

/** Which index operation is being confirmed. */
export type IndexActionKind = 'delete' | 'hide' | 'unhide';

/** Details rendered in the confirmation dialog body. Size / usage are optional
 * because not every caller (e.g. the tree view) has statistics on hand. */
export interface IndexActionConfirmationDetails {
    indexName: string;
    collectionName?: string;
    /** Pre-formatted index size, e.g. "1.2 MB". Shown as a dash when omitted. */
    sizeText?: string;
    /** Pre-formatted usage, e.g. "42 ops". Shown as a dash when omitted. */
    usageText?: string;
}

/** Title / action-button label / effect note for each supported action. */
function copyFor(kind: IndexActionKind): { title: string; actionLabel: string; effect: string } {
    switch (kind) {
        case 'delete':
            return {
                title: l10n.t('Delete index?'),
                actionLabel: l10n.t('Delete'),
                effect: l10n.t('Deleting this index is permanent and cannot be undone.'),
            };
        case 'hide':
            return {
                title: l10n.t('Hide index?'),
                actionLabel: l10n.t('Hide'),
                effect: l10n.t('Hiding prevents the query planner from using this index.'),
            };
        case 'unhide':
            return {
                title: l10n.t('Unhide index?'),
                actionLabel: l10n.t('Unhide'),
                effect: l10n.t('Unhiding makes this index available to the query planner again.'),
            };
    }
}

/**
 * Confirm a delete / hide / unhide of an index via a single, consistent modal
 * VS Code dialog. The body lists the index name (and collection when provided),
 * its size and usage — one per line — followed by a short note describing the
 * effect. Shared by the Index Management webview and the tree-view commands so
 * every entry point offers the same level of detail and the same interaction.
 *
 * @returns `true` when the user confirms the action, `false` when they cancel.
 */
export async function confirmIndexAction(
    kind: IndexActionKind,
    details: IndexActionConfirmationDetails,
): Promise<boolean> {
    const dash = l10n.t('—');
    const { title, actionLabel, effect } = copyFor(kind);

    const lines = [l10n.t('Index: {0}', details.indexName)];
    if (details.collectionName && details.collectionName.trim() !== '') {
        lines.push(l10n.t('Collection: {0}', details.collectionName));
    }
    lines.push(
        l10n.t('Size: {0}', details.sizeText && details.sizeText.trim() !== '' ? details.sizeText : dash),
        l10n.t('Usage: {0}', details.usageText && details.usageText.trim() !== '' ? details.usageText : dash),
        '',
        effect,
    );
    const detail = lines.join('\n');

    const result = await vscode.window.showWarningMessage(title, { modal: true, detail }, actionLabel);
    return result === actionLabel;
}
