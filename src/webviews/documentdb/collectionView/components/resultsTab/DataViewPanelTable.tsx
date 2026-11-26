/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { DataGrid, type Column, type DefaultColumnOptions } from 'react-data-grid';
import 'react-data-grid/lib/styles.css';
import * as l10n from '@vscode/l10n';
import {
    getCell,
    type ColumnKey,
    type TableColumn,
    type TablePage,
    type TableRow,
} from '../../../../../utils/documentGrid/types';
import { CollectionViewContext } from '../../collectionViewContext';
import { LoadingAnimationTable } from './LoadingAnimationTable';
import './dataGridTheme.scss';
import './dataViewPanelTable.scss';

interface DataViewPanelTableProps {
    readonly page: TablePage | undefined;
    readonly selectedRowKeys: readonly string[];
    readonly onSelectedRowKeysChange: (rowKeys: readonly string[]) => void;
    readonly onStepIn: (rowKey: string, columnKey: ColumnKey) => void;
}

const defaultColumnOptions: DefaultColumnOptions<TableRow, unknown> = {
    resizable: true,
};

function renderTableCell(row: TableRow, column: TableColumn): React.ReactNode {
    return getCell(row, column.key)?.display ?? '';
}

export function DataViewPanelTable({
    page,
    selectedRowKeys,
    onSelectedRowKeysChange,
    onStepIn,
}: DataViewPanelTableProps): React.JSX.Element {
    const [currentContext] = React.useContext(CollectionViewContext);
    void selectedRowKeys;
    void onStepIn;
    React.useEffect(() => (): void => onSelectedRowKeysChange([]), [onSelectedRowKeysChange]);

    const columns = React.useMemo<readonly Column<TableRow>[]>(
        () =>
            (page?.columns ?? []).map(
                (column): Column<TableRow> => ({
                    key: column.key,
                    name: column.label,
                    renderCell: ({ row }): React.ReactNode => renderTableCell(row, column),
                }),
            ),
        [page?.columns],
    );

    if (currentContext.isFirstTimeLoad) {
        return <LoadingAnimationTable />;
    }

    return (
        <DataGrid
            aria-label={l10n.t('Table View')}
            className="documentDataGrid dataViewPanelTable"
            columns={columns}
            defaultColumnOptions={defaultColumnOptions}
            getRowKey={(row): string => row.rowKey}
            rows={page?.rows ?? []}
        />
    );
}
