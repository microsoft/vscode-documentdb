/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useCallback, useMemo, useState } from 'react';
import { type TreeNode } from '../../../../../utils/documentGrid/types';

const COLLAPSED_KEYS: ReadonlySet<string> = new Set<string>();

interface TreeExpansionState {
    readonly nodes: readonly TreeNode[];
    readonly expandedKeys: ReadonlySet<string>;
}

interface TreeRows {
    readonly rows: readonly TreeNode[];
    readonly expandedKeys: ReadonlySet<string>;
    readonly setExpanded: (node: TreeNode, expanded: boolean) => void;
}

export function getVisibleTreeRows(
    nodes: readonly TreeNode[],
    expandedKeys: ReadonlySet<string>,
): TreeNode[] {
    const children = new Map<string | null, TreeNode[]>();
    for (const node of nodes) {
        const siblings = children.get(node.parentKey);
        if (siblings) {
            siblings.push(node);
        } else {
            children.set(node.parentKey, [node]);
        }
    }
    for (const siblings of children.values()) {
        siblings.sort((left, right): number => left.field.localeCompare(right.field));
    }

    const rows: TreeNode[] = [];
    const stack = [...(children.get(null) ?? [])].reverse();
    while (stack.length > 0) {
        const node = stack.pop();
        if (!node) {
            continue;
        }
        rows.push(node);
        if (node.expandable && expandedKeys.has(node.key)) {
            const descendants = children.get(node.key) ?? [];
            for (let index = descendants.length - 1; index >= 0; index--) {
                stack.push(descendants[index]);
            }
        }
    }
    return rows;
}

export function setTreeNodeExpanded(
    node: TreeNode,
    expandedKeys: ReadonlySet<string>,
    expanded: boolean,
): ReadonlySet<string> {
    if (!node.expandable || expandedKeys.has(node.key) === expanded) {
        return expandedKeys;
    }
    const next = new Set(expandedKeys);
    if (expanded) {
        next.add(node.key);
    } else {
        next.delete(node.key);
    }
    return next;
}

export function useTreeRows(nodes: readonly TreeNode[]): TreeRows {
    const [state, setState] = useState<TreeExpansionState>({ nodes, expandedKeys: COLLAPSED_KEYS });
    // A replacement page starts collapsed, including position-keyed roots reused by the host.
    if (state.nodes !== nodes) {
        setState({ nodes, expandedKeys: COLLAPSED_KEYS });
    }
    const expandedKeys = state.nodes === nodes ? state.expandedKeys : COLLAPSED_KEYS;
    const rows = useMemo((): TreeNode[] => getVisibleTreeRows(nodes, expandedKeys), [nodes, expandedKeys]);
    const setExpanded = useCallback(
        (node: TreeNode, expanded: boolean): void => {
            setState((previous): TreeExpansionState => ({
                nodes,
                expandedKeys: setTreeNodeExpanded(
                    node,
                    previous.nodes === nodes ? previous.expandedKeys : COLLAPSED_KEYS,
                    expanded,
                ),
            }));
        },
        [nodes],
    );
    return { rows, expandedKeys, setExpanded };
}
