/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { act, createElement, type FunctionComponent } from 'react';
// eslint-disable-next-line import/no-internal-modules -- react-dom/client is React 19's only root API
import { createRoot, type Root } from 'react-dom/client';
import { type VSCodeThemeState, useActiveVSCodeTheme } from './useActiveVSCodeTheme';

declare global {
    var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const setButtonBackground = (value: string): void =>
    document.documentElement.style.setProperty('--vscode-button-background', value);

function renderHook(): { results: VSCodeThemeState[]; rerender: () => void; unmount: () => void } {
    const results: VSCodeThemeState[] = [];

    const Probe: FunctionComponent = () => {
        results.push(useActiveVSCodeTheme());
        return null;
    };

    const container = document.createElement('div');
    document.body.appendChild(container);

    let root: Root;
    act(() => {
        root = createRoot(container);
        root.render(createElement(Probe));
    });

    return {
        results,
        rerender: () => act(() => root.render(createElement(Probe, { key: undefined }))),
        unmount: () =>
            act(() => {
                root.unmount();
                container.remove();
            }),
    };
}

describe('useActiveVSCodeTheme', () => {
    beforeAll(() => {
        globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    });

    afterEach(() => {
        document.documentElement.removeAttribute('style');
        document.body.removeAttribute('data-vscode-theme-kind');
    });

    it('re-derives the brand ramp on a same-kind theme color change', async () => {
        document.body.setAttribute('data-vscode-theme-kind', 'vscode-dark');
        setButtonBackground('#0066cc');

        const { results, unmount } = renderHook();
        const initialBrandBackground = results.at(-1)?.theme?.colorBrandBackground;

        try {
            await act(async () => {
                setButtonBackground('#cc3300');
                await Promise.resolve();
            });

            expect(document.body.getAttribute('data-vscode-theme-kind')).toBe('vscode-dark');
            expect(results.at(-1)?.theme?.colorBrandBackground).not.toBe(initialBrandBackground);
        } finally {
            unmount();
        }
    });

    it('holds its identity across a render when the theme colors are unchanged', () => {
        document.body.setAttribute('data-vscode-theme-kind', 'vscode-dark');
        setButtonBackground('#0066cc');

        const { results, rerender, unmount } = renderHook();
        const first = results.at(-1);

        try {
            rerender();
            expect(results.at(-1)).toBe(first);
        } finally {
            unmount();
        }
    });
});