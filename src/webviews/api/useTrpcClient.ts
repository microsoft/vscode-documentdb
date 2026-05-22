/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Thin wrapper around the framework's `useTrpcClient` hook from
 * `@microsoft/vscode-webview-api`, pre-typed against this extension's
 * {@link AppRouter}. Webview components import from here so they do not need
 * to repeat the router type argument at every call site.
 */

import { useTrpcClient as useFrameworkTrpcClient } from '@microsoft/vscode-webview-api';
import { type AppRouter } from './appRouter';

export function useTrpcClient() {
    return useFrameworkTrpcClient<AppRouter>();
}
