/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext } from 'react';
import { type RpcEventChannel } from '../webview/events';
import { getWebviewConnection } from './connection';
import { WebviewContext } from './WebviewContext';

/**
 * React hook returning the webview's RPC event channel.
 *
 * The channel is the observe-only side of the per-webview connection shared
 * with {@link useTrpcClient}: it reports the outcome of every query and
 * mutation made through that client. Subscribe with `onSuccess`, `onError`,
 * or `onAborted` to react to results webview-wide without wrapping individual
 * call sites. The returned reference is stable across re-renders.
 *
 * Subscription procedures are intentionally excluded from the channel; observe
 * their results through the per-subscription `.subscribe({ ... })` callbacks.
 *
 * @returns The webview's {@link RpcEventChannel}.
 *
 * @example
 * ```tsx
 * import { useEffect } from 'react';
 * import { useRpcEvents } from '@microsoft/vscode-ext-webview/react';
 *
 * export const ErrorAnnouncer = () => {
 *   const events = useRpcEvents();
 *
 *   useEffect(() => events.onError((error) => announcer.announceError(error.message)), [events]);
 *
 *   return <></>;
 * };
 * ```
 */
export function useRpcEvents(): RpcEventChannel {
    const { vscodeApi } = useContext(WebviewContext);
    return getWebviewConnection(vscodeApi).events;
}
