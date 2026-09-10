/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client'; // eslint-disable-line import/no-internal-modules

/**
 * Test-only. Excluded from the build (`tsconfig.json`), never exported from a public entry, by the
 * same reasoning decision 0007 records for the sibling package's `src/testing/`.
 */

/** jsdom ships no `ResizeObserver`, and `ContainerBody` wires one unconditionally. */
class NoopResizeObserver {
    public observe(): void {
        /* jsdom has no layout, so there is nothing to report */
    }
    public unobserve(): void {
        /* no-op */
    }
    public disconnect(): void {
        /* no-op */
    }
}

export interface RenderedSurface {
    /** The rendered tree's outermost element. */
    readonly root: HTMLElement;
    readonly rerender: (next: ReactNode) => Promise<void>;
}

const mounted: { host: HTMLElement; reactRoot: Root }[] = [];

/** Call from `beforeAll`. */
export const installTestEnvironment = (): void => {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = NoopResizeObserver;
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
};

/** Call from `afterEach`. Focus survives between tests otherwise, and the next assertion inherits it. */
export const cleanupSurfaces = async (): Promise<void> => {
    for (const { host, reactRoot } of mounted.splice(0)) {
        await act(async () => {
            reactRoot.unmount();
        });
        host.remove();
    }
};

export const renderSurface = async (node: ReactNode): Promise<RenderedSurface> => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const reactRoot = createRoot(host);
    mounted.push({ host, reactRoot });

    await act(async () => {
        reactRoot.render(node);
    });

    return {
        root: host.firstElementChild as HTMLElement,
        rerender: async (next: ReactNode): Promise<void> => {
            await act(async () => {
                reactRoot.render(next);
            });
        },
    };
};

export interface ScrollMetrics {
    readonly scrollTop: number;
    readonly clientHeight: number;
    readonly scrollHeight: number;
}

/** jsdom reports 0 for every layout metric, so a test that measures overflow supplies them. */
export const setScrollMetrics = (element: HTMLElement, metrics: ScrollMetrics): void => {
    for (const [name, value] of Object.entries(metrics)) {
        Object.defineProperty(element, name, { value, configurable: true });
    }
};
