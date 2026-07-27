/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ParseMode, parse as parseShellBSON } from '@mongodb-js/shell-bson-parser';
import * as l10n from '@vscode/l10n';
import { z } from 'zod';
import { type IndexSpecification } from '../../../documentdb/LlmEnhancedFeatureApis';
import {
    isVectorCreateIndexInput,
    type CreateIndexInput,
    type FieldIndexType,
    type VectorCreateIndexInput,
} from './types';

const FieldIndexTypeSchema = z.enum(['asc', 'desc', 'text', '2dsphere', 'hashed']);

/** Index key sentinel that marks a field as a DocumentDB vector. */
const VECTOR_INDEX_DIRECTION = 'cosmosSearch';

/** True when an index key contains the wildcard token. */
export function isWildcardKey(field: string): boolean {
    return field.includes('$**');
}

/**
 * True only for the all-fields wildcard key `$**`. A scoped `path.$**` key is a
 * wildcard but is not the all-fields form, and the server only accepts a
 * `wildcardProjection` on the all-fields key.
 */
export function isAllFieldsWildcardKey(field: string): boolean {
    return field.trim() === '$**';
}

/**
 * True when an optional JSON-object option carries no meaningful content —
 * either absent, blank, or an empty object (`{}` with any inner whitespace).
 * Such values are treated as "not set" exactly like an omitted option, so an
 * empty option never triggers validation errors (mirrors the drawer's
 * `isBlankIndexOption`).
 */
function isBlankOptionText(text: string | undefined): boolean {
    if (text === undefined) {
        return true;
    }
    const trimmed = text.trim();
    return trimmed === '' || /^\{\s*\}$/.test(trimmed);
}

/** Strict field-keyed (Standard/Wildcard) create-index input validation. */
const FieldCreateIndexInputSchema = z
    .object({
        fields: z
            .array(
                z.object({
                    field: z.string().min(1),
                    type: FieldIndexTypeSchema,
                }),
            )
            .min(1),
        name: z
            .string()
            .refine((name) => name.trim() !== '*', { message: l10n.t('The index name "*" is reserved.') })
            .optional(),
        unique: z.boolean().optional(),
        sparse: z.boolean().optional(),
        expireAfterSeconds: z.number().int().positive().optional(),
        partialFilterExpression: z.string().optional(),
        collation: z.string().optional(),
        wildcardProjection: z.string().optional(),
    })
    .superRefine((input, ctx) => {
        const fieldNames = new Set<string>();
        const wildcardFields = input.fields.filter((entry) => isWildcardKey(entry.field.trim()));
        // The all-fields wildcard is the exact `$**` key; a scoped `path.$**`
        // key is still a wildcard but does not accept a wildcard projection.
        const hasAllFieldsWildcard = input.fields.some((entry) => isAllFieldsWildcardKey(entry.field.trim()));

        input.fields.forEach((entry, index) => {
            const fieldName = entry.field.trim();
            if (fieldNames.has(fieldName)) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ['fields', index, 'field'],
                    message: l10n.t('Duplicate index field.'),
                });
            }
            fieldNames.add(fieldName);

            if (isWildcardKey(fieldName) && entry.type !== 'asc') {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ['fields', index, 'type'],
                    message: l10n.t('Wildcard index keys must use ascending direction.'),
                });
            }
        });

        if (wildcardFields.length > 0 && input.fields.length !== 1) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['fields'],
                message: l10n.t('A wildcard index key must be the only index key.'),
            });
        }
        if (wildcardFields.length > 0 && input.unique) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['unique'],
                message: l10n.t('Wildcard indexes cannot be unique.'),
            });
        }
        if (wildcardFields.length > 0 && input.sparse) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['sparse'],
                message: l10n.t('Wildcard indexes cannot be sparse.'),
            });
        }
        if (wildcardFields.length > 0 && input.expireAfterSeconds !== undefined) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['expireAfterSeconds'],
                message: l10n.t('Wildcard indexes cannot use TTL.'),
            });
        }
        if (wildcardFields.length === 0 && !isBlankOptionText(input.wildcardProjection)) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['wildcardProjection'],
                message: l10n.t('Wildcard projection requires a wildcard index key.'),
            });
        }
        // A wildcard projection is only accepted on the all-fields `$**` key.
        // A scoped `path.$**` key rejects it server-side, so block it here too.
        if (wildcardFields.length > 0 && !hasAllFieldsWildcard && !isBlankOptionText(input.wildcardProjection)) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['wildcardProjection'],
                message: l10n.t('Wildcard projection is only allowed on an all-fields wildcard index (the $** key).'),
            });
        }
        if (hasAllFieldsWildcard && !isBlankOptionText(input.wildcardProjection)) {
            try {
                parseOptionObject(input.wildcardProjection, l10n.t('wildcard projection'));
            } catch (error) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ['wildcardProjection'],
                    message: error instanceof Error ? error.message : String(error),
                });
            }
        }
    });

