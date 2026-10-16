/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { teamsHighContrastTheme, teamsLightTheme, type Theme } from '@fluentui/react-components';
import { generateAdaptiveDarkTheme, generateAdaptiveLightTheme } from './themeGenerator.js';

/**
 * Builds the Fluent theme for a VS Code theme kind, as read from the `data-vscode-theme-kind`
 * attribute VS Code puts on `document.body`.
 *
 * This is a snapshot factory: light and dark themes read the current VS Code button background to
 * generate a fixed brand ramp. React consumers that need live theme updates should use
 * `useActiveVSCodeTheme`; use this lower-level function when the caller owns color-change
 * invalidation.
 *
 * Returns `undefined` for an unrecognised kind, which `FluentProvider` accepts and treats as
 * "use the default theme".
 *
 * @param themeKind - a VS Code theme kind, e.g. `vscode-dark`.
 */
export const createVSCodeFluentTheme = (themeKind: string): Theme | undefined => {
    switch (themeKind) {
        case 'vscode-light':
            return generateAdaptiveLightTheme();
        case 'vscode-dark':
            return generateAdaptiveDarkTheme();
        case 'vscode-high-contrast':
            return teamsHighContrastTheme;
        case 'vscode-high-contrast-light':
            // TODO: find a better theme for this
            return teamsLightTheme;
        default:
            return undefined;
    }
};
