/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The CSS custom property VS Code publishes a theme color under.
 *
 * VS Code writes every resolved workbench color onto the webview's root element as
 * `--vscode-<id with dots replaced by dashes>`. Color ids that a theme leaves unset, and whose
 * registry default is null, are not written at all.
 *
 * @param colorId - a VS Code theme color id, e.g. `editorWidget.background`.
 */
export const vscodeColorIdToCSSVariable = (colorId: string): string => `--vscode-${colorId.replace(/\./g, '-')}`;
