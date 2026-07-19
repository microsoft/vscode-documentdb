/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type WebviewState, WithWebviewContext } from '@microsoft/vscode-ext-webview/react';
import * as l10n from '@vscode/l10n';
import { type l10nJsonFormat } from '@vscode/l10n';
import type * as React from 'react';
import { createRoot } from 'react-dom/client'; // eslint-disable-line import/no-internal-modules
import { type WebviewApi } from 'vscode-webview';
import { reportObserverError } from './_integration/observability/reportObserverError';
import { type WebviewName, WebviewRegistry } from './_integration/WebviewRegistry';
import { DynamicThemeProvider } from './theme/DynamicThemeProvider';

export type ViewKey = WebviewName;

/**
 * Swallow the benign "ResizeObserver loop …" browser warning.
 *
 * Fluent UI drives popup positioning (Combobox / Dropdown / Menu / Tooltip) from
 * inside a `ResizeObserver` callback. When opening a popup — e.g. giving a
 * Combobox focus — nudges layout enough to schedule another resize in the same
 * frame, the browser emits a non-fatal `ErrorEvent` whose message is
 * "ResizeObserver loop completed with undelivered notifications" (or, on some
 * engines, "ResizeObserver loop limit exceeded"). The observer simply continues
 * on the next frame, but the event otherwise bubbles to the global error stream
 * (devtools "Uncaught", any `window` error listener, the framework's error → host
 * telemetry bridge, and hence any error notification surface).
 *
 * We stop **only** this one message from propagating; every other error is left
 * completely untouched. The listener is registered in the capture phase before
 * React mounts so it runs ahead of the framework's own handler.
 */
let resizeObserverLoopGuardInstalled = false;
function installResizeObserverLoopGuard(): void {
    if (resizeObserverLoopGuardInstalled || typeof window === 'undefined') {
        return;
    }
    resizeObserverLoopGuardInstalled = true;
    const isResizeObserverLoop = /^ResizeObserver loop/;
    window.addEventListener(
        'error',
        (event: ErrorEvent) => {
            if (typeof event.message === 'string' && isResizeObserverLoop.test(event.message)) {
                event.stopImmediatePropagation();
                event.preventDefault();
            }
        },
        true, // capture phase, so we pre-empt the framework's error → host bridge
    );
}

export function render<V extends ViewKey>(key: V, vscodeApi: WebviewApi<WebviewState>, rootId = 'root'): void {
    installResizeObserverLoopGuard();
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
            <WithWebviewContext vscodeApi={vscodeApi} onObserverError={reportObserverError}>
                <Component />
            </WithWebviewContext>
        </DynamicThemeProvider>,
    );
}
