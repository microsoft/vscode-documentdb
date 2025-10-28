/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Binary, Decimal128, Double, Int32, Long, ObjectId, Timestamp, type Document } from 'mongodb';

type PrimitiveType =
    | 'string'
    | 'number'
    | 'boolean'
    | 'objectId'
    | 'date'
    | 'binary'
    | 'regex'
    | 'timestamp'
    | 'undefined'
    | 'unknown';

interface FieldSummary {
    primitiveTypes: Set<PrimitiveType>;
    hasNull: boolean;
    objectProperties?: Map<string, FieldSummary>;
    arraySummary?: ArraySummary;
}

interface ArraySummary {
    elementSummary: FieldSummary;
    vectorLengths: Set<number>;
    nonVectorObserved: boolean;
    sawValues: boolean;
}

export interface SchemaDefinition {
    collectionName?: string;
    fields: Record<string, SchemaFieldDefinition>;
}

export type SchemaFieldDefinition = string | SchemaObjectDefinition | SchemaArrayDefinition | SchemaUnionDefinition;

export interface SchemaObjectDefinition {
    type: 'object';
    properties: Record<string, SchemaFieldDefinition>;
}

export interface SchemaArrayDefinition {
    type: 'array';
    items: SchemaFieldDefinition;
    vectorLength?: number;
}

export interface SchemaUnionDefinition {
    type: 'union';
    variants: SchemaFieldDefinition[];
}

export function generateSchemaDefinition(documents: Array<Document>, collectionName?: string): SchemaDefinition {
    const root = new Map<string, FieldSummary>();

    for (const doc of documents) {
        recordDocument(root, doc);
    }

    const fields = convertProperties(root);

    const schema: SchemaDefinition = { fields };
    if (collectionName) {
        schema.collectionName = collectionName;
    }

    return schema;
}

function recordDocument(target: Map<string, FieldSummary>, doc: Document): void {
    for (const [key, value] of Object.entries(doc)) {
        const summary = target.get(key) ?? createFieldSummary();
        recordValue(summary, value);
        target.set(key, summary);
    }
}

function recordValue(summary: FieldSummary, value: unknown): void {
    if (value === null) {
        summary.hasNull = true;
        return;
    }

    if (Array.isArray(value)) {
        handleArray(summary, value);
        return;
    }

    if (isPlainObject(value)) {
        handleObject(summary, value as Record<string, unknown>);
        return;
    }

    summary.primitiveTypes.add(getPrimitiveType(value));
}

function handleObject(summary: FieldSummary, value: Record<string, unknown>): void {
    const properties = summary.objectProperties ?? new Map<string, FieldSummary>();
    summary.objectProperties = properties;

    for (const [key, nested] of Object.entries(value)) {
        const nestedSummary = properties.get(key) ?? createFieldSummary();
        recordValue(nestedSummary, nested);
        properties.set(key, nestedSummary);
    }
}

function handleArray(summary: FieldSummary, values: Array<unknown>): void {
    const arraySummary = summary.arraySummary ?? createArraySummary();
    summary.arraySummary = arraySummary;

    arraySummary.sawValues ||= values.length > 0;
    const vectorCandidate = values.length > 0 && values.every((element) => isNumericValue(element));

    if (vectorCandidate) {
        arraySummary.vectorLengths.add(values.length);
    } else if (values.length > 0) {
        arraySummary.nonVectorObserved = true;
    }

    for (const element of values) {
        recordValue(arraySummary.elementSummary, element);
    }
}

function getPrimitiveType(value: unknown): PrimitiveType {
    if (value === undefined) {
        return 'undefined';
    }

    if (typeof value === 'string') {
        return 'string';
    }

    if (typeof value === 'number' || typeof value === 'bigint') {
        return 'number';
    }

    if (typeof value === 'boolean') {
        return 'boolean';
    }

    if (value instanceof Date) {
        return 'date';
    }

    if (value instanceof RegExp) {
        return 'regex';
    }

    if (value instanceof Uint8Array || value instanceof Binary) {
        return 'binary';
    }

    if (value instanceof Timestamp) {
        return 'timestamp';
    }

    if (value instanceof ObjectId) {
        return 'objectId';
    }

    if (value instanceof Decimal128 || value instanceof Double || value instanceof Int32 || value instanceof Long) {
        return 'number';
    }

    const bsonType = getBsonType(value);
    if (bsonType) {
        return mapBsonType(bsonType);
    }

    return 'unknown';
}

