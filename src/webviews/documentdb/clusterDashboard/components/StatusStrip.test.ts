/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it, vi } from 'vitest';

import { createElement } from 'react';
// eslint-disable-next-line import/no-internal-modules -- React DOM exposes server rendering through this public subpath.
import { renderToStaticMarkup } from 'react-dom/server';

import { type ClusterStorageStats } from '../../../../documentdb/utils/getClusterHealth';
import { StatusStrip } from './StatusStrip';

vi.mock('../../collectionView/queryInsightsTab/components/metricsRow', () => {
    const metric = ({ label, value }: { label: string; value: string | number | null | undefined }): string =>
        `${label}=${value === null ? 'null' : String(value)};`;
    return { GenericMetric: metric, CountMetric: metric };
});

vi.mock('@vscode/l10n', () => ({
    t: (message: string, substitutions?: Record<string, unknown>): string =>
        Object.entries(substitutions ?? {}).reduce(
            (result, [key, value]) => result.replace(`{${key}}`, String(value)),
            message,
        ),
}));

function renderStrip(storageStats: ClusterStorageStats): string {
    return renderToStaticMarkup(createElement(StatusStrip, { storageStats, currentDatabase: null }));
}

describe('StatusStrip', () => {
    it('does not report a failed database listing as an empty cluster', () => {
        const markup = renderStrip({
            databases: null,
            totalSizeBytes: null,
            omittedDatabaseCount: 0,
            errors: ['listDatabases: connect ECONNREFUSED'],
        });

        expect(markup).toContain('Databases / Collections=null;');
        expect(markup).toContain('Documents=null;');
        expect(markup).toContain('Indexes / Size=null;');
    });

    it('reports an empty cluster that was read successfully', () => {
        const markup = renderStrip({ databases: [], totalSizeBytes: 0, omittedDatabaseCount: 0, errors: [] });

        expect(markup).toContain('Databases / Collections=0 / 0;');
    });
});
