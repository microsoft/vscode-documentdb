/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type Theme } from '@fluentui/react-components';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import {
    DEFAULT_VSCODE_THEME_KIND,
    getVSCodeThemeColorsVersion,
    readVSCodeThemeKind,
    subscribeToVSCodeThemeColors,
} from '../../vscode/index.js';
import { createVSCodeFluentTheme } from '../core/createVSCodeFluentTheme.js';

/** The active VS Code theme, and the Fluent theme derived from it. */
export interface VSCodeThemeState {
    /** The raw `data-vscode-theme-kind` value, e.g. `vscode-dark`. */
    readonly themeKind: string;
    /** `undefined` for an unrecognised kind, which `FluentProvider` treats as "use the default". */
    readonly theme: Theme | undefined;
}

/**
 * The theme kind of the user's active VS Code color theme, kept current as they switch themes.
 *
 * VS Code re-writes `data-vscode-theme-kind` on the webview's body element on every theme change;
 * there is no message to subscribe to, so this observes the attribute directly. Standalone by
 * design, because a consumer using their own `FluentProvider` needs this without mounting ours.
 */
export function useActiveVSCodeThemeKind(): string {
    const [themeKind, setThemeKind] = useState(readVSCodeThemeKind);

    const observer = useMemo(
        () =>
            new MutationObserver((mutations) => {
                mutations.forEach((mutation) => {
                    if (mutation.type === 'attributes' && mutation.attributeName === 'data-vscode-theme-kind') {
                        setThemeKind(
                            (mutation.target as HTMLElement).getAttribute('data-vscode-theme-kind') ??
                                DEFAULT_VSCODE_THEME_KIND,
                        );
                    }
                });
            }),
        [],
    );

    useEffect(() => {
        observer.observe(document.body, { attributes: true });

        // The attribute can have changed between the initial render and this effect.
        // eslint-disable-next-line react-hooks/set-state-in-effect -- Synchronizing React state with an external DOM attribute; no way to derive this without effect+setState
        setThemeKind(readVSCodeThemeKind());

        return () => observer.disconnect();
    }, [observer]);

    return themeKind;
}

/**
 * The user's active VS Code theme, as a Fluent theme plus the kind it was derived from.
 *
 * Theme-kind changes and same-kind color changes both invalidate the generated theme. The latter
 * matters because the neutral mappings use live CSS variables, but the generated brand ramp is a
 * fixed color snapshot. `VSCodeFluentProvider` is this hook plus a `FluentProvider`.
 */
export function useActiveVSCodeTheme(): VSCodeThemeState {
    const themeKind = useActiveVSCodeThemeKind();
    const themeColorsVersion = useSyncExternalStore(
        subscribeToVSCodeThemeColors,
        getVSCodeThemeColorsVersion,
        getVSCodeThemeColorsVersion,
    );
    const theme = useMemo(() => createVSCodeFluentTheme(themeKind), [themeKind, themeColorsVersion]);

    return useMemo(() => ({ themeKind, theme }), [themeKind, theme]);
}
