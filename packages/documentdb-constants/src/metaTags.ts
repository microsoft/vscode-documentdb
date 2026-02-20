/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Meta tag constants for categorizing operators in the DocumentDB constants package.
 *
 * Tags use a hierarchical scheme where prefix matching is supported:
 * filtering by 'query' matches 'query', 'query:comparison', 'query:logical', etc.
 */

// -- Query operators --
export const META_QUERY = 'query' as const;
export const META_QUERY_COMPARISON = 'query:comparison' as const;
export const META_QUERY_LOGICAL = 'query:logical' as const;
export const META_QUERY_ELEMENT = 'query:element' as const;
export const META_QUERY_EVALUATION = 'query:evaluation' as const;
export const META_QUERY_ARRAY = 'query:array' as const;
export const META_QUERY_BITWISE = 'query:bitwise' as const;
export const META_QUERY_GEOSPATIAL = 'query:geospatial' as const;
export const META_QUERY_PROJECTION = 'query:projection' as const;
export const META_QUERY_MISC = 'query:misc' as const;

// -- Update operators --
export const META_UPDATE = 'update' as const;
export const META_UPDATE_FIELD = 'update:field' as const;
export const META_UPDATE_ARRAY = 'update:array' as const;
export const META_UPDATE_BITWISE = 'update:bitwise' as const;

// -- Aggregation pipeline --
export const META_STAGE = 'stage' as const;
export const META_ACCUMULATOR = 'accumulator' as const;

// -- Expression operators --
export const META_EXPR_ARITH = 'expr:arith' as const;
export const META_EXPR_ARRAY = 'expr:array' as const;
export const META_EXPR_BOOL = 'expr:bool' as const;
export const META_EXPR_COMPARISON = 'expr:comparison' as const;
export const META_EXPR_CONDITIONAL = 'expr:conditional' as const;
export const META_EXPR_DATE = 'expr:date' as const;
export const META_EXPR_OBJECT = 'expr:object' as const;
export const META_EXPR_SET = 'expr:set' as const;
export const META_EXPR_STRING = 'expr:string' as const;
export const META_EXPR_TRIG = 'expr:trig' as const;
export const META_EXPR_TYPE = 'expr:type' as const;
export const META_EXPR_DATASIZE = 'expr:datasize' as const;
export const META_EXPR_TIMESTAMP = 'expr:timestamp' as const;
export const META_EXPR_BITWISE = 'expr:bitwise' as const;
export const META_EXPR_LITERAL = 'expr:literal' as const;
export const META_EXPR_MISC = 'expr:misc' as const;
export const META_EXPR_VARIABLE = 'expr:variable' as const;

// -- Window operators --
export const META_WINDOW = 'window' as const;

// -- BSON constructors --
export const META_BSON = 'bson' as const;

// -- System variables --
export const META_VARIABLE = 'variable' as const;

// -- Schema-injected field names (not static — provided at runtime) --
export const META_FIELD_IDENTIFIER = 'field:identifier' as const;

/**
 * All known meta tag values for validation purposes.
 */
export const ALL_META_TAGS = [
    META_QUERY,
    META_QUERY_COMPARISON,
    META_QUERY_LOGICAL,
    META_QUERY_ELEMENT,
    META_QUERY_EVALUATION,
    META_QUERY_ARRAY,
    META_QUERY_BITWISE,
    META_QUERY_GEOSPATIAL,
    META_QUERY_PROJECTION,
    META_QUERY_MISC,
    META_UPDATE,
    META_UPDATE_FIELD,
    META_UPDATE_ARRAY,
    META_UPDATE_BITWISE,
    META_STAGE,
    META_ACCUMULATOR,
    META_EXPR_ARITH,
    META_EXPR_ARRAY,
    META_EXPR_BOOL,
    META_EXPR_COMPARISON,
    META_EXPR_CONDITIONAL,
    META_EXPR_DATE,
    META_EXPR_OBJECT,
    META_EXPR_SET,
    META_EXPR_STRING,
    META_EXPR_TRIG,
    META_EXPR_TYPE,
    META_EXPR_DATASIZE,
    META_EXPR_TIMESTAMP,
    META_EXPR_BITWISE,
    META_EXPR_LITERAL,
    META_EXPR_MISC,
    META_EXPR_VARIABLE,
    META_WINDOW,
    META_BSON,
    META_VARIABLE,
    META_FIELD_IDENTIFIER,
] as const;

// -- Completion context presets --

/** Query filter contexts: find filter bar, $match stage body */
export const FILTER_COMPLETION_META: readonly string[] = ['query', 'bson', 'variable'];

/** Projection/sort contexts */
export const PROJECTION_COMPLETION_META: readonly string[] = ['field:identifier'];

/** $group/$project/$addFields stage body: expressions + accumulators */
export const GROUP_EXPRESSION_COMPLETION_META: readonly string[] = ['expr', 'accumulator', 'bson', 'variable'];

/** Other stage bodies: expressions only (no accumulators) */
export const EXPRESSION_COMPLETION_META: readonly string[] = ['expr', 'bson', 'variable'];

/** Update operations: update operators */
export const UPDATE_COMPLETION_META: readonly string[] = ['update'];

/** Top-level aggregation pipeline: stage names */
export const STAGE_COMPLETION_META: readonly string[] = ['stage'];

/** Window fields: window operators + accumulators + expressions */
export const WINDOW_COMPLETION_META: readonly string[] = ['window', 'accumulator', 'expr', 'bson', 'variable'];
