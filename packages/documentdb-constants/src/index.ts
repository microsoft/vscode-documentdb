/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * @vscode-documentdb/documentdb-constants
 *
 * Static operator metadata for DocumentDB-supported operators, stages,
 * accumulators, update operators, BSON constructors, and system variables.
 */

// -- Core types --
export type { CompletionFilter, MetaTag, OperatorEntry } from './types';

// -- Meta tag constants and presets --
export {
    ALL_META_TAGS,
    EXPRESSION_COMPLETION_META,
    // Completion context presets
    FILTER_COMPLETION_META,
    GROUP_EXPRESSION_COMPLETION_META,
    META_ACCUMULATOR,
    META_BSON,
    META_EXPR_ARITH,
    META_EXPR_ARRAY,
    META_EXPR_BITWISE,
    META_EXPR_BOOL,
    META_EXPR_COMPARISON,
    META_EXPR_CONDITIONAL,
    META_EXPR_DATASIZE,
    META_EXPR_DATE,
    META_EXPR_LITERAL,
    META_EXPR_MISC,
    META_EXPR_OBJECT,
    META_EXPR_SET,
    META_EXPR_STRING,
    META_EXPR_TIMESTAMP,
    META_EXPR_TRIG,
    META_EXPR_TYPE,
    META_EXPR_VARIABLE,
    META_FIELD_IDENTIFIER,
    // Individual meta tags
    META_QUERY,
    META_QUERY_ARRAY,
    META_QUERY_BITWISE,
    META_QUERY_COMPARISON,
    META_QUERY_ELEMENT,
    META_QUERY_EVALUATION,
    META_QUERY_GEOSPATIAL,
    META_QUERY_LOGICAL,
    META_QUERY_MISC,
    META_QUERY_PROJECTION,
    META_STAGE,
    META_UPDATE,
    META_UPDATE_ARRAY,
    META_UPDATE_BITWISE,
    META_UPDATE_FIELD,
    META_VARIABLE,
    META_WINDOW,
    PROJECTION_COMPLETION_META,
    STAGE_COMPLETION_META,
    UPDATE_COMPLETION_META,
    WINDOW_COMPLETION_META,
} from './metaTags';

// -- Consumer API --
export { getAllCompletions, getFilteredCompletions, registerOperators } from './getFilteredCompletions';

// -- Documentation URL helpers --
export { getDocBase, getDocLink } from './docLinks';
