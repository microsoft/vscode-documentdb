/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { type CopyCollectionStrings } from '../tasks/copy-and-paste/copyCollectionStrings';

export function getExtensionCopyCollectionStrings(): CopyCollectionStrings {
    return {
        taskName: (
            sourceCollection: string,
            sourceDatabase: string,
            targetDatabase: string,
            targetCollection: string,
        ): string =>
            vscode.l10n.t(
                'Copy "{sourceCollection}" from "{sourceDatabase}" to "{targetDatabase}/{targetCollection}"',
                { sourceCollection, sourceDatabase, targetDatabase, targetCollection },
            ),
        countingSourceDocuments: vscode.l10n.t('Counting documents in the source collection...'),
        failedToCountSourceDocuments: vscode.l10n.t('Failed to count documents in the source collection.'),
        ensuringTargetExists: vscode.l10n.t('Ensuring target exists...'),
        failedToEnsureTargetExists: vscode.l10n.t('Failed to ensure the target collection exists.'),
        sourceCollectionEmpty: vscode.l10n.t('Source collection is empty.'),
        failedAfterPartialCompletion: (summary: string): string =>
            vscode.l10n.t('Task failed after partial completion: {0}', summary),
        indexCopyServicesNotConfigured: vscode.l10n.t('Index copy services were not configured.'),
        copyingIndexesBeforeDocuments: vscode.l10n.t('Copying indexes before documents...'),
        copyingIndexes: (total: string): string => vscode.l10n.t('Copying {0} indexes...', total),
        failedToCopyIndexes: (message: string): string =>
            vscode.l10n.t('Failed to copy indexes before copying documents: {0}', message),
        indexesCopied: (count: string): string =>
            vscode.l10n.t('{0} indexes copied. Document copy will begin shortly...', count),
        processed: (count: string): string => vscode.l10n.t('{0} processed', count),
        inserted: (count: string): string => vscode.l10n.t('{0} inserted', count),
        skipped: (count: string): string => vscode.l10n.t('{0} skipped', count),
        replaced: (count: string): string => vscode.l10n.t('{0} replaced', count),
        created: (count: string): string => vscode.l10n.t('{0} created', count),
        documentProgress: (processed: string, total: string): string => vscode.l10n.t('{0}/{1} documents', processed, total),
        writingBatch: vscode.l10n.t('writing batch...'),
    };
}
