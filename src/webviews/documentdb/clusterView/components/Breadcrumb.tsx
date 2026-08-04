/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Breadcrumb, BreadcrumbButton, BreadcrumbDivider, BreadcrumbItem } from '@fluentui/react-components';
import { DatabaseRegular, ServerRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { type JSX } from 'react';

export interface DashboardBreadcrumbProps {
    clusterDisplayName: string;
    /** Current database when drilled in; `undefined` on the overview page. */
    databaseName?: string;
    /** Navigate back to the cluster overview. */
    onNavigateToOverview: () => void;
}

/**
 * Cluster → database breadcrumb. On the overview the cluster segment is the
 * current (non-interactive) page; when drilled into a database the cluster
 * segment becomes a button that returns to the overview.
 */
export const DashboardBreadcrumb = ({
    clusterDisplayName,
    databaseName,
    onNavigateToOverview,
}: DashboardBreadcrumbProps): JSX.Element => {
    const onDatabasePage = databaseName !== undefined;

    return (
        <Breadcrumb aria-label={l10n.t('Cluster navigation')} className="dashboardBreadcrumb">
            <BreadcrumbItem>
                {onDatabasePage ? (
                    <BreadcrumbButton icon={<ServerRegular />} onClick={onNavigateToOverview}>
                        {clusterDisplayName}
                    </BreadcrumbButton>
                ) : (
                    <BreadcrumbButton icon={<ServerRegular />} current>
                        {clusterDisplayName}
                    </BreadcrumbButton>
                )}
            </BreadcrumbItem>
            {onDatabasePage && (
                <>
                    <BreadcrumbDivider />
                    <BreadcrumbItem>
                        <BreadcrumbButton icon={<DatabaseRegular />} current>
                            {databaseName}
                        </BreadcrumbButton>
                    </BreadcrumbItem>
                </>
            )}
        </Breadcrumb>
    );
};
