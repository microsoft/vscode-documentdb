/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { debounce } from 'es-toolkit';
import * as React from 'react';
import { useContext, useRef } from 'react';
import {
    SlickgridReact,
    type Formatter,
    type GridOption,
    type OnDblClickEventArgs,
    type OnSelectedRowsChangedEventArgs,
} from 'slickgrid-react';
import { type TableDataEntry } from '../../../../documentdb/ClusterSession';
import { type CellValue } from '../../../../utils/slickgrid/CellValue';
import { bsonStringToDisplayString } from '../../../utils/slickgrid/typeToDisplayString';
import { CollectionViewContext } from '../collectionViewContext';
import './dataViewPanelTableV2.scss';
import { LoadingAnimationTable } from './LoadingAnimationTable';

interface Props {
    liveHeaders: string[];
    liveData: TableDataEntry[];
    handleStepIn: (row: number, cell: number) => void;
}

const cellFormatter: Formatter<object> = (_row: number, _cell: number, value: CellValue) => {
    if (value === undefined || value === null) {
        return {
            text: '',
            toolTip: l10n.t('This field is not set'),
        };
    }
    return {
        text: value.value,
        addClasses: `typedTableCell type-${value.type}`,
        toolTip: bsonStringToDisplayString(value.type),
    };
};

