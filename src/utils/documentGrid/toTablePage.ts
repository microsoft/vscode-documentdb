/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { BSONTypes, valueToDisplayString } from '@documentdb-js/schema-analyzer';
import { type Document } from 'mongodb';
import { ext } from '../../extensionVariables';
import { assignRowIdentities } from './documentIdentity';
import { fieldColumnKey, ROOT_ID_COLUMN_KEY, type ColumnKey, type GridCellValue, type TablePage } from './types';

export function toGridCellValue(value: unknown): GridCellValue {
    const type = BSONTypes.inferType(value);
    try {
        return {
            display: Array.isArray(value) ? `array[${value.length}]` : (valueToDisplayString(value, type) ?? ''),
            type,
        };
    } catch {
        ext.outputChannel.warn('[DocumentGrid] Failed to format a cell value');
        return { display: '', type };
    }
}

export function toTablePage(
    documents: readonly Document[],
    path: readonly string[],
    headers: readonly string[],
    identityTrusted: boolean,
): TablePage {
    const identities = assignRowIdentities(documents, identityTrusted);
    return {
        path: [...path],
        columns: [
            { key: ROOT_ID_COLUMN_KEY, label: '_id', isRootId: true },
            ...headers
                .filter((field) => field !== '_id')
                .map((field) => ({ key: fieldColumnKey(field), label: field, isRootId: false })),
        ],
        rows: documents.map((document, index) => {
            const cells: Partial<Record<ColumnKey, GridCellValue>> = {};
            if (Object.prototype.hasOwnProperty.call(document, '_id')) {
                cells[ROOT_ID_COLUMN_KEY] = toGridCellValue(document._id);
            }

            let subdocument: unknown = document;
            for (const field of path) {
                if (
                    subdocument !== null &&
                    typeof subdocument === 'object' &&
                    Object.prototype.hasOwnProperty.call(subdocument, field)
                ) {
                    subdocument = (subdocument as Document)[field] as unknown;
                } else {
                    subdocument = undefined;
                    break;
                }
            }

            if (
                subdocument !== null &&
                typeof subdocument === 'object' &&
                (BSONTypes.inferType(subdocument) === BSONTypes.Object || Array.isArray(subdocument))
            ) {
                for (const [field, value] of Object.entries(subdocument)) {
                    if (field !== '_id') {
                        cells[fieldColumnKey(field)] = toGridCellValue(value);
                    }
                }
            }
            return { ...identities[index], cells };
        }),
    };
}
