/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import Denque from 'denque';
import { type JSONSchema } from '../../JSONSchema';
import { BSONTypes } from '../BSONTypes';

/**
 * Work item for BFS traversal of the schema tree.
 */
interface WorkItem {
    schemaNode: JSONSchema;
    parentDocumentsInspected: number;
}

/**
 * Post-processor that mutates the schema in-place, adding human-readable
 * `description` strings to each property node. Descriptions include:
 * - Dominant type name(s)
 * - Occurrence percentage (based on `x-occurrence / parentDocumentsInspected`)
 * - Type-specific stats (length, range, true/false counts, etc.)
 *
 * Uses BFS to traverse all property levels.
 */
export function generateDescriptions(schema: JSONSchema): void {
    const rootDocumentsInspected = (schema['x-documentsInspected'] as number) ?? 0;

    const queue = new Denque<WorkItem>();

    // Seed the queue with root-level properties
    if (schema.properties) {
        for (const propName of Object.keys(schema.properties)) {
            const propSchema = schema.properties[propName] as JSONSchema;
            if (typeof propSchema === 'boolean') continue;

            queue.push({
                schemaNode: propSchema,
                parentDocumentsInspected: rootDocumentsInspected,
            });
        }
    }

    while (queue.length > 0) {
        const item = queue.shift();
        if (!item) continue;

        const { schemaNode, parentDocumentsInspected } = item;

        // Collect type display names from anyOf entries
        const typeNames = collectTypeDisplayNames(schemaNode);

        // Build description parts
        const parts: string[] = [];

        // Part 1: Type info
        if (typeNames.length > 0) {
            parts.push(typeNames.join(' | '));
        }

        // Part 2: Occurrence percentage
        if (parentDocumentsInspected > 0) {
            const occurrence = (schemaNode['x-occurrence'] as number) ?? 0;
            const percentage = ((occurrence / parentDocumentsInspected) * 100).toFixed(0);
            parts.push(`${percentage}%`);
        }

        // Part 3: Stats from the dominant type entry
        const dominantEntry = getDominantTypeEntry(schemaNode);
        if (dominantEntry) {
            const statString = getStatString(dominantEntry);
            if (statString) {
                parts.push(statString);
            }

            // If the dominant entry is an object with properties, enqueue children
            if (dominantEntry.type === 'object' && dominantEntry.properties) {
                const objectDocumentsInspected = (dominantEntry['x-documentsInspected'] as number) ?? 0;
                for (const childName of Object.keys(dominantEntry.properties)) {
                    const childSchema = dominantEntry.properties[childName] as JSONSchema;
                    if (typeof childSchema === 'boolean') continue;

                    queue.push({
                        schemaNode: childSchema,
                        parentDocumentsInspected: objectDocumentsInspected,
                    });
                }
            }
        }

        // Set the description
        if (parts.length > 0) {
            schemaNode.description = parts.join(' · ');
        }
    }
}

/**
 * Collects display names for all types in a schema node's `anyOf` entries.
 * Returns them ordered by descending `x-typeOccurrence`.
 */
function collectTypeDisplayNames(schemaNode: JSONSchema): string[] {
    if (!schemaNode.anyOf || schemaNode.anyOf.length === 0) {
        return [];
    }

    const entries: Array<{ name: string; occurrence: number }> = [];
    for (const entry of schemaNode.anyOf) {
        if (typeof entry === 'boolean') continue;
        const bsonType = (entry['x-bsonType'] as string) ?? '';
        const occurrence = (entry['x-typeOccurrence'] as number) ?? 0;
        const name = bsonType
            ? BSONTypes.toDisplayString(bsonType as BSONTypes)
            : ((entry.type as string) ?? 'Unknown');
        entries.push({ name, occurrence });
    }

    // Sort by occurrence descending so dominant type comes first
    entries.sort((a, b) => b.occurrence - a.occurrence);
    return entries.map((e) => e.name);
}

/**
 * Returns the anyOf entry with the highest `x-typeOccurrence`.
 */
function getDominantTypeEntry(schemaNode: JSONSchema): JSONSchema | null {
    if (!schemaNode.anyOf || schemaNode.anyOf.length === 0) {
        return null;
    }

    let maxOccurrence = -1;
    let dominant: JSONSchema | null = null;

    for (const entry of schemaNode.anyOf) {
        if (typeof entry === 'boolean') continue;
        const occurrence = (entry['x-typeOccurrence'] as number) ?? 0;
        if (occurrence > maxOccurrence) {
            maxOccurrence = occurrence;
            dominant = entry;
        }
    }

    return dominant;
}

/**
 * Returns a type-specific stats string for the given type entry, or undefined if
 * no relevant stats are available.
 */
function getStatString(typeEntry: JSONSchema): string | undefined {
    const bsonType = (typeEntry['x-bsonType'] as string) ?? '';

    switch (bsonType) {
        case 'string':
        case 'binary': {
            const minLen = typeEntry['x-minLength'] as number | undefined;
            const maxLen = typeEntry['x-maxLength'] as number | undefined;
            if (minLen !== undefined && maxLen !== undefined) {
                return `length: ${String(minLen)}–${String(maxLen)}`;
            }
            return undefined;
        }

        case 'int32':
        case 'double':
        case 'long':
        case 'decimal128':
        case 'number': {
            const minVal = typeEntry['x-minValue'] as number | undefined;
            const maxVal = typeEntry['x-maxValue'] as number | undefined;
            if (minVal !== undefined && maxVal !== undefined) {
                return `range: ${String(minVal)}–${String(maxVal)}`;
            }
            return undefined;
        }

        case 'date': {
            const minDate = typeEntry['x-minDate'] as number | undefined;
            const maxDate = typeEntry['x-maxDate'] as number | undefined;
            if (minDate !== undefined && maxDate !== undefined) {
                const minISO = new Date(minDate).toISOString().split('T')[0];
                const maxISO = new Date(maxDate).toISOString().split('T')[0];
                return `range: ${minISO} – ${maxISO}`;
            }
            return undefined;
        }

        case 'boolean': {
            const trueCount = typeEntry['x-trueCount'] as number | undefined;
            const falseCount = typeEntry['x-falseCount'] as number | undefined;
            if (trueCount !== undefined && falseCount !== undefined) {
                return `true: ${String(trueCount)}, false: ${String(falseCount)}`;
            }
            return undefined;
        }

        case 'array': {
            const minItems = typeEntry['x-minItems'] as number | undefined;
            const maxItems = typeEntry['x-maxItems'] as number | undefined;
            if (minItems !== undefined && maxItems !== undefined) {
                return `items: ${String(minItems)}–${String(maxItems)}`;
            }
            return undefined;
        }

        case 'object': {
            const minProps = typeEntry['x-minProperties'] as number | undefined;
            const maxProps = typeEntry['x-maxProperties'] as number | undefined;
            if (minProps !== undefined && maxProps !== undefined) {
                return `properties: ${String(minProps)}–${String(maxProps)}`;
            }
            return undefined;
        }

        default:
            return undefined;
    }
}
