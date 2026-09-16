/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { act, createElement, useLayoutEffect, type FunctionComponent } from 'react';
// eslint-disable-next-line import/no-internal-modules -- react-dom/client is React 19's only root API
import { createRoot, type Root } from 'react-dom/client';
import { type VSCodeMonacoTheme } from '../core/types';
import { useVSCodeMonacoTheme } from './useVSCodeMonacoTheme';

declare global {
    var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const setColor = (colorId: string, value: string): void =>
    document.documentElement.style.setProperty(`--vscode-${colorId.replace(/\./g, '-')}`, value);

/** Mounts the hook and reports every value it returned, in order. */
function renderHook(beforeSubscribe?: () => void): {
    results: VSCodeMonacoTheme[];
    rerender: () => void;
    unmount: () => void;
} {
    const results: VSCodeMonacoTheme[] = [];

    const Probe: FunctionComponent = () => {
        results.push(useVSCodeMonacoTheme());
        useLayoutEffect(() => beforeSubscribe?.(), [beforeSubscribe]);

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

describe('useVSCodeMonacoTheme', () => {
    beforeAll(() => {
        globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    });

    afterEach(() => {
        document.documentElement.removeAttribute('style');
        document.body.removeAttribute('data-vscode-theme-kind');
        document.body.removeAttribute('data-vscode-theme-id');
    });

    it('refreshes colors changed between the first render and initial subscription', () => {
        setColor('editor.background', '#111111');

        const { results, unmount } = renderHook(() => setColor('editor.background', '#222222'));

        try {
            expect(results[0].data.colors['editor.background']).toBe('#111111');
            expect(results.at(-1)?.data.colors['editor.background']).toBe('#222222');
        } finally {
            unmount();
        }
    });

    it('derives the theme from the active VS Code theme', () => {
        document.body.setAttribute('data-vscode-theme-kind', 'vscode-dark');
        setColor('editor.background', '#1e1e1e');

        const { results, unmount } = renderHook();

        expect(results.at(-1)?.data.base).toBe('vs-dark');
        expect(results.at(-1)?.data.colors['editor.background']).toBe('#1e1e1e');

        unmount();
    });

    // Defect (b): the extension keyed its cache on the theme kind, so Dark Modern to Dracula
    // returned the previous theme and Monaco kept the old colours until the webview reloaded.
    it('re-derives on a same-kind theme switch', async () => {
        document.body.setAttribute('data-vscode-theme-kind', 'vscode-dark');
        setColor('editor.background', '#1e1e1e');

        const { results, unmount } = renderHook();
        expect(results.at(-1)?.data.colors['editor.background']).toBe('#1e1e1e');

        await act(async () => {
            setColor('editor.background', '#282a36');
            await Promise.resolve();
        });

        expect(document.body.getAttribute('data-vscode-theme-kind')).toBe('vscode-dark');
        expect(results.at(-1)?.data.colors['editor.background']).toBe('#282a36');

        unmount();
    });

    it('holds its identity across a re-render, so the consumer effect does not re-run', () => {
        setColor('editor.background', '#1e1e1e');

        const { results, rerender, unmount } = renderHook();
        const first = results.at(-1);

        rerender();

        expect(results.at(-1)).toBe(first);

        unmount();
    });

    // The store fires on any root-style write, including ones that moved no colour we read.
    it('holds its identity when a mutation changed nothing it reads', async () => {
        setColor('editor.background', '#1e1e1e');

        const { results, unmount } = renderHook();
        const first = results.at(-1);

        await act(async () => {
            document.documentElement.style.setProperty('--vscode-activityBar-background', '#333333');
            await Promise.resolve();
        });

        expect(results.at(-1)).toBe(first);

        unmount();
    });
});
