/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

interface VsixTools {
    readVsix(filename: string): Map<string, Buffer>;
    extractVsix(filename: string, destination: string): void;
}

function isVsixTools(value: unknown): value is VsixTools {
    return value !== null && typeof value === 'object' &&
        'readVsix' in value && typeof value.readVsix === 'function' &&
        'extractVsix' in value && typeof value.extractVsix === 'function';
}

function loadVsixTools(): VsixTools {
    const shared: unknown = require('../vsix.cjs');
    if (!isVsixTools(shared)) {
        throw new Error('Shared VSIX tools must export synchronous readVsix and extractVsix');
    }
    return shared;
}

export const vsixTools = loadVsixTools();
