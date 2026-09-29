import { Breadcrumb, BreadcrumbButton, BreadcrumbDivider, BreadcrumbItem, Tooltip } from '@fluentui/react-components';
import { DatabaseMultipleRegular, DatabaseRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { type JSX } from 'react';

interface DashboardBreadcrumbProps {
    currentDatabase: string | null;
    onNavigateToCluster: () => void;
}

export const DashboardBreadcrumb = ({
    currentDatabase,
    onNavigateToCluster,
}: DashboardBreadcrumbProps): JSX.Element => (
    <Breadcrumb className="dashboardBreadcrumb" aria-label={l10n.t('Inventory level')} size="medium">
        <BreadcrumbItem>
            <BreadcrumbButton
                current={currentDatabase === null}
                icon={<DatabaseMultipleRegular />}
                onClick={currentDatabase === null ? undefined : onNavigateToCluster}
            >
                {l10n.t('Databases')}
            </BreadcrumbButton>
        </BreadcrumbItem>
        {currentDatabase !== null && (
            <>
                <BreadcrumbDivider />
                <BreadcrumbItem>
                    <Tooltip content={currentDatabase} relationship="inaccessible">
                        <BreadcrumbButton current icon={<DatabaseRegular />}>
                            <span className="dashboardBreadcrumbDatabaseName">{currentDatabase}</span>
                        </BreadcrumbButton>
                    </Tooltip>
                </BreadcrumbItem>
            </>
        )}
    </Breadcrumb>
);
