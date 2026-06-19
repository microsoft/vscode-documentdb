/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useConfiguration } from '@microsoft/vscode-ext-react-webview';
import { type JSX, useState } from 'react';
import './clusterView.scss';
import { type ClusterViewWebviewConfigurationType } from './clusterViewController';
import { DashboardBreadcrumb } from './components/Breadcrumb';
import { CollectionList } from './components/CollectionList';
import { DatabaseList } from './components/DatabaseList';

/**
 * Discriminated page state for the dashboard's two views: the cluster overview
 * (list of databases) and the per-database drill-in (list of collections). All
 * navigation is client-side; the breadcrumb returns to the overview.
 */
type PageState = { kind: 'overview' } | { kind: 'database'; databaseName: string };

/**
 * Cluster dashboard / home page. Opens from the cluster tree node in place of
 * the empty editor and lets users browse databases and drill into a database
 * to see its collections, with search, sort, and create flows.
 */
export const ClusterView = (): JSX.Element => {
    const configuration = useConfiguration<ClusterViewWebviewConfigurationType>();
    const [page, setPage] = useState<PageState>({ kind: 'overview' });

    return (
        <div className="clusterViewRoot">
            <DashboardBreadcrumb
                clusterDisplayName={configuration?.clusterDisplayName ?? ''}
                databaseName={page.kind === 'database' ? page.databaseName : undefined}
                onNavigateToOverview={() => setPage({ kind: 'overview' })}
            />
            {page.kind === 'overview' ? (
                <DatabaseList onOpenDatabase={(databaseName) => setPage({ kind: 'database', databaseName })} />
            ) : (
                <CollectionList databaseName={page.databaseName} />
            )}
        </div>
    );
};
