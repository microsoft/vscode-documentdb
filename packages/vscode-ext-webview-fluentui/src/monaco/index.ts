/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export {
    DEFAULT_MONACO_THEME_NAME,
    createVSCodeMonacoTheme,
    type CreateVSCodeMonacoThemeOptions,
} from './core/createVSCodeMonacoTheme.js';
export {
    type VSCodeMonacoBaseTheme,
    type VSCodeMonacoTheme,
    type VSCodeMonacoThemeData,
    type VSCodeMonacoTokenRule,
} from './core/types.js';
export { useVSCodeMonacoTheme, type UseVSCodeMonacoThemeOptions } from './react/useVSCodeMonacoTheme.js';
