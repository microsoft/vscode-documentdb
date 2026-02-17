/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { assert } from 'console';
import Denque from 'denque';
import { type Document, type WithId } from 'mongodb';
import { BSONTypes } from './BSONTypes';
import { type JSONSchema, type JSONSchemaRef } from './JSONSchema';
import { type FieldEntry, getKnownFields as getKnownFieldsFromSchema } from './getKnownFields';

/**
 * Incremental schema analyzer for documents from the MongoDB API / DocumentDB API.
 *
 * Analyzes documents one at a time (or in batches) and builds a cumulative
 * JSON Schema with statistical extensions (x-occurrence, x-bsonType, etc.).
 *
 * The output schema follows JSON Schema draft-07 with custom x- extensions.
 */
export class SchemaAnalyzer {
    private _schema: JSONSchema = {};
    private _version: number = 0;
    private _knownFieldsCache: FieldEntry[] | null = null;
    private _knownFieldsCacheVersion: number = -1;

    /**
     * A monotonically increasing version counter. Incremented on every mutation
     * (addDocument, addDocuments, reset). Adapters can store this value alongside
     * their cached derived data and recompute only when it changes.
     */
    get version(): number {
        return this._version;
    }

    /**
     * Adds a single document to the accumulated schema.
     * This is the primary incremental API — call once per document.
     */
    addDocument(document: WithId<Document>): void {
        updateSchemaWithDocumentInternal(this._schema, document);
        this._version++;
    }

    /**
     * Adds multiple documents to the accumulated schema.
     * Convenience method equivalent to calling addDocument() for each.
     * Increments version once for the entire batch — not per document.
     */
    addDocuments(documents: ReadonlyArray<WithId<Document>>): void {
        for (const doc of documents) {
            updateSchemaWithDocumentInternal(this._schema, doc);
        }
        this._version++;
    }

    /**
     * Returns the current accumulated JSON Schema.
     * The returned object is a live reference (not a copy) — do not mutate externally.
     */
    getSchema(): JSONSchema {
        return this._schema;
    }

    /**
     * Returns the number of documents analyzed so far.
     */
    getDocumentCount(): number {
        return (this._schema['x-documentsInspected'] as number) ?? 0;
    }

    /**
     * Resets the analyzer to its initial empty state.
     */
    reset(): void {
        this._schema = {};
        this._version++;
    }

    /**
     * Creates a deep copy of this analyzer, including all accumulated schema data.
     * Useful for aggregation stage branching where each stage needs its own schema state.
     * The clone starts with version 0, independent from the original.
     */
    clone(): SchemaAnalyzer {
        const copy = new SchemaAnalyzer();
        copy._schema = structuredClone(this._schema);
        return copy;
    }

    /**
     * Returns the cached list of known fields (all nesting levels, sorted).
     * Recomputed only when the schema version has changed since the last call.
     */
    getKnownFields(): FieldEntry[] {
        if (this._knownFieldsCacheVersion !== this._version || this._knownFieldsCache === null) {
            this._knownFieldsCache = getKnownFieldsFromSchema(this._schema);
            this._knownFieldsCacheVersion = this._version;
        }
        return this._knownFieldsCache;
    }

    /**
     * Creates a SchemaAnalyzer from a single document.
     * Equivalent to creating an instance and calling addDocument() once.
     */
    static fromDocument(document: WithId<Document>): SchemaAnalyzer {
        const analyzer = new SchemaAnalyzer();
        analyzer.addDocument(document);
        return analyzer;
    }

    /**
     * Creates a SchemaAnalyzer from multiple documents.
     * Equivalent to creating an instance and calling addDocuments().
     */
    static fromDocuments(documents: ReadonlyArray<WithId<Document>>): SchemaAnalyzer {
        const analyzer = new SchemaAnalyzer();
        analyzer.addDocuments(documents);
        return analyzer;
    }
}

