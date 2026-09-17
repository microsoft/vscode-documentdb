/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';

function formatIndexNames(indexNames: string[]): string {
    return indexNames.map((name) => `"${name}"`).join(', ');
}

export function formatIndexCopyWarnings(uniqueIndexNames: string[], ttlIndexNames: string[]): string[] {
    const warnings: string[] = [];

    if (uniqueIndexNames.length > 0) {
        warnings.push(
            l10n.t(
                '⚠️ Unique indexes ({0}) may reject copied documents that conflict with existing values or generated IDs.',
                formatIndexNames(uniqueIndexNames),
            ),
        );
    }

    if (ttlIndexNames.length > 0) {
        warnings.push(
            l10n.t(
                '⚠️ TTL indexes ({0}) may delete expired documents while the copy is running.',
                formatIndexNames(ttlIndexNames),
            ),
        );
    }

    return warnings;
}