/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Represents a single operator, stage, accumulator, or BSON constructor
 * for use in autocomplete, hover docs, and diagnostics.
 */
export interface OperatorEntry {
    /** The operator string, e.g. "$gt", "$match", "ObjectId" */
    readonly value: string;

    /**
     * Category tag for filtering. Determines which contexts this entry
     * appears in. See {@link MetaTag} for the full set.
     *
     * Examples: "query", "query:comparison", "stage", "accumulator",
     * "expr:arith", "expr:date", "bson", "field:identifier"
     */
    readonly meta: MetaTag;

    /** Human-readable one-line description. */
    readonly description: string;

    /**
     * Monaco snippet with tab stops for insertion.
     * Example: '{ \\$match: { ${1:field}: ${2:value} } }'
     * If absent, `value` is inserted as-is.
     */
    readonly snippet?: string;

    /**
     * URL to the DocumentDB documentation page for this operator.
     * Generated from `docLinks.ts` helpers.
     */
    readonly link?: string;

    /**
     * Applicable BSON types for type-aware filtering.
     * If set, this operator only appears when the field's bsonType
     * matches one of these values. If absent, the operator is universal.
     *
     * Example: $regex → ['string'], $size → ['array']
     */
    readonly applicableBsonTypes?: readonly string[];

    /**
     * Operator return type or value type hint.
     * Used by CompletionItemProvider for contextual snippet generation.
     * Example: "$gt" → "same" (same type as input), "$size" → "number"
     */
    readonly returnType?: string;
}

/**
 * Filter configuration for {@link getFilteredCompletions}.
 */
export interface CompletionFilter {
    /**
     * Meta tag prefixes to include. Supports prefix matching:
     * 'query' matches 'query', 'query:comparison', 'query:logical', etc.
     * 'expr' matches all 'expr:*' entries.
     */
    readonly meta: readonly string[];

    /** Optional: only return operators applicable to these BSON types. */
    readonly bsonTypes?: readonly string[];
}

/**
 * Meta tag constants. Tags use a hierarchical scheme:
 *
 * - 'query' — top-level query operators (in find filter, $match)
 * - 'query:comparison' — comparison subset ($eq, $gt, etc.)
 * - 'query:logical' — logical ($and, $or, $not, $nor)
 * - 'query:element' — element ($exists, $type)
 * - 'query:evaluation' — evaluation ($expr, $regex, $mod, $text)
 * - 'query:array' — array ($all, $elemMatch, $size)
 * - 'query:bitwise' — bitwise ($bitsAllSet, etc.)
 * - 'query:geospatial' — geospatial ($geoWithin, $near, etc.)
 * - 'query:projection' — projection ($, $elemMatch, $slice)
 * - 'query:misc' — miscellaneous ($comment, $rand, $natural)
 * - 'update' — update operators ($set, $unset, $inc, etc.)
 * - 'update:field' — field update subset
 * - 'update:array' — array update subset ($push, $pull, etc.)
 * - 'update:bitwise' — bitwise update ($bit)
 * - 'stage' — aggregation pipeline stages ($match, $group, etc.)
 * - 'accumulator' — accumulators ($sum, $avg, $first, etc.)
 * - 'expr:arith' — arithmetic expressions ($add, $subtract, etc.)
 * - 'expr:array' — array expressions ($arrayElemAt, $filter, etc.)
 * - 'expr:bool' — boolean expressions ($and, $or, $not)
 * - 'expr:comparison' — comparison expressions ($cmp, $eq, etc.)
 * - 'expr:conditional' — conditional ($cond, $ifNull, $switch)
 * - 'expr:date' — date expressions ($dateAdd, $year, etc.)
 * - 'expr:object' — object expressions ($mergeObjects, etc.)
 * - 'expr:set' — set expressions ($setUnion, etc.)
 * - 'expr:string' — string expressions ($concat, $substr, etc.)
 * - 'expr:trig' — trigonometry ($sin, $cos, etc.)
 * - 'expr:type' — type conversion ($convert, $toInt, etc.)
 * - 'expr:datasize' — data size ($bsonSize, $binarySize)
 * - 'expr:timestamp' — timestamp ($tsIncrement, $tsSecond)
 * - 'expr:bitwise' — bitwise expressions ($bitAnd, $bitOr, etc.)
 * - 'expr:literal' — $literal
 * - 'expr:misc' — miscellaneous expressions ($getField, $rand, etc.)
 * - 'expr:variable' — variable expressions ($let)
 * - 'window' — window operators ($rank, $denseRank, etc.)
 * - 'bson' — BSON constructor functions (ObjectId, ISODate, etc.)
 * - 'variable' — system variables ($$NOW, $$ROOT, etc.)
 * - 'field:identifier' — injected field names from schema (not static)
 */
export type MetaTag = string;