/** Distance metric accepted by a DocumentDB vector index. */
const VectorSimilaritySchema = z.enum(['COS', 'L2', 'IP']);

/**
 * Algorithm choice plus its own build-time tuning. Ranges mirror the current
 * Azure DocumentDB service documentation. The cross-field
 * `efConstruction >= 2 * m` HNSW rule is enforced in the top-level refinement
 * because a discriminated-union member cannot carry its own refinement.
 */
const VectorAlgorithmSchema = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('vector-ivf'), numLists: z.number().int().positive() }),
    z.object({
        kind: z.literal('vector-hnsw'),
        m: z.number().int().min(2).max(100),
        efConstruction: z.number().int().min(4).max(1000),
    }),
    z.object({
        kind: z.literal('vector-diskann'),
        maxDegree: z.number().int().min(20).max(2048),
        lBuild: z.number().int().min(10).max(500),
    }),
]);

/** Optional index compression: half precision or product quantization. */
const VectorCompressionSchema = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('half') }),
    z.object({
        kind: z.literal('pq'),
        pqCompressedDims: z.number().int().positive().optional(),
        pqSampleSize: z.number().int().min(1000).max(100000).optional(),
    }),
]);

/** Strict vector (`cosmosSearch`) create-index input validation. */
const VectorCreateIndexInputSchema = z
    .object({
        kind: z.literal('vector'),
        field: z.string().min(1),
        name: z
            .string()
            .refine((name) => name.trim() !== '*', { message: l10n.t('The index name "*" is reserved.') })
            .optional(),
        dimensions: z.number().int().positive(),
        similarity: VectorSimilaritySchema,
        algorithm: VectorAlgorithmSchema,
        compression: VectorCompressionSchema.optional(),
    })
    .superRefine((input, ctx) => {
        if (input.algorithm.kind === 'vector-hnsw' && input.algorithm.efConstruction < 2 * input.algorithm.m) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['algorithm', 'efConstruction'],
                message: l10n.t('Build candidates (efConstruction) must be at least 2 × connections (m).'),
            });
        }
        if (input.compression?.kind === 'half' && input.algorithm.kind === 'vector-diskann') {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['compression'],
                message: l10n.t('Half precision is only available for IVF and HNSW indexes.'),
            });
        }
        if (input.compression?.kind === 'pq' && input.algorithm.kind !== 'vector-diskann') {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['compression'],
                message: l10n.t('Product quantization is only available for DiskANN indexes.'),
            });
        }
        if (
            input.compression?.kind === 'pq' &&
            input.compression.pqCompressedDims !== undefined &&
            input.compression.pqCompressedDims >= input.dimensions
        ) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['compression', 'pqCompressedDims'],
                message: l10n.t('Compressed dimensions must be smaller than the vector dimensions.'),
            });
        }
    });

/**
 * Strict create-index input validation shared by direct creation and command
 * handoffs. A union so vector payloads are validated against the vector
 * contract and field-keyed payloads against the Standard/Wildcard contract.
 */
export const CreateIndexInputSchema = z.union([VectorCreateIndexInputSchema, FieldCreateIndexInputSchema]);

/** Map a per-field index type onto its wire-level key value. */
function fieldTypeToKeyValue(type: FieldIndexType): number | string {
    switch (type) {
        case 'asc':
            return 1;
        case 'desc':
            return -1;
        case 'text':
            return 'text';
        case '2dsphere':
            return '2dsphere';
        case 'hashed':
            return 'hashed';
    }
}

/** Parse an optional loose shell-BSON object used by an index option. */
function parseOptionObject(text: string | undefined, label: string): Record<string, unknown> | undefined {
    const trimmed = text?.trim();
    if (!trimmed) {
        return undefined;
    }
    let parsed: unknown;
    try {
        parsed = parseShellBSON(trimmed, { mode: ParseMode.Loose });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(l10n.t('Invalid {0}: {1}', label, message));
    }
    if (
        typeof parsed !== 'object' ||
        parsed === null ||
        Array.isArray(parsed) ||
        (Object.getPrototypeOf(parsed) !== Object.prototype && Object.getPrototypeOf(parsed) !== null)
    ) {
        throw new Error(l10n.t('Invalid {0}: expected a JSON object.', label));
    }
    return parsed as Record<string, unknown>;
}

