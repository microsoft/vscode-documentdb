/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type Theme } from '@fluentui/react-components';
import { useEffect, useMemo, useState } from 'react';
import { createVSCodeFluentTheme } from '../core/createVSCodeFluentTheme.js';

const DEFAULT_THEME_KIND = 'vscode-light';

/** The active VS Code theme, and the Fluent theme derived from it. */
export interface VSCodeThemeState {
    /** The raw `data-vscode-theme-kind` value, e.g. `vscode-dark`. */
    readonly themeKind: string;
    /** `undefined` for an unrecognised kind — `FluentProvider` treats that as "use the default". */
    readonly theme: Theme | undefined;
}

/** Reads the theme kind VS Code publishes on the body element. */
const readVSCodeThemeKind = (): string => document.body.getAttribute('data-vscode-theme-kind') ?? DEFAULT_THEME_KIND;

/**
 * The theme kind of the user's active VS Code color theme, kept current as they switch themes.
 *
 * VS Code re-writes `data-vscode-theme-kind` on the webview's body element on every theme change;
 * there is no message to subscribe to, so this observes the attribute directly. Standalone by
 * design — a consumer using their own `FluentProvider` needs this without mounting ours.
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
                                DEFAULT_THEME_KIND,
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
 * This is the facade's own implementation: `VSCodeFluentProvider` is this hook plus a
 * `FluentProvider`, and nothing else.
 */
export function useActiveVSCodeTheme(): VSCodeThemeState {
    const themeKind = useActiveVSCodeThemeKind();
    const theme = useMemo(() => createVSCodeFluentTheme(themeKind), [themeKind]);

    return useMemo(() => ({ themeKind, theme }), [themeKind, theme]);
}
