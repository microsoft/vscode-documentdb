/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type TypedRpcFixtures } from './core/fixtures';
import { diagnosticsRowLabels, fixtures, type DiagnosticsRow } from './fixtures';
import { parseScenarioRoute, runnerRoutes, scenarioHtml, scenarioIndex, scenarioRunner } from './scenario-server';
import {
    diagnosticsEntraRuleIds,
    diagnosticsForbiddenText,
    diagnosticsListTop,
    findScenario,
    scenarioRoutes,
    scenarios,
    type Scenario,
    type ScenarioAssertion,
} from './scenarios';

describe('L2-dev manifest and routes', (): void => {
    it('imports, rather than duplicates, all six settled L2 fixtures', (): void => {
        for (const route of scenarioRoutes().filter((route): boolean => route.scenario === 'default')) {
            const scenario = findScenario(route);
            expect(scenario.config).toBe(fixtures[route.view].config);
            expect(scenario.rpc).toBe(fixtures[route.view].rpc);
            expect(scenario.readiness.content).toBe(fixtures[route.view].content);
        }
    });

    it('round-trips every scenario and theme, without duplicate routes', (): void => {
        const routes = scenarioRoutes();
        expect(routes).toHaveLength(162);
        expect(new Set(routes.map((route): string => route.path)).size).toBe(162);
        for (const route of routes) expect(parseScenarioRoute(route.path)).toEqual(route);
    });

    it.each([
        'provisioning',
        'success',
        'failed-port-in-use',
        'failed-timeout',
        'docker-missing-windows',
        'docker-missing-mac',
        'docker-missing-linux',
    ] as const)('expects the fixed container-engine heading in %s', (scenario): void => {
        expect(scenarios.localQuickStart[scenario].readiness.content).toContain('Checking container engine');
    });

    it.each([
        '/unknown/default/dark',
        '/localQuickStart/missing/dark',
        '/localQuickStart/introduction/blue',
        '/localQuickStart/introduction/dark?theme=light',
        '/localQuickStart/introduction/dark/',
        '/localQuickStart/introduction/dark#light',
        '/localQuickStart/%69ntroduction/dark',
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
        expect(runnerRoutes('/scenarios/run-all.js')).toHaveLength(162);
        expect(runnerRoutes('/scenarios/run-all/connectionDiagnostics.js')).toHaveLength(84);
        expect(runnerRoutes('/scenarios/run-all/localQuickStart.js')).toHaveLength(66);
        expect(runnerRoutes('/scenarios/run-all/localQuickStart/dark.js')).toHaveLength(22);
        expect(runnerRoutes('/scenarios/run-all/unknown.js')).toBeUndefined();
        expect(runnerRoutes('/scenarios/run-all.js?view=localQuickStart')).toBeUndefined();
        const snippet = scenarioRunner(scenarioRoutes());
        expect(snippet).toMatch(/page\.goto\(["']about:blank["']/);
        expect(snippet).not.toContain('waitForFunction');
        expect(snippet).not.toContain('networkidle');
    });

    it.each(['configure-engine-default', 'configure-engine-choice', 'configure-engine-recreate'] as const)(
        'covers %s in every theme with metadata and no pre-execution readiness',
        (name): void => {
            expect(
                scenarioRoutes()
                    .filter((route): boolean => route.scenario === name)
                    .map((route) => route.theme),
            ).toEqual(['dark', 'light', 'high-contrast']);
            const scenario = scenarios.localQuickStart[name];
            expect(scenario.rpc['localQuickStart.getWizardContext']).toBeDefined();
            expect(scenario.assertions).toContainEqual(
                expect.objectContaining({
                    kind: 'calls',
                    path: 'localQuickStart.getDockerStatus',
                    count: 0,
                }),
            );
            expect(scenario.assertions).toContainEqual(
                expect.objectContaining({
                    kind: 'calls',
                    path: 'localQuickStart.startDockerProvider',
                    count: 0,
                }),
            );
            expect(
                scenario.assertions?.some(
                    (assertion) =>
                        assertion.kind === 'text' &&
                        ['Found', 'Not found on PATH', 'Detected'].every((text) => assertion.excludes.includes(text)),
                ),
            ).toBe(true);
        },
    );

    it('covers execution fallback with its summary, preferred-engine fact and both PATH facts in every theme', (): void => {
        const scenario: Scenario<'localQuickStart'> = scenarios.localQuickStart['setup-engine-fallback'];
        expect(
            scenarioRoutes()
                .filter((route): boolean => route.scenario === 'setup-engine-fallback')
                .map((route) => route.theme),
        ).toEqual(['dark', 'light', 'high-contrast']);
        expect(scenario.readiness.content).toContain('Podman 5.8.3 (Docker not found)');
        expect(scenario.assertions).toContainEqual(
            expect.objectContaining({
                kind: 'order',
                texts: ['Preferred engine', 'Podman CLI', 'Docker CLI'],
            }),
        );
        const evidence = scenario.assertions
            ?.filter((assertion) => assertion.kind === 'text')
            .find((assertion) => assertion.includes.includes('Docker · not found, used Podman'));
        expect(evidence?.includes).toEqual(
            expect.arrayContaining([
                'Docker · not found, used Podman',
                'Podman CLI',
                'Found, version 5.8.3',
                'Docker CLI',
                'Not found',
            ]),
        );
        expect(scenario.assertions).toContainEqual(
            expect.objectContaining({
                kind: 'calls',
                path: 'localQuickStart.getDockerStatus',
                input: undefined,
                count: 0,
            }),
        );
        expect(scenario.assertions).toContainEqual(
            expect.objectContaining({
                kind: 'calls',
                path: 'localQuickStart.startDockerProvider',
                count: 0,
            }),
        );
    });

    it.each([
        'both-clis-found',
        'setup-engine-fallback',
        'podman-selected',
        'failed-check-details',
        'docker-missing-windows',
        'docker-missing-mac',
        'docker-missing-linux',
    ] as const)(
        'carries execution checking evidence in the %s fixture rather than depending on a post-check query',
        (name): void => {
            const scenario: Scenario<'localQuickStart'> = scenarios.localQuickStart[name];
            const stream = scenario.rpc['localQuickStart.startQuickStart'];
            expect(stream?.type).toBe('subscription');
            if (!stream || stream.type !== 'subscription') throw new Error('Missing setup stream');
            const checking = stream.results.find((event) => event.stage === 'checking');
            expect(checking?.dockerReadiness).toBeDefined();
            if (name === 'setup-engine-fallback') {
                expect(checking?.dockerReadiness).toMatchObject({
                    preferredEngine: 'docker',
                    cli: 'podman',
                    cliFallback: true,
                    cliOnPath: { docker: false, podman: true },
                });
            }
        },
    );

    it('covers native Podman click/wait and Linux copy-only recovery in every theme', (): void => {
        const machine = scenarios.localQuickStart['podman-machine-stopped-mac'];
        const socket = scenarios.localQuickStart['podman-linux-socket-down'];
        for (const name of ['podman-machine-stopped-mac', 'podman-linux-socket-down']) {
            expect(scenarioRoutes().filter((route): boolean => route.scenario === name)).toHaveLength(3);
        }
        expect(machine.steps).toContainEqual({ action: 'click', role: 'button', name: 'Start Podman machine' });
        expect(machine.assertions).toContainEqual(
            expect.objectContaining({
                kind: 'calls',
                path: 'localQuickStart.startDockerProvider',
                count: 2,
                input: { preferredEngine: 'podman' },
            }),
        );
        expect(socket.assertions).toContainEqual(
            expect.objectContaining({
                kind: 'calls',
                path: 'localQuickStart.startDockerProvider',
                count: 0,
            }),
        );
        expect(socket.assertions).toContainEqual(
            expect.objectContaining({
                kind: 'calls',
                path: 'localQuickStart.copyRecoveryCommand',
                input: 'linuxStartPodmanSocket',
                count: 1,
            }),
        );
    });

    it('covers an initially starting Podman machine with read-only polling in every theme', (): void => {
        const scenario = scenarios.localQuickStart['podman-machine-starting-initial'];
        expect(
            scenarioRoutes().filter((route): boolean => route.scenario === 'podman-machine-starting-initial'),
        ).toHaveLength(3);
        expect(scenario.steps).not.toContainEqual({
            action: 'click',
            role: 'button',
            name: 'Start Podman machine',
        });
        expect(scenario.assertions).toContainEqual(
            expect.objectContaining({
                kind: 'calls',
                path: 'localQuickStart.startDockerProvider',
                count: 0,
            }),
        );
        expect(scenario.assertions).toContainEqual(
            expect.objectContaining({
                kind: 'sequence',
                milestones: ['.fui-MessageBar [role="progressbar"]'],
            }),
        );
        expect(scenario.readiness.content).toContain('Ready to set up');
        expect(scenario.readiness.content).toContain('Podman CLI 6.0.2 found');
    });

    it('settles the preference submission back in Configure instead of leaving its readiness marker behind', (): void => {
        const scenario = scenarios.localQuickStart['configure-engine-choice'];
        expect(scenario.assertions).toContainEqual(expect.objectContaining({
            kind: 'calls',
            path: 'localQuickStart.startQuickStart',
            input: { preferredEngine: 'podman', port: 10260 },
            count: 1,
            steps: [
                { action: 'click', role: 'button', name: 'Start DocumentDB Local' },
                { action: 'click', role: 'button', name: 'Cancel' },
            ],
        }));
        expect(scenario.readiness.content).toContain('Configure setup');
    });

    it.each(['podman-machine-starting-initial', 'podman-machine-stopped-mac'] as const)(
        'lets %s finish on the first independent healthy poll and verifies its final ready state',
        (name): void => {
            const scenario: Scenario<'localQuickStart'> = scenarios.localQuickStart[name];
            const query = scenario.rpc['localQuickStart.getDockerStatus'];
            expect(query?.results).toHaveLength(1);
            expect(query?.results[0]?.readiness).toMatchObject({
                outcome: 'ready',
                cli: 'podman',
                daemonReachable: true,
            });
            expect(scenario.readiness.content).toEqual([
                'Ready to set up', 'Continue setup', 'Podman CLI 6.0.2 found',
            ]);
            expect(scenario.readiness.noProgressbar).toBe(true);
            if (name === 'podman-machine-stopped-mac') {
                expect(scenario.steps?.slice(-3)).toEqual([
                    { action: 'click', role: 'button', name: 'Start Podman machine' },
                    { action: 'click', role: 'button', name: 'Stop waiting' },
                    { action: 'click', role: 'button', name: 'Start Podman machine' },
                ]);
            }
        },
    );

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

    it('pins the connection diagnostics row order, row heights, list position and card position in every connection diagnostics scenario', (): void => {
        const entries = Object.entries(scenarios.connectionDiagnostics);
        expect(entries.map(([name]): string => name).sort()).toEqual([
            'auth-rejected-native',
            'cancelled',
            'compressor-unavailable',
            'default',
            'dns-failure',
            'entra-cloud-mismatch',
            'entra-connected',
            'entra-no-silent-session',
            'entra-server-rejected',
            'entra-token-failed',
            'entra-us-gov-connected',
            'ip-address-tls-off',
            'listing-denied',
            'managed-identity-connected',
            'network-refused',
            'no-auth-signin-required',
            'paced-run',
            'private-endpoint-blocked',
            'private-endpoint-public',
            'private-endpoint-report-identifiers-hidden',
            'remote-host',
            'report-identifiers-hidden',
            'running',
            'seed-refused-connected',
            'several-findings',
            'timeout-limited',
            'tls-warning',
            'unreachable-host',
        ]);
        for (const [name, scenario] of entries) {
            const assertions: readonly ScenarioAssertion[] = scenario.assertions ?? [];
            expect(assertions).toContainEqual({
                kind: 'order',
                name: 'The eight row labels are present in order',
                selector: '#connectivity-checks [role="listitem"]',
                texts: diagnosticsRowLabels,
            });
            expect(assertions).toContainEqual(
                name === 'network-refused' || name === 'seed-refused-connected' || name === 'unreachable-host'
                    ? {
                          kind: 'rowHeights',
                          name: 'Rows other than Network connection (TCP) are one height; a long evidence line wraps around its Details toggle',
                          list: '#connectivity-checks',
                          selector:
                              '#connectivity-checks [role="listitem"]:not(#connectivity-checks-networkConnection)',
                          count: 7,
                          tolerance: 1,
                      }
                    : {
                          kind: 'rowHeights',
                          name: 'Pending, active, settled and skipped rows, with or without a collapsed Details toggle, are one height',
                          list: '#connectivity-checks',
                          selector: '#connectivity-checks [role="listitem"]',
                          count: 8,
                          tolerance: 1,
                      },
            );
            expect(assertions).toContainEqual({
                kind: 'text',
                name: 'The wizard-style header names the task',
                selector: 'h1',
                includes: ['Connection Diagnostics'],
                excludes: [],
            });
            expect(assertions).toContainEqual({
                kind: 'below',
                name: 'The header renders above the list',
                above: 'h1',
                below: '#connectivity-checks',
            });
            expect(assertions).toContainEqual({
                kind: 'text',
                name: 'The content heading names the connection being checked',
                selector: 'main h2',
                includes: [fixtures.connectionDiagnostics.config.connectionName],
                excludes: [],
            });
            expect(assertions).toContainEqual({
                kind: 'top',
                name: 'The list starts at the same offset in every state',
                selector: '#connectivity-checks',
                top: diagnosticsListTop,
            });
            expect(assertions).toContainEqual({
                kind: 'inside',
                name: 'Each Details toggle sits on its own row, on the evidence line under the row title',
                container: '#connectivity-checks [role="listitem"]',
                inner: 'button[aria-expanded]',
                minimum: 1,
                under: ':scope > div > :first-child',
            });
            expect(assertions).toContainEqual({
                kind: 'text',
                name: 'No internal codes, DNS library name, absolute checked time or elapsed counter is rendered',
                selector: 'body',
                includes: [],
                excludes: [...diagnosticsForbiddenText, 'Elapsed', 'Checked at'],
            });
            for (const label of diagnosticsRowLabels) expect(scenario.readiness.content).toContain(label);
            if (name === 'running') continue;
            expect(assertions).toContainEqual({
                kind: 'below',
                name: 'The result card renders below the list',
                above: '#connectivity-checks',
                below: '#connectivity-result',
            });
            const card = assertions.find(
                (assertion): boolean => assertion.kind === 'text' && assertion.selector === '#connectivity-result',
            );
            expect(card?.kind === 'text' ? card.includes.length : 0).toBeGreaterThan(0);
        }
    });

    it('clicks the connection diagnostics header Give Feedback action once in the default scenario', (): void => {
        expect(fixtures.connectionDiagnostics.config.feedbackPermitted).toBe(true);
        expect(scenarios.connectionDiagnostics.default.assertions).toContainEqual({
            kind: 'calls',
            name: 'Give Feedback in the header opens the feedback view once',
            path: 'common.openFeedback',
            input: {},
            count: 1,
            steps: [{ action: 'click', role: 'button', name: 'Give Feedback' }],
        });
    });

    it('streams a run that is still checking row 4, with no card yet', (): void => {
        const running = scenarios.connectionDiagnostics.running;
        const updates = running.rpc['connectionDiagnostics.run'];
        expect(updates.keepOpen).toBe(true);
        expect(updates.results.map((update): string => update.type)).toEqual(['started', 'rows']);
        const rows = updates.results[1].type === 'rows' ? updates.results[1].rows : [];
        expect(rows.map((row): string => row.status)).toEqual([
            'done',
            'done',
            'done',
            'active',
            'pending',
            'pending',
            'pending',
            'pending',
        ]);
        const assertions: readonly ScenarioAssertion[] = running.assertions;
        expect(
            assertions.some(
                (assertion): boolean => assertion.kind === 'below' && assertion.below === '#connectivity-result',
            ),
        ).toBe(false);
        expect(
            assertions.some(
                (assertion): boolean => assertion.kind === 'text' && assertion.selector === '#connectivity-result',
            ),
        ).toBe(false);
    });

    it('paces only the paced-run scenario, which replays an instant run with the default pacing (decision 0043)', (): void => {
        for (const [name, scenario] of Object.entries(scenarios.connectionDiagnostics)) {
            expect(scenario.config.stepPacing, name).toEqual(
                name === 'paced-run' ? undefined : { stepMs: 0, jitterMs: 0 },
            );
        }
        const paced = scenarios.connectionDiagnostics['paced-run'];
        const updates = paced.rpc['connectionDiagnostics.run'];
        if (!updates) throw new Error('paced-run has no run subscription');
        expect(updates.keepOpen).toBeUndefined();
        expect(updates.results.map((update): string => update.type)).toEqual([
            'started',
            ...Array<string>(8).fill('rows'),
            'finished',
        ]);
        expect(paced.assertions).toContainEqual(
            expect.objectContaining({ kind: 'sequence', minimumGapMs: 150, minimumSpanMs: 1_800 }),
        );
    });

    it('gives every warning or error row details that explain it, and no pending or active row any details (WI-18)', (): void => {
        for (const [name, scenario] of Object.entries(scenarios.connectionDiagnostics)) {
            for (const update of scenario.rpc['connectionDiagnostics.run']?.results ?? []) {
                if (update.type === 'failed') continue;
                for (const row of update.rows as readonly DiagnosticsRow[]) {
                    if (row.status === 'warning' || row.status === 'error') {
                        expect(
                            row.details?.findings.some((finding): boolean => finding.severity !== 'info'),
                            `${name}: ${row.id} explains its ${row.status}`,
                        ).toBe(true);
                    }
                    if (row.status === 'pending' || row.status === 'active') {
                        expect(row.details, `${name}: ${row.id} is ${row.status}`).toBeUndefined();
                    }
                }
            }
        }
    });

    it('carries the host result card data in every finished connection diagnostics run', (): void => {
        for (const [name, scenario] of Object.entries(scenarios.connectionDiagnostics)) {
            for (const update of scenario.rpc['connectionDiagnostics.run']?.results ?? []) {
                if (update.type === 'finished') {
                    expect(update.result.outcome, name).toBe(update.outcome);
                }
            }
        }
    });

    it('asserts the firewall sentence only where the run flags a network failure', (): void => {
        const firewall = 'A firewall or IP allowlist may be blocking this connection.';
        const cardOf = (scenario: Scenario): Extract<ScenarioAssertion, { kind: 'text' }> | undefined =>
            scenario.assertions?.find(
                (assertion): assertion is Extract<ScenarioAssertion, { kind: 'text' }> =>
                    assertion.kind === 'text' && assertion.selector === '#connectivity-result',
            );
        expect(cardOf(scenarios.connectionDiagnostics['network-refused'])?.includes.join(' ')).toContain(firewall);
        expect(cardOf(scenarios.connectionDiagnostics['auth-rejected-native'])?.excludes).toContain(
            'A firewall or IP allowlist',
        );
    });

    it('rejects codes, AADSTS codes, URLs, rule IDs and DNS library names but not hosts, accounts or setting names', (): void => {
        const matches = (text: string): boolean =>
            diagnosticsForbiddenText.some((pattern): boolean => new RegExp(pattern, 'i').test(text));
        for (const text of [
            'tcp.refused',
            'auth.entraTokenFailed',
            'AADSTS50020',
            'See https://aka.ms/x',
            'accountNotInTenant',
            'System and c-ares agree',
            'C-ares resolver',
            'cares',
            'getaddrinfo failed',
        ]) {
            expect(matches(text), text).toBe(true);
        }
        for (const text of [
            'c-stage0.mongocluster.cosmos.azure.com',
            'alice@contoso.com',
            'Protocol TLS 1.3',
            'Set microsoft-sovereign-cloud.environment to the cluster cloud, then connect again.',
            'Check access from the computer or remote host where these checks ran.',
            "Your system's lookup",
            'Direct DNS query',
            'Microsoft Azure RSA TLS Issuing CA 03',
        ]) {
            expect(matches(text), text).toBe(false);
        }
    });

    it('lists every Microsoft Entra ID rule ID the panel must never show', (): void => {
        const rules = readFileSync(
            resolve(__dirname, '../../../src/documentdb/auth/entraErrors/entraErrorRules.ts'),
            'utf8',
        );
        const ids = [...rules.matchAll(/^\s{8}id: '([A-Za-z]+)'/gm)].map((match): string => match[1]);
        expect(ids.length).toBeGreaterThan(0);
        expect([...diagnosticsEntraRuleIds].sort()).toEqual(ids.sort());
    });

    it('checks procedure outputs and assertion inputs at compile time', (): void => {
        const valid = {
            'localQuickStart.checkPort': { type: 'query', results: ['available'] },
        } as const satisfies TypedRpcFixtures;
        const unknownPath = {
            // @ts-expect-error Unknown procedures must not be accepted, even when a result is supplied.
            'localQuickStart.nonexistent': { type: 'query', results: [] },
        } as const satisfies TypedRpcFixtures;
        const wrongOutput = {
            // @ts-expect-error This router returns a port-availability union, not an arbitrary object.
            'localQuickStart.checkPort': { type: 'query', results: [{ available: true }] },
        } as const satisfies TypedRpcFixtures;
        const invalidAssertion = {
            ...scenarios.localQuickStart.introduction,
            assertions: [
                // @ts-expect-error common.openUrl requires a string URL.
                { kind: 'calls', name: 'wrong URL', path: 'common.openUrl', input: { url: 1 }, count: 1, steps: [] },
            ],
        } as const satisfies Scenario<'localQuickStart'>;
        expect(valid['localQuickStart.checkPort'].results).toEqual(['available']);
        expect([unknownPath, wrongOutput, invalidAssertion]).toHaveLength(3);
    });
});
