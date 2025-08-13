/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'node:fs/promises';

/**
 * Appends content to a file at the specified path
 *
 * @param filePath The path to the file
 * @param content The content to append
 * @returns Promise that resolves when the append operation completes
 */
export async function appendToFile(filePath: string, content: string): Promise<void> {
    return fs.appendFile(filePath, content);
}
