/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ParseMode, parse as parseShellBSON } from '@mongodb-js/shell-bson-parser';
import * as l10n from '@vscode/l10n';
import { z } from 'zod';
import { type IndexSpecification } from '../../../documentdb/LlmEnhancedFeatureApis';
import { type CreateIndexInput, type FieldIndexType } from './types';

const FieldIndexTypeSchema = z.enum(['asc', 'desc', 'text', '2dsphere', 'hashed']);

/** True when an index key contains the wildcard token. */
export function isWildcardKey(field: string): boolean {
    return field.includes('$**');
}

/** Strict create-index input validation shared by direct creation and command handoffs. */
export const CreateIndexInputSchema = z
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
        if (wildcardFields.length === 0 && input.wildcardProjection !== undefined) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['wildcardProjection'],
                message: l10n.t('Wildcard projection requires a wildcard index key.'),
            });
        }
        if (wildcardFields.length > 0 && input.wildcardProjection !== undefined) {
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

/** Build the driver index specification from validated drawer input. */
export function buildIndexSpec(input: CreateIndexInput): IndexSpecification {
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
    const spec = buildIndexSpec(input);
    const { key, partialFilterExpression, collation, wildcardProjection, ...serializableOptions } = spec;
    const collection = JSON.stringify(collectionName);
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
