/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useCallback, useSyncExternalStore } from 'react';
import { getVSCodeThemeColorsVersion, subscribeToVSCodeThemeColors } from '../../vscode/index.js';
import { createVSCodeMonacoTheme, DEFAULT_MONACO_THEME_NAME } from '../core/createVSCodeMonacoTheme.js';
import { type VSCodeMonacoTheme, type VSCodeMonacoThemeData } from '../core/types.js';

export interface UseVSCodeMonacoThemeOptions {
    /** Defaults to `vscode-adaptive`. */
    themeName?: string;
}

/**
 * Every editor in a webview reads the same document, so the derivation is shared rather than
 * repeated per instance. Keyed by theme name so two editors asking for different names cannot
 * evict each other's entry - which would hand `useSyncExternalStore` a snapshot that changes on
 * every call, and it would spin.
 */
const snapshots = new Map<string, { version: number; theme: VSCodeMonacoTheme }>();

/**
 * `useSyncExternalStore` requires a snapshot that is referentially stable until the store changes,
 * so this caches rather than deriving per call.
 */
function getMonacoThemeSnapshot(themeName: string): VSCodeMonacoTheme {
    const version = getVSCodeThemeColorsVersion();
    const cached = snapshots.get(themeName);

    if (cached?.version === version) {
        return cached.theme;
    }

    const derived = createVSCodeMonacoTheme({ themeName });

    // The version bumps on any root-style or body-attribute write, which does not imply a color we
    // read moved. Keeping the previous identity is what stops the consumer's defineTheme/setTheme
    // effect from firing, and Monaco from repainting, for nothing.
    const theme = cached && isSameTheme(cached.theme, derived) ? cached.theme : derived;

    snapshots.set(themeName, { version, theme });

    return theme;
}

/**
 * The user's active VS Code theme as a Monaco theme, re-derived whenever the theme changes.
 *
 * ```tsx
 * const monaco = useMonaco();
 * const monacoTheme = useVSCodeMonacoTheme();
 *
 * useEffect(() => {
 *     if (!monaco) return;
 *     monaco.editor.defineTheme(monacoTheme.themeName, monacoTheme.data);
 *     monaco.editor.setTheme(monacoTheme.themeName);
 * }, [monaco, monacoTheme]);
 * ```
 *
 * The identity of the returned object is stable while the derived theme is unchanged, so that
 * effect does not re-run - and Monaco does not repaint - on an unrelated render or on a DOM
 * mutation that moved no colour.
 *
 * Takes primitives only. `colors` and `rules` are extension points on
 * {@link createVSCodeMonacoTheme}, deliberately not here: passing an object literal to a hook that
 * memoizes on it would silently re-derive several hundred CSS lookups on every render.
 */
export function useVSCodeMonacoTheme(options: UseVSCodeMonacoThemeOptions = {}): VSCodeMonacoTheme {
    const themeName = options.themeName ?? DEFAULT_MONACO_THEME_NAME;
    const getSnapshot = useCallback(() => getMonacoThemeSnapshot(themeName), [themeName]);

    return useSyncExternalStore(subscribeToVSCodeThemeColors, getSnapshot, getSnapshot);
}

function isSameTheme(a: VSCodeMonacoTheme, b: VSCodeMonacoTheme): boolean {
    return a.themeName === b.themeName && isSameThemeData(a.data, b.data);
}

function isSameThemeData(a: VSCodeMonacoThemeData, b: VSCodeMonacoThemeData): boolean {
    if (a.base !== b.base || a.inherit !== b.inherit || a.rules.length !== b.rules.length) {
        return false;
    }

    const colorIds = Object.keys(a.colors);

    return (
        colorIds.length === Object.keys(b.colors).length && colorIds.every((id) => a.colors[id] === b.colors[id])
    );
}
