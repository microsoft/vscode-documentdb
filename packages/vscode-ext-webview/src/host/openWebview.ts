/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type AnyRouter } from '@trpc/server';
import type * as vscode from 'vscode';
import { type BaseRouterContext } from '../shared/BaseRouterContext';
import { WebviewController, type WebviewControllerOptions } from './WebviewController';

/**
 * The greenfield front door: opens a webview panel and returns its
 * {@link WebviewController} handle.
 *
 * This is sugar over `new WebviewController({ extensionContext, ...options })`.
 * The returned controller owns the panel, renders the HTML, and wires the tRPC
 * dispatch pump (with the default console logger unless `options.telemetry` is
 * supplied). Use it directly for the common case; subclass
 * {@link WebviewController} when you need lifecycle hooks or extra methods.
 *
 * @template TRouter        - The application's root tRPC router type.
 * @template TConfiguration - The configuration object delivered to the webview.
 * @template TContext       - The router context shape (must extend {@link BaseRouterContext}).
 *
 * @param extensionContext - The extension context.
 * @param options          - Everything else (see {@link WebviewControllerOptions}).
 * @returns The {@link WebviewController} handle, exposing `panel`, `onDisposed`,
 *          `revealToForeground`, `dispose`, and `isDisposed`.
 *
 * @example
 * ```ts
 * const controller = openWebview(context, {
 *   title: 'My View',
 *   viewType: 'myView',
 *   router: appRouter,
 *   createCallerFactory,
 *   context: { ...myContext },
 *   config: { ...initialConfig },
 *   sourceLayout: { bundled: { dir: 'dist', file: 'views.js' }, dev: { dir: 'out', file: 'views.js' } },
 * });
 * ```
 */
export function openWebview<
    TRouter extends AnyRouter,
    TConfiguration = unknown,
    TContext extends BaseRouterContext = BaseRouterContext,
>(
    extensionContext: vscode.ExtensionContext,
    options: Omit<WebviewControllerOptions<TRouter, TConfiguration, TContext>, 'extensionContext'>,
): WebviewController<TRouter, TConfiguration, TContext> {
    return new WebviewController<TRouter, TConfiguration, TContext>({ extensionContext, ...options });
}