function updateSchemaWithDocumentInternal(schema: JSONSchema, document: WithId<Document>): void {
    // Initialize schema if it's empty
    if (!schema.properties) {
        schema.properties = {};
        schema['x-documentsInspected'] = 0;
    }

    schema['x-documentsInspected'] = (schema['x-documentsInspected'] ?? 0) + 1;

    // Define the structure of work items to be processed
    type WorkItem = {
        fieldName: string;
        fieldMongoType: BSONTypes; // The inferred BSON type
        propertySchema: JSONSchema; // Reference to the schema entry within 'properties'
        fieldValue: unknown;
        pathSoFar: string; // Used for debugging and tracing
    };

    // Initialize a FIFO queue for breadth-first traversal
    const fifoQueue: Denque<WorkItem> = new Denque();

    /**
     * Start by pushing all root-level elements of the document into the queue
     */
    for (const [name, value] of Object.entries(document)) {
        const mongoDatatype = BSONTypes.inferType(value);

        // Ensure the field exists in the schema
        if (!schema.properties[name]) {
            // Initialize the property schema if it doesn't exist
            schema.properties[name] = {
                anyOf: [],
                'x-occurrence': 0,
            };
        }

        const propertySchema: JSONSchema = schema.properties[name] as JSONSchema;
        assert(propertySchema !== undefined, 'propertySchema should not be undefined');

        // Increment the field occurrence count
        propertySchema['x-occurrence'] = (propertySchema['x-occurrence'] ?? 0) + 1;

        // Find or create the type entry in 'anyOf'
        let typeEntry = findTypeEntry(propertySchema.anyOf as JSONSchema[], mongoDatatype);

        if (!typeEntry) {
            // Create a new type entry
            typeEntry = {
                type: BSONTypes.toJSONType(mongoDatatype),
                'x-bsonType': mongoDatatype,
                'x-typeOccurrence': 0,
            };
            if (!propertySchema.anyOf) {
                propertySchema.anyOf = [];
            }
            propertySchema.anyOf.push(typeEntry);
        }

        // Increment the type occurrence count
        typeEntry['x-typeOccurrence'] = (typeEntry['x-typeOccurrence'] ?? 0) + 1;

        // Push a work item into the queue for further processing
        fifoQueue.push({
            fieldName: name,
            fieldMongoType: mongoDatatype,
            propertySchema: typeEntry,
            fieldValue: value,
            pathSoFar: name,
        });
    }

    /**
     * Process items in the queue to build/update the schema
     * This is a breadth-first traversal of the document structure
     */
    while (fifoQueue.length > 0) {
        const item = fifoQueue.shift();
        if (item === undefined) {
            continue;
        }

        switch (item.fieldMongoType) {
            case BSONTypes.Object: {
                const objValue = item.fieldValue as Record<string, unknown>;
                const objKeysCount = Object.keys(objValue).length;

                // Update min and max property counts
                updateMinMaxStats(item.propertySchema, 'x-minProperties', 'x-maxProperties', objKeysCount);

                // Track how many object instances contributed to this sub-schema.
                // This enables uniform probability computation at every nesting level:
                //   probability = property.x-occurrence / parentObject.x-documentsInspected
                //
                // Without this, array-embedded objects have no denominator for probability.
                // Example: doc1.a=[], doc2.a=[{b:1},...,{b:100}]
                //   b.x-occurrence = 100, root.x-documentsInspected = 2
                //   Naive: 100/2 = 5000% — wrong!
                //   With fix: objectEntry.x-documentsInspected = 100, so 100/100 = 100%
                item.propertySchema['x-documentsInspected'] = (item.propertySchema['x-documentsInspected'] ?? 0) + 1;

                // Ensure 'properties' exists
                if (!item.propertySchema.properties) {
                    item.propertySchema.properties = {};
                }

                // Iterate over the object's properties
                for (const [name, value] of Object.entries(objValue)) {
                    const mongoDatatype = BSONTypes.inferType(value);

                    // Ensure the field exists in the schema
                    if (!item.propertySchema.properties[name]) {
                        // Initialize the property schema if it doesn't exist
                        item.propertySchema.properties[name] = {
                            anyOf: [],
                            'x-occurrence': 0,
                        };
                    }

                    const propertySchema: JSONSchema = item.propertySchema.properties[name] as JSONSchema;
                    assert(propertySchema !== undefined, 'propertySchema should not be undefined');

                    // Increment the field occurrence count
                    propertySchema['x-occurrence'] = (propertySchema['x-occurrence'] ?? 0) + 1;

                    // Find or create the type entry in 'anyOf'
                    let typeEntry = findTypeEntry(propertySchema.anyOf as JSONSchema[], mongoDatatype);

                    if (!typeEntry) {
                        // Create a new type entry
                        typeEntry = {
                            type: BSONTypes.toJSONType(mongoDatatype),
                            'x-bsonType': mongoDatatype,
                            'x-typeOccurrence': 0,
                        };
                        if (!propertySchema.anyOf) {
                            propertySchema.anyOf = [];
                        }
                        propertySchema.anyOf.push(typeEntry);
                    }

                    // Increment the type occurrence count
                    typeEntry['x-typeOccurrence'] = (typeEntry['x-typeOccurrence'] ?? 0) + 1;

                    // Queue the property's value for further processing
                    fifoQueue.push({
                        fieldName: name,
                        fieldMongoType: mongoDatatype,
                        propertySchema: typeEntry,
                        fieldValue: value,
                        pathSoFar: `${item.pathSoFar}.${name}`,
                    });
                }
                break;
            }

            case BSONTypes.Array: {
                const arrayValue = item.fieldValue as unknown[];
                const arrayLength = arrayValue.length;

                // Update min and max array lengths
                updateMinMaxStats(item.propertySchema, 'x-minItems', 'x-maxItems', arrayLength);

                // Ensure 'items' exists
                if (!item.propertySchema.items) {
                    item.propertySchema.items = {
                        anyOf: [],
                    };
                }

                const itemsSchema: JSONSchema = item.propertySchema.items as JSONSchema;
                assert(itemsSchema !== undefined, 'itemsSchema should not be undefined');

                // Iterate over the array elements
                for (const element of arrayValue) {
                    const elementMongoType = BSONTypes.inferType(element);

                    // Find or create the type entry in 'items.anyOf'
                    let itemEntry = findTypeEntry(itemsSchema.anyOf as JSONSchema[], elementMongoType);
                    const isNewTypeEntry = !itemEntry;

                    if (!itemEntry) {
                        // Create a new type entry
                        itemEntry = {
                            type: BSONTypes.toJSONType(elementMongoType),
                            'x-bsonType': elementMongoType,
                            'x-typeOccurrence': 0,
                        };
                        if (!itemsSchema.anyOf) {
                            itemsSchema.anyOf = [];
                        }
                        itemsSchema.anyOf.push(itemEntry);
                    }

                    // Increment the type occurrence count
                    itemEntry['x-typeOccurrence'] = (itemEntry['x-typeOccurrence'] ?? 0) + 1;

                    // Update stats for the element.
                    // Use initializeStatsForValue only when the type entry is brand new
                    // (first element of this type ever seen). For subsequent elements —
                    // whether in the same array or across documents — always aggregate
                    // to avoid overwriting previously accumulated min/max stats.
                    if (isNewTypeEntry) {
                        initializeStatsForValue(element, elementMongoType, itemEntry);
                    } else {
                        aggregateStatsForValue(element, elementMongoType, itemEntry);
                    }

                    // If the element is an object or array, queue it for further processing
                    if (elementMongoType === BSONTypes.Object || elementMongoType === BSONTypes.Array) {
                        fifoQueue.push({
                            fieldName: '[]', // Array items don't have a specific field name
                            fieldMongoType: elementMongoType,
                            propertySchema: itemEntry,
                            fieldValue: element,
                            pathSoFar: `${item.pathSoFar}[]`,
                        });
                    }
                }
                break;
            }

            default: {
                // Update stats for the value
                if (item.propertySchema['x-typeOccurrence'] === 1) {
                    // First occurrence, initialize stats
                    initializeStatsForValue(item.fieldValue, item.fieldMongoType, item.propertySchema);
                } else {
                    // Subsequent occurrences, aggregate stats
                    aggregateStatsForValue(item.fieldValue, item.fieldMongoType, item.propertySchema);
                }
                break;
            }
        }
    }
}

