/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { type DocumentDBExtensionApi, type DocumentDBExtensionApiV030 } from '../extensionApi';

// The actual extension ID based on the package.json
const DOCUMENTDB_EXTENSION_ID = 'ms-azuretools.vscode-documentdb';

/**
 * Interface for the DocumentDB API configuration in package.json
 */
interface DocumentDBApiConfig {
    'x-documentdbApi'?: {
        registeredClients?: string[];
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
 * @param apiVersionRange The required API version ('0.2.0' or '0.3.0')
 * @returns The DocumentDB extension API
 * @throws Error if the extension is not installed or calling extension is not whitelisted
 *
 * @example
 * ```typescript
 * // For API v0.2.0
 * const api = await getDocumentDBExtensionApi(context, '0.2.0');
 * api.migration.registerProvider(myProvider);
 *
 * // For API v0.3.0 (requires extension context)
 * const api = await getDocumentDBExtensionApi(context, '0.3.0') as DocumentDBExtensionApiV030;
 * api.migration.registerProvider(context, myProvider);
 * ```
 */
export async function getDocumentDBExtensionApi(
    context: vscode.ExtensionContext,
    apiVersionRange: string,
): Promise<DocumentDBExtensionApi | DocumentDBExtensionApiV030> {
    // Get the calling extension's ID from the context
    const callingExtensionId = context.extension.id;

    // Get the DocumentDB extension to access its package.json configuration
    const extension = vscode.extensions.getExtension<DocumentDBExtensionApi | DocumentDBExtensionApiV030>(
        DOCUMENTDB_EXTENSION_ID,
    );
    if (!extension) {
        throw new Error(`Extension '${DOCUMENTDB_EXTENSION_ID}' is not installed.`);
    }

    // Check if the calling extension is whitelisted
    const packageJson = extension.packageJSON as unknown;
    const registeredClients = isValidPackageJson(packageJson)
        ? packageJson['x-documentdbApi']?.registeredClients
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
