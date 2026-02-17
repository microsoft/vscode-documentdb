/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { BSONTypes, type JSONSchema } from '@vscode-documentdb/schema-analyzer';

/**
 * Maps a BSON type string to the corresponding TypeScript type representation.
 */
const bsonToTypeScriptMap: Record<string, string> = {
    [BSONTypes.String]: 'string',
    [BSONTypes.Int32]: 'number',
    [BSONTypes.Double]: 'number',
    [BSONTypes.Long]: 'number',
    [BSONTypes.Decimal128]: 'number',
    [BSONTypes.Number]: 'number',
    [BSONTypes.Boolean]: 'boolean',
    [BSONTypes.Date]: 'Date',
    [BSONTypes.ObjectId]: 'ObjectId',
    [BSONTypes.Null]: 'null',
    [BSONTypes.Undefined]: 'undefined',
    [BSONTypes.Binary]: 'Binary',
    [BSONTypes.RegExp]: 'RegExp',
    [BSONTypes.UUID]: 'UUID',
    [BSONTypes.UUID_LEGACY]: 'UUID',
    [BSONTypes.Timestamp]: 'Timestamp',
    [BSONTypes.MinKey]: 'MinKey',
    [BSONTypes.MaxKey]: 'MaxKey',
    [BSONTypes.Code]: 'Code',
    [BSONTypes.CodeWithScope]: 'Code',
    [BSONTypes.DBRef]: 'DBRef',
    [BSONTypes.Map]: 'Map<string, unknown>',
    [BSONTypes.Symbol]: 'symbol',
};

/**
 * Converts a BSON type string to a TypeScript type string.
 */
function bsonTypeToTS(bsonType: string): string {
    return bsonToTypeScriptMap[bsonType] ?? 'unknown';
}

/**
 * Matches valid JavaScript/TypeScript identifiers.
 * A valid identifier starts with a letter, underscore, or dollar sign,
 * followed by zero or more letters, digits, underscores, or dollar signs.
 */
const JS_IDENTIFIER_PATTERN = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;

/**
 * Returns a safe TypeScript property name for use in interface definitions.
 * If the name is a valid JS identifier, it is returned as-is.
 * Otherwise, it is wrapped in double quotes with internal quotes and backslashes escaped.
 *
 * Examples:
 *  - "age" → "age" (valid identifier, unchanged)
 *  - "order-items" → '"order-items"' (dash)
 *  - "a.b" → '"a.b"' (dot)
 *  - "my field" → '"my field"' (space)
 *  - 'say"hi"' → '"say\\"hi\\""' (embedded quotes escaped)
 */
function safePropertyName(name: string): string {
    if (JS_IDENTIFIER_PATTERN.test(name)) {
        return name;
    }
    const escaped = name.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return `"${escaped}"`;
}

/**
 * Converts a collection name to PascalCase and appends "Document".
 * Examples:
 *  - "users" → "UsersDocument"
 *  - "order_items" → "OrderItemsDocument"
 */
function toInterfaceName(collectionName: string): string {
    const pascal = collectionName
        .split(/[_\-\s]+/)
        .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
        .join('');
    return `${pascal}Document`;
}

/**
 * Generates a TypeScript interface definition string from a JSONSchema
 * produced by the SchemaAnalyzer.
 *
 * @param schema - The JSON Schema with x- extensions from SchemaAnalyzer
 * @param collectionName - The MongoDB collection name, used to derive the interface name
 * @returns A formatted TypeScript interface definition string
 */
export function toTypeScriptDefinition(schema: JSONSchema, collectionName: string): string {
    const interfaceName = toInterfaceName(collectionName);
    const rootDocumentsInspected = (schema['x-documentsInspected'] as number) ?? 0;

    const lines: string[] = [];
    lines.push(`interface ${interfaceName} {`);

    if (schema.properties) {
        renderProperties(schema.properties, rootDocumentsInspected, 1, lines);
    }

    lines.push('}');
    return lines.join('\n');
}

/**
 * Renders property lines for a set of JSON Schema properties at a given indent level.
 */
