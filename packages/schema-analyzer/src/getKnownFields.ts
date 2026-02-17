/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import Denque from 'denque';
import { type JSONSchema } from './JSONSchema';

export interface FieldEntry {
    /** Dot-notated path (e.g., "user.profile.name") */
    path: string;
    /** JSON type of the dominant type entry ("string", "number", "object", "array", etc.) */
    type: string;
    /** Dominant BSON type from x-bsonType on the most common type entry ("date", "objectid", "int32", etc.) */
    bsonType: string;
    /** All observed BSON types for this field (for polymorphic fields) */
    bsonTypes?: string[];
    /**
     * True if this field was not present in every inspected document
     * (x-occurrence < parent x-documentsInspected).
     *
     * This is a statistical observation, not a schema constraint — in the
     * MongoDB API / DocumentDB API all fields are implicitly optional.
     */
    isSparse?: boolean;
    /** If the field is an array, the dominant element BSON type */
    arrayItemBsonType?: string;
}

/**
 * This function traverses our JSON Schema object and collects all leaf property paths
 * along with their most common data types.
 *
 * This information is needed for auto-completion support
 *
 * The approach is as follows:
 * - Initialize a queue with the root properties of the schema to perform a breadth-first traversal.
 * - While the queue is not empty:
 *   - Dequeue the next item, which includes the current schema node and its path.
 *   - Determine the most common type for the current node by looking at the 'x-typeOccurrence' field.
 *   - If the most common type is an object with properties:
 *     - Enqueue its child properties with their updated paths into the queue for further traversal.
 *   - Else if the most common type is a leaf type (e.g., string, number, boolean):
 *     - Add the current path and type to the result array as it represents a leaf property.
 * - Continue this process until all nodes have been processed.
 * - Return the result array containing objects with 'path' and 'type' for each leaf property.
 */
export function getKnownFields(schema: JSONSchema): FieldEntry[] {
    const result: FieldEntry[] = [];

    type QueueItem = {
        path: string;
        schemaNode: JSONSchema;
        parentDocumentsInspected: number;
    };

    const rootDocumentsInspected = (schema['x-documentsInspected'] as number) ?? 0;
    const queue: Denque<QueueItem> = new Denque();

    // Initialize the queue with root properties
    if (schema.properties) {
        for (const propName of Object.keys(schema.properties)) {
            const propSchema = schema.properties[propName] as JSONSchema;
            queue.push({
                path: propName,
                schemaNode: propSchema,
                parentDocumentsInspected: rootDocumentsInspected,
            });
        }
    }

    while (queue.length > 0) {
        const item = queue.shift();
        if (!item) continue;

        const { path, schemaNode, parentDocumentsInspected } = item;
        const mostCommonTypeEntry = getMostCommonTypeEntry(schemaNode);

        if (mostCommonTypeEntry) {
            if (mostCommonTypeEntry.type === 'object' && mostCommonTypeEntry.properties) {
                // Not a leaf node, enqueue its properties
                const objectDocumentsInspected = (mostCommonTypeEntry['x-documentsInspected'] as number) ?? 0;
                for (const childName of Object.keys(mostCommonTypeEntry.properties)) {
                    const childSchema = mostCommonTypeEntry.properties[childName] as JSONSchema;
                    // TODO: Dot-delimited path concatenation is ambiguous when a field name
                    // itself contains a literal dot. For example, a root-level field named
                    // "a.b" produces path "a.b", indistinguishable from a nested field
                    // { a: { b: ... } }. Fields with literal dots in their names were
                    // prohibited before MongoDB 3.6 and remain rare in practice.
                    //
                    // Future improvement: change `path` from `string` to `string[]`
                    // (segment array) to preserve the distinction between nesting and
                    // literal dots, pushing escaping/formatting decisions to consumers
                    // (TS definitions, completion items, aggregation references, etc.).
                    queue.push({
                        path: `${path}.${childName}`,
                        schemaNode: childSchema,
                        parentDocumentsInspected: objectDocumentsInspected,
                    });
                }
            } else {
                // Leaf node, build the FieldEntry
                const bsonType = (mostCommonTypeEntry['x-bsonType'] as string) ?? (mostCommonTypeEntry.type as string);

                const entry: FieldEntry = {
                    path,
                    type: mostCommonTypeEntry.type as string,
                    bsonType,
                };

                // bsonTypes: collect all distinct x-bsonType values from anyOf entries
                const allBsonTypes = collectBsonTypes(schemaNode);
                if (allBsonTypes.length >= 2) {
                    entry.bsonTypes = allBsonTypes;
                }

                // isSparse: field was not observed in every document
                const occurrence = (schemaNode['x-occurrence'] as number) ?? 0;
                if (parentDocumentsInspected > 0 && occurrence < parentDocumentsInspected) {
                    entry.isSparse = true;
                }

                // arrayItemBsonType: for array fields, find the dominant element type
                if (mostCommonTypeEntry.type === 'array') {
                    const itemBsonType = getDominantArrayItemBsonType(mostCommonTypeEntry);
                    if (itemBsonType) {
                        entry.arrayItemBsonType = itemBsonType;
                    }
                }

                result.push(entry);
            }
        }
    }

    // Sort: _id first, then alphabetical by path
    result.sort((a, b) => {
        if (a.path === '_id') return -1;
        if (b.path === '_id') return 1;
        return a.path.localeCompare(b.path);
    });

    return result;
}

