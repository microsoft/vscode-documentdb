/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { type TreeElement } from './TreeElement';
import { TreeParentCache } from './TreeParentCache';

function createNode(id: string): TreeElement {
    return { id, getTreeItem: (): { id: string } => ({ id }) };
}

describe('TreeParentCache', (): void => {
    it('returns only registered direct children, matching the parent by id', (): void => {
        const cache = new TreeParentCache<TreeElement>();
        const parent = createNode('parent');
        const child = createNode('child');
        const otherChild = createNode('other-child');
        const grandchild = createNode('grandchild');
        cache.registerRelationship(parent, child);
        cache.registerRelationship(parent, otherChild);
        cache.registerRelationship(child, grandchild);
        cache.registerRelationship(createNode('other-parent'), createNode('unrelated-child'));

        const children = cache.getChildren(createNode(parent.id));

        expect(children).toHaveLength(2);
        expect(children).toEqual(expect.arrayContaining([child, otherChild]));
    });

    it('returns no children for an unknown parent or a registered node without children', (): void => {
        const cache = new TreeParentCache<TreeElement>();
        const parent = createNode('parent');
        cache.registerNode(parent);

        expect(cache.getChildren(createNode('unknown'))).toEqual([]);
        expect(cache.getChildren(parent)).toEqual([]);
    });

    it('clears all cached children when no node id is supplied', (): void => {
        const cache = new TreeParentCache<TreeElement>();
        const parent = createNode('parent');
        const child = createNode('parent/child');
        cache.registerRelationship(parent, child);
        cache.registerRelationship(child, createNode('parent/child/grandchild'));

        cache.clear();

        expect(cache.getChildren(parent)).toEqual([]);
        expect(cache.getChildren(child)).toEqual([]);
    });

    it('prunes a node and its path descendants while keeping other branches', (): void => {
        const cache = new TreeParentCache<TreeElement>();
        const parent = createNode('parent');
        const child = createNode('parent/child');
        const sibling = createNode('parent/sibling');
        const siblingChild = createNode('parent/sibling/child');
        cache.registerRelationship(parent, child);
        cache.registerRelationship(child, createNode('parent/child/grandchild'));
        cache.registerRelationship(parent, sibling);
        cache.registerRelationship(sibling, siblingChild);

        cache.clear(child.id);

        expect(cache.getChildren(parent)).toEqual([sibling]);
        expect(cache.getChildren(child)).toEqual([]);
        expect(cache.getChildren(sibling)).toEqual([siblingChild]);

        cache.clear(parent.id);

        expect(cache.getChildren(parent)).toEqual([]);
        expect(cache.getChildren(sibling)).toEqual([]);
    });
});
