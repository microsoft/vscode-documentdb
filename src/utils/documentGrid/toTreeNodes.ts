/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { BSONTypes } from '@documentdb-js/schema-analyzer';
import { type Document, type ObjectId } from 'mongodb';
import { assignRowIdentities } from './documentIdentity';
import { toGridCellValue } from './toTablePage';
import { type GridCellValue, type TreeNode } from './types';

const ARRAY_EXPANSION_LIMIT = 10;

export function toTreeNodes(documents: readonly Document[], identityTrusted: boolean): TreeNode[] {
    const nodes: TreeNode[] = [];
    const identities = assignRowIdentities(documents, identityTrusted);
    documents.forEach((document, index) => {
        const rowKey = identities[index].rowKey;
        const rootKey = JSON.stringify([rowKey]);
        const id: unknown = Object.prototype.hasOwnProperty.call(document, '_id') ? document._id : undefined;
        let field: string;
        if (id === null) {
            field = 'null';
        } else if (BSONTypes.inferType(id) === BSONTypes.ObjectId) {
            field = (id as ObjectId).toHexString();
        } else {
            field = JSON.stringify(id) ?? '';
        }
        nodes.push({
            key: rootKey,
            parentKey: null,
            depth: 0,
            field,
            value: { display: '{...}', type: BSONTypes.Object },
            expandable: Object.keys(document).length > 0,
        });

        const stack = Object.entries(document)
            .reverse()
            .map(([key, value]) => ({
                segments: [key] as (string | number)[],
                field: key,
                value: value as unknown,
                parentKey: rootKey,
            }));

        while (stack.length > 0) {
            const entry = stack.pop();
            if (!entry) {
                continue;
            }
            const key = JSON.stringify([rowKey, ...entry.segments]);
            const type = BSONTypes.inferType(entry.value);
            const children: { segment: string | number; field: string; value: unknown }[] = [];
            let value: GridCellValue;
            if (type === BSONTypes.Object) {
                value = { display: '{...}', type };
                for (const [field, child] of Object.entries(entry.value as object)) {
                    children.push({ segment: field, field, value: child });
                }
            } else if (Array.isArray(entry.value)) {
                value = { display: `(elements: ${entry.value.length})`, type };
                if (entry.value.length <= ARRAY_EXPANSION_LIMIT) {
                    entry.value.forEach((child, childIndex) => {
                        children.push({
                            segment: childIndex,
                            field: `${entry.field}[${childIndex}]`,
                            value: child as unknown,
                        });
                    });
                }
            } else {
                value = toGridCellValue(entry.value);
            }
            nodes.push({
                key,
                parentKey: entry.parentKey,
                depth: entry.segments.length,
                field: entry.field,
                value,
                expandable: children.length > 0,
            });
            for (const child of children.reverse()) {
                stack.push({
                    segments: [...entry.segments, child.segment],
                    field: child.field,
                    value: child.value,
                    parentKey: key,
                });
            }
        }
    });
    return nodes;
}
