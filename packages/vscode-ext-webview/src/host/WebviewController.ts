/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type AnyRouter } from '@trpc/server';
import { randomBytes } from 'crypto';
import * as path from 'path';
import * as vscode from 'vscode';
import { type BaseRouterContext } from '../shared/BaseRouterContext';
import { type WebviewTrpc } from '../shared/initWebviewTrpc';
import { attachTrpc, type WebviewCallerFactory } from './attachTrpc';
import { consoleProcedureLogger, type ProcedureLogger } from './middleware/logging';

/**
 * Describes where the bundled webview JavaScript lives on disk relative to the
 * extension root, both when the extension is shipped as a webpack bundle
 * (production) and when it is loaded from `tsc` output (development).
 *
 * The framework picks the appropriate entry based on the extension's mode
 * (`vscode.ExtensionMode.Production` selects `bundled`, otherwise `dev`). In
 * development, if the `DEVSERVER` environment variable is set, the controller
 * serves the script from {@link WebviewControllerOptions.devServerHost} instead
 * of the on-disk location.
 */
export interface WebviewSourceLayout {
    /** Layout used in production (bundle on disk). */
    bundled: { dir: string; file: string };

    /** Layout used in development (loaded from `tsc` output). */
    dev: { dir: string; file: string };
}

/**
 * Options bag passed to the {@link WebviewController} constructor and (minus
 * `extensionContext`) to the {@link openWebview} factory.
 *
 * @template TRouter        - The application's root tRPC router type.
 * @template TConfiguration - The configuration object delivered to the webview
 *                            at creation time (received via `useConfiguration`).
 * @template TContext       - The router context shape (must extend
 *                            {@link BaseRouterContext}).
 */
export interface WebviewControllerOptions<
    TRouter extends AnyRouter,
    TConfiguration = unknown,
    TContext extends BaseRouterContext = BaseRouterContext,
> {
    /** The extension context (resource roots, extension mode, on-disk paths). */
    extensionContext: vscode.ExtensionContext;

    /** The title shown in the webview panel tab. */
    title: string;

    /**
     * Identifier for this webview. Used both as the panel `viewType` (prefixed
     * with `react-webview-`) and as the key passed to the webview's `render()`
     * entry so it can look up the matching component from its registry.
     */
    viewType: string;

    /**
     * The root tRPC router for this application. The controller dispatches
     * incoming webview messages against it.
     */
    router: TRouter;

    /**
     * Your tRPC instance from `initWebviewTrpc<TContext>()`.
     *
     * When provided, the dispatcher reads `trpc.createCallerFactory` off it, so
     * the caller factory always belongs to the same instance that built `router`
     * and can never be mismatched — and there is no separate factory to export or
     * pass. This is the recommended way to wire a typed-context router.
     *
     * Only `createCallerFactory` is read, so any `initWebviewTrpc(...)` result is
     * accepted even when its instance context is a base of `TContext` (e.g. when
     * procedures build on a base-context instance and narrow `ctx` per call). If
     * both `trpc` and {@link WebviewControllerOptions.createCallerFactory} are
     * given, `trpc` wins. When omitted, the package's shared default instance is
     * used — correct only for routers built from the package's default
     * `router` / `publicProcedure`.
     */
    trpc?: Pick<WebviewTrpc<TContext>, 'createCallerFactory'>;

    /**
     * tRPC `createCallerFactory` from your own `initWebviewTrpc(...)` result.
     *
     * @deprecated Prefer {@link WebviewControllerOptions.trpc}: pass the whole
     * `initWebviewTrpc<TContext>()` result and the caller factory is read from it,
     * which cannot be mismatched with `router`. This standalone option is still
     * honored (and the low-level {@link attachTrpc} primitive still takes an
     * explicit `callerFactory`) for embedders who bring their own tRPC instance.
     */
    createCallerFactory?: WebviewCallerFactory;

    /** The router context handed to every procedure call. */
    context: TContext;

    /** The initial configuration object the webview reads on startup. */
    config: TConfiguration;

    /**
     * Where the webview JavaScript bundle is located. See {@link WebviewSourceLayout}.
     */
    sourceLayout: WebviewSourceLayout;

    /**
     * Dev-server URL used in development when `process.env.DEVSERVER` is truthy.
     * Typically `'http://localhost:18080'`.
     *
     * Defaults to `'http://localhost:18080'` when omitted.
     */
    devServerHost?: string;

    /**
     * Sink for the zero-config **dispatch logger**: one structured entry per
     * completed query, mutation, and subscription, logged at the transport
     * boundary. Defaults to {@link consoleProcedureLogger} so the panel logs to
     * the extension-host console out of the box; pass your own
     * {@link ProcedureLogger} to route the entries elsewhere (an output channel, a
     * file), or an inert logger to silence it.
     *
     * This is deliberately named `logger`, not `telemetry`: it is console/log
     * plumbing, not analytics. For Application Insights-style reporting, wire
     * {@link telemetryMiddlewareBody} + a `TelemetryRunner` onto your procedures
     * (see the package's Observability docs).
     */
    logger?: ProcedureLogger;

    /** Optional icon shown in the webview tab. */
    icon?:
        | vscode.Uri
        | {
              readonly light: vscode.Uri;
              readonly dark: vscode.Uri;
          };

    /** The view column to open the panel in. Defaults to {@link vscode.ViewColumn.One}. */
    viewColumn?: vscode.ViewColumn;
}

