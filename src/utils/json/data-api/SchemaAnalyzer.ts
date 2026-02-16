/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * This is an example of a JSON Schema document that will be generated from MongoDB documents.
 * It's optimized for the use-case of generating a schema for a table view, the monaco editor, and schema statistics.
 *
 * This is a 'work in progress' and will be updated as we progress with the project.
 *
 * Curent focus is:
 *  - discovery of the document structure
 *  - basic pre for future statistics work
 *
 * Future tasks:
 *  - statistics aggregation
 *  - meaningful 'description' and 'markdownDescription'
 *  - add more properties to the schema, incl. properties like '$id', '$schema', and enable schema sharing/download
 *

{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://example.com/sample.schema.json",
  "title": "Sample Document Schema",
  "type": "object",
  "properties": {
    "a-propert-root-level": {
      "description": "a description as text",
      "anyOf": [ // anyOf is used to indicate that the value can be of any of the types listed
        {
          "type": "string"
        },
        {
          "type": "string"
        }
      ]
    },
    "isOpen": {
      "description": "Indicates if the item is open",
      "anyOf": [
        {
          "type": "boolean"
        },
        {
          "type": "number"
        }
      ]
    }
  },
  "required": ["isOpen"]
}

 *
 *
 */

import * as l10n from '@vscode/l10n';
import { assert } from 'console';
import Denque from 'denque';
import { type Document, type WithId } from 'mongodb';
import { type JSONSchema } from '../JSONSchema';
import { BSONTypes } from './BSONTypes';

export function updateSchemaWithDocument(schema: JSONSchema, document: WithId<Document>): void {
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
    if (schema[minKey] === undefined || value < schema[minKey]) {
        schema[minKey] = value;
    }
    if (schema[maxKey] === undefined || value > schema[maxKey]) {
        schema[maxKey] = value;
    }
}