/** Assemble the `cosmosSearchOptions` document for a vector index. */
function buildCosmosSearchOptions(input: VectorCreateIndexInput): Record<string, unknown> {
    const options: Record<string, unknown> = {
        kind: input.algorithm.kind,
        dimensions: input.dimensions,
        similarity: input.similarity,
    };

    switch (input.algorithm.kind) {
        case 'vector-ivf':
            options.numLists = input.algorithm.numLists;
            break;
        case 'vector-hnsw':
            options.m = input.algorithm.m;
            options.efConstruction = input.algorithm.efConstruction;
            break;
        case 'vector-diskann':
            options.maxDegree = input.algorithm.maxDegree;
            options.lBuild = input.algorithm.lBuild;
            break;
    }

    if (input.compression?.kind === 'half') {
        options.compression = 'half';
    } else if (input.compression?.kind === 'pq') {
        options.compression = 'pq';
        if (input.compression.pqCompressedDims !== undefined) {
            options.pqCompressedDims = input.compression.pqCompressedDims;
        }
        if (input.compression.pqSampleSize !== undefined) {
            options.pqSampleSize = input.compression.pqSampleSize;
        }
    }

    return options;
}

/** Build the driver index specification for a DocumentDB vector index. */
function buildVectorIndexSpec(input: VectorCreateIndexInput): IndexSpecification {
    const spec: IndexSpecification = {
        key: { [input.field]: VECTOR_INDEX_DIRECTION },
        cosmosSearchOptions: buildCosmosSearchOptions(input),
    };
    if (input.name && input.name.trim().length > 0) {
        spec.name = input.name.trim();
    }
    return spec;
}

/** Build the driver index specification from validated drawer input. */
export function buildIndexSpec(input: CreateIndexInput): IndexSpecification {
    if (isVectorCreateIndexInput(input)) {
        return buildVectorIndexSpec(input);
    }

    const key: Record<string, number | string> = {};

    for (const entry of input.fields) {
        key[entry.field] = fieldTypeToKeyValue(entry.type);
    }

    const spec: IndexSpecification = { key };
    if (input.name && input.name.trim().length > 0) {
        spec.name = input.name.trim();
    }
    if (input.unique) {
        spec.unique = true;
    }
    if (input.sparse) {
        spec.sparse = true;
    }
    if (typeof input.expireAfterSeconds === 'number') {
        spec.expireAfterSeconds = input.expireAfterSeconds;
    }
    const partialFilterExpression = parseOptionObject(
        input.partialFilterExpression,
        l10n.t('partial filter expression'),
    );
    if (partialFilterExpression) {
        spec.partialFilterExpression = partialFilterExpression;
    }
    const collation = parseOptionObject(input.collation, l10n.t('collation'));
    if (collation) {
        spec.collation = collation;
    }
    const wildcardProjection = parseOptionObject(input.wildcardProjection, l10n.t('wildcard projection'));
    if (wildcardProjection) {
        spec.wildcardProjection = wildcardProjection;
    }
    return spec;
}

/** Render a createIndex invocation for playground and shell handoffs. */
export function buildCreateIndexShellCommand(collectionName: string, input: CreateIndexInput): string {
    const collection = JSON.stringify(collectionName);

    if (isVectorCreateIndexInput(input)) {
        const spec = buildVectorIndexSpec(input);
        const keyJson = JSON.stringify(spec.key);
        const optionEntries: string[] = [];
        if (spec.name !== undefined) {
            optionEntries.push(`${JSON.stringify('name')}:${JSON.stringify(spec.name)}`);
        }
        optionEntries.push(`${JSON.stringify('cosmosSearchOptions')}:${JSON.stringify(spec.cosmosSearchOptions)}`);
        return `db.getCollection(${collection}).createIndex(${keyJson}, {${optionEntries.join(',')}})`;
    }

    const spec = buildIndexSpec(input);
    const { key, partialFilterExpression, collation, wildcardProjection, ...serializableOptions } = spec;
    const keyJson = JSON.stringify(key);
    const optionEntries = Object.entries(serializableOptions).map(
        ([option, value]) => `${JSON.stringify(option)}:${JSON.stringify(value)}`,
    );
    const partialFilterText = input.partialFilterExpression?.trim();
    if (partialFilterExpression && partialFilterText) {
        optionEntries.push(`${JSON.stringify('partialFilterExpression')}:${partialFilterText}`);
    }
    const collationText = input.collation?.trim();
    if (collation && collationText) {
        optionEntries.push(`${JSON.stringify('collation')}:${collationText}`);
    }
    const wildcardProjectionText = input.wildcardProjection?.trim();
    if (wildcardProjection && wildcardProjectionText) {
        optionEntries.push(`${JSON.stringify('wildcardProjection')}:${wildcardProjectionText}`);
    }
    if (optionEntries.length === 0) {
        return `db.getCollection(${collection}).createIndex(${keyJson})`;
    }
    return `db.getCollection(${collection}).createIndex(${keyJson}, {${optionEntries.join(',')}})`;
}
