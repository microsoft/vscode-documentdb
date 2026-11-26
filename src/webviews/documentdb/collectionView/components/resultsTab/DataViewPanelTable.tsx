/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { DataGrid } from 'react-data-grid';
import 'react-data-grid/lib/styles.css';
import { type TableDataEntry } from '../../../../../documentdb/ClusterSession';
import { CollectionViewContext } from '../../collectionViewContext';
import { LoadingAnimationTable } from './LoadingAnimationTable';

interface Props {
    liveHeaders: string[];
    liveData: TableDataEntry[];
    handleStepIn: (row: number, cell: number) => void;
}

export function DataViewPanelTable({ liveHeaders, liveData, handleStepIn }: Props): React.JSX.Element {
    const [currentContext] = React.useContext(CollectionViewContext);
    void liveHeaders;
    void liveData;
    void handleStepIn;

    if (currentContext.isFirstTimeLoad) {
        return <LoadingAnimationTable />;
    }

    return (
        <div inert aria-hidden="true">
            <DataGrid columns={[]} rows={[]} />
        </div>
    );
}