/**
 * Helper function to find a type entry in 'anyOf' array based on 'x-bsonType'
 */
function findTypeEntry(anyOfArray: JSONSchema[], bsonType: BSONTypes): JSONSchema | undefined {
    return anyOfArray.find((entry) => entry['x-bsonType'] === bsonType);
}

/**
 * Helper function to update min and max stats
 */
function updateMinMaxStats(schema: JSONSchema, minKey: string, maxKey: string, value: number): void {
    const record = schema as Record<string, unknown>;
    if (record[minKey] === undefined || value < (record[minKey] as number)) {
        record[minKey] = value;
    }
    if (record[maxKey] === undefined || value > (record[maxKey] as number)) {
        record[maxKey] = value;
    }
}

/**
 * Helper function to compute stats for a value based on its MongoDB data type
 * Updates the provided propertyTypeEntry with the computed stats
 */
function initializeStatsForValue(value: unknown, mongoType: BSONTypes, propertyTypeEntry: JSONSchema): void {
    switch (mongoType) {
        case BSONTypes.String: {
            const currentLength = (value as string).length;
            propertyTypeEntry['x-maxLength'] = currentLength;
            propertyTypeEntry['x-minLength'] = currentLength;
            break;
        }

        case BSONTypes.Number:
        case BSONTypes.Int32:
        case BSONTypes.Long:
        case BSONTypes.Double:
        case BSONTypes.Decimal128: {
            const numericValue = Number(value);
            propertyTypeEntry['x-maxValue'] = numericValue;
            propertyTypeEntry['x-minValue'] = numericValue;
            break;
        }

        case BSONTypes.Boolean: {
            const boolValue = value as boolean;
            propertyTypeEntry['x-trueCount'] = boolValue ? 1 : 0;
            propertyTypeEntry['x-falseCount'] = boolValue ? 0 : 1;
            break;
        }

        case BSONTypes.Date: {
            const dateValue = (value as Date).getTime();
            propertyTypeEntry['x-maxDate'] = dateValue;
            propertyTypeEntry['x-minDate'] = dateValue;
            break;
        }

        case BSONTypes.Binary: {
            const binaryLength = (value as Buffer).length;
            propertyTypeEntry['x-maxLength'] = binaryLength;
            propertyTypeEntry['x-minLength'] = binaryLength;
            break;
        }

        case BSONTypes.Null:
        case BSONTypes.RegExp:
        case BSONTypes.ObjectId:
        case BSONTypes.MinKey:
        case BSONTypes.MaxKey:
        case BSONTypes.Symbol:
        case BSONTypes.Timestamp:
        case BSONTypes.DBRef:
        case BSONTypes.Map:
            // No stats computation for other types
            break;

        default:
            // No stats computation for other types
            break;
    }
}

