/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { SchemaStore } from '../../documentdb/SchemaStore';
import { ext } from '../../extensionVariables';

/**
 * Command handler: Clear the shared schema cache.
 * Logs current size, clears all entries, and logs the result.
 */
export function clearSchemaCache(_context: IActionContext): void {
    const store = SchemaStore.getInstance();
    const before = store.getStats();

    ext.outputChannel.appendLog(
        l10n.t(
            '[SchemaStore] Clearing schema cache: {0} collections, {1} documents, {2} fields',
            String(before.collectionCount),
            String(before.totalDocuments),
            String(before.totalFields),
        ),
    );

    store.reset();

    const after = store.getStats();
    ext.outputChannel.appendLog(
        l10n.t(
            '[SchemaStore] Schema cache cleared: {0} collections, {1} documents, {2} fields',
            String(after.collectionCount),
            String(after.totalDocuments),
            String(after.totalFields),
        ),
    );

    ext.outputChannel.show();
}