function renderProperties(
    properties: Record<string, JSONSchema | boolean>,
    parentDocumentsInspected: number,
    indentLevel: number,
    lines: string[],
): void {
    const indent = '    '.repeat(indentLevel);

    for (const [propName, propSchema] of Object.entries(properties)) {
        if (typeof propSchema === 'boolean') continue;

        const isOptional = isFieldOptional(propSchema, parentDocumentsInspected);
        const optionalMarker = isOptional ? '?' : '';
        const tsType = resolveTypeString(propSchema, indentLevel);
        const safeName = safePropertyName(propName);

        lines.push(`${indent}${safeName}${optionalMarker}: ${tsType};`);
    }
}

/**
 * Returns true if the field's occurrence is less than the parent's document count.
 */
function isFieldOptional(schemaNode: JSONSchema, parentDocumentsInspected: number): boolean {
    const occurrence = (schemaNode['x-occurrence'] as number) ?? 0;
    return parentDocumentsInspected > 0 && occurrence < parentDocumentsInspected;
}

/**
 * Resolves a full TypeScript type string for a schema node by examining its
 * `anyOf` entries. Handles primitives, objects (inline blocks), and arrays.
 */
function resolveTypeString(schemaNode: JSONSchema, indentLevel: number): string {
    if (!schemaNode.anyOf || schemaNode.anyOf.length === 0) {
        return 'unknown';
    }

    const typeStrings: string[] = [];

    for (const entry of schemaNode.anyOf) {
        if (typeof entry === 'boolean') continue;
        const ts = singleEntryToTS(entry, indentLevel);
        if (ts && !typeStrings.includes(ts)) {
            typeStrings.push(ts);
        }
    }

    if (typeStrings.length === 0) {
        return 'unknown';
    }

    return typeStrings.join(' | ');
}

/**
 * Converts a single `anyOf` type entry to a TypeScript type string.
 */
function singleEntryToTS(entry: JSONSchema, indentLevel: number): string {
    const bsonType = (entry['x-bsonType'] as string) ?? '';

    // Object with nested properties → inline block
    if (entry.type === 'object' && entry.properties) {
        return renderInlineObject(entry, indentLevel);
    }

    // Array → determine element types
    if (entry.type === 'array' || bsonType === (BSONTypes.Array as string)) {
        return renderArrayType(entry, indentLevel);
    }

    // Primitive or mapped type
    if (bsonType) {
        return bsonTypeToTS(bsonType);
    }

    // Fallback to JSON type
    const jsonType = entry.type as string | undefined;
    if (jsonType) {
        return jsonType;
    }

    return 'unknown';
}

/**
 * Renders an inline object type `{ field: type; ... }`.
 */
function renderInlineObject(entry: JSONSchema, indentLevel: number): string {
    const lines: string[] = [];
    const objectDocumentsInspected = (entry['x-documentsInspected'] as number) ?? 0;

    lines.push('{');

    if (entry.properties) {
        renderProperties(entry.properties, objectDocumentsInspected, indentLevel + 1, lines);
    }

    const closingIndent = '    '.repeat(indentLevel);
    lines.push(`${closingIndent}}`);

    return lines.join('\n');
}

/**
 * Renders an array type, e.g., `string[]` or `(string | number)[]`.
 */
function renderArrayType(entry: JSONSchema, indentLevel: number): string {
    const itemsSchema = entry.items;

    if (!itemsSchema || typeof itemsSchema === 'boolean') {
        return 'unknown[]';
    }

    // Items specified as a single schema (not an array of schemas)
    if (!Array.isArray(itemsSchema)) {
        const itemSchema = itemsSchema as JSONSchema;

        if (itemSchema.anyOf && itemSchema.anyOf.length > 0) {
            const elementTypes: string[] = [];
            for (const itemEntry of itemSchema.anyOf) {
                if (typeof itemEntry === 'boolean') continue;
                const ts = singleEntryToTS(itemEntry, indentLevel);
                if (ts && !elementTypes.includes(ts)) {
                    elementTypes.push(ts);
                }
            }

            if (elementTypes.length === 0) {
                return 'unknown[]';
            }

            if (elementTypes.length === 1) {
                return `${elementTypes[0]}[]`;
            }

            return `(${elementTypes.join(' | ')})[]`;
        }

        // Single item type without anyOf
        const bsonType = (itemSchema['x-bsonType'] as string) ?? '';
        if (bsonType) {
            return `${bsonTypeToTS(bsonType)}[]`;
        }

        return 'unknown[]';
    }

    return 'unknown[]';
}
