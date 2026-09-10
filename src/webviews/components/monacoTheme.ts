/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// eslint-disable-next-line import/no-internal-modules
import type * as monacoEditor from 'monaco-editor/esm/vs/editor/editor.api';
import { vscodeThemeTokens, vscodeThemeTokenToCSSVar } from './vscodeThemeTokens';

export type MonacoBuiltinTheme = monacoEditor.editor.BuiltinTheme;
export type MonacoThemeData = monacoEditor.editor.IStandaloneThemeData;
export type MonacoColors = monacoEditor.editor.IColors;
export type MonacoTheme = {
    theme?: MonacoThemeData;
    themeName: string;
};

/**
 * Monaco theming stays in the extension rather than moving to
 * `@microsoft/vscode-ext-webview-fluentui` with the rest of the theming layer: Monaco is not
 * Fluent, and its type import alone would drag a ~5 MB peer into a theming package. The package
 * publishes the active theme kind; deriving Monaco from it is ours to do.
 *
 * Kept beside MonacoEditor.tsx, its only consumer.
 */

/** Local copy of the package's internal palette helper — the package's colour math is not public. */
function rgbaToHex(rgba: string): string {
    return (
        '#' +
        rgba
            .replace(/^rgba?\(|\s+|\)$/g, '')
            .split(',')
            .map((component) => parseFloat(component))
            .map((value, index) => (index === 3 ? Math.round(value * 255) : value))
            .map((value) => value.toString(16))
            .map((hex) => (hex.length === 1 ? '0' + hex : hex))
            .join('')
    );
}

/**
 * Reads every VS Code theme color off the document and hands them to Monaco, so the editor is
 * painted by the user's workbench theme rather than by Monaco's built-in approximation of it.
 *
 * Note for whoever picks this up next: this performs ~815 `getPropertyValue` lookups. Acceptable
 * once per theme change, which is what the cache below guarantees, but worth a second look before
 * it grows any further.
 */
export const generateMonacoTheme = (baseTheme: MonacoBuiltinTheme): MonacoThemeData => {
    const style = getComputedStyle(document.documentElement);
    const colors = vscodeThemeTokens
        .map((token) => {
            let color = style.getPropertyValue(vscodeThemeTokenToCSSVar(token));
            if (!color.startsWith('#')) {
                if (color.startsWith('rgb')) {
                    color = rgbaToHex(color);
                }
            }
            return [token, color];
        })
        .filter(([_, color]) => color !== '');

    return {
        base: baseTheme,
        inherit: true,
        rules: [],
        colors: Object.fromEntries(colors) as MonacoColors,
    };
};

/**
 * Every editor in a webview reads the same document, so the derivation is shared rather than
 * repeated per instance — which is what the theme context used to do for us before it was
 * dissolved. Without this, mounting the enhanced query row costs ~815 lookups per editor.
 */
let cached: { themeKind: string; theme: MonacoTheme } | undefined;

/** Derives the Monaco theme for a VS Code theme kind, as reported by `useActiveVSCodeThemeKind()`. */
export const getMonacoTheme = (themeKind: string): MonacoTheme => {
    if (cached?.themeKind === themeKind) {
        return cached.theme;
    }

    const monacoBaseTheme: MonacoBuiltinTheme =
        themeKind === 'vscode-dark'
            ? 'vs-dark'
            : themeKind === 'vscode-high-contrast'
              ? 'hc-black'
              : themeKind === 'vscode-high-contrast-light'
                ? 'hc-light'
                : 'vs';

    const theme: MonacoTheme = {
        themeName: 'adaptive',
        theme: generateMonacoTheme(monacoBaseTheme),
    };

    cached = { themeKind, theme };

    return theme;
};
