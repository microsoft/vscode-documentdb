/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Entry point `./monaco`: the active VS Code theme, shaped for `monaco.editor.defineTheme()`.
 *
 * Deliberately imports neither `theme/`, `components/` nor `styles/`, and takes no dependency on
 * `monaco-editor` - the theme data is structurally typed. Importing this entry injects nothing.
 * See decision 0032.
 */

export * from './monaco/index.js';
