/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { type TreeNode } from '../../../../../utils/documentGrid/types';
import { getVisibleTreeRows, setTreeNodeExpanded } from './useTreeRows';

const root: TreeNode = {
    key: '["id:\\"z-root\\""]',
    parentKey: null,
    depth: 0,
    field: '"z-root"',
    value: { display: '{...}', type: 'object' },
    expandable: true,
};
const object: TreeNode = {
    key: '["id:\\"z-root\\"","a.b"]',
    parentKey: root.key,
    depth: 1,
    field: 'a.b',
    value: { display: '{...}', type: 'object' },
    expandable: true,
};
const leaf: TreeNode = {
    key: '["id:\\"z-root\\"","a.b",""]',
    parentKey: object.key,
    depth: 2,
    field: '',
    value: { display: '42', type: 'int32' },
    expandable: false,
};
const sibling: TreeNode = {
    key: '["id:\\"z-root\\"","z"]',
    parentKey: root.key,
    depth: 1,
    field: 'z',
    value: { display: 'text', type: 'string' },
    expandable: false,
};
const otherRoot: TreeNode = {
    ...root,
    key: '["id:\\"a-root\\""]',
    field: '"a-root"',
    expandable: false,
};
const nodes: readonly TreeNode[] = [root, sibling, object, leaf, otherRoot];

describe('tree expansion and visible rows', () => {
    it('starts with just document roots in Field-ascending order', () => {
        expect(getVisibleTreeRows(nodes, new Set())).toEqual([otherRoot, root]);
    });

    it('sorts siblings by Field without separating them from their keyed parents', () => {
        const expanded = new Set([root.key, object.key]);
        expect(getVisibleTreeRows(nodes, expanded)).toEqual([otherRoot, root, object, leaf, sibling]);
        expect(nodes).toEqual([root, sibling, object, leaf, otherRoot]);
    });

    it('hides collapsed descendants while preserving their expansion on reopening', () => {
        const expanded = new Set([root.key, object.key]);
        const collapsed = setTreeNodeExpanded(root, expanded, false);
        expect(getVisibleTreeRows(nodes, collapsed)).toEqual([otherRoot, root]);
        expect(expanded.has(root.key)).toBe(true);
        expect(collapsed.has(object.key)).toBe(true);
        expect(getVisibleTreeRows(nodes, setTreeNodeExpanded(root, collapsed, true))).toEqual([
            otherRoot,
            root,
            object,
            leaf,
            sibling,
        ]);
    });

    it('traverses arbitrary depth without recursive calls', () => {
        const deepNodes: TreeNode[] = [root];
        const expanded = new Set([root.key]);
        let parent = root;
        for (let depth = 1; depth <= 3000; depth++) {
            const child: TreeNode = {
                key: `deep:${depth}`,
                parentKey: parent.key,
                depth,
                field: 'nested',
                value: { display: '{...}', type: 'object' },
                expandable: depth < 3000,
            };
            deepNodes.push(child);
            expanded.add(child.key);
            parent = child;
        }
        expect(getVisibleTreeRows(deepNodes, expanded)).toEqual(deepNodes);
        expect(getVisibleTreeRows(deepNodes, setTreeNodeExpanded(root, expanded, false))).toEqual([root]);
    });

    it('respects host array expansion eligibility and never fabricates capped children', () => {
        const empty: TreeNode = {
            ...sibling,
            key: 'empty',
            field: 'empty',
            value: { display: '(elements: 0)', type: 'array' },
        };
        const ten: TreeNode = {
            ...object,
            key: 'ten',
            field: 'ten',
            value: { display: '(elements: 10)', type: 'array' },
        };
        const eleven: TreeNode = {
            ...sibling,
            key: 'eleven',
            field: 'eleven',
            value: { display: '(elements: 11)', type: 'array' },
        };
        const elements: TreeNode[] = Array.from(
            { length: 10 },
            (_, index): TreeNode => ({
                ...leaf,
                key: `ten:${index}`,
                parentKey: ten.key,
                field: `ten[${index}]`,
            }),
        );
        const arrayNodes = [root, empty, ten, ...elements, eleven];
        let expanded: ReadonlySet<string> = new Set([root.key]);
        expanded = setTreeNodeExpanded(eleven, expanded, true);
        expanded = setTreeNodeExpanded(empty, expanded, true);
        expect([...expanded]).toEqual([root.key]);
        expect(getVisibleTreeRows(arrayNodes, expanded)).toEqual([root, eleven, empty, ten]);
        expanded = setTreeNodeExpanded(ten, expanded, true);
        expect(getVisibleTreeRows(arrayNodes, expanded)).toEqual([root, eleven, empty, ten, ...elements]);
    });
});