function mapBsonType(type: string): PrimitiveType {
    const normalized = type.toLowerCase();

    switch (normalized) {
        case 'objectid':
            return 'objectId';
        case 'decimal128':
        case 'double':
        case 'int32':
        case 'long':
            return 'number';
        case 'timestamp':
            return 'timestamp';
        case 'binary':
            return 'binary';
        default:
            return 'unknown';
    }
}

function getBsonType(value: unknown): string | undefined {
    if (!value || typeof value !== 'object') {
        return undefined;
    }

    const potential = value as { _bsontype?: unknown };
    if (typeof potential._bsontype === 'string') {
        return potential._bsontype;
    }

    return undefined;
}

function createFieldSummary(): FieldSummary {
    return {
        primitiveTypes: new Set<PrimitiveType>(),
        hasNull: false,
    };
}

function createArraySummary(): ArraySummary {
    return {
        elementSummary: createFieldSummary(),
        vectorLengths: new Set<number>(),
        nonVectorObserved: false,
        sawValues: false,
    };
}

function convertProperties(properties: Map<string, FieldSummary>): Record<string, SchemaFieldDefinition> {
    const result: Record<string, SchemaFieldDefinition> = {};

    for (const key of Array.from(properties.keys()).sort((a, b) => a.localeCompare(b))) {
        result[key] = convertSummary(properties.get(key) as FieldSummary);
    }

    return result;
}

function convertSummary(summary: FieldSummary): SchemaFieldDefinition {
    const variants: SchemaFieldDefinition[] = [];

    if (summary.primitiveTypes.size > 0) {
        variants.push(combinePrimitiveTypes(summary.primitiveTypes));
    }

    if (summary.objectProperties && summary.objectProperties.size > 0) {
        variants.push({
            type: 'object',
            properties: convertProperties(summary.objectProperties),
        });
    }

    if (summary.arraySummary) {
        variants.push(convertArraySummary(summary.arraySummary));
    }

    if (summary.hasNull) {
        variants.push('null');
    }

    if (variants.length === 0) {
        return 'unknown';
    }

    if (variants.length === 1) {
        return variants[0];
    }

    return { type: 'union', variants };
}

function combinePrimitiveTypes(types: Set<PrimitiveType>): string {
    const filtered = Array.from(types)
        .filter((type) => type !== 'undefined')
        .sort((a, b) => a.localeCompare(b));

    if (filtered.length === 0) {
        return types.has('undefined') ? 'undefined' : 'unknown';
    }

    return filtered.join(' | ');
}

function convertArraySummary(summary: ArraySummary): SchemaArrayDefinition | SchemaUnionDefinition {
    const items = convertSummary(summary.elementSummary);
    const definition: SchemaArrayDefinition = {
        type: 'array',
        items,
    };

    if (!summary.nonVectorObserved && summary.vectorLengths.size === 1 && summary.sawValues) {
        definition.vectorLength = Array.from(summary.vectorLengths)[0];
    }

    if (summary.elementSummary.hasNull && typeof items === 'string' && items === 'unknown') {
        return { type: 'union', variants: [definition, 'null'] };
    }

    return definition;
}

function isPlainObject(value: unknown): boolean {
    if (typeof value !== 'object' || value === null) {
        return false;
    }

    if (Array.isArray(value)) {
        return false;
    }

    if (value instanceof Date || value instanceof RegExp) {
        return false;
    }

    if (value instanceof Uint8Array || value instanceof Binary) {
        return false;
    }

    if (getBsonType(value)) {
        return false;
    }

    return true;
}

function isNumericValue(value: unknown): boolean {
    if (typeof value === 'number') {
        return Number.isFinite(value);
    }

    if (typeof value === 'bigint') {
        return true;
    }

    if (value instanceof Decimal128 || value instanceof Double || value instanceof Int32 || value instanceof Long) {
        return true;
    }

    return getBsonType(value)?.toLowerCase() === 'decimal128';
}
