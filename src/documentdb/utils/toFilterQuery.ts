/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ParseMode, parse as parseShellBSON } from '@mongodb-js/shell-bson-parser';
import { type Document, type Filter } from 'mongodb';
import * as vscode from 'vscode';
import { QueryError } from '../errors/QueryError';

/**
 * Parses a user-provided filter query string into a DocumentDB filter object.
 *
 * Uses `@mongodb-js/shell-bson-parser` in Loose mode, which supports:
 * - Unquoted keys: `{ name: 1 }`
 * - Single-quoted strings: `{ name: 'Alice' }`
 * - BSON constructors: `ObjectId("...")`, `UUID("...")`, `ISODate("...")`, etc.
 * - JS expressions: `Math.min(1.7, 2)`, `Date.now()`, arithmetic
 * - MongoDB Extended JSON: `{ "$oid": "..." }`
 *
 * Replaces the previous hand-rolled regex-based converter + EJSON.parse pipeline.
 */
export function toFilterQueryObj(queryString: string): Filter<Document> {
    try {
        if (queryString.trim().length === 0) {
            return {} as Filter<Document>;
        }
        return parseShellBSON(queryString, { mode: ParseMode.Loose }) as Filter<Document>;
    } catch (error) {
        const cause = error instanceof Error ? error : new Error(String(error));
        throw new QueryError(
            'INVALID_FILTER',
            vscode.l10n.t(
                'Invalid filter syntax: {0}. Please use valid JSON or a DocumentDB API expression, for example: { name: "value" }',
                cause.message,
            ),
            cause,
        );
    }
}
