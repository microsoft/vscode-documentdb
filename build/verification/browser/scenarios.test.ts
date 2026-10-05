/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type TypedRpcFixtures } from './core/fixtures';
import { fixtures } from './fixtures';
import { parseScenarioRoute, runnerRoutes, scenarioHtml, scenarioIndex, scenarioRunner } from './scenario-server';
import { findScenario, scenarioRoutes, scenarios, type Scenario } from './scenarios';

describe('L2-dev manifest and routes', (): void => {
    it('imports, rather than duplicates, all five settled L2 fixtures', (): void => {
        for (const route of scenarioRoutes().filter((route): boolean => route.scenario === 'default')) {
            const scenario = findScenario(route);
            expect(scenario.config).toBe(fixtures[route.view].config);
            expect(scenario.rpc).toBe(fixtures[route.view].rpc);
            expect(scenario.readiness.content).toBe(fixtures[route.view].content);
        }
    });

    it('round-trips every scenario and theme, without duplicate routes', (): void => {
        const routes = scenarioRoutes();
        expect(routes).toHaveLength(42);
        expect(new Set(routes.map((route): string => route.path)).size).toBe(42);
        for (const route of routes) expect(parseScenarioRoute(route.path)).toEqual(route);
    });

    it.each([
        '/unknown/default/dark', '/localQuickStart/missing/dark', '/localQuickStart/introduction/blue',
        '/localQuickStart/introduction/dark?theme=light', '/localQuickStart/introduction/dark/',
        '/localQuickStart/introduction/dark#light', '/localQuickStart/%69ntroduction/dark',
    ])('rejects an unknown or non-canonical route: %s', (path): void => {
        expect(parseScenarioRoute(path)).toBeUndefined();
        const notFound = scenarioIndex(`Unknown L2-dev route: ${path}`);
        expect(notFound).toContain('Unknown L2-dev route:');
        expect(notFound).toContain('href="/localQuickStart/introduction/dark"');
        expect(notFound).toContain('high-contrast');
    });

    it('escapes diagnostic HTML and lists all routes', (): void => {
        expect(scenarioIndex('<script>alert(1)</script>')).not.toContain('<script>alert');
        for (const route of scenarioRoutes()) expect(scenarioIndex()).toContain(`href="${route.path}"`);
    });

    it('provides path-only all/view/theme helpers and rejects unknown subsets', (): void => {
        expect(runnerRoutes('/scenarios/run-all.js')).toHaveLength(42);
        expect(runnerRoutes('/scenarios/run-all/localQuickStart.js')).toHaveLength(30);
        expect(runnerRoutes('/scenarios/run-all/localQuickStart/dark.js')).toHaveLength(10);
        expect(runnerRoutes('/scenarios/run-all/unknown.js')).toBeUndefined();
        expect(runnerRoutes('/scenarios/run-all.js?view=localQuickStart')).toBeUndefined();
        const snippet = scenarioRunner(scenarioRoutes());
        expect(snippet).toMatch(/page\.goto\(["']about:blank["']/);
        expect(snippet).not.toContain('waitForFunction');
        expect(snippet).not.toContain('networkidle');
    });

    it('emits the host initial-data contract and theme kind before the Vite boot', (): void => {
        for (const route of scenarioRoutes()) {
            const html = scenarioHtml(route);
            const json = /id="vscode-ext-webview-initial-data" nonce="l2-dev">([^<]*)</.exec(html)?.[1];
            expect(json).toBeDefined();
            if (!json) throw new Error('Initial data absent');
            const data = JSON.parse(json) as { viewType: string; l10n: unknown; initialData: string };
            expect(data.viewType).toBe(route.view);
            expect(data.l10n).toEqual({});
            expect(JSON.parse(decodeURIComponent(data.initialData))).toEqual(findScenario(route).config);
            const kind = route.theme === 'high-contrast' ? 'vscode-high-contrast' : `vscode-${route.theme}`;
            expect(html).toContain(`class="${kind}" data-vscode-theme-kind="${kind}"`);
            expect(html.indexOf("addEventListener('error'")).toBeLessThan(html.indexOf('scenario-boot.ts'));
            expect(html).not.toContain('unsafe-eval');
        }
    });

    it('registers the scenario middleware only for vite serve', (): void => {
        const plugin = readFileSync(resolve(__dirname, '../../vite/webview-scenarios.mjs'), 'utf8');
        expect(plugin).toContain("apply: 'serve'");
        expect(plugin).toContain('response.statusCode = 404');
    });

    it('supplies all literal VS Code tokens consumed by webviews in each palette', (): void => {
        const tokens = new Set<string>();
        for (const directory of ['../../../src/webviews', '../../../packages/vscode-ext-webview-fluentui/src']) {
            const root = resolve(__dirname, directory);
            for (const file of readdirSync(root, { recursive: true, encoding: 'utf8' })) {
                if (!/\.(?:ts|tsx|scss|css)$/.test(file) || /\.test\.|\.d\.ts$/.test(file)) continue;
                for (const match of readFileSync(resolve(root, file), 'utf8').matchAll(/--vscode-[a-zA-Z0-9-]+/g)) {
                    tokens.add(match[0]);
                }
            }
        }
        const base = readFileSync(resolve(__dirname, 'theme.css'), 'utf8');
        const palettes = readFileSync(resolve(__dirname, 'scenario-theme.css'), 'utf8');
        for (const theme of ['dark', 'light', 'high-contrast']) {
            const block = palettes.split(`:root[data-scenario-theme="${theme}"] {`)[1]?.split('}')[0];
            expect(block).toBeDefined();
            for (const token of tokens) expect(`${base}${block}`).toContain(`${token}:`);
        }
    });

    it('checks procedure outputs and assertion inputs at compile time', (): void => {
        const valid = { 'localQuickStart.checkPort': { type: 'query', results: ['available'] } } as const satisfies TypedRpcFixtures;
        // @ts-expect-error Unknown procedures must not be accepted, even when a result is supplied.
        const unknownPath = { 'localQuickStart.nonexistent': { type: 'query', results: [] } } as const satisfies TypedRpcFixtures;
        // @ts-expect-error This router returns a port-availability union, not an arbitrary object.
        const wrongOutput = { 'localQuickStart.checkPort': { type: 'query', results: [{ available: true }] } } as const satisfies TypedRpcFixtures;
        const invalidAssertion = {
            ...scenarios.localQuickStart.introduction,
            // @ts-expect-error common.openUrl requires a string URL.
            assertions: [{ kind: 'calls', name: 'wrong URL', path: 'common.openUrl', input: { url: 1 }, count: 1, steps: [] }],
        } as const satisfies Scenario<'localQuickStart'>;
        expect(valid['localQuickStart.checkPort'].results).toEqual(['available']);
        expect([unknownPath, wrongOutput, invalidAssertion]).toHaveLength(3);
    });
});
