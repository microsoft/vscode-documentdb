/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { type DocumentDBExtensionApi } from '../extensionApi';

// The actual extension ID based on the package.json
const DOCUMENTDB_EXTENSION_ID = 'ms-azuretools.vscode-documentdb';

/**
 * Interface for the DocumentDB API configuration in package.json
 */
interface DocumentDBApiConfig {
    'x-documentdbApi'?: {
        verifiedClients?: string[];
    };
}

/**
 * Type guard to check if the package.json has the expected DocumentDB API configuration
 */
function isValidPackageJson(packageJson: unknown): packageJson is DocumentDBApiConfig {
    return typeof packageJson === 'object' && packageJson !== null && 'x-documentdbApi' in packageJson;
}

/**
 * Gets the DocumentDB for VS Code extension API
 *
 * NOTE: This is an experimental implementation. Extensions using this API are whitelisted
 * as a safeguard during the experimental phase. This safeguard will be removed once the
 * experimental phase ends. Contributors wishing to join in this phase are asked to reach out to us.
 *
 * @param context The calling extension context
 * @param apiVersionRange The required API version (not checked in this simple implementation)
 * @returns The DocumentDB extension API
 * @throws Error if the extension is not installed or calling extension is not whitelisted
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
    // Get the calling extension's ID from the context
    const callingExtensionId = _context.extension.id;

    // Get the DocumentDB extension to access its package.json configuration
    const extension = vscode.extensions.getExtension<DocumentDBExtensionApi>(DOCUMENTDB_EXTENSION_ID);
    if (!extension) {
        throw new Error(`Extension '${DOCUMENTDB_EXTENSION_ID}' is not installed.`);
    }

    // Check if the calling extension is whitelisted
    const packageJson = extension.packageJSON as unknown;
    const registeredClients = isValidPackageJson(packageJson)
        ? packageJson['x-documentdbApi']?.verifiedClients
        : undefined;

    if (!registeredClients || !Array.isArray(registeredClients)) {
        throw new Error(`DocumentDB for VS Code API configuration is invalid. No registered clients found.`);
    }

    if (!registeredClients.includes(callingExtensionId)) {
        throw new Error(
            `Extension '${callingExtensionId}' is not authorized to use the DocumentDB for VS Code API. ` +
                `This is an experimental API with whitelisted access. ` +
                `Please reach out to the DocumentDB for VS Code extension team to request access.`,
        );
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
