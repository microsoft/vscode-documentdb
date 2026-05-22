/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type WebviewState, WithWebviewContext } from '@microsoft/vscode-ext-react-webview';
import * as l10n from '@vscode/l10n';
import { type l10nJsonFormat } from '@vscode/l10n';
import type * as React from 'react';
import { createRoot } from 'react-dom/client'; // eslint-disable-line import/no-internal-modules
import { type WebviewApi } from 'vscode-webview';
import { DynamicThemeProvider } from './theme/DynamicThemeProvider';
import { type WebviewName, WebviewRegistry } from './webviewIntegration/WebviewRegistry';

export type ViewKey = WebviewName;

export function render<V extends ViewKey>(key: V, vscodeApi: WebviewApi<WebviewState>, rootId = 'root'): void {
    l10n.config({
        contents: (globalThis.l10n_bundle as l10nJsonFormat) ?? {},
    });
    const container = document.getElementById(rootId);
    if (!container) {
        throw new Error(l10n.t('Element with id of {rootId} not found.', { rootId }));
    }

    const Component: React.ComponentType = WebviewRegistry[key];

    const root = createRoot(container);

    root.render(
        <DynamicThemeProvider useAdaptive={true}>
            <WithWebviewContext vscodeApi={vscodeApi}>
                <Component />
            </WithWebviewContext>
        </DynamicThemeProvider>,
    );
}
