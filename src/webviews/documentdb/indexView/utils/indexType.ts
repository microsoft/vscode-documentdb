/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    DEFAULT_ID_INDEX_NAME,
    GEOSPATIAL_INDEX_DIRECTIONS,
    HASHED_INDEX_DIRECTION,
    TEXT_INDEX_DIRECTION,
    WILDCARD_INDEX_FIELD_TOKEN,
} from '../constants';
import { type IndexRow, type IndexTypeBadge } from '../types';

/**
 * Classify an index into one of the display badge categories.
 *
 * Detection order matters: `_id_` always wins, then the type-defining key
 * features (text, geospatial, hashed, wildcard) which are determined by the
 * key value rather than field count, then a single field named `_id` is
 * rendered as `ObjectId`, and finally we fall back on field count (Compound
 * vs Single Field).
 *
 * The type names mirror the supported index types published by
 * `@documentdb-js/operator-registry` (`INDEX_TYPES`).
 */
export function classifyIndex(index: Pick<IndexRow, 'name' | 'key'>): IndexTypeBadge {
    if (index.name === DEFAULT_ID_INDEX_NAME) {
        return 'Default';
    }

    for (const { field, direction } of index.key) {
        if (direction === TEXT_INDEX_DIRECTION) {
            return 'Text';
        }
        if (typeof direction === 'string' && GEOSPATIAL_INDEX_DIRECTIONS.has(direction)) {
            return 'Geospatial';
        }
        if (direction === HASHED_INDEX_DIRECTION) {
            return 'Hashed';
        }
        if (field.includes(WILDCARD_INDEX_FIELD_TOKEN)) {
            return 'Wildcard';
        }
    }

    if (index.key.length === 1 && index.key[0]?.field === '_id') {
        return 'ObjectId';
    }

    return index.key.length > 1 ? 'Compound' : 'Single Field';
}
