/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { fluentOverridesCss } from './generated';

export const STYLE_ELEMENT_ID = 'vscode-ext-webview-fluentui-overrides';

/**
 * Puts the Fluent adaptations on the page.
 *
 * Called at module scope from the package entry rather than from `VSCodeFluentProvider`, so
 * there is no import for a consumer to forget and no tier that silently misses the sheet —
 * including consumers who take only the hooks and wire their own `FluentProvider`.
 *
 * Safe to call repeatedly, and a no-op without a DOM so node-environment tests can import the
 * entry.
 */
export function injectStyles(): void {
    if (typeof document === 'undefined') {
        return;
    }

    if (document.getElementById(STYLE_ELEMENT_ID)) {
        return;
    }

    const element = document.createElement('style');
    element.id = STYLE_ELEMENT_ID;
    element.textContent = fluentOverridesCss;
    document.head.appendChild(element);
}
