/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { runScenario } from './scenario-playwright';
import { findScenario, scenarioRoutes, themes, type ScenarioRoute } from './scenarios';
import { inertJson } from './template';

export function parseScenarioRoute(path: string): ScenarioRoute | undefined {
    // Match the manifest exactly: no queries, fragments, aliases, decoding or silent defaults.
    return scenarioRoutes().find((route): boolean => route.path === path);
}

function escapeHtml(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

export function scenarioIndex(message = 'L2-dev scenarios'): string {
    const list = scenarioRoutes().map((route): string =>
        `<li><a href="${route.path}">${escapeHtml(route.path)}</a></li>`).join('\n');
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>L2-dev</title><link rel="icon" href="data:,"></head>
<body><h1>${escapeHtml(message)}</h1><p>Run <a href="/scenarios/run-all.js">/scenarios/run-all.js</a> with a Playwright page.
Flows need the declared steps (shown in window.__scenario.data.steps), or run the helper.
Themes: ${themes.join(', ')}. Unknown paths are not substituted.</p><ul>${list}</ul></body></html>`;
}

export function scenarioHtml(route: ScenarioRoute, devServerOrigin = 'http://localhost:18080'): string {
    const scenario = findScenario(route);
    const kind = route.theme === 'high-contrast' ? 'vscode-high-contrast' : `vscode-${route.theme}`;
    const initial = { initialData: encodeURIComponent(JSON.stringify(scenario.config)), l10n: {}, viewType: route.view };
    // Like the host's development CSP, allow the configured server origin as well as the document
    // origin: Vite emits absolute font/worker URLs even when this page is opened on 127.0.0.1.
    const source = `'self' ${devServerOrigin}`;
    // Install failure capture before any module is fetched/evaluated. Preserve the original console;
    // no warning/error filtering, including late failures after the page first becomes ready.
    return `<!doctype html><html lang="en" data-scenario-theme="${route.theme}" data-ready="pending">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src ${source}; script-src ${source} 'nonce-l2-dev'; style-src ${source} 'unsafe-inline'; img-src ${source} data:; font-src ${source}; connect-src ${source} ws: wss:; worker-src ${source} blob:; form-action 'none'">
<title>${route.path}</title><link rel="icon" href="data:,">
<link rel="stylesheet" href="/build/verification/browser/theme.css">
<link rel="stylesheet" href="/build/verification/browser/scenario-theme.css">
<script nonce="l2-dev">
window.__harnessErrors = [];
const fail = (reason) => { window.__harnessErrors.push(reason); document.documentElement.dataset.ready = 'failed'; };
for (const method of ['error', 'warn']) {
    const original = console[method];
    console[method] = (...values) => { fail('console.' + method + ': ' + values.map(String).join(' ')); Reflect.apply(original, console, values); };
}
addEventListener('error', (event) => fail('pageerror: ' + event.message));
addEventListener('unhandledrejection', (event) => fail('unhandledrejection: ' + String(event.reason)));
document.addEventListener('securitypolicyviolation', (event) => fail('CSP: ' + event.violatedDirective + ': ' + event.blockedURI));
</script></head><body class="${kind}" data-vscode-theme-kind="${kind}" data-vscode-theme-name="L2-dev ${route.theme}">
<div id="root"></div>
<script type="application/json" id="vscode-ext-webview-initial-data" nonce="l2-dev">${inertJson(initial)}</script>
<script type="application/json" id="l2-dev-scenario" nonce="l2-dev">${inertJson({ route, scenario })}</script>
<script type="module" nonce="l2-dev" src="/build/verification/browser/scenario-boot.ts"></script>
</body></html>`;
}

export function runnerRoutes(path: string): ScenarioRoute[] | undefined {
    if (path === '/scenarios/run-all.js') return scenarioRoutes();
    const match = /^\/scenarios\/run-all\/([a-zA-Z]+)(?:\/(dark|light|high-contrast))?\.js$/.exec(path);
    if (!match) return undefined;
    const routes = scenarioRoutes().filter((route): boolean => route.view === match[1] && (!match[2] || route.theme === match[2]));
    return routes.length ? routes : undefined;
}

export function scenarioRunner(routes: readonly ScenarioRoute[]): string {
    return `${runScenario.toString()}
const origin = await page.evaluate(() => location.origin);
if (!/^https?:/.test(origin)) throw new Error('Open /scenarios/ on the dev server before running this helper');
const results = [];
for (const route of ${inertJson(routes)}) results.push(await runScenario(page, origin, route));
return results;`;
}
