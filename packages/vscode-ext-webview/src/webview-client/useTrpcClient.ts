/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createTRPCClient, loggerLink, type CreateTRPCClient } from '@trpc/client';
import { type AnyRouter } from '@trpc/server';
import { useContext, useMemo } from 'react';
import { errorLink, type ErrorHandler } from './errorLink';
import { vscodeLink, type VsCodeLinkRequestMessage, type VsCodeLinkResponseMessage } from './vscodeLink';
import { WebviewContext } from './WebviewContext';

/**
 * Convenience alias for a fully-typed tRPC client for a given application router.
 *
 * @example
 * ```ts
 * import type { AppRouter } from './appRouter';
 * import type { TrpcClient } from '@microsoft/vscode-ext-react-webview';
 *
 * type AppTrpcClient = TrpcClient<AppRouter>;
 * ```
 */
export type TrpcClient<TRouter extends AnyRouter> = CreateTRPCClient<TRouter>;

/**
 * Options accepted by {@link useTrpcClient}.
 */
export interface UseTrpcClientOptions {
    /**
     * Optional callback invoked for **every** query and mutation that
     * errors out, in addition to the normal tRPC error flow (call-site
     * `.catch(...)` handlers still fire).
     *
     * Subscription errors are intentionally not forwarded here. Use the
     * per-subscription `.subscribe({ onError })` callback instead so that
     * subscription failures do not surface twice.
     *
     * Typical uses: announce errors through an ARIA live region, show a
     * toast, log to a webview-side telemetry sink.
     *
     * The callback is captured once when the hook builds its tRPC client.
     * Pass a stable reference (e.g. `useCallback`) or accept that changing
     * the callback will recreate the client on the next render.
     */
    onError?: ErrorHandler;
}

/**
 * Custom React hook that creates a tRPC client for communication between the
 * webview and the VS Code extension host.
 *
 * Each component that calls this hook receives its own client instance, stable
 * across re-renders (via `useMemo`). This keeps components self-contained and
 * easy to reason about. For views with many components (>10) consider sharing
 * a single client via React context instead - see the "Advanced" section of
 * the package README.
 *
 * @template TRouter - The application's root tRPC router type.
 * @param options - Optional configuration. Pass `onError` to install a
 *                  webview-side error observer for queries and mutations
 *                  (see {@link UseTrpcClientOptions.onError}).
 * @returns An object containing the tRPC client (`trpcClient`).
 *
 * @example
 * ```tsx
 * import { useTrpcClient } from '@microsoft/vscode-ext-react-webview';
 * import type { AppRouter } from '../_integration/appRouter';
 *
 * export const MyComponent = () => {
 *   const { trpcClient } = useTrpcClient<AppRouter>({
 *     onError: (err) => announcer.announceError(err.message),
 *   });
 *
 *   useEffect(() => {
 *     trpcClient.myProcedure.query().then((result) => {
 *       console.log('Procedure result:', result);
 *     });
 *   }, [trpcClient]);
 *
 *   return <></>;
 * };
 * ```
 */
export function useTrpcClient<TRouter extends AnyRouter>(
    options?: UseTrpcClientOptions,
): { trpcClient: TrpcClient<TRouter> } {
    const { vscodeApi } = useContext(WebviewContext);
    const onError = options?.onError;

    /**
     * Function to send messages to the VSCode extension.
     *
     * @param message - The message to send, following the VsCodeLinkRequestMessage format.
     */
    function send(message: VsCodeLinkRequestMessage) {
        vscodeApi.postMessage(message);
    }

    /**
     * Function to handle incoming messages from the VSCode extension.
     * This function is provided to the tRPC client and is used internally to manage tRPC responses.
     *
     * @param callback - The callback to invoke when a tRPC response message is received.
     * @returns A function to unsubscribe the event listener.
     *
     * Note to code maintainers:
     * The tRPC client expects this `onReceive` function to handle the subscription and unsubscription
     * of the event listener for tRPC responses. It registers the handler when a tRPC request is made,
     * and unregisters it after the response is received.
     * Be cautious when modifying this function, as it could affect the tRPC client's ability to
     * receive responses correctly.
     */
    function onReceive(callback: (message: VsCodeLinkResponseMessage) => void): () => void {
        const handler = (event: MessageEvent) => {
            // a basic type guard here
            if ((event.data as VsCodeLinkResponseMessage).id) {
                const message = event.data as VsCodeLinkResponseMessage;
                callback(message);
            }
        };

        window.addEventListener('message', handler);
        return () => {
            window.removeEventListener('message', handler);
        };
    }

    // Each component that calls `useTrpcClient()` gets its own client instance.
    // `useMemo` keeps the instance stable across re-renders of that component,
    // but different components will hold separate clients. This is intentional:
    // it keeps every component self-contained and easy to understand.
    // For views with many components (>10) sharing a client via React context
    // may be preferable - see the "Advanced" section of the README.
    const trpcClient = useMemo(
        () =>
            createTRPCClient<TRouter>({
                links: [
                    loggerLink(),
                    ...(onError ? [errorLink<TRouter>(onError)] : []),
                    vscodeLink<TRouter>({ send, onReceive }),
                ],
            }),
        [vscodeApi, onError],
    );

    // Return the tRPC client
    return { trpcClient };
}
