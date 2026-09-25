/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SSRProvider } from '@fluentui/react-components';
import { createElement, type ReactNode } from 'react';
// eslint-disable-next-line import/no-internal-modules -- React DOM exposes server rendering through this public subpath.
import { renderToStaticMarkup } from 'react-dom/server';

import { type ClusterDashboardInfo } from '../clusterDashboardRouter';
import { buildDetailGroups } from './DashboardDetails';
import { collectResilienceBadges, DashboardHeader } from './DashboardHeader';

jest.mock('@microsoft/vscode-ext-webview-fluentui/components', () => {
    const react = jest.requireActual<typeof import('react')>('react');
    return {
        FocusableBadge: ({ children, ...props }: { children: ReactNode; className?: string }): ReactNode =>
            react.createElement('span', { ...props, role: 'group', tabIndex: 0 }, children),
    };
});

jest.mock('@vscode/l10n', () => ({
    t: (message: string, ...args: unknown[]): string => {
        const substitutions = args[0];
        if (typeof substitutions === 'object' && substitutions !== null) {
            return Object.entries(substitutions).reduce(
                (result, [key, value]) => result.replace(`{${key}}`, String(value)),
                message,
            );
        }
        return args.reduce<string>((result, value, index) => result.replace(`{${index}}`, String(value)), message);
    },
}));

interface VersionScenario {
    name: string;
    metadata: ClusterDashboardInfo['metadata'];
    headerVersions: string[];
    rows: Array<{ label: string; value: string }>;
}

const SCENARIOS: VersionScenario[] = [
    {
        name: 'engine and API',
        metadata: {
            topology_hello_internal_documentdb_versions: '0.117-0;0.117.0',
            serverInfo_version: '7.0.0',
        },
        headerVersions: ['DocumentDB 0.117-0 · 0.117.0', 'API 7.0.0'],
        rows: [
            { label: 'Engine version', value: '0.117-0 · 0.117.0' },
            { label: 'API version', value: '7.0.0' },
        ],
    },
    {
        name: 'all three reported Azure DocumentDB versions and the separate API version',
        metadata: {
            topology_hello_internal_documentdb_versions: '1.117-3;2.0.0;12.1-1',
            serverInfo_version: '7.0.0',
        },
        headerVersions: ['DocumentDB 1.117-3 · 2.0.0 · 12.1-1', 'API 7.0.0'],
        rows: [
            { label: 'Engine version', value: '1.117-3 · 2.0.0 · 12.1-1' },
            { label: 'API version', value: '7.0.0' },
        ],
    },
    {
        name: 'all reported DocumentDB versions when the API is missing',
        metadata: { topology_hello_internal_documentdb_versions: '1.117-3;2.0.0;12.1-1' },
        headerVersions: ['DocumentDB 1.117-3 · 2.0.0 · 12.1-1'],
        rows: [{ label: 'Engine version', value: '1.117-3 · 2.0.0 · 12.1-1' }],
    },
    {
        name: 'engine only when buildInfo fails',
        metadata: { topology_hello_internal_documentdb_versions: '0.117.0' },
        headerVersions: ['DocumentDB 0.117.0'],
        rows: [{ label: 'Engine version', value: '0.117.0' }],
    },
    {
        name: 'engine only when the API version is unclear',
        metadata: {
            topology_hello_internal_documentdb_versions: '0.117.0',
            serverInfo_version: 'unknown',
        },
        headerVersions: ['DocumentDB 0.117.0'],
        rows: [{ label: 'Engine version', value: '0.117.0' }],
    },
    {
        name: 'API only when the engine version is ambiguous',
        metadata: {
            topology_hello_internal_documentdb_versions: '0.117.0;unknown',
            serverInfo_version: '7.0.0',
        },
        headerVersions: ['API 7.0.0'],
        rows: [{ label: 'API version', value: '7.0.0' }],
    },
    {
        name: 'API only when the engine version is empty',
        metadata: {
            topology_hello_internal_documentdb_versions: '',
            serverInfo_version: '7.0.0',
        },
        headerVersions: ['API 7.0.0'],
        rows: [{ label: 'API version', value: '7.0.0' }],
    },
    {
        name: 'existing server wording without DocumentDB metadata',
        metadata: { serverInfo_version: '8.0.11' },
        headerVersions: ['8.0.11'],
        rows: [{ label: 'Server version', value: '8.0.11' }],
    },
    {
        name: 'neither version available',
        metadata: {},
        headerVersions: [],
        rows: [],
    },
    {
        name: 'neither version clear',
        metadata: { topology_hello_internal_documentdb_versions: 'unknown', serverInfo_version: 'unknown' },
        headerVersions: [],
        rows: [],
    },
];

