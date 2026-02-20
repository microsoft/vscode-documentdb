/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * URL generation helpers for DocumentDB documentation pages.
 *
 * Each operator has a documentation page at:
 *   https://learn.microsoft.com/en-us/azure/documentdb/operators/{category}/{operatorName}
 */

const DOC_BASE = 'https://learn.microsoft.com/en-us/azure/documentdb/operators';

/**
 * Maps meta tag prefixes to the docs directory name used in the
 * DocumentDB documentation URL path.
 */
const META_TO_DOC_DIR: Record<string, string> = {
    'query:comparison': 'comparison-query',
    'query:logical': 'logical-query',
    'query:element': 'element-query',
    'query:evaluation': 'evaluation-query',
    'query:array': 'array-query',
    'query:bitwise': 'bitwise-query',
    'query:geospatial': 'geospatial',
    'query:projection': 'projection',
    'query:misc': 'miscellaneous-query',
    'update:field': 'field-update',
    'update:array': 'array-update',
    'update:bitwise': 'bitwise-update',
    stage: 'aggregation',
    accumulator: 'accumulators',
    'expr:arith': 'arithmetic-expression',
    'expr:array': 'array-expression',
    'expr:bool': 'logical-query',
    'expr:comparison': 'comparison-query',
    'expr:conditional': 'conditional-expression',
    'expr:date': 'date-expression',
    'expr:object': 'object-expression',
    'expr:set': 'set-expression',
    'expr:string': 'string-expression',
    'expr:trig': 'trigonometry-expression',
    'expr:type': 'aggregation/type-expression',
    'expr:datasize': 'data-size',
    'expr:timestamp': 'timestamp-expression',
    'expr:bitwise': 'bitwise',
    'expr:literal': 'literal-expression',
    'expr:misc': 'miscellaneous',
    'expr:variable': 'variable-expression',
    window: 'window-operators',
};

/**
 * Generates a documentation URL for a DocumentDB operator.
 *
 * @param operatorValue - the operator name, e.g. "$bucket", "$gt"
 * @param meta - the meta tag, e.g. "stage", "query:comparison"
 * @returns URL string or undefined if no mapping exists for the meta tag
 */
export function getDocLink(operatorValue: string, meta: string): string | undefined {
    const dir = META_TO_DOC_DIR[meta];
    if (!dir) {
        return undefined;
    }

    // Operator names in URLs keep their $ prefix and are lowercased
    const name = operatorValue.toLowerCase();
    return `${DOC_BASE}/${dir}/${name}`;
}

/**
 * Returns the base URL for the DocumentDB operators documentation.
 */
export function getDocBase(): string {
    return DOC_BASE;
}
