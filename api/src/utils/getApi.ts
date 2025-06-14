/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { type DocumentDBExtensionApi } from '../extensionApi';

// The actual extension ID based on the package.json
const DOCUMENTDB_EXTENSION_ID = 'ms-azuretools.vscode-documentdb';

/**
 * Gets the DocumentDB extension API
 * @param context The extension context (not used in this simple implementation)
 * @param apiVersionRange The required API version (not checked in this simple implementation)
 * @returns The DocumentDB extension API
 * @throws Error if the extension is not installed
 *
 * @example
 * ```typescript
 * const api = await getDocumentDBExtensionApi(context, '0.1.0');
 * api.migration.registerProvider(myProvider);
 * ```
 */
export async function getDocumentDBExtensionApi(
    _context: vscode.ExtensionContext,
    apiVersionRange: string,
): Promise<DocumentDBExtensionApi> {
    const extension = vscode.extensions.getExtension<DocumentDBExtensionApi>(DOCUMENTDB_EXTENSION_ID);

    if (!extension) {
        throw new Error(`Extension '${DOCUMENTDB_EXTENSION_ID}' is not installed.`);
    }

    if (!extension.isActive) {
        await extension.activate();
    }

    const api = extension.exports;

    if (!api) {
        throw new Error(`Extension '${DOCUMENTDB_EXTENSION_ID}' does not export an API.`);
    }

    // Simple version check (you can enhance this later)
    if (api.apiVersion !== apiVersionRange) {
        console.warn(`API version mismatch. Expected ${apiVersionRange}, got ${api.apiVersion}`);
    }

    return api;
}
