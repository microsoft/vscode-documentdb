/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getTRPCErrorFromUnknown } from '@trpc/server';
import * as l10n from '@vscode/l10n';
import { randomBytes } from 'crypto';
import * as path from 'path';
import * as vscode from 'vscode';
import { ext } from '../../../extensionVariables';
import { appRouter, type BaseRouterContext } from '../configuration/appRouter';
import { type WebviewName } from '../configuration/WebviewRegistry';
import { type VsCodeLinkRequestMessage } from '../webview-client/vscodeLink';
import { createCallerFactory } from './trpc';

const DEV_SERVER_HOST = 'http://localhost:18080';

/**
 * WebviewController manages a vscode.WebviewPanel and provides tRPC-based communication
 * with the React webview. It handles incoming requests (queries, mutations, and subscriptions)
 * from the webview, routing them to server-side procedures defined in the `appRouter`.
 *
 * @template Configuration - The type of the configuration object that the webview will receive.
 */
export class WebviewController<Configuration> implements vscode.Disposable {
    private _panel: vscode.WebviewPanel;
    private _disposables: vscode.Disposable[] = [];
    private _isDisposed: boolean = false;
    private _onDisposed: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    public readonly onDisposed: vscode.Event<void> = this._onDisposed.event;

    /**
     * A map tracking active subscriptions by their operation ID.
     * Each subscription is associated with an AbortController, allowing the server
     * side to cancel the subscription if requested by the client.
     */
    private _activeSubscriptions = new Map<string, AbortController>();

    /**
     * A map tracking active queries and mutations by their operation ID.
     * Each operation is associated with an AbortController, allowing the server
     * side to cancel the operation if the client sends an abort message.
     */
    private _activeOperations = new Map<string, AbortController>();

    /**
     * Creates a new WebviewController instance.
     *
     * @param extensionContext The extension context.
     * @param title            The title of the webview panel.
     * @param webviewName      The identifier/name for the webview resource.
     * @param configuration    The initial state object that the webview will use on startup.
     * @param viewColumn       The view column in which to show the new webview panel.
     * @param _iconPath        An optional icon to display in the tab of the webview.
     */
    constructor(
        protected extensionContext: vscode.ExtensionContext,
        title: string,
        private _webviewName: WebviewName,
        private configuration: Configuration,
        viewColumn: vscode.ViewColumn = vscode.ViewColumn.One,
        private _iconPath?:
            | vscode.Uri
            | {
                  readonly light: vscode.Uri;
                  readonly dark: vscode.Uri;
              },
    ) {
        this._panel = vscode.window.createWebviewPanel('react-webview-' + _webviewName, title, viewColumn, {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [vscode.Uri.file(this.extensionContext.extensionPath)],
        });

        this._panel.webview.html = this.getDocumentTemplate(this._panel.webview);
        this._panel.iconPath = this._iconPath;

        this.registerDisposable(
            this._panel.onDidDispose(() => {
                this.dispose();
            }),
        );
    }

    /**
     * Sets up tRPC integration for the webview. This includes listening for messages from the webview,
     * parsing them as tRPC operations (queries, mutations, subscriptions, or subscription stops),
     * invoking the appropriate server-side procedures, and returning results or errors.
     *
     * @param context - The base router context for procedure calls.
     */
    protected setupTrpc(context: BaseRouterContext): void {
        this.registerDisposable(
            this._panel.webview.onDidReceiveMessage(async (message: VsCodeLinkRequestMessage) => {
                switch (message.op.type) {
                    case 'subscription':
                        await this.handleSubscriptionMessage(message, context);
                        break;

                    case 'subscription.stop':
                        this.handleSubscriptionStopMessage(message);
                        break;

                    case 'abort':
                        this.handleAbortMessage(message);
                        break;

                    default:
                        await this.handleDefaultMessage(message, context);
                        break;
                }
            }),
        );
    }

    /**
     * Handles the 'subscription' message type.
     *
     * Sets up an async iterator for the subscription procedure and streams results back
     * to the webview. Also handles cancellation via AbortController.
     *
     * @param message - The original message from the webview.
     * @param context - The base router context, to which we add an abort signal.
     */
    private async handleSubscriptionMessage(message: VsCodeLinkRequestMessage, context: BaseRouterContext) {
        try {
            // In v12, tRPC will have better cancellation support. For now, we use AbortController.
            const abortController = new AbortController();
            this._activeSubscriptions.set(message.id, abortController);

            // Clone context so the signal is per-operation and does not mutate the shared context object
            const opContext: BaseRouterContext = { ...context, signal: abortController.signal };

            const callerFactory = createCallerFactory(appRouter);
            const caller = callerFactory(opContext);

            // eslint-disable-next-line
            const procedure = caller[message.op.path];

            if (typeof procedure !== 'function') {
                throw new Error(l10n.t('Procedure not found: {name}', { name: message.op.path }));
            }

            // Await the procedure call to get the async iterator (async generator) for the subscription
            // eslint-disable-next-line , @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment
            const asyncIter = await procedure(message.op.input);

            void (async () => {
                try {
                    for await (const value of asyncIter) {
                        // Each yielded value is sent to the webview
                        // eslint-disable-next-line
                        this._panel.webview.postMessage({ id: message.id, result: value });
                    }

                    // On natural completion, inform the client
                    this._panel.webview.postMessage({ id: message.id, complete: true });
                } catch (error) {
                    const trpcErrorMessage = this.wrapInTrpcErrorMessage(error, message.id);
                    this._panel.webview.postMessage(trpcErrorMessage);
                } finally {
                    this._activeSubscriptions.delete(message.id);
                }
            })();
        } catch (error) {
            const trpcErrorMessage = this.wrapInTrpcErrorMessage(error, message.id);
            this._panel.webview.postMessage(trpcErrorMessage);
        }
    }

