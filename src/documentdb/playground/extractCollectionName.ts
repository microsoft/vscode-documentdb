/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Extract the collection name from a playground code block.
 *
 * Supports two patterns:
 * - `db.getCollection('name')` / `db.getCollection("name")`
 * - `db.collectionName.find(...)` (direct property access)
 *
 * Returns `undefined` if no collection name can be extracted.
 */
export function extractCollectionName(code: string): string | undefined {
    // Pattern 1: db.getCollection('name') or db.getCollection("name")
    const getCollectionMatch = /db\.getCollection\(\s*['"]([^'"]+)['"]\s*\)/.exec(code);
    if (getCollectionMatch) {
        return getCollectionMatch[1];
    }

    // Pattern 2: db.<name>.find(...) or db.<name>.aggregate(...) etc.
    // Exclude built-in db methods: getCollection, getMongo, adminCommand, runCommand, etc.
    const directMatch = /db\.([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\./.exec(code);
    if (directMatch) {
        const name = directMatch[1];
        const builtins = new Set([
            'getCollection',
            'getMongo',
            'adminCommand',
            'runCommand',
            'getSiblingDB',
            'getCollectionNames',
            'getCollectionInfos',
            'createCollection',
            'dropDatabase',
        ]);
        if (!builtins.has(name)) {
            return name;
        }
    }

    return undefined;
}
