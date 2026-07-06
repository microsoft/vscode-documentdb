/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DEFAULT_ID_INDEX_NAME, GEOSPATIAL_INDEX_DIRECTIONS, TEXT_INDEX_DIRECTION } from '../constants';
import { type IndexRow, type IndexTypeBadge } from '../types';

/**
 * Classify an index into one of the six display badge categories.
 *
 * Detection order matters: `_id_` always wins, then text and geospatial
 * (which are determined by key value rather than count), then a single
 * field named `_id` is rendered as `ObjectId`, and finally we fall back
 * on field count (Compound vs Single Field).
 */
export function classifyIndex(index: Pick<IndexRow, 'name' | 'key'>): IndexTypeBadge {
    if (index.name === DEFAULT_ID_INDEX_NAME) {
        return 'Default';
    }

    for (const { direction } of index.key) {
        if (direction === TEXT_INDEX_DIRECTION) {
            return 'Text';
        }
        if (typeof direction === 'string' && GEOSPATIAL_INDEX_DIRECTIONS.has(direction)) {
            return 'Geospatial';
        }
    }

    if (index.key.length === 1 && index.key[0]?.field === '_id') {
        return 'ObjectId';
    }

    return index.key.length > 1 ? 'Compound' : 'Single Field';
}
