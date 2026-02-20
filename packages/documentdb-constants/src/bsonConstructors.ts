/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { registerOperators } from './getFilteredCompletions';
import { META_BSON } from './metaTags';
import { type OperatorEntry } from './types';

// ---------------------------------------------------------------------------
// BSON Constructor Functions
// ---------------------------------------------------------------------------

const bsonConstructors: readonly OperatorEntry[] = [
    {
        value: 'ObjectId',
        meta: META_BSON,
        description: 'Creates a new ObjectId value, a 12-byte unique identifier.',
        snippet: 'ObjectId("${1:hex}")',
    },
    {
        value: 'ISODate',
        meta: META_BSON,
        description: 'Creates a date object from an ISO 8601 date string.',
        snippet: 'ISODate("${1:yyyy-MM-ddTHH:mm:ssZ}")',
    },
    {
        value: 'NumberLong',
        meta: META_BSON,
        description: 'Creates a 64-bit integer (long) value.',
        snippet: 'NumberLong(${1:value})',
    },
    {
        value: 'NumberInt',
        meta: META_BSON,
        description: 'Creates a 32-bit integer value.',
        snippet: 'NumberInt(${1:value})',
    },
    {
        value: 'NumberDecimal',
        meta: META_BSON,
        description: 'Creates a 128-bit decimal value for high-precision calculations.',
        snippet: 'NumberDecimal("${1:value}")',
    },
    {
        value: 'BinData',
        meta: META_BSON,
        description: 'Creates a binary data value with a specified subtype.',
        snippet: 'BinData(${1:subtype}, "${2:base64}")',
    },
    {
        value: 'UUID',
        meta: META_BSON,
        description: 'Creates a UUID (Universally Unique Identifier) value.',
        snippet: 'UUID("${1:uuid}")',
    },
    {
        value: 'Timestamp',
        meta: META_BSON,
        description: 'Creates a BSON timestamp value for internal replication use.',
        snippet: 'Timestamp(${1:seconds}, ${2:increment})',
    },
    {
        value: 'MinKey',
        meta: META_BSON,
        description: 'Represents the lowest possible BSON value, comparing less than all other types.',
        snippet: 'MinKey()',
    },
    {
        value: 'MaxKey',
        meta: META_BSON,
        description: 'Represents the highest possible BSON value, comparing greater than all other types.',
        snippet: 'MaxKey()',
    },
];

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

registerOperators(bsonConstructors);