export function getSchemaFromDocument(document: WithId<Document>): JSONSchema {
    const schema: JSONSchema = {};
    schema['x-documentsInspected'] = 1; // we're inspecting one document, this will make sense when we start aggregating stats
    schema.properties = {};

    type WorkItem = {
        fieldName: string;
        fieldMongoType: BSONTypes; // the inferred BSON type
        propertyTypeEntry: JSONSchema; // points to the entry within the 'anyOf' property of the schema
        fieldValue: unknown;
        pathSoFar: string; // used for debugging
    };

    // having some import/require issues with Denque atm
    // prototype with an array
    //const fifoQueue = new Denque();
    const fifoQueue: WorkItem[] = [];

    /**
     * Push all elements from the root of the document into the queue
     */
    for (const [name, value] of Object.entries(document)) {
        const mongoDatatype = BSONTypes.inferType(value);

        const typeEntry = {
            type: BSONTypes.toJSONType(mongoDatatype),
            'x-bsonType': mongoDatatype,
            'x-typeOccurrence': 1,
        };

        // please note (1/2): we're adding the type entry to the schema here
        schema.properties[name] = { anyOf: [typeEntry], 'x-occurrence': 1 };

        fifoQueue.push({
            fieldName: name,
            fieldMongoType: mongoDatatype,
            propertyTypeEntry: typeEntry, // please note (2/2): and we're keeping a reference to it here for further updates
            fieldValue: value,
            pathSoFar: name,
        });
    }

    /**
     * Work through the queue, adding elements to the schema as we go.
     * This is a breadth-first search of the document, do note special
     * handling on objects/arrays
     */
    while (fifoQueue.length > 0) {
        const item = fifoQueue.shift(); // todo, replace with a proper queue
        if (item === undefined) {
            // unexpected, but let's try to continue
            continue;
        }

        switch (item.fieldMongoType) {
            case BSONTypes.Object: {
                const objKeys = Object.keys(item.fieldValue as object).length;
                item.propertyTypeEntry['x-maxLength'] = objKeys;
                item.propertyTypeEntry['x-minLength'] = objKeys;

                // prepare an entry for the object properties
                item.propertyTypeEntry.properties = {};

                for (const [name, value] of Object.entries(item.fieldValue as object)) {
                    const mongoDatatype = BSONTypes.inferType(value);

                    const typeEntry = {
                        type: BSONTypes.toJSONType(mongoDatatype),
                        'x-bsonType': mongoDatatype,
                        'x-typeOccurrence': 1,
                    };

                    // please note (1/2): we're adding the entry to the main schema here
                    item.propertyTypeEntry.properties[name] = { anyOf: [typeEntry], 'x-occurrence': 1 };

                    fifoQueue.push({
                        fieldName: name,
                        fieldMongoType: mongoDatatype,
                        propertyTypeEntry: typeEntry, // please note (2/2): and we're keeping a reference to it here for further updates to the schema
                        fieldValue: value,
                        pathSoFar: `${item.pathSoFar}.${item.fieldName}`,
                    });
                }
                break;
            }
            case BSONTypes.Array: {
                const arrayLength = (item.fieldValue as unknown[]).length;
                item.propertyTypeEntry['x-maxLength'] = arrayLength;
                item.propertyTypeEntry['x-minLength'] = arrayLength;

                // preapare the array items entry (in two lines for ts not to compalin about the missing type later on)
                item.propertyTypeEntry.items = {};
                item.propertyTypeEntry.items.anyOf = [];

                const encounteredMongoTypes: Map<BSONTypes, JSONSchema> = new Map();

                // iterate over the array and infer the type of each element
                for (const element of item.fieldValue as unknown[]) {
                    const elementMongoType = BSONTypes.inferType(element);

                    let itemEntry: JSONSchema;

                    if (!encounteredMongoTypes.has(elementMongoType)) {
                        itemEntry = {
                            type: BSONTypes.toJSONType(elementMongoType),
                            'x-bsonType': elementMongoType,
                            'x-typeOccurrence': 1, // Initialize type occurrence counter
                        };
                        item.propertyTypeEntry.items.anyOf.push(itemEntry);
                        encounteredMongoTypes.set(elementMongoType, itemEntry);

                        initializeStatsForValue(element, elementMongoType, itemEntry);
                    } else {
                        // if we've already encountered this type, we'll just add the type to the existing entry
                        itemEntry = encounteredMongoTypes.get(elementMongoType) as JSONSchema;

                        if (itemEntry === undefined) continue; // unexpected, but let's try to continue

                        if (itemEntry['x-typeOccurrence'] !== undefined) {
                            itemEntry['x-typeOccurrence'] += 1;
                        }

                        // Aggregate stats with the new value
                        aggregateStatsForValue(element, elementMongoType, itemEntry);
                    }

                    // an imporant exception for arrays as we have to start adding them already now to the schema
                    // (if we want to avoid more iterations over the data)
                    if (elementMongoType === BSONTypes.Object || elementMongoType === BSONTypes.Array) {
                        fifoQueue.push({
                            fieldName: '[]', // Array items don't have a field name
                            fieldMongoType: elementMongoType,
                            propertyTypeEntry: itemEntry,
                            fieldValue: element,
                            pathSoFar: `${item.pathSoFar}.${item.fieldName}.items`,
                        });
                    }
                }

                break;
            }

            default: {
                // For all other types, update stats for the value
                initializeStatsForValue(item.fieldValue, item.fieldMongoType, item.propertyTypeEntry);
                break;
            }
        }
    }

    return schema;
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

function getSchemaAtPath(schema: JSONSchema, path: string[]): JSONSchema {
    let currentNode = schema;

    for (let i = 0; i < path.length; i++) {
        const key = path[i];

        // If the current node is an array, we should move to its `items`
        // if (currentNode.type === 'array' && currentNode.items) {
        //     currentNode = currentNode.items;
        // }

        // Move to the next property in the schema
        if (currentNode && currentNode.properties && currentNode.properties[key]) {
            const nextNode: JSONSchema = currentNode.properties[key] as JSONSchema;
            /**
             * Now, with our JSON Schema, there are "anyOf" entries that we need to consider.
             * We're looking at the "Object"-one, because these have the properties we're interested in.
             */
            if (nextNode.anyOf && nextNode.anyOf.length > 0) {
                currentNode = nextNode.anyOf.find((entry: JSONSchema) => entry.type === 'object') as JSONSchema;
            } else {
                // we can't continue, as we're missing the next node, we abort at the last node we managed to extract
                return currentNode;
            }
        } else {
            throw new Error(l10n.t('No properties found in the schema at path "{0}"', path.slice(0, i + 1).join('/')));
        }
    }

    return currentNode; // Return the node at the path
}

export function getPropertyNamesAtLevel(jsonSchema: JSONSchema, path: string[]): string[] {
    const headers = new Set<string>();

    // Explore the schema and apply the callback to collect headers at the specified path
    const selectedSchema: JSONSchema = getSchemaAtPath(jsonSchema, path);

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
