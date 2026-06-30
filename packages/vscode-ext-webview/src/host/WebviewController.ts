/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type AnyRouter } from '@trpc/server';
import { randomBytes } from 'crypto';
import * as path from 'path';
import * as vscode from 'vscode';
import { type BaseRouterContext } from '../shared/BaseRouterContext';
import { attachTrpc } from './attachTrpc';

/**
 * Describes where the bundled webview JavaScript lives on disk relative to the
 * extension root, both when the extension is shipped as a webpack bundle
 * (production) and when it is loaded from `tsc` output (development).
 *
 * The framework picks the appropriate entry based on
 * {@link WebviewControllerOptions.isBundled}. In development, if the
 * `DEVSERVER` environment variable is set, the controller serves the script
 * from {@link WebviewControllerOptions.devServerHost} instead of the on-disk
 * location.
 */
export interface WebviewSourceLayout {
    /** Layout used when `isBundled` is true (production bundle on disk). */
    bundled: { dir: string; file: string };

    /** Layout used when `isBundled` is false (loaded from `tsc` output). */
    dev: { dir: string; file: string };
}

/**
 * Configuration injected into every {@link WebviewController}.
 */
export interface WebviewControllerOptions<TRouter extends AnyRouter> {
    /**
     * The root tRPC router for this application. The controller dispatches
     * incoming webview messages against this router.
     */
    appRouter: TRouter;

    /**
     * True when the extension is running from its webpack bundle (production),
     * false when running from the TypeScript dev output. Determines which
     * entry from {@link sourceLayout} is used.
     */
    isBundled: boolean;

    /**
     * Where the webview JavaScript bundle is located. See {@link WebviewSourceLayout}.
     */
    sourceLayout: WebviewSourceLayout;

    /**
     * Dev-server URL used when `isBundled` is false and `process.env.DEVSERVER`
     * is truthy. Typically `'http://localhost:18080'`.
     *
     * Defaults to `'http://localhost:18080'` when omitted.
     */
    devServerHost?: string;
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
    private _onDisposed: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    public readonly onDisposed: vscode.Event<void> = this._onDisposed.event;

    private readonly _options: WebviewControllerOptions<TRouter>;

    /**
     * Creates a new WebviewController instance.
     *
     * @param extensionContext The extension context.
     * @param title            The title of the webview panel.
     * @param webviewName      The identifier/name for the webview resource.
     *                         Used both as the `viewType` (prefixed with
     *                         `react-webview-`) and as the key passed to the
     *                         webview's `render()` entry point so it can look
     *                         up the matching component from its registry.
     * @param configuration    The initial state object that the webview will
     *                         use on startup.
     * @param options          Framework configuration (router, source layout,
     *                         bundling mode).
     * @param viewColumn       The view column in which to show the new webview
     *                         panel.
     * @param _iconPath        An optional icon to display in the tab of the
     *                         webview.
     */
    constructor(
        protected extensionContext: vscode.ExtensionContext,
        title: string,
        private _webviewName: string,
        private configuration: TConfiguration,
        options: WebviewControllerOptions<TRouter>,
        viewColumn: vscode.ViewColumn = vscode.ViewColumn.One,
        private _iconPath?:
            | vscode.Uri
            | {
                  readonly light: vscode.Uri;
                  readonly dark: vscode.Uri;
              },
    ) {
        this._options = options;

        this._panel = vscode.window.createWebviewPanel('react-webview-' + _webviewName, title, viewColumn, {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [vscode.Uri.file(this.extensionContext.extensionPath)],
        });

        this._panel.webview.html = this.getDocumentTemplate(this._panel.webview);
        this._panel.iconPath = this._iconPath;

        // Register the onDisposed emitter so dispose() releases its subscriber list.
        // It is intentionally not part of the disposables chain that fires _onDisposed
        // itself — dispose() fires the event first, then disposes the rest (this entry
        // included), so subscribers see the notification before the emitter is torn down.
        this.registerDisposable(this._onDisposed);

        this.registerDisposable(
            this._panel.onDidDispose(() => {
                this.dispose();
            }),
        );
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
        // and all in-flight operations are torn down on dispose.
        const { disposable } = attachTrpc(this._panel, context, this._options.appRouter);
        this.registerDisposable(disposable);
    }

    /**
     * Generates the full HTML document for the webview, including CSP headers,
     * serialized initial configuration, and the script that boots the React app.
     */
    private getDocumentTemplate(webview?: vscode.Webview): string {
        const devServer = !!process.env.DEVSERVER;
        const isProduction = this.extensionContext.extensionMode === vscode.ExtensionMode.Production;
        const nonce = randomBytes(16).toString('base64');

        const layout = this._options.isBundled ? this._options.sourceLayout.bundled : this._options.sourceLayout.dev;
        const devServerHost = this._options.devServerHost ?? DEFAULT_DEV_SERVER_HOST;

        const uri = (...parts: string[]) =>
            webview
                ?.asWebviewUri(vscode.Uri.file(path.join(this.extensionContext.extensionPath, layout.dir, ...parts)))
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
                                    __initialData: '${encodeURIComponent(JSON.stringify(this.configuration))}'
                                };

                                import { render } from "${srcUri}";
                                render('${this._webviewName}', acquireVsCodeApi());
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
     * Disposes the controller and all registered disposables.
     * Aborts all in-flight operations and subscriptions to prevent orphaned work.
     *
     * **Panel ownership architecture:** The panel owns the controller, not the
     * other way around. When the user closes the tab, VS Code disposes the panel,
     * which fires `onDidDispose`, which calls `this.dispose()`. We intentionally
     * do NOT dispose the panel from within this method — doing so would create a
     * circular call chain (`dispose → panel.dispose → onDidDispose → dispose`).
     * No code path in the codebase disposes the controller independently of the
     * panel, so the panel is always already disposed (or disposing) when we get here.
     */
    public dispose(): void {
        if (this._isDisposed) {
            return;
        }
        this._isDisposed = true;

        this._onDisposed.fire();

        // The tRPC dispatch disposable returned by `attachTrpc` is in this list;
        // disposing it removes the message listener and aborts every in-flight
        // operation and subscription (calling `return()` on each iterator so async
        // generators parked on `next()` terminate cleanly).
        this._disposables.forEach((d) => {
            d.dispose();
        });
    }
}
