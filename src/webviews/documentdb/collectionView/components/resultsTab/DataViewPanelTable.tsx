/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { DataGrid } from 'react-data-grid';
import 'react-data-grid/lib/styles.css';
import { type ColumnKey, type TablePage } from '../../../../../utils/documentGrid/types';
import { CollectionViewContext } from '../../collectionViewContext';
import { LoadingAnimationTable } from './LoadingAnimationTable';

interface DataViewPanelTableProps {
    readonly page: TablePage | undefined;
    readonly selectedRowKeys: readonly string[];
    readonly onSelectedRowKeysChange: (rowKeys: readonly string[]) => void;
    readonly onStepIn: (rowKey: string, columnKey: ColumnKey) => void;
}

export function DataViewPanelTable({
    page,
    selectedRowKeys,
    onSelectedRowKeysChange,
    onStepIn,
}: DataViewPanelTableProps): React.JSX.Element {
    const [currentContext] = React.useContext(CollectionViewContext);
    void page;
    void selectedRowKeys;
    void onStepIn;
    React.useEffect(() => (): void => onSelectedRowKeysChange([]), [onSelectedRowKeysChange]);

    if (currentContext.isFirstTimeLoad) {
        return <LoadingAnimationTable />;
    }

    return (
        <div inert aria-hidden="true">
            <DataGrid columns={[]} rows={[]} />
        </div>
    );
}
