/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Entry point `.` — theming.
 *
 * Importing anything from here injects the Fluent adaptations. That is the point: there is no
 * stylesheet import for a consumer to forget, and no opt-out. See decisions 0010 and 0011.
 */

import { injectStyles } from './styles/injectStyles';

injectStyles();

export {
    createVSCodeFluentTheme,
    generateAdaptiveDarkTheme,
    generateAdaptiveLightTheme,
    useActiveVSCodeTheme,
    useActiveVSCodeThemeKind,
    VSCodeFluentProvider,
    type VSCodeThemeState,
} from './theme';
