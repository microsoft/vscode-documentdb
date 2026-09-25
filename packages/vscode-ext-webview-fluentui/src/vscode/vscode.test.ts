/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { vscodeColorIdToCSSVariable } from './cssVariable';
import { readVSCodeThemeColors } from './readVSCodeThemeColors';
import { getVSCodeThemeColorsVersion, subscribeToVSCodeThemeColors } from './themeColorsStore';
import { DEFAULT_VSCODE_THEME_KIND, readVSCodeThemeKind } from './themeKind';

/** MutationObserver callbacks are delivered as microtasks. */
const flush = (): Promise<void> => Promise.resolve();

describe('vscodeColorIdToCSSVariable', () => {
    it('replaces every dot, not just the first', () => {
        expect(vscodeColorIdToCSSVariable('editorWidget.background')).toBe('--vscode-editorWidget-background');
        expect(vscodeColorIdToCSSVariable('walkthrough.stepTitle.foreground')).toBe(
            '--vscode-walkthrough-stepTitle-foreground',
        );
    });

    it('leaves a dotless id alone', () => {
        expect(vscodeColorIdToCSSVariable('focusBorder')).toBe('--vscode-focusBorder');
    });
});

describe('readVSCodeThemeKind', () => {
    afterEach(() => document.body.removeAttribute('data-vscode-theme-kind'));

    it('reads the attribute VS Code publishes', () => {
        document.body.setAttribute('data-vscode-theme-kind', 'vscode-dark');

        expect(readVSCodeThemeKind()).toBe('vscode-dark');
    });

    it('falls back outside a webview, where the attribute is absent', () => {
        expect(readVSCodeThemeKind()).toBe(DEFAULT_VSCODE_THEME_KIND);
    });
});

describe('readVSCodeThemeColors', () => {
    afterEach(() => document.documentElement.removeAttribute('style'));

    it('resolves published ids as hex', () => {
        document.documentElement.style.setProperty('--vscode-editor-background', '#1e1e1e');
        document.documentElement.style.setProperty('--vscode-editor-foreground', 'rgb(212, 212, 212)');

        expect(readVSCodeThemeColors(['editor.background', 'editor.foreground'])).toEqual({
            'editor.background': '#1e1e1e',
            'editor.foreground': '#d4d4d4',
        });
    });

    it('omits ids the theme does not publish', () => {
        document.documentElement.style.setProperty('--vscode-editor-background', '#1e1e1e');

        expect(readVSCodeThemeColors(['editor.background', 'tree.tableOddRowsBackground'])).toEqual({
            'editor.background': '#1e1e1e',
        });
    });

    // Passing it through would paint that surface red, via Monaco's `parseHex() || Color.red`.
    it('omits an id whose value it cannot read', () => {
        document.documentElement.style.setProperty('--vscode-editor-background', 'color-mix(in srgb, red, blue)');

        expect(readVSCodeThemeColors(['editor.background'])).toEqual({});
    });
});

describe('themeColorsStore', () => {
    it('reports a new version when the root custom properties are rewritten', async () => {
        const listener = jest.fn();
        const unsubscribe = subscribeToVSCodeThemeColors(listener);
        const before = getVSCodeThemeColorsVersion();

        document.documentElement.style.setProperty('--vscode-editor-background', '#202020');
        await flush();

        expect(listener).toHaveBeenCalled();
        expect(getVSCodeThemeColorsVersion()).toBeGreaterThan(before);

        unsubscribe();
        document.documentElement.removeAttribute('style');
    });

    // The defect this store exists for: Dark Modern to Dracula leaves the kind unchanged while
    // every colour moves, so a derivation keyed on the kind alone goes stale until reload.
    it('reports a new version on a same-kind theme switch', async () => {
        document.body.setAttribute('data-vscode-theme-kind', 'vscode-dark');
        document.body.setAttribute('data-vscode-theme-id', 'Default Dark Modern');

        const listener = jest.fn();
        const unsubscribe = subscribeToVSCodeThemeColors(listener);
        const before = getVSCodeThemeColorsVersion();

        document.body.setAttribute('data-vscode-theme-id', 'Dracula');
        await flush();

        expect(document.body.getAttribute('data-vscode-theme-kind')).toBe('vscode-dark');
        expect(getVSCodeThemeColorsVersion()).toBeGreaterThan(before);

        unsubscribe();
        document.body.removeAttribute('data-vscode-theme-kind');
        document.body.removeAttribute('data-vscode-theme-id');
    });

    it('stops observing once the last listener unsubscribes', async () => {
        const listener = jest.fn();
        subscribeToVSCodeThemeColors(listener)();

        document.documentElement.style.setProperty('--vscode-editor-background', '#303030');
        await flush();

        expect(listener).not.toHaveBeenCalled();
        document.documentElement.removeAttribute('style');
    });

    // Nothing counted the change above, so a consumer caching on the version would serve a stale
    // snapshot to the next subscriber. Re-subscribing has to invalidate it.
    it('reports a new version when observation resumes after a gap', () => {
        const before = getVSCodeThemeColorsVersion();
        const unsubscribe = subscribeToVSCodeThemeColors(jest.fn());

        expect(getVSCodeThemeColorsVersion()).toBeGreaterThan(before);

        unsubscribe();
    });
});