/**
 * Helper function to get the most common type entry from a schema node.
 * It looks for the 'anyOf' array and selects the type with the highest 'x-typeOccurrence'.
 */
function getMostCommonTypeEntry(schemaNode: JSONSchema): JSONSchema | null {
    if (schemaNode.anyOf && schemaNode.anyOf.length > 0) {
        let maxOccurrence = -1;
        let mostCommonTypeEntry: JSONSchema | null = null;

        for (const typeEntry of schemaNode.anyOf as JSONSchema[]) {
            const occurrence = typeEntry['x-typeOccurrence'] || 0;
            if (occurrence > maxOccurrence) {
                maxOccurrence = occurrence;
                mostCommonTypeEntry = typeEntry;
            }
        }
        return mostCommonTypeEntry;
    } else if (schemaNode.type) {
        // If 'anyOf' is not present, use the 'type' field directly
        return schemaNode;
    }
    return null;
}

/**
 * Collects all distinct x-bsonType values from a schema node's anyOf entries.
 * Returns them sorted alphabetically for determinism.
 */
function collectBsonTypes(schemaNode: JSONSchema): string[] {
    if (!schemaNode.anyOf || schemaNode.anyOf.length === 0) {
        return [];
    }

    const bsonTypes = new Set<string>();
    for (const entry of schemaNode.anyOf as JSONSchema[]) {
        const bsonType = entry['x-bsonType'] as string | undefined;
        if (bsonType) {
            bsonTypes.add(bsonType);
        }
    }

    return Array.from(bsonTypes).sort();
}

/**
 * For an array type entry, finds the dominant element BSON type by looking at
 * items.anyOf and selecting the entry with the highest x-typeOccurrence.
 */
function getDominantArrayItemBsonType(arrayTypeEntry: JSONSchema): string | undefined {
    const itemsSchema = arrayTypeEntry.items as JSONSchema | undefined;
    if (!itemsSchema?.anyOf || itemsSchema.anyOf.length === 0) {
        return undefined;
    }

    let maxOccurrence = -1;
    let dominantBsonType: string | undefined;

    for (const entry of itemsSchema.anyOf as JSONSchema[]) {
        const occurrence = (entry['x-typeOccurrence'] as number) ?? 0;
        if (occurrence > maxOccurrence) {
            maxOccurrence = occurrence;
            dominantBsonType = entry['x-bsonType'] as string | undefined;
        }
    }

    return dominantBsonType;
}
