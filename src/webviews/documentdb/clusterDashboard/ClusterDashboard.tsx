/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useConfiguration } from '@microsoft/vscode-ext-webview/react';
import { type JSX } from 'react';

import { type ClusterDashboardWebviewConfigurationType } from './clusterDashboardController';

export const ClusterDashboard = (): JSX.Element => {
    const configuration = useConfiguration<ClusterDashboardWebviewConfigurationType>();

    return <div className="clusterDashboard">{configuration.clusterDisplayName}</div>;
};
