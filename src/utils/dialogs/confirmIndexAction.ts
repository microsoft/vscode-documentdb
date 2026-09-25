/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { UserCancelledError } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { formatBytes, formatOps } from '../../webviews/documentdb/collectionView/indexesTab/utils/format';
import { getConfirmationAsInSettings } from './getConfirmation';

/** Which index operation is being confirmed. */
export type IndexActionKind = 'delete' | 'hide' | 'unhide';

/** Details rendered in the confirmation dialog body. Size / usage are raw numbers
 * because both come from optional server commands that some cluster tiers do not
 * support; formatting happens here so every caller words a missing value the same. */
export interface IndexActionConfirmationDetails {
    indexName: string;
    collectionName?: string;
    /** Index size in bytes. Shown as "Not available" when omitted. */
    sizeBytes?: number;
    /** Usage operations counter. Shown as "Not available" when omitted. */
    usageOps?: number;
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
 * Formats one statistic for the dialog body. The grid renders a missing value as an
 * em dash, which reads as nothing in a sentence, so prose spells it out instead.
 */
function describeStat(value: number | undefined, format: (value: number) => string): string {
    return value === undefined || Number.isNaN(value) ? l10n.t('Not available') : format(value);
}

/**
 * Confirm a delete / hide / unhide of an index. The body lists the index name
 * (and collection when provided), its size and usage — one per line — followed
 * by a short note describing the effect. Shared by the Index Management webview
 * and the tree-view commands so every entry point offers the same level of detail.
 *
 * Deletion is irreversible and therefore routes through
 * `getConfirmationAsInSettings`, honoring the user's configured destructive-action
 * confirmation style (word / challenge / click) just like `deleteCollection` and
 * `deleteDatabase`. The reversible hide / unhide actions keep the lighter
 * single-click warning modal.
 *
 * @returns `true` when the user confirms the action, `false` when they cancel.
 */
export async function confirmIndexAction(
    kind: IndexActionKind,
    details: IndexActionConfirmationDetails,
): Promise<boolean> {
    const { title, actionLabel, effect } = copyFor(kind);

    const lines = [l10n.t('Index: {0}', details.indexName)];
    if (details.collectionName && details.collectionName.trim() !== '') {
        lines.push(l10n.t('Collection: {0}', details.collectionName));
    }
    lines.push(
        l10n.t('Size: {0}', describeStat(details.sizeBytes, formatBytes)),
        l10n.t('Usage: {0}', describeStat(details.usageOps, formatOps)),
        '',
        effect,
    );
    const detail = lines.join('\n');

    // Deletion is irreversible, so honor the user's configured destructive-action
    // confirmation style (word / challenge / click) exactly like deleteCollection and
    // deleteDatabase. `getConfirmationAsInSettings` throws UserCancelledError when the
    // user dismisses the word-confirmation input box; translate that into `false` so the
    // shared boolean contract (true = confirmed, false = cancelled) holds for every caller.
    if (kind === 'delete') {
        try {
            return await getConfirmationAsInSettings(title, detail, details.indexName, {
                fallbackWord: 'delete',
            });
        } catch (error) {
            if (error instanceof UserCancelledError) {
                return false;
            }
            throw error;
        }
    }

    // Hide / unhide are reversible, so they keep the lighter single-click modal.
    const result = await vscode.window.showWarningMessage(title, { modal: true, detail }, actionLabel);
    return result === actionLabel;
}
