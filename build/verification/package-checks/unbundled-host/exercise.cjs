/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Runs inside the throwaway probe extension. The ESM variant receives this file converted to
// `exercise.mjs`, so the extension's own files stay in its module format. Keep it dependency-free.

'use strict';

const TITLE = 'Unbundled host probe';
const VIEW_TYPE = 'unbundledHostProbe';
const VIEW_FILE = 'probe-view.js';

/** @param {unknown} error @returns {{ name: string, message: string, code?: string, stack?: string }} */
function describeError(error) {
    if (error instanceof Error) {
        const code = /** @type {{ code?: unknown }} */ (error).code;
        return {
            name: error.name,
            message: error.message,
            ...(typeof code === 'string' ? { code } : {}),
            ...(error.stack ? { stack: error.stack.split('\n').slice(0, 12).join('\n') } : {}),
        };
    }
    return { name: typeof error, message: String(error) };
}

/** @param {() => boolean} predicate @param {number} timeoutMs @returns {Promise<boolean>} */
async function waitFor(predicate, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (!predicate()) {
        if (Date.now() > deadline) {
            return false;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return true;
}

/**
 * Load `@microsoft/vscode-ext-webview/host` the way the variant does, then make the smallest calls
 * that need the package's own `vscode` binding at runtime: `openWebview` calls
 * `vscode.window.createWebviewPanel`, `vscode.Uri.file`, `webview.asWebviewUri` and
 * `new vscode.EventEmitter()`; the tab check proves the panel reached the real workbench.
 * @param {{
 *   vscode: typeof import('vscode'),
 *   context: import('vscode').ExtensionContext,
 *   trace: (step: string) => void,
 *   load: () => Promise<{
 *     host: typeof import('@microsoft/vscode-ext-webview/host'),
 *     shared: typeof import('@microsoft/vscode-ext-webview'),
 *     resolved: string,
 *   }>,
 * }} options
 * @returns {Promise<{
 *   status: 'PASS' | 'FAIL', stage: string, resolved?: string, checks: string[],
 *   error?: ReturnType<typeof describeError>,
 * }>}
 */
async function exercise({ vscode, context, trace, load }) {
    let stage = 'load';
    /** @type {string | undefined} */
    let resolved;
    const checks = [];
    const enter = (/** @type {string} */ next) => {
        stage = next;
        trace(`stage ${next}`);
    };
    try {
        trace('stage load');
        const loaded = await load();
        resolved = loaded.resolved;
        checks.push('loaded /host and the shared entry');

        enter('exports');
        if (typeof loaded.host.openWebview !== 'function') {
            throw new Error(`/host has no openWebview function; exports: ${Object.keys(loaded.host).join(', ')}`);
        }
        const trpc = loaded.shared.initWebviewTrpc();
        const router = trpc.router({ ping: trpc.publicProcedure.query(() => 'pong') });

        enter('openWebview');
        const controller = loaded.host.openWebview(context, {
            title: TITLE,
            viewType: VIEW_TYPE,
            router,
            trpc,
            context: {},
            config: { probe: true },
            sourceLayout: { bundled: { dir: 'views', file: VIEW_FILE }, dev: { dir: 'views', file: VIEW_FILE } },
            isBundled: true,
        });
        checks.push('openWebview returned a controller');

        enter('panel');
        const panel = controller.panel;
        if (panel.viewType !== `react-webview-${VIEW_TYPE}`) {
            throw new Error(`Unexpected panel viewType ${JSON.stringify(panel.viewType)}`);
        }
        const html = panel.webview.html;
        if (!html.includes('vscode-ext-webview-initial-data') || !html.includes(VIEW_FILE)) {
            throw new Error('The panel HTML lacks the initial-data block or the asWebviewUri script reference.');
        }
        checks.push('panel created with the package HTML and an asWebviewUri script URI');

        enter('tab');
        const tabOpen = () =>
            vscode.window.tabGroups.all.some((group) =>
                group.tabs.some((tab) => tab.input instanceof vscode.TabInputWebview && tab.label === TITLE),
            );
        if (!(await waitFor(tabOpen, 10000))) {
            throw new Error('No webview tab with the probe title appeared in the workbench.');
        }
        checks.push('webview tab is open in the workbench');

        enter('dispose');
        let fired = false;
        controller.onDisposed(() => {
            fired = true;
        });
        controller.dispose();
        if (!controller.isDisposed || !fired) {
            throw new Error(`dispose(): isDisposed=${controller.isDisposed}, onDisposed fired=${fired}`);
        }
        if (!(await waitFor(() => !tabOpen(), 10000))) {
            throw new Error('The webview tab is still open after dispose().');
        }
        checks.push('dispose fired onDisposed and closed the tab');
        trace('done');
        return { status: 'PASS', stage: 'done', resolved, checks };
    } catch (error) {
        return { status: 'FAIL', stage, resolved, checks, error: describeError(error) };
    }
}

module.exports = { exercise };