describe('Dashboard versions', () => {
    it.each(SCENARIOS)('renders $name consistently in the header and details', ({ metadata, headerVersions, rows }) => {
        const clusterInfo: ClusterDashboardInfo = { clusterDisplayName: 'Test cluster', metadata, hosts: [] };
        const html = renderToStaticMarkup(
            createElement(
                SSRProvider,
                null,
                createElement(DashboardHeader, {
                    clusterDisplayName: clusterInfo.clusterDisplayName,
                    clusterInfo,
                    connectionState: 'connected',
                    latestSample: { uptimeSeconds: 3600, pingLatencyMs: 3, errors: [] },
                    azure: { location: 'westus2', sku: 'M10' },
                }),
            ),
        );
        const labels = Array.from(
            html.matchAll(/class="dashboardFactLabel"(?: id="[^"]*")?>([^<]*)</g),
            (match) => match[1],
        );
        const versionLabels = rows.map((row) => {
            if (row.label === 'Engine version') {
                return 'DocumentDB';
            }
            return row.label === 'API version' ? 'API' : 'Version';
        });
        const expectedLabels = [...versionLabels, 'Region', 'Compute', 'Uptime'];
        expect(labels).toEqual(expectedLabels);
        const tagCount =
            metadata['topology_hello_internal_documentdb_versions'] === undefined ? 0 : headerVersions.length;
        expect(html.match(/class="dashboardFactSegment(?: dashboardVersion)?"/g)).toHaveLength(
            3 + headerVersions.length,
        );
        const values = Array.from(
            html.matchAll(/class="dashboardFactValue"(?: (?:title|id)="[^"]*")?>([^<]*)</g),
            (match) => match[1],
        );
        const expectedValues = [...rows.map((row) => row.value), 'West US 2 (westus2)', 'M10', '1h 0m'];
        expect(values).toEqual(expectedValues);
        expect(html.match(/class="dashboardFactSegment(?: dashboardVersion)?" role="group" tabindex="0" aria-labelledby=/g)).toHaveLength(
            3 + headerVersions.length,
        );
        expect(html.match(/class="dashboardFactSeparator" aria-hidden="true">\|<\/span>/g)).toHaveLength(
            3 + headerVersions.length,
        );
        if (tagCount > 0) {
            expect(html.match(/class="dashboardFactSegment dashboardVersion" role="group" tabindex="0" aria-labelledby=[^>]+><span class="dashboardFactSeparator"/g)).toHaveLength(
                tagCount,
            );
        }
        expect(html).not.toContain('DocumentDB 0.117.0 · API 7.0.0');
        const groups = buildDetailGroups(clusterInfo, undefined);
        expect(groups).toEqual(
            rows.length === 0 ? [] : [{ title: 'Server', details: rows.map((row) => ({ ...row, copyable: false })) }],
        );
    });

    it('omits version facts before cluster metadata arrives', () => {
        const html = renderToStaticMarkup(
            createElement(
                SSRProvider,
                null,
                createElement(DashboardHeader, {
                    clusterDisplayName: 'Test cluster',
                    clusterInfo: null,
                    connectionState: 'connecting',
                    latestSample: null,
                }),
            ),
        );
        expect(html).not.toContain('dashboardFactLabel');
        expect(buildDetailGroups(null, undefined)).toEqual([]);
    });

    it('renders one wrapping status strip with separators attached to warnings and facts', () => {
        const html = renderToStaticMarkup(
            createElement(
                SSRProvider,
                null,
                createElement(DashboardHeader, {
                    clusterDisplayName: 'Test cluster',
                    clusterInfo: {
                        clusterDisplayName: 'Test cluster',
                        metadata: {
                            topology_hello_internal_documentdb_versions: '0.117.0',
                            serverInfo_version: '7.0.0',
                            topology_readOnly: 'true',
                        },
                        hosts: [],
                    },
                    connectionState: 'connected',
                    latestSample: { uptimeSeconds: 3600, pingLatencyMs: 3, errors: [] },
                    azure: { location: 'westus2', sku: 'M10', enableHa: false },
                }),
            ),
        );

        expect(html.match(/class="dashboardHeaderStatus"/g)).toHaveLength(1);
        expect(html).not.toContain('dashboardHeaderStatusNarrow');
        expect(html).not.toContain('dashboardHeaderOverflow');
        expect(html).toContain('dashboardResilienceBadge');
        expect(html).toContain('No high availability');
        expect(html.indexOf('dashboardHeaderLatency')).toBeLessThan(html.indexOf('dashboardResilienceBadge'));
        expect(html.indexOf('dashboardResilienceBadge')).toBeLessThan(html.indexOf('class="dashboardFact"'));
        expect(html.match(/class="dashboardFactSegment dashboardResilience"><span class="dashboardFactSeparator" aria-hidden="true">\|<\/span>/g)).toHaveLength(
            2,
        );
        expect(html).toContain('dashboardFactName');
        expect(html.match(/\bdashboardDisclosure\b/g)).toHaveLength(1);
    });

    it('shows an Azure HA badge only when its setting is known', () => {
        expect(collectResilienceBadges({}, { enableHa: true })).toEqual([
            {
                label: 'High Availability',
                tooltip: 'The Azure resource reports that in-region high availability is enabled.',
                color: 'success',
            },
        ]);
        expect(collectResilienceBadges({}, { enableHa: false })).toEqual([
            {
                label: 'No high availability',
                tooltip: 'The Azure resource reports that in-region high availability is disabled.',
                color: 'warning',
            },
        ]);
        expect(collectResilienceBadges({}, {})).toEqual([]);
        expect(collectResilienceBadges({ topology_readOnly: 'true' }, { enableHa: true })).toEqual([
            {
                label: 'Read-only connection',
                tooltip: 'The connected server reported readOnly: true in its hello response.',
                color: 'warning',
            },
            {
                label: 'High Availability',
                tooltip: 'The Azure resource reports that in-region high availability is enabled.',
                color: 'success',
            },
        ]);

        const html = renderToStaticMarkup(
            createElement(
                SSRProvider,
                null,
                createElement(DashboardHeader, {
                    clusterDisplayName: 'Test cluster',
                    clusterInfo: { clusterDisplayName: 'Test cluster', metadata: {}, hosts: [] },
                    connectionState: 'connected',
                    latestSample: null,
                    azure: { enableHa: true },
                }),
            ),
        );
        expect(html).toContain('class="dashboardResilienceBadge"');
        expect(html).toContain('color="success"');
        expect(html).toContain('High Availability');
        expect(html).not.toContain('No high availability');
    });
});
