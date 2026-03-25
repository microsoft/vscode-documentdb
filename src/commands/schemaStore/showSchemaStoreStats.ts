/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { SchemaStore } from '../../documentdb/SchemaStore';
import { ext } from '../../extensionVariables';

/**
 * Command handler: Show SchemaStore statistics in the output channel.
 * Displays collection count, document count, field count, and per-collection breakdown.
 */
export function showSchemaStoreStats(_context: IActionContext): void {
    const store = SchemaStore.getInstance();
    const stats = store.getStats();

    ext.outputChannel.appendLog(
        `[SchemaStore] Stats: ${String(stats.collectionCount)} collections, ` +
            `${String(stats.totalDocuments)} documents analyzed, ` +
            `${String(stats.totalFields)} fields discovered`,
    );

    if (stats.collections.length > 0) {
        for (const c of stats.collections) {
            ext.outputChannel.appendLog(
                `[SchemaStore]   ${c.key}: ${String(c.documentCount)} docs, ${String(c.fieldCount)} fields`,
            );
        }
    } else {
        ext.outputChannel.appendLog('[SchemaStore]   (empty — no schemas cached)');
    }

    ext.outputChannel.show();
}