const DEFAULT_DEV_SERVER_HOST = 'http://localhost:18080';

/**
 * WebviewController manages a `vscode.WebviewPanel` and provides tRPC-based
 * communication with the React webview. It handles incoming requests (queries,
 * mutations, and subscriptions) from the webview, routing them to server-side
 * procedures defined in the injected `appRouter`.
 *
 * @template TRouter        - The application's root tRPC router type.
 * @template TConfiguration - The configuration object passed to the webview at
 *                            creation time (received in the webview via
 *                            {@link useConfiguration}).
 * @template TContext       - The router context shape (must extend
 *                            {@link BaseRouterContext}).
 */
export class WebviewController<
    TRouter extends AnyRouter,
    TConfiguration = unknown,
    TContext extends BaseRouterContext = BaseRouterContext,
>
    implements vscode.Disposable
{
    private _panel: vscode.WebviewPanel;
    private _disposables: vscode.Disposable[] = [];
    private _isDisposed: boolean = false;
    /**
     * `true` once VS Code is tearing the panel down on its own (the user closed
     * the tab). Set by the `onDidDispose` handler before it calls `dispose()`, so
     * `dispose()` knows not to close an already-closing panel a second time.
     */
    private _panelDisposed: boolean = false;
    private _onDisposed: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    public readonly onDisposed: vscode.Event<void> = this._onDisposed.event;

    private readonly _options: WebviewControllerOptions<TRouter, TConfiguration, TContext>;

    /**
     * Creates a new WebviewController instance.
     *
     * Opens the panel, renders its HTML, and wires the tRPC dispatch pump (via
     * {@link attachTrpc}) against `options.router` using `options.context`. The
     * dispatch logger defaults to {@link consoleProcedureLogger}.
     *
     * @param options - The controller options. See {@link WebviewControllerOptions}.
     */
    constructor(options: WebviewControllerOptions<TRouter, TConfiguration, TContext>) {
        this._options = options;

        const viewColumn = options.viewColumn ?? vscode.ViewColumn.One;

        this._panel = vscode.window.createWebviewPanel('react-webview-' + options.viewType, options.title, viewColumn, {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [vscode.Uri.file(options.extensionContext.extensionPath)],
        });

        this._panel.webview.html = this.getDocumentTemplate(this._panel.webview);
        this._panel.iconPath = options.icon;

        // Register the onDisposed emitter so dispose() releases its subscriber list.
        // It is intentionally not part of the disposables chain that fires _onDisposed
        // itself — dispose() fires the event first, then disposes the rest (this entry
        // included), so subscribers see the notification before the emitter is torn down.
        this.registerDisposable(this._onDisposed);

        this.registerDisposable(
            this._panel.onDidDispose(() => {
                // VS Code is disposing the panel (the user closed the tab). Record that
                // so dispose() does not try to close an already-closing panel, then run
                // the normal teardown.
                this._panelDisposed = true;
                this.dispose();
            }),
        );

        this.setupTrpc(options.context);
    }

    /**
     * Sets up tRPC integration for the webview. This includes listening for
     * messages from the webview, parsing them as tRPC operations (queries,
     * mutations, subscriptions, or subscription stops), invoking the
     * appropriate server-side procedures, and returning results or errors.
     *
     * @param context - The router context for procedure calls.
     */
    protected setupTrpc(context: TContext): void {
        // The dispatch pump (message handling, abort / subscription lifecycle)
        // lives in the free `attachTrpc` primitive. The controller simply wires
        // it to its panel and registers the returned disposable so the listener
        // and all in-flight operations are torn down on dispose. The dispatch
        // logger defaults to the zero-config console sink.
        // The dispatch pump (message handling, abort / subscription lifecycle)
        // lives in the free `attachTrpc` primitive. The controller simply wires
        // it to its panel and registers the returned disposable so the listener
        // and all in-flight operations are torn down on dispose. The dispatch
        // logger defaults to the zero-config console sink.
        //
        // R766-N02: prefer the caller factory carried by the `trpc` instance (it
        // cannot be mismatched with `router`); fall back to the deprecated
        // standalone `createCallerFactory`, then to `attachTrpc`'s own default.
        const callerFactory: WebviewCallerFactory | undefined =
            this._options.trpc?.createCallerFactory ?? this._options.createCallerFactory;
        const { disposable } = attachTrpc(
            this._panel,
            context,
            this._options.router,
            callerFactory,
            this._options.logger ?? consoleProcedureLogger,
        );
        this.registerDisposable(disposable);
    }

    /**
     * Generates the full HTML document for the webview, including CSP headers,
     * serialized initial configuration, and the script that boots the React app.
     */
    private getDocumentTemplate(webview?: vscode.Webview): string {
        const devServer = !!process.env.DEVSERVER;
        const isProduction = this._options.extensionContext.extensionMode === vscode.ExtensionMode.Production;
        const nonce = randomBytes(16).toString('base64');

        const layout = isProduction ? this._options.sourceLayout.bundled : this._options.sourceLayout.dev;
        const devServerHost = this._options.devServerHost ?? DEFAULT_DEV_SERVER_HOST;

        const uri = (...parts: string[]) =>
            webview
                ?.asWebviewUri(
                    vscode.Uri.file(path.join(this._options.extensionContext.extensionPath, layout.dir, ...parts)),
                )
                .toString(true);

        const srcUri = isProduction || !devServer ? uri(layout.file) : `${devServerHost}/${layout.file}`;

        const csp = (
            isProduction
                ? [
                      `form-action 'none';`,
                      `default-src ${webview?.cspSource};`,
                      `script-src ${webview?.cspSource} 'nonce-${nonce}';`,
                      `style-src ${webview?.cspSource} vscode-resource: 'unsafe-inline';`,
                      `img-src ${webview?.cspSource} data: vscode-resource:;`,
                      `connect-src ${webview?.cspSource} ws:;`,
                      `font-src ${webview?.cspSource};`,
                      `worker-src ${webview?.cspSource} blob:;`,
                  ]
                : [
                      `form-action 'none';`,
                      `default-src ${webview?.cspSource} ${devServerHost};`,
                      `script-src ${webview?.cspSource} ${devServerHost} 'nonce-${nonce}';`,
                      `style-src ${webview?.cspSource} ${devServerHost} vscode-resource: 'unsafe-inline';`,
                      `img-src ${webview?.cspSource} ${devServerHost} data: vscode-resource:;`,
                      `connect-src ${webview?.cspSource} ${devServerHost} ws:;`,
                      `font-src ${webview?.cspSource} ${devServerHost};`,
                      `worker-src ${webview?.cspSource} ${devServerHost} blob:;`,
                  ]
        ).join(' ');

        /**
         * Note to code maintainers:
         * encodeURIComponent(JSON.stringify(this.configuration)) below is crucial
         * We want to avoid the webview from crashing when the configuration object contains 'unsupported' bytes
         */

        return `<!DOCTYPE html>
                <html lang="en">
                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <meta // noinspection JSAnnotator
                        http-equiv="Content-Security-Policy" content="${csp}" />
                </head>
                    <body>
                        <div id="root"></div>
                            <script nonce="${nonce}">
                                globalThis.l10n_bundle = ${JSON.stringify(vscode.l10n.bundle ?? {})};
                            </script>
                            <script type="module" nonce="${nonce}">
                                window.config = {
                                    ...window.config,
                                    __initialData: '${encodeURIComponent(JSON.stringify(this._options.config))}'
                                };

                                import { render } from "${srcUri}";
                                render('${this._options.viewType}', acquireVsCodeApi());
                            </script>

                    </body>
                </html>`;
    }

    protected registerDisposable(disposable: vscode.Disposable): void {
        this._disposables.push(disposable);
    }

    /**
     * Gets whether the controller has been disposed.
     */
    public get isDisposed(): boolean {
        return this._isDisposed;
    }

    /**
     * Gets the vscode.WebviewPanel that the controller is managing.
     */
    public get panel(): vscode.WebviewPanel {
        return this._panel;
    }

    /**
     * Reveals the webview in the given column, bringing it to the foreground.
     * Useful if the webview is already open but hidden.
     *
     * @param viewColumn The column to reveal in. Defaults to ViewColumn.One.
     */
    public revealToForeground(viewColumn: vscode.ViewColumn = vscode.ViewColumn.One): void {
        this._panel.reveal(viewColumn, true);
    }

    /**
     * Disposes the controller: notifies `onDisposed` subscribers, tears down the
     * tRPC dispatch pump (aborting in-flight operations and subscriptions), and
     * closes the webview panel/tab.
     *
     * **Two entry points, one outcome.** Either the consumer calls `dispose()`
     * directly (to close the view), or the user closes the tab and VS Code fires
     * `onDidDispose`, whose handler calls `dispose()`. Both paths must end with the
     * panel closed and every resource released, so this method does both. A public
     * handle whose `dispose()` left the tab open would be a surprising API.
     *
     * **No recursion.** `_isDisposed` is set before anything else, so the
     * re-entrant `dispose → panel.dispose → onDidDispose → dispose` call returns at
     * the guard. On the `onDidDispose` path `_panelDisposed` is already `true`, so
     * the redundant `this._panel.dispose()` is skipped.
     */
    public dispose(): void {
        if (this._isDisposed) {
            return;
        }
        this._isDisposed = true;

        // Notify subscribers before tearing anything down, so they observe the
        // disposal while the object graph is still intact.
        this._onDisposed.fire();

        // Dispose registered resources: the tRPC dispatch disposable returned by
        // `attachTrpc` (removes the message listener and aborts every in-flight
        // operation and subscription, calling `return()` on each iterator so async
        // generators parked on `next()` terminate cleanly), the `onDidDispose`
        // listener, and the `onDisposed` emitter.
        this._disposables.forEach((d) => {
            d.dispose();
        });

        // Close the panel/tab unless VS Code is already doing so (the `onDidDispose`
        // path set `_panelDisposed`). Disposing the listeners above already removed
        // our `onDidDispose` subscription, so this call cannot re-enter `dispose()`.
        if (!this._panelDisposed) {
            this._panel.dispose();
        }
    }
}
