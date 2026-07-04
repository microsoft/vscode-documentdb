/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as React from 'react';
import { createContext } from 'react';
import { type WebviewApi } from 'vscode-webview';
import { type ObserverErrorHandler } from '../webview/events';

export type WebviewState = object;

export type WebviewContextValue = {
    vscodeApi: WebviewApi<WebviewState>;
    /**
     * When `true`, the shared tRPC client logs every call to the webview devtools
     * console (tRPC's `loggerLink`). Off by default; set it on
     * {@link WithWebviewContext} to enable it for the whole webview.
     */
    enableRpcLogging?: boolean;
    /**
     * Called when an RPC event-channel observer throws. The channel always
     * isolates the throw (a broken observer cannot break the call it observes);
     * this only routes the isolated error. Defaults to `console.error`. Set it on
     * {@link WithWebviewContext} to route observer failures to telemetry.
     */
    onObserverError?: ObserverErrorHandler;
};

export const WebviewContext = createContext<WebviewContextValue>({} as WebviewContextValue);

export const WithWebviewContext = ({
    vscodeApi,
    enableRpcLogging,
    onObserverError,
    children,
}: {
    vscodeApi: WebviewApi<WebviewState>;
    enableRpcLogging?: boolean;
    onObserverError?: ObserverErrorHandler;
    children: React.ReactNode;
}) => {
    return (
        <WebviewContext.Provider value={{ vscodeApi, enableRpcLogging, onObserverError }}>
            {children}
        </WebviewContext.Provider>
    );
};
