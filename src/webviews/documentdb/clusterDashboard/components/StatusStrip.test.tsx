/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SSRProvider } from '@fluentui/react-components';
import { act, useState, type JSX, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client'; // eslint-disable-line import/no-internal-modules

import { type ClusterStorageStats } from '../../../../documentdb/utils/getClusterHealth';
import { DashboardBreadcrumb } from './DashboardBreadcrumb';
import { StatusStrip } from './StatusStrip';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('@microsoft/vscode-ext-webview-fluentui/components', () => {
    const react = jest.requireActual<typeof import('react')>('react');
    return {
        MetricGrid: ({ children, className }: { children: ReactNode; className: string }): ReactNode =>
            react.createElement('div', { className }, children),
        MetricCard: ({ label, value }: { label: string; value: ReactNode }): ReactNode =>
            react.createElement('div', null, label, value ?? 'N/A'),
    };
});

jest.mock('@vscode/l10n', () => ({
    t: (message: string, ...args: unknown[]): string =>
        args.reduce<string>((result, value, index) => result.replace(`{${index}}`, String(value)), message),
}));

const storageStats: ClusterStorageStats = {
    databases: [
        {
            name: 'orders',
            sizeOnDiskBytes: 2048,
            dataSizeBytes: 1024,
            indexSizeBytes: 128,
            collections: 2,
            objects: 12,
            indexes: 3,
        },
    ],
    totalSizeBytes: 2048,
    omittedDatabaseCount: 0,
    errors: [],
};

describe('Dashboard inventory breadcrumb and metrics', () => {
    it('shows Databases below the cluster-wide metric cards', async () => {
        const host = document.createElement('div');
        const root = createRoot(host);
        document.body.appendChild(host);
        try {
            await act(async () => {
                root.render(
                    <SSRProvider>
                        <StatusStrip storageStats={storageStats} currentDatabase={null} />
                        <DashboardBreadcrumb currentDatabase={null} onNavigateToCluster={jest.fn()} />
                    </SSRProvider>,
                );
            });

            const breadcrumb = host.querySelector('.dashboardBreadcrumb');
            expect(breadcrumb?.getAttribute('aria-label')).toBe('Inventory level');
            expect(breadcrumb?.textContent).toBe('Databases');
            expect(breadcrumb?.previousElementSibling?.classList.contains('statusStrip')).toBe(true);
            const scope = host.querySelector('.metricsScopeLine');
            expect(scope?.textContent).toBe('Scope: All databases');
            expect(scope?.querySelector('.metricsScopeType')).toBeNull();
            expect(scope?.nextElementSibling?.classList.contains('metricsRow')).toBe(true);
            expect(host.querySelectorAll('.statusTile')).toHaveLength(4);
            expect(host.textContent).toContain('Databases / Collections');
        } finally {
            await act(async () => root.unmount());
            host.remove();
        }
    });

    it('navigates through Databases and switches back to cluster metrics', async () => {
        const host = document.createElement('div');
        const root = createRoot(host);
        document.body.appendChild(host);
        const onNavigateToCluster = jest.fn();

        const DashboardScope = (): JSX.Element => {
            const [currentDatabase, setCurrentDatabase] = useState<string | null>('orders');
            return (
                <>
                    <StatusStrip storageStats={storageStats} currentDatabase={currentDatabase} />
                    <DashboardBreadcrumb
                        currentDatabase={currentDatabase}
                        onNavigateToCluster={() => {
                            onNavigateToCluster();
                            setCurrentDatabase(null);
                        }}
                    />
                </>
            );
        };

        try {
            await act(async () => {
                root.render(
                    <SSRProvider>
                        <DashboardScope />
                    </SSRProvider>,
                );
            });

            const breadcrumb = host.querySelector('.dashboardBreadcrumb');
            expect(breadcrumb?.textContent).toBe('Databasesorders');
            expect(breadcrumb?.querySelector('.dashboardBreadcrumbDatabaseName')?.textContent).toBe('orders');
            expect(breadcrumb?.previousElementSibling?.classList.contains('statusStrip')).toBe(true);
            expect(host.querySelector('.metricsScopeLine')?.textContent).toBe('Scope: Database orders');
            expect(host.querySelector('.metricsScopeValue')?.textContent).toBe('orders');
            expect(host.querySelector('.statusStrip')?.textContent).toContain('Collections');
            expect(host.querySelector('.statusStrip')?.textContent).not.toContain('Databases / Collections');
            const cluster = Array.from(breadcrumb?.querySelectorAll('button') ?? []).find(
                (button) => button.textContent === 'Databases',
            );
            expect(cluster).toBeDefined();

            await act(async () => cluster?.click());

            expect(onNavigateToCluster).toHaveBeenCalledTimes(1);
            expect(host.querySelector('.dashboardBreadcrumb')?.textContent).toBe('Databases');
            expect(host.querySelector('.metricsScopeLine')?.textContent).toBe('Scope: All databases');
            expect(host.querySelector('.metricsScopeType')).toBeNull();
            expect(host.textContent).toContain('Databases / Collections');
        } finally {
            await act(async () => root.unmount());
            host.remove();
        }
    });
});
