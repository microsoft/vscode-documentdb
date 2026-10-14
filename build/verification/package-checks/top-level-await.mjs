/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Static top-level-await detection for shipped ES modules. Node's `require(esm)` throws
// ERR_REQUIRE_ASYNC_MODULE for a graph that contains one.

import { parse } from 'acorn';

/** True when `await` (or `for await`) occurs outside every function body. */
export function hasTopLevelAwait(source) {
    const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true });
    const visit = (node) => {
        if (!node || typeof node.type !== 'string') return false;
        if (/Function/.test(node.type)) return false;
        if (node.type === 'AwaitExpression' || (node.type === 'ForOfStatement' && node.await)) return true;
        for (const value of Object.values(node)) {
            if (Array.isArray(value) ? value.some(visit) : value && typeof value === 'object' && visit(value)) {
                return true;
            }
        }
        return false;
    };
    return visit(ast);
}
