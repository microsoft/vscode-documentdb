/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SSRProvider } from '@fluentui/react-components';
import { createElement } from 'react';
// eslint-disable-next-line import/no-internal-modules -- React DOM exposes server rendering through this public subpath.
import { renderToStaticMarkup } from 'react-dom/server';

import { type ClusterStorageStats } from '../../../../documentdb/utils/getClusterHealth';
import {
    createInventoryViewState,
    InventoryPanel,
    type InventoryPanelProps,
    type InventoryViewState,
} from './InventoryPanel';

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

jest.mock('../../collectionView/queryInsightsTab/components/metricsRow', () => ({
    formatCount: (value: number): string => String(value),
}));

jest.mock('../../../_integration/useTrpcClient', () => ({
    useTrpcClient: () => ({
        clusterDashboard: { openCollectionView: { mutate: jest.fn() } },
        common: { displayErrorMessage: { mutate: jest.fn() } },
    }),
}));

const EMPTY_STORAGE: ClusterStorageStats = {
    databases: [],
    totalSizeBytes: 0,
    omittedDatabaseCount: 0,
    errors: [],
};

function renderInventory(overrides: Partial<InventoryPanelProps> = {}): string {
    const props: InventoryPanelProps = {
        storageStats: EMPTY_STORAGE,
        storageError: null,
        isLoading: false,
        collections: {
            result: null,
            isLoading: false,
            isTableLoading: false,
            error: null,
            reload: jest.fn(),
        },
        viewState: createInventoryViewState(),
        onViewStateChange: jest.fn(),
        onCreateNamespace: jest.fn(),
        onRetryStorage: jest.fn(),
        isCreatingNamespace: false,
        busyNamespaces: [],
        ...overrides,
    };

    return renderToStaticMarkup(createElement(SSRProvider, null, createElement(InventoryPanel, props)));
}

function databaseViewState(databaseName: string): InventoryViewState {
    return { ...createInventoryViewState(), currentDatabase: databaseName };
}

describe('InventoryPanel empty states', () => {
    it('offers database creation after a successful empty cluster read', () => {
        const markup = renderInventory();

        expect(markup).toContain('No databases in this cluster');
        expect(markup).toContain('Create one to start storing documents.');
        expect(markup).toContain('New Database');
        expect(markup).not.toContain('Retry');
    });

    it('offers only retry and the reason after a failed cluster read', () => {
        const markup = renderInventory({ storageStats: null, storageError: 'permission denied' });

        expect(markup).toContain('fui-MessageBar');
        expect(markup).toContain('fui-MessageBarTitle');
        expect(markup).toContain('Could not read databases');
        expect(markup).toContain('The databases in this cluster could not be listed: permission denied');
        expect(markup).toContain('Retry');
        expect(markup).not.toContain('New Database');
    });

    it('reports an empty database inventory failure only in the retry panel', () => {
        const reason = 'listDatabases: connection closed';
        const markup = renderInventory({ storageStats: { ...EMPTY_STORAGE, errors: [reason] } });

        expect(markup).toContain('Could not read databases');
        expect(markup).toContain('Retry');
        expect(markup.split(reason)).toHaveLength(2);
        expect(markup).not.toContain('Some database statistics could not be read');
        expect(markup).not.toContain('New Database');
    });

    it('preserves the statistics warning when database rows are available', () => {
        const markup = renderInventory({
            storageStats: {
                ...EMPTY_STORAGE,
                errors: ['dbStats: permission denied'],
                databases: [
                    {
                        name: 'catalog',
                        sizeOnDiskBytes: 1,
                        dataSizeBytes: null,
                        indexSizeBytes: null,
                        collections: null,
                        objects: null,
                        indexes: null,
                    },
                ],
            },
        });

        expect(markup).toContain('Some database statistics could not be read: dbStats: permission denied');
        expect(markup).toContain('Showing 1 of 1 databases');
        expect(markup).not.toContain('Could not read databases');
    });

    it('names the database and offers collection creation after a successful empty read', () => {
        const markup = renderInventory({
            viewState: databaseViewState('catalog'),
            collections: {
                result: { databaseName: 'catalog', collections: [], omittedCollectionCount: 0, errors: [] },
                isLoading: false,
                isTableLoading: false,
                error: null,
                reload: jest.fn(),
            },
        });

        expect(markup).toContain('No collections in &quot;catalog&quot;');
        expect(markup).toContain('New Collection');
        expect(markup).not.toContain('Retry');
    });

    it('offers only retry and the reason after a failed collection read', () => {
        const markup = renderInventory({
            viewState: databaseViewState('catalog'),
            collections: {
                result: null,
                isLoading: false,
                isTableLoading: false,
                error: 'request timed out',
                reload: jest.fn(),
            },
        });

        expect(markup).toContain('Could not read collections');
        expect(markup).toContain('The collections of &quot;catalog&quot; could not be listed: request timed out');
        expect(markup).toContain('Retry');
        expect(markup).not.toContain('New Collection');
    });

    it('does not offer creation while a zero-row inventory is still loading', () => {
        const markup = renderInventory({ storageStats: null, isLoading: true });

        expect(markup).toContain('Loading inventory');
        expect(markup).not.toContain('New Database');
    });

    it('keeps the table when a filter matches no rows', () => {
        const markup = renderInventory({
            storageStats: {
                ...EMPTY_STORAGE,
                databases: [
                    {
                        name: 'catalog',
                        sizeOnDiskBytes: 1,
                        dataSizeBytes: 1,
                        indexSizeBytes: 0,
                        collections: 1,
                        objects: 1,
                        indexes: 1,
                    },
                ],
            },
            viewState: { ...createInventoryViewState(), filterText: 'missing' },
        });

        expect(markup).toContain('Showing 0 of 1 databases');
        expect(markup).not.toContain('No databases in this cluster');
    });
});
