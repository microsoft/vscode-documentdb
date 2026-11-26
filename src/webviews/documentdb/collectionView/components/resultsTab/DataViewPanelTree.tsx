/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';

interface Props {
    liveData: { [key: string]: unknown }[];
}

export const DataViewPanelTree = ({ liveData }: Props): React.JSX.Element => {
    void liveData;
    return <></>;
};