    /**
     * Handles the 'subscription.stop' message type.
     *
     * Looks up the active subscription by ID and aborts it, stopping further data emission.
     *
     * @param message - The original message from the webview.
     */
    private handleSubscriptionStopMessage(message: VsCodeLinkRequestMessage) {
        const abortController = this._activeSubscriptions.get(message.id);
        if (abortController) {
            abortController.abort();
            this._activeSubscriptions.delete(message.id);
        }
    }

    /**
     * Handles the 'abort' message type for queries and mutations.
     *
     * Looks up the active operation by ID and aborts it, allowing the server-side
     * procedure to detect cancellation via `ctx.signal.aborted`.
     *
     * @param message - The original message from the webview.
     */
    private handleAbortMessage(message: VsCodeLinkRequestMessage) {
        const abortController = this._activeOperations.get(message.id);
        if (abortController) {
            abortController.abort();
            this._activeOperations.delete(message.id);
        }
    }

    /**
     * Handles the default case for messages (i.e., queries and mutations).
     *
     * Calls the specified tRPC procedure and returns a single result.
     * If the procedure is not found or throws, returns an error message.
     *
     * @param message - The original message from the webview.
     * @param context - The base router context.
     */
    private async handleDefaultMessage(message: VsCodeLinkRequestMessage, context: BaseRouterContext) {
        // In v12, tRPC will have better cancellation support. For now, we use AbortController.
        const abortController = new AbortController();
        this._activeOperations.set(message.id, abortController);

        try {
            // Clone context so the signal is per-operation and does not mutate the shared context object
            const opContext: BaseRouterContext = { ...context, signal: abortController.signal };

            const callerFactory = createCallerFactory(appRouter);
            const caller = callerFactory(opContext);

            // eslint-disable-next-line
            const procedure = caller[message.op.path];

            if (typeof procedure !== 'function') {
                throw new Error(l10n.t('Procedure not found: {name}', { name: message.op.path }));
            }

            // eslint-disable-next-line , @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment
            const result = await procedure(message.op.input);

            // Only send the result if the operation was not aborted
            if (!abortController.signal.aborted) {
                // Send the result back to the client
                // eslint-disable-next-line
                const response = { id: message.id, result };
                this._panel.webview.postMessage(response);
            }
        } catch (error) {
            // Only send error if the operation was not aborted (client already errored locally)
            if (!abortController.signal.aborted) {
                const trpcErrorMessage = this.wrapInTrpcErrorMessage(error, message.id);
                this._panel.webview.postMessage(trpcErrorMessage);
            }
        } finally {
            this._activeOperations.delete(message.id);
        }
    }

    /**
     * Converts an unknown error into a tRPC-compatible error response.
     *
     * By constructing a plain object with enumerable properties, we ensure the client
     * receives a properly serialized error object over postMessage.
     *
     * @param error - The caught error.
     * @param operationId - The operation ID associated with the error.
     */
    private wrapInTrpcErrorMessage(error: unknown, operationId: string) {
        const errorEntry = getTRPCErrorFromUnknown(error);

        return {
            id: operationId,
            error: {
                code: errorEntry.code,
                name: errorEntry.name,
                message: errorEntry.message,
                stack: errorEntry.stack,
                cause: errorEntry.cause,
            },
        };
    }

    /**
     * Generates the full HTML document for the webview, including CSP headers,
     * serialized initial configuration, and the script that boots the React app.
     */
    private getDocumentTemplate(webview?: vscode.Webview): string {
        const devServer = !!process.env.DEVSERVER;
        const isProduction = this.extensionContext.extensionMode === vscode.ExtensionMode.Production;
        const nonce = randomBytes(16).toString('base64');

        const dir = ext.isBundle ? '' : 'out/src/webviews';
        const filename = ext.isBundle ? 'views.js' : 'index.js';
        const uri = (...parts: string[]) =>
            webview?.asWebviewUri(vscode.Uri.file(path.join(this.extensionContext.extensionPath, dir, ...parts))).toString(true);

        const srcUri = isProduction || !devServer ? uri(filename) : `${DEV_SERVER_HOST}/${filename}`;

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
                      `default-src ${webview?.cspSource} ${DEV_SERVER_HOST};`,
                      `script-src ${webview?.cspSource} ${DEV_SERVER_HOST} 'nonce-${nonce}';`,
                      `style-src ${webview?.cspSource} ${DEV_SERVER_HOST} vscode-resource: 'unsafe-inline';`,
                      `img-src ${webview?.cspSource} ${DEV_SERVER_HOST} data: vscode-resource:;`,
                      `connect-src ${webview?.cspSource} ${DEV_SERVER_HOST} ws:;`,
                      `font-src ${webview?.cspSource} ${DEV_SERVER_HOST};`,
                      `worker-src ${webview?.cspSource} ${DEV_SERVER_HOST} blob:;`,
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

        // Abort all active queries/mutations so server-side procedures can stop early
        for (const controller of this._activeOperations.values()) {
            controller.abort();
        }
        this._activeOperations.clear();

        // Abort all active subscriptions so async generators can terminate
        for (const controller of this._activeSubscriptions.values()) {
            controller.abort();
        }
        this._activeSubscriptions.clear();

        this._disposables.forEach((d) => {
            d.dispose();
        });
    }
}
