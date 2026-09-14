/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The kind VS Code reports when the attribute is missing, which is every environment that is not
 * a webview: jsdom, Storybook, a browser preview.
 */
export const DEFAULT_VSCODE_THEME_KIND = 'vscode-light';

/**
 * The theme kind VS Code publishes on the webview's body element.
 *
 * Shared by every derivation in the package so "which theme is active" has one answer. VS Code
 * rewrites this attribute on each theme change; {@link subscribeToVSCodeThemeColors} is what turns
 * that into a notification.
 */
export const readVSCodeThemeKind = (): string =>
    document.body.getAttribute('data-vscode-theme-kind') ?? DEFAULT_VSCODE_THEME_KIND;