/**
 * Helper function to aggregate stats for a value based on its MongoDB data type
 * Used when processing multiple values (e.g., elements in arrays)
 */
function aggregateStatsForValue(value: unknown, mongoType: BSONTypes, propertyTypeEntry: JSONSchema): void {
    switch (mongoType) {
        case BSONTypes.String: {
            const currentLength = (value as string).length;

            // Update minLength
            if (propertyTypeEntry['x-minLength'] === undefined || currentLength < propertyTypeEntry['x-minLength']) {
                propertyTypeEntry['x-minLength'] = currentLength;
            }

            // Update maxLength
            if (propertyTypeEntry['x-maxLength'] === undefined || currentLength > propertyTypeEntry['x-maxLength']) {
                propertyTypeEntry['x-maxLength'] = currentLength;
            }
            break;
        }

        case BSONTypes.Number:
        case BSONTypes.Int32:
        case BSONTypes.Long:
        case BSONTypes.Double:
        case BSONTypes.Decimal128: {
            const numericValue = Number(value);

            // Update minValue
            if (propertyTypeEntry['x-minValue'] === undefined || numericValue < propertyTypeEntry['x-minValue']) {
                propertyTypeEntry['x-minValue'] = numericValue;
            }

            // Update maxValue
            if (propertyTypeEntry['x-maxValue'] === undefined || numericValue > propertyTypeEntry['x-maxValue']) {
                propertyTypeEntry['x-maxValue'] = numericValue;
            }
            break;
        }

        case BSONTypes.Boolean: {
            const boolValue = value as boolean;

            // Update trueCount and falseCount
            if (propertyTypeEntry['x-trueCount'] === undefined) {
                propertyTypeEntry['x-trueCount'] = boolValue ? 1 : 0;
            } else {
                propertyTypeEntry['x-trueCount'] += boolValue ? 1 : 0;
            }

            if (propertyTypeEntry['x-falseCount'] === undefined) {
                propertyTypeEntry['x-falseCount'] = boolValue ? 0 : 1;
            } else {
                propertyTypeEntry['x-falseCount'] += boolValue ? 0 : 1;
            }
            break;
        }

        case BSONTypes.Date: {
            const dateValue = (value as Date).getTime();

            // Update minDate
            if (propertyTypeEntry['x-minDate'] === undefined || dateValue < propertyTypeEntry['x-minDate']) {
                propertyTypeEntry['x-minDate'] = dateValue;
            }

            // Update maxDate
            if (propertyTypeEntry['x-maxDate'] === undefined || dateValue > propertyTypeEntry['x-maxDate']) {
                propertyTypeEntry['x-maxDate'] = dateValue;
            }
            break;
        }

        case BSONTypes.Binary: {
            const binaryLength = (value as Buffer).length;

            // Update minLength
            if (propertyTypeEntry['x-minLength'] === undefined || binaryLength < propertyTypeEntry['x-minLength']) {
                propertyTypeEntry['x-minLength'] = binaryLength;
            }

            // Update maxLength
            if (propertyTypeEntry['x-maxLength'] === undefined || binaryLength > propertyTypeEntry['x-maxLength']) {
                propertyTypeEntry['x-maxLength'] = binaryLength;
            }
            break;
        }

        default:
            // No stats computation for other types
            break;
    }
}

