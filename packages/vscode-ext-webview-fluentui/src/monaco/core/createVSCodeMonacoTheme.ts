/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { readVSCodeThemeColors, readVSCodeThemeKind } from '../../vscode/index.js';
import { MONACO_COLOR_IDS } from './colorIds.js';
import { MONACO_COLOR_FALLBACKS, MONACO_FALLBACK_SOURCES } from './fallbackChains.js';
import { type VSCodeMonacoBaseTheme, type VSCodeMonacoTheme, type VSCodeMonacoTokenRule } from './types.js';

/** The name the derived theme is registered under when the caller does not pick one. */
export const DEFAULT_MONACO_THEME_NAME = 'vscode-adaptive';

const BASE_THEMES: Readonly<Record<string, VSCodeMonacoBaseTheme>> = {
    'vscode-light': 'vs',
    'vscode-dark': 'vs-dark',
    'vscode-high-contrast': 'hc-black',
    'vscode-high-contrast-light': 'hc-light',
};

export interface CreateVSCodeMonacoThemeOptions {
    /** Defaults to {@link DEFAULT_MONACO_THEME_NAME}. */
    themeName?: string;
    /** Defaults to the kind VS Code publishes on the body element. */
    themeKind?: string;
    /** Merged over the derived colours. */
    colors?: Readonly<Record<string, string>>;
    /**
     * Token colourization rules, appended after the derived ones.
     *
     * Empty by default, which means Monaco colourizes syntax from its built-in `vs`/`vs-dark`
     * palette rather than from the user's theme. VS Code publishes no TextMate colours as CSS
     * variables, so closing that gap means approximating, and approximating is a decision for the
     * consumer to make rather than one to inherit.
     */
    rules?: readonly VSCodeMonacoTokenRule[];
}

/**
 * Builds a Monaco theme from the user's active VS Code theme.
 *
 * Hand the result to `monaco.editor.defineTheme(theme.themeName, theme.data)` and then
 * `monaco.editor.setTheme(theme.themeName)`. The return value is structurally assignable to
 * `IStandaloneThemeData`, so no cast is needed and no `monaco-editor` dependency is taken on here.
 *
 * Reads the document, so it must run in a webview. Each call resolves {@link MONACO_COLOR_IDS};
 * call it once per theme change rather than once per editor - {@link useVSCodeMonacoTheme} is that,
 * done for you.
 */
export function createVSCodeMonacoTheme(options: CreateVSCodeMonacoThemeOptions = {}): VSCodeMonacoTheme {
    const themeKind = options.themeKind ?? readVSCodeThemeKind();
    const published = readVSCodeThemeColors([...MONACO_COLOR_IDS, ...MONACO_FALLBACK_SOURCES]);

    const colors: Record<string, string> = {};

    for (const colorId of MONACO_COLOR_IDS) {
        const color = published[colorId] ?? resolveFallback(colorId, published);

        if (color !== undefined) {
            colors[colorId] = color;
        }
    }

    return {
        themeName: options.themeName ?? DEFAULT_MONACO_THEME_NAME,
        data: {
            base: BASE_THEMES[themeKind] ?? 'vs',
            inherit: true,
            rules: [...(options.rules ?? [])],
            colors: { ...colors, ...options.colors },
        },
    };
}

function resolveFallback(colorId: string, published: Readonly<Record<string, string>>): string | undefined {
    for (const source of MONACO_COLOR_FALLBACKS[colorId] ?? []) {
        const color = published[source];

        if (color !== undefined) {
            return color;
        }
    }

    return undefined;
}
