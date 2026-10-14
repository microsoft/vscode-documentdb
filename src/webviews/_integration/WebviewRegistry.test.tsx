/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom

import { act, Suspense } from 'react';
import { createRoot } from 'react-dom/client'; // eslint-disable-line import/no-internal-modules
import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { type WebviewName, WebviewRegistry } from './WebviewRegistry';

const moduleLoads = vi.hoisted(() => ({
    clusterDashboard: vi.fn(() => ({ ClusterDashboard: (): string => 'clusterDashboard' })),
    collectionView: vi.fn(() => ({ CollectionView: (): string => 'collectionView' })),
    documentView: vi.fn(() => ({ DocumentView: (): string => 'documentView' })),
    localQuickStart: vi.fn(() => ({ LocalQuickStart: (): string => 'localQuickStart' })),
    atlasCredentials: vi.fn(() => ({ AtlasCredentialsView: (): string => 'atlasCredentials' })),
}));

vi.mock('../documentdb/clusterDashboard/ClusterDashboard', moduleLoads.clusterDashboard);
vi.mock('../documentdb/collectionView/CollectionView', moduleLoads.collectionView);
vi.mock('../documentdb/documentView/documentView', moduleLoads.documentView);
vi.mock('../documentdb/localQuickStart/LocalQuickStart', moduleLoads.localQuickStart);
vi.mock('../documentdb/atlasCredentials/AtlasCredentialsView', moduleLoads.atlasCredentials);

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('WebviewRegistry', () => {
    it('loads only the selected root module and renders each named export through Suspense', async () => {
        expectTypeOf<WebviewName>().toEqualTypeOf<
            'clusterDashboard' | 'collectionView' | 'documentView' | 'localQuickStart' | 'atlasCredentials'
        >();
        expect(Object.keys(WebviewRegistry).sort()).toEqual(Object.keys(moduleLoads).sort());
        for (const load of Object.values(moduleLoads)) {
            expect(load).not.toHaveBeenCalled();
        }

        const host = document.createElement('div');
        document.body.appendChild(host);
        const root = createRoot(host);
        const loaded = new Set<WebviewName>();
        const names: WebviewName[] = [
            'atlasCredentials',
            'localQuickStart',
            'documentView',
            'collectionView',
            'clusterDashboard',
        ];

        try {
            for (const name of names) {
                const Component = WebviewRegistry[name];
                await act(async () => {
                    root.render(
                        <Suspense fallback={null}>
                            <Component />
                        </Suspense>,
                    );
                    await vi.dynamicImportSettled();
                });

                expect(host.textContent).toBe(name);
                loaded.add(name);
                for (const key of names) {
                    expect(moduleLoads[key]).toHaveBeenCalledTimes(loaded.has(key) ? 1 : 0);
                }
            }
        } finally {
            await act(async () => {
                root.unmount();
                await vi.dynamicImportSettled();
            });
            host.remove();
        }
    });
});