export function DataViewPanelTableV2({ liveHeaders, liveData, handleStepIn }: Props): React.JSX.Element {
    const [currentContext, setCurrentContext] = useContext(CollectionViewContext);
    const gridRef = useRef<SlickgridReact>(null);

    // IMPORTANT: Store latest data in refs to solve React closure issues with third-party components.
    // React closure issues occur when event handlers or callbacks capture outdated state or props
    // from the render in which they were defined. This is known as "stale state capturing."
    // SlickGrid binds event handlers during initialization and doesn't automatically update them on re-renders,
    // leading to potential bugs if the state changes after the handlers are initialized.
    const liveDataRef = useRef<TableDataEntry[]>(liveData);

    // Also keep a ref for grid columns to solve the same issue
    const gridColumnsRef = useRef<Array<{ id: string; name: string; field: string; minWidth: number }>>([]);

    // Update data ref whenever liveData changes
    React.useEffect(() => {
        liveDataRef.current = liveData;
    }, [liveData]);

    // Create grid columns
    type GridColumn = { id: string; name: string; field: string; minWidth: number };

    const gridColumns: GridColumn[] = liveHeaders.map((header) => {
        return {
            id: header + '_id',
            name: header,
            field: header,
            minWidth: 100,
            formatter: cellFormatter,
        };
    });

    // Update grid columns ref whenever they change
    React.useEffect(() => {
        gridColumnsRef.current = gridColumns;
    }, [gridColumns]);

    // Using useCallback for reference stability, but the critical solution is the ref pattern
    const onCellDblClick = React.useCallback(
        (event: CustomEvent<{ eventData: unknown; args: OnDblClickEventArgs }>): void => {
            // Use ref to always get latest data and columns
            const activeDocument = liveDataRef.current[event.detail.args.row];

            // Access columns from the ref instead of the closure-captured variable
            const columnsData = gridColumnsRef.current;
            if (!activeDocument || event.detail.args.cell >= columnsData.length) {
                return; // Guard against invalid indexes
            }

            const activeColumn = columnsData[event.detail.args.cell].field;
            const activeCell = activeDocument[activeColumn] as { type?: string };

            if (activeCell && activeCell.type === 'object') {
                handleStepIn(event.detail.args.row, event.detail.args.cell);
            }
        },
        [handleStepIn],
    );

    // Add this handler definition after onCellDblClick but before gridOptions
    const onSelectedRowsChanged = React.useCallback(
        (_eventData: unknown, _args: OnSelectedRowsChangedEventArgs): void => {
            // Use the ref pattern to access latest data
            setCurrentContext((prev) => ({
                ...prev,
                commands: {
                    // Use prev instead of currentContext to avoid stale state references
                    ...prev.commands,
                    disableAddDocument: false,
                    disableDeleteDocument: _args.rows.length === 0,
                    disableEditDocument: _args.rows.length !== 1,
                    disableViewDocument: _args.rows.length !== 1,
                },
                dataSelection: {
                    selectedDocumentIndexes: _args.rows,
                    // Always use the ref to get the latest data, not the prop value captured in closure
                    selectedDocumentObjectIds: _args.rows.map((row) => liveDataRef.current[row]?.['x-objectid'] ?? ''),
                },
            }));
        },
        [setCurrentContext], // Only depends on setCurrentContext, not liveData since we use the ref
    );

    const gridOptions: GridOption = {
        autoResize: {
            calculateAvailableSizeBy: 'container',
            container: '#resultsDisplayAreaId', // this is a selector of the parent container, in this case it's the collectionView.tsx and the class is "resultsDisplayArea"
            bottomPadding: 2,
        },
        enableAutoResize: false, // Disable SlickGrid's automatic resize, we'll handle it manually with ResizeObserver
        enableAutoSizeColumns: true, // true by default, we disabled it under the assumption that there are a lot of columns in users' data in general

        enableCellNavigation: true,
        enableTextSelectionOnCells: true,

        enableCheckboxSelector: false, // todo: [post MVP] this is failing, it looks like it happens when we're defining columns after the grid has been created.. we're deleting the 'checkbox' column. we  can work around it, but it needs a bit more attention to get it done right.
        enableRowSelection: true,
        multiSelect: true,
        // checkboxSelector: {
        //     // optionally change the column index position of the icon (defaults to 0)
        //     // columnIndexPosition: 1,

        //     // you can toggle these 2 properties to show the "select all" checkbox in different location
        //     hideInFilterHeaderRow: false,
        //     hideInColumnTitleRow: true,
        //     applySelectOnAllPages: true, // when clicking "Select All", should we apply it to all pages (defaults to true)
        // },
        // rowSelectionOptions: {
        //     // todo: [post MVP] connected to the issue above.
        //     // True (Single Selection), False (Multiple Selections)
        //     selectActiveRow: false,
        // },

        // disalbing features that would require more polishing to make them production-ready
        enableColumnPicker: false,
        enableColumnReorder: false,
        enableContextMenu: false,
        enableGridMenu: false,
        enableHeaderButton: false,
        enableHeaderMenu: false,
        footerRowHeight: 1,
    };

    React.useEffect(() => {
        return () => {
            gridRef.current?.gridService.setSelectedRows([]);
        };
    }, []);

    /*
     * Effect to manually trigger grid update on liveHeaders or liveData change.
     * This is necessary because SlickGrid does not consistently re-render when data changes.
     * This could be an implementation issue/details of the SlickGrid React wrapper
     * or a mistake in the way we're using the grid.
     */
    React.useEffect(() => {
        gridRef.current?.gridService.renderGrid();
    }, [liveData, gridColumns]); // Re-run when headers or data change

    // Setup ResizeObserver to watch the results container and manually trigger grid resize
    React.useEffect(() => {
        const container = document.querySelector('.resultsDisplayArea');
        let resizeObserver: ResizeObserver | null = null;

        if (container) {
            const debouncedResizeHandler = debounce(() => {
                void gridRef.current?.resizerService?.resizeGrid(10);
            }, 200);

            resizeObserver = new ResizeObserver(debouncedResizeHandler);
            resizeObserver.observe(container);
        }

        return () => {
            if (resizeObserver) {
                resizeObserver.disconnect();
            }
        };
    }, []);

    if (currentContext.isFirstTimeLoad) {
        return <LoadingAnimationTable />;
    } else {
        return (
            <SlickgridReact
                gridId="myGrid"
                ref={gridRef}
                gridOptions={gridOptions}
                columnDefinitions={gridColumns}
                dataset={liveData}
                onDblClick={(event) => onCellDblClick(event)}
                onSelectedRowsChanged={debounce(
                    (event: { detail: { eventData: unknown; args: OnSelectedRowsChangedEventArgs } }) =>
                        onSelectedRowsChanged(event.detail.eventData, event.detail.args),
                    100,
                )}
            />
        );
    }
}
