/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export { vscodeColorIdToCSSVariable } from './cssVariable.js';
export { readVSCodeThemeColors, type VSCodeThemeColors } from './readVSCodeThemeColors.js';
export { getVSCodeThemeColorsVersion, subscribeToVSCodeThemeColors } from './themeColorsStore.js';
export { DEFAULT_VSCODE_THEME_KIND, readVSCodeThemeKind } from './themeKind.js';
export { toHexColor } from './toHexColor.js';
