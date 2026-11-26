/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface GridCellValue {
    /** Formatter output; render as text, not HTML. */
    readonly display: string;
    /** The existing BSONTypes key, not its display name. */
    readonly type: string;
}

export const ROOT_ID_COLUMN_KEY = 'root:_id';
const FIELD_COLUMN_KEY_PREFIX = 'field:';
export type FieldColumnKey = `field:${string}`;
export type ColumnKey = typeof ROOT_ID_COLUMN_KEY | FieldColumnKey;

export function fieldColumnKey(field: string): FieldColumnKey {
    return `${FIELD_COLUMN_KEY_PREFIX}${field}`;
}

export function fieldFromColumnKey(key: ColumnKey): string | undefined {
    return key.startsWith(FIELD_COLUMN_KEY_PREFIX) ? key.slice(FIELD_COLUMN_KEY_PREFIX.length) : undefined;
}

export interface TableColumn {
    readonly key: ColumnKey;
    readonly label: string;
    readonly isRootId: boolean;
}

export interface TableRow {
    /** 'id:' + documentId when actionable; otherwise 'pos:' + zero-based page index. */
    readonly rowKey: string;
    /** Canonical EJSON of the root _id. Absent means browsable but not actionable. */
    readonly documentId?: string;
    /** Missing key means missing field. BSON null is { display: 'null', type: 'null' }. */
    readonly cells: Readonly<Partial<Record<ColumnKey, GridCellValue>>>;
}

export interface TablePage {
    readonly path: readonly string[];
    /** Root ID column first, then field columns at path. */
    readonly columns: readonly TableColumn[];
    /** Server order. */
    readonly rows: readonly TableRow[];
}

export interface TreeNode {
    /** JSON.stringify([rowKey, ...segments]); segments are field strings or array index numbers. */
    readonly key: string;
    readonly parentKey: string | null;
    /** Document root = 0; aria-level = depth + 1. */
    readonly depth: number;
    readonly field: string;
    readonly value: GridCellValue;
    /** True only if children exist; false for arrays over the expansion cap. */
    readonly expandable: boolean;
}

export function getCell(row: TableRow, key: ColumnKey): GridCellValue | undefined {
    return Object.prototype.hasOwnProperty.call(row.cells, key) ? row.cells[key] : undefined;
}
