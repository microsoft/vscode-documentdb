/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { type TreeNode } from '../../../../../utils/documentGrid/types';

interface DataViewPanelTreeProps {
    readonly nodes: readonly TreeNode[];
}

export const DataViewPanelTree = ({ nodes }: DataViewPanelTreeProps): React.JSX.Element => {
    void nodes;
    return <></>;
};
