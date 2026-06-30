/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type CreateTRPCClient } from '@trpc/client';
import { type AnyRouter } from '@trpc/server';
import { useContext } from 'react';
import { getWebviewConnection } from './connection';
import { WebviewContext } from './WebviewContext';

/**
 * Convenience alias for a fully-typed tRPC client for a given application router.
 *
 * @example
 * ```ts
 * import type { AppRouter } from './appRouter';
 * import type { TrpcClient } from '@microsoft/vscode-ext-webview/react';
 *
 * type AppTrpcClient = TrpcClient<AppRouter>;
 * ```
 */
export type TrpcClient<TRouter extends AnyRouter> = CreateTRPCClient<TRouter>;

/**
 * React hook returning the tRPC client for talking to the extension host.
 *
 * The client is a per-webview singleton: every component that calls this hook
 * (and {@link useRpcEvents}) shares the same underlying connection, so events
 * observed on the channel correspond to calls made through this client. The
 * returned reference is stable across re-renders.
 *
 * For webview-wide observation of query/mutation outcomes (errors, aborts,
 * successes), subscribe through {@link useRpcEvents} rather than wrapping every
 * call site.
 *
 * @template TRouter - The application's root tRPC router type.
 * @returns The tRPC client.
 *
 * @example
 * ```tsx
 * import { useTrpcClient } from '@microsoft/vscode-ext-webview/react';
 * import type { AppRouter } from '../_integration/appRouter';
 *
 * export const MyComponent = () => {
 *   const trpcClient = useTrpcClient<AppRouter>();
 *
 *   useEffect(() => {
 *     void trpcClient.myProcedure.query().then((result) => {
 *       console.log('Procedure result:', result);
 *     });
 *   }, [trpcClient]);
 *
 *   return <></>;
 * };
 * ```
 */
export function useTrpcClient<TRouter extends AnyRouter>(): TrpcClient<TRouter> {
    const { vscodeApi } = useContext(WebviewContext);
    return getWebviewConnection<TRouter>(vscodeApi).client;
}
