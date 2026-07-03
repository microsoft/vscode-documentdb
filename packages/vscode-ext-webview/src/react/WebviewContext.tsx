/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as React from 'react';
import { createContext } from 'react';
import { type WebviewApi } from 'vscode-webview';

export type WebviewState = object;

export type WebviewContextValue = {
    vscodeApi: WebviewApi<WebviewState>;
    /**
     * When `true`, the shared tRPC client logs every call to the webview devtools
     * console (tRPC's `loggerLink`). Off by default; set it on
     * {@link WithWebviewContext} to enable it for the whole webview.
     */
    enableRpcLogging?: boolean;
};

export const WebviewContext = createContext<WebviewContextValue>({} as WebviewContextValue);

export const WithWebviewContext = ({
    vscodeApi,
    enableRpcLogging,
    children,
}: {
    vscodeApi: WebviewApi<WebviewState>;
    enableRpcLogging?: boolean;
    children: React.ReactNode;
}) => {
    return <WebviewContext.Provider value={{ vscodeApi, enableRpcLogging }}>{children}</WebviewContext.Provider>;
};