function getSchemaAtPath(schema: JSONSchema, path: string[]): JSONSchema | undefined {
    let currentNode: JSONSchema | undefined = schema;

    for (let i = 0; i < path.length; i++) {
        const key = path[i];

        // Move to the next property in the schema
        if (currentNode && currentNode.properties && currentNode.properties[key]) {
            const nextNode: JSONSchema = currentNode.properties[key] as JSONSchema;
            /**
             * Now, with our JSON Schema, there are "anyOf" entries that we need to consider.
             * We're looking at the "Object"-one, because these have the properties we're interested in.
             */
            if (nextNode.anyOf && nextNode.anyOf.length > 0) {
                currentNode = nextNode.anyOf.find(
                    (entry: JSONSchemaRef): entry is JSONSchema => typeof entry === 'object' && entry.type === 'object',
                );
            } else {
                // we can't continue, as we're missing the next node, we abort at the last node we managed to extract
                return currentNode;
            }
        } else {
            throw new Error(`No properties found in the schema at path "${path.slice(0, i + 1).join('/')}"`);
        }
    }

    return currentNode; // Return the node at the path
}

export function getPropertyNamesAtLevel(jsonSchema: JSONSchema, path: string[]): string[] {
    const headers = new Set<string>();

    // Explore the schema and apply the callback to collect headers at the specified path
    const selectedSchema = getSchemaAtPath(jsonSchema, path);

    if (selectedSchema && selectedSchema.properties) {
        Object.keys(selectedSchema.properties).forEach((key) => {
            headers.add(key);
        });
    }

    return Array.from(headers).sort((a, b) => {
        if (a === '_id') return -1; // _id should come before b
        if (b === '_id') return 1; // _id should come after a
        return a.localeCompare(b); // regular sorting
    });
}

export function buildFullPaths(path: string[], propertyNames: string[]): string[] {
    return propertyNames.map((name) => path.concat(name).join('.'));
}
