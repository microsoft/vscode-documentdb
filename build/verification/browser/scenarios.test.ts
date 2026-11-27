/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EJSON } from 'bson';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fieldColumnKey } from '../../../src/utils/documentGrid/types';
import { collectionViewFixtures } from './collectionViewFixtures';
import { type TypedRpcFixtures } from './core/fixtures';
import { diagnosticsRowLabels, fixtures, type DiagnosticsRow } from './fixtures';
import { parseScenarioRoute, runnerRoutes, scenarioHtml, scenarioIndex, scenarioRunner } from './scenario-server';
import {
    collectionViewContracts,
    diagnosticsEntraRuleIds,
    diagnosticsForbiddenText,
    diagnosticsListTop,
    findScenario,
    scenarioRoutes,
    scenarios,
    type Scenario,
    type ScenarioAssertion,
} from './scenarios';

describe('TDD: Collection View grid contracts', (): void => {
    const ids = [
        'M1',
        'M2',
        'M3',
        'M4',
        'M5',
        'M6',
        'M7',
        'K1',
        'K2',
        'K3',
        'K4',
        'K5',
        'K6',
        'K7',
        'K8',
        'K9',
        'K10',
        'K11',
    ];
    const assertions: readonly ScenarioAssertion[] = Object.values(collectionViewContracts).flat();

    it.each(ids)('%s has executable user-outcome assertions, never a silent skip', (id): void => {
        const matching = assertions.filter((assertion): boolean => assertion.name?.startsWith(`TDD: ${id} `) ?? false);
        expect(matching.length).toBeGreaterThan(0);
        for (const assertion of matching) {
            expect(assertion.requiresGrid).toMatch(/^(grid|treegrid)$/);
            expect(assertion).not.toHaveProperty('skip');
            if ('selector' in assertion) {
                expect(assertion.selector).not.toMatch(/rdg|slickgrid/i);
            }
            if (assertion.kind === 'text') {
                expect(assertion.includes.length + assertion.excludes.length).toBeGreaterThan(0);
            } else if (assertion.kind === 'focused') {
                expect(assertion.target).toBeDefined();
            } else if (assertion.kind === 'calls') {
                expect(assertion.path).toMatch(/^mongoClusters\.collectionView\./);
            } else if (assertion.kind === 'order') {
                expect(assertion.texts.length).toBeGreaterThan(0);
            } else if (assertion.kind === 'countAtMost') {
                expect(assertion.max).toBeLessThan(500);
            }
        }
        const routes = scenarioRoutes().filter(
            (route): boolean =>
                route.view === 'collectionView' &&
                (findScenario(route).assertions?.some(
                    (assertion): boolean => assertion.name?.startsWith(`TDD: ${id} `) ?? false,
                ) ??
                    false),
        );
        expect(new Set(routes.map((route): string => route.theme))).toEqual(
            new Set(['dark', 'light', 'high-contrast']),
        );
    });

    it('pins the single-selection and fail-closed no-ID regressions', (): void => {
        expect(collectionViewContracts.selection).toContainEqual(
            expect.objectContaining({
                kind: 'calls',
                name: 'TDD: K1 exactly one selected document can be viewed',
                requiresGrid: 'grid',
                path: 'mongoClusters.collectionView.viewDocumentById',
                input: '"heterogeneous-1"',
                count: 1,
            }),
        );
        expect(collectionViewContracts['no-id']).toContainEqual(
            expect.objectContaining({
                kind: 'attribute',
                attribute: 'aria-selected',
                expected: 'true',
                selector: '[role="grid"] [role="row"][aria-rowindex="2"]',
            }),
        );
        for (const name of ['View selected document', 'Edit selected document', 'Delete selected document(s)']) {
            expect(collectionViewContracts['no-id']).toContainEqual(
                expect.objectContaining({
                    kind: 'attribute',
                    selector: `.collectionView :is(button,[role="button"])[aria-label="${name}"]`,
                    attribute: 'disabled',
                    expected: '',
                }),
            );
        }
    });

    it('pins decorative glyph and Tab-stop contracts for mixed typed cells', (): void => {
        expect(collectionViewContracts['mixed-types']).toContainEqual({
            kind: 'attribute',
            name: 'TDD: K7 visual BSON glyph is hidden from the accessible name',
            requiresGrid: 'grid',
            selector:
                '[role="grid"] [role="row"][aria-rowindex="2"] [role="gridcell"][aria-colindex="3"] > span > span:last-child',
            attribute: 'aria-hidden',
            expected: 'true',
            steps: [
                { action: 'press', key: 'Home' },
                { action: 'press', key: 'ArrowRight' },
                { action: 'press', key: 'ArrowRight' },
            ],
        });
        expect(collectionViewContracts['mixed-types']).toContainEqual({
            kind: 'attribute',
            name: 'TDD: M6 typed value introduces no extra cell Tab stop',
            requiresGrid: 'grid',
            selector:
                '[role="grid"] [role="row"][aria-rowindex="2"] [role="gridcell"][aria-colindex="3"] [tabindex]:not([tabindex="-1"])',
            attribute: 'tabindex',
            expected: null,
        });
    });

    it('pins deterministic late acknowledgements separately from same-panel stale results', (): void => {
        expect(collectionViewContracts['late-delete']).toContainEqual(
            expect.objectContaining({
                kind: 'text',
                name: 'TDD: K2 late delete acknowledgement preserves the newer selection',
                selector: '[role="grid"] [role="row"][aria-selected="true"]',
                includes: ['Beta', 'heterogeneous-2'],
                excludes: ['Alpha'],
                steps: [
                    { action: 'click', role: 'gridcell', name: 'Beta' },
                    { action: 'releaseReply', tag: 'delete-alpha' },
                ],
            }),
        );
        expect(
            collectionViewFixtures['late-delete'].rpc['mongoClusters.collectionView.deleteDocumentsById'],
        ).toMatchObject({
            hold: 'delete-alpha',
            results: [true],
        });

        expect(
            collectionViewFixtures['late-query'].rpc['mongoClusters.collectionView.getCurrentPageAsTable'].cases,
        ).toContainEqual(expect.objectContaining({ input: ['details'], hold: 'old-details' }));
        expect(collectionViewContracts['late-query']).toContainEqual(
            expect.objectContaining({
                kind: 'calls',
                input: '"heterogeneous-2"',
                count: 1,
                path: 'mongoClusters.collectionView.viewDocumentById',
            }),
        );
        expect(assertions.map((assertion): string => assertion.name ?? '')).not.toContainEqual(
            expect.stringMatching(/cross.collection|cross.panel/i),
        );
        expect(collectionViewContracts['late-query'].at(-1)).toEqual({
            kind: 'focused',
            name: 'TDD: M7 late keyboard step-in does not steal focus from the view picker',
            requiresGrid: 'grid',
            target: { selector: '.collectionDocumentViewSwitcher [role="combobox"]' },
            steps: [
                { action: 'focus', role: 'gridcell', name: '{...}' },
                { action: 'press', key: 'Enter' },
                { action: 'focus', role: 'combobox', name: 'Select view type' },
                { action: 'releaseReply', tag: 'old-details' },
            ],
        });
    });

    it('keeps identity fixtures canonical and synchronized with document action inputs', (): void => {
        const documentIds = collectionViewFixtures.identity.tablePage.rows.map((row): string => {
            if (row.documentId === undefined) throw new Error('Missing identity fixture document ID');
            expect(row.documentId).toBe(EJSON.stringify(EJSON.parse(row.documentId), { relaxed: false }));
            return row.documentId;
        });
        const identity: readonly ScenarioAssertion[] = collectionViewContracts.identity;
        const targets = identity.flatMap((assertion): string[] => {
            if (assertion.kind !== 'calls') return [];
            if (assertion.path === 'mongoClusters.collectionView.deleteDocumentsById') return assertion.input;
            if (
                assertion.path === 'mongoClusters.collectionView.viewDocumentById' ||
                assertion.path === 'mongoClusters.collectionView.editDocumentById'
            )
                return [assertion.input];
            throw new Error('Unexpected identity fixture action');
        });
        expect(targets).toEqual(documentIds);
    });

    it('pins nested whole-page navigation, root identity and the accepted Enter gesture', (): void => {
        expect(collectionViewContracts['step-in']).toContainEqual(
            expect.objectContaining({
                kind: 'text',
                includes: ['nested Alpha', 'heterogeneous-1', 'heterogeneous-2', 'heterogeneous-3'],
                steps: [{ action: 'dblclick', role: 'gridcell', name: '{...}' }],
            }),
        );
        expect(collectionViewContracts['step-in']).toContainEqual(
            expect.objectContaining({
                kind: 'calls',
                name: 'TDD: K4 nested inspection still targets the root document',
                input: '"heterogeneous-1"',
            }),
        );
        expect(collectionViewContracts['step-in']).toContainEqual(
            expect.objectContaining({
                kind: 'text',
                name: 'TDD: M7 Enter on an object cell steps in',
                includes: ['leaf Alpha'],
                steps: [
                    { action: 'focus', role: 'gridcell', name: '{...}' },
                    { action: 'press', key: 'Enter' },
                ],
            }),
        );
        expect(collectionViewContracts['missing-vs-null']).toContainEqual(
            expect.objectContaining({
                kind: 'order',
                texts: ['', 'null', 'Ab', 'false', '0'],
            }),
        );
    });

    it('pins uninterrupted M7 focus restoration and positional no-ID keyboard step-in', (): void => {
        const firstEnter = collectionViewContracts['step-in'].findIndex(
            (assertion): boolean => assertion.name === 'TDD: M7 Enter on an object cell steps in',
        );
        expect(firstEnter).toBeGreaterThanOrEqual(0);
        expect(collectionViewContracts['step-in'].slice(firstEnter + 1, firstEnter + 4)).toEqual([
            {
                kind: 'focused',
                name: "TDD: M7 keyboard step-in focuses the same row's _id cell",
                requiresGrid: 'grid',
                target: {
                    selector:
                        '[role="grid"] [role="row"][aria-rowindex="2"] [role="gridcell"][aria-colindex="1"]',
                },
            },
            {
                kind: 'focused',
                name: 'TDD: M7 arrow keys continue after keyboard step-in',
                requiresGrid: 'grid',
                target: {
                    selector:
                        '[role="grid"] [role="row"][aria-rowindex="2"] [role="gridcell"][aria-colindex="2"]',
                },
                steps: [{ action: 'press', key: 'ArrowRight' }],
            },
            {
                kind: 'attribute',
                name: 'TDD: M7 Space selects after keyboard step-in',
                requiresGrid: 'grid',
                selector: '[role="grid"] [role="row"][aria-rowindex="2"]',
                attribute: 'aria-selected',
                expected: 'true',
                steps: [{ action: 'press', key: 'Space' }],
            },
        ]);

        expect(collectionViewContracts['step-in'][firstEnter + 4]?.name).toBe(
            'TDD: M2 Level up returns to the parent data',
        );

        const noId = collectionViewFixtures['no-id'];
        expect(noId.tablePage.rows[0]).toMatchObject({
            rowKey: 'pos:0',
            cells: {
                [fieldColumnKey('details')]: { display: '{...}', type: 'object' },
            },
        });
        expect(noId.tablePage.rows[0]).not.toHaveProperty('documentId');
        expect(noId.rpc['mongoClusters.collectionView.getCurrentPageAsTable'].cases).toContainEqual(
            expect.objectContaining({
                input: ['details'],
                results: [
                    expect.objectContaining({
                        path: ['details'],
                        rows: [
                            expect.objectContaining({ rowKey: 'pos:0' }),
                            expect.objectContaining({
                                rowKey: 'id:"ordinary-target"',
                                documentId: '"ordinary-target"',
                            }),
                        ],
                    }),
                ],
            }),
        );

        expect(collectionViewContracts['no-id'].slice(-2)).toEqual([
            {
                kind: 'text',
                name: 'TDD: M7 Enter on a no-ID object cell steps in',
                requiresGrid: 'grid',
                selector: '[role="grid"]',
                includes: ['Nested browse-only result'],
                excludes: ['Browse only'],
                waitForText: true,
                steps: [
                    { action: 'focus', role: 'gridcell', name: '{...}' },
                    { action: 'press', key: 'Enter' },
                ],
            },
            {
                kind: 'focused',
                name: 'TDD: M7 keyboard step-in focuses a no-ID row',
                requiresGrid: 'grid',
                target: {
                    selector:
                        '[role="grid"] [role="row"][aria-rowindex="2"] [role="gridcell"][aria-colindex="1"]',
                },
            },
        ]);
    });

    it('pins Enter tree activation without weakening the hierarchy or array viewport contract', (): void => {
        const tree: readonly ScenarioAssertion[] = collectionViewContracts['deep-nesting'];
        expect(tree).toContainEqual(
            expect.objectContaining({
                kind: 'attribute',
                name: 'TDD: M5 Enter expands a focused root',
                attribute: 'aria-expanded',
                expected: 'true',
                steps: [
                    { action: 'press', key: 'ArrowLeft' },
                    { action: 'press', key: 'Enter' },
                ],
            }),
        );
        expect(tree).toContainEqual(
            expect.objectContaining({
                kind: 'focused',
                name: 'TDD: M5 Up visits the previous visible sibling rather than a direct parent shortcut',
                steps: [{ action: 'press', key: 'ArrowUp' }],
            }),
        );
        expect(tree).toContainEqual(
            expect.objectContaining({
                kind: 'text',
                selector: '[role="treegrid"] [role="row"][aria-level="6"]',
                includes: ['latitude'],
            }),
        );
        expect(collectionViewContracts.arrays).toContainEqual(
            expect.objectContaining({
                kind: 'text',
                name: 'TDD: M4 arrays of ten expand from the keyboard',
                selector: '[role="treegrid"]',
                includes: ['ten[0]'],
                excludes: ['eleven\\[0\\]'],
                steps: [
                    { action: 'focus', role: 'gridcell', name: 'ten' },
                    { action: 'press', key: 'Enter' },
                ],
            }),
        );
        expect(collectionViewContracts.arrays).toContainEqual(
            expect.objectContaining({
                kind: 'text',
                name: 'TDD: M4 keyboard scrolling reaches the last child of an array of ten',
                selector: '[role="treegrid"]',
                includes: ['ten[9]'],
                excludes: ['eleven\\[0\\]'],
                waitForText: true,
                steps: [{ action: 'press', key: 'Control+End' }],
            }),
        );
        expect(collectionViewContracts.arrays).toContainEqual(
            expect.objectContaining({
                kind: 'text',
                name: 'TDD: M4 the top viewport is mounted before comparing over-ten array text',
                requiresGrid: 'treegrid',
                selector: '[role="treegrid"]',
                includes: ['"arrays-root"', '(elements: 11)'],
                excludes: ['eleven\\[0\\]'],
                waitForText: true,
            }),
        );
        expect(collectionViewContracts.arrays).toContainEqual(
            expect.objectContaining({
                kind: 'stableText',
                name: 'TDD: M4 arrays over ten do not gain children',
                steps: [
                    { action: 'focus', role: 'gridcell', name: 'eleven' },
                    { action: 'press', key: 'Enter' },
                ],
            }),
        );
    });

    it('pins symmetric grid traversal, explicit Escape exit and focus-only outlines in both grids', (): void => {
        for (const [scenario, id, role] of [
            ['heterogeneous', 'M6', 'grid'],
            ['deep-nesting', 'M5', 'treegrid'],
            ['page-500', 'M6', 'grid'],
        ] as const) {
            const navigation: readonly ScenarioAssertion[] = collectionViewContracts[scenario];
            expect(navigation).toContainEqual(
                expect.objectContaining({
                    kind: 'focused',
                    name: `TDD: ${id} Shift+Tab crosses the same data row boundary backwards`,
                    requiresGrid: role,
                    steps: [{ action: 'press', key: 'Shift+Tab' }],
                }),
            );
            expect(navigation).toContainEqual(
                expect.objectContaining({
                    kind: 'focused',
                    name: `TDD: ${id} Escape focuses the existing view picker`,
                    target: { selector: '.collectionDocumentViewSwitcher [role="combobox"]' },
                    steps: [{ action: 'press', key: 'Escape' }],
                }),
            );
            expect(navigation).toContainEqual(
                expect.objectContaining({
                    kind: 'style',
                    name: `TDD: ${id} the remembered cell has no focus outline after Escape`,
                    property: 'outline-style',
                    expected: 'none',
                }),
            );
            expect(navigation).toContainEqual(
                expect.objectContaining({
                    kind: 'focused',
                    name: `TDD: ${id} Tab leaves at the last cell`,
                    steps: [
                        { action: 'press', key: 'Control+End' },
                        { action: 'press', key: 'Tab' },
                    ],
                }),
            );
        }
    });

    it('pins theme outcomes and honest virtualization evidence in every palette', (): void => {
        const colors = {
            dark: ['rgb(31, 31, 31)', 'rgb(204, 204, 204)'],
            light: ['rgb(255, 255, 255)', 'rgb(59, 59, 59)'],
            'high-contrast': ['rgb(0, 0, 0)', 'rgb(255, 255, 255)'],
        };
        for (const route of scenarioRoutes().filter(
            (route): boolean => route.view === 'collectionView' && route.scenario === 'mixed-types',
        )) {
            expect(
                findScenario(route)
                    .assertions?.filter((assertion): boolean => assertion.kind === 'style')
                    .map((assertion): string => (assertion.kind === 'style' ? assertion.expected : '')),
            ).toEqual(colors[route.theme]);
        }
        expect(collectionViewContracts['page-500']).toContainEqual(
            expect.objectContaining({
                kind: 'countAtMost',
                selector: '[role="grid"] [role="row"]',
                max: 100,
            }),
        );
        expect(collectionViewContracts['page-500']).toContainEqual(
            expect.objectContaining({
                kind: 'text',
                includes: ['page-499'],
                steps: [
                    { action: 'focus', role: 'columnheader', name: '_id' },
                    { action: 'press', key: 'ArrowDown' },
                    { action: 'press', key: 'Control+End' },
                ],
            }),
        );
    });

    it('pins only the accepted paging choices and loading-to-results workflow', (): void => {
        const paging: readonly ScenarioAssertion[] = collectionViewContracts.paging;
        expect(
            paging.flatMap((assertion): readonly string[] =>
                'steps' in assertion
                    ? (assertion.steps ?? []).flatMap((step): string[] =>
                          step.action === 'click' && step.role === 'option' ? [step.name] : [],
                      )
                    : [],
            ),
        ).toEqual(['50', '100', '500', '10', 'Tree View', 'Table View']);
        expect(
            collectionViewFixtures['loading-to-results'].rpc['mongoClusters.collectionView.runFindQuery'],
        ).toMatchObject({
            hold: 'initial-results',
            results: [{ documentCount: 3 }],
        });
        expect(collectionViewContracts['loading-to-results']).toContainEqual(
            expect.objectContaining({
                kind: 'text',
                requiresGrid: 'grid',
                includes: ['Alpha', 'Beta'],
            }),
        );
        expect(collectionViewContracts.empty).toContainEqual(
            expect.objectContaining({
                kind: 'text',
                selector: '.collectionView [role="status"][aria-live="assertive"]',
                includes: ['No results found'],
            }),
        );
        expect(collectionViewContracts.empty).toContainEqual(
            expect.objectContaining({
                kind: 'attribute',
                requiresGrid: 'grid',
                attribute: 'aria-rowcount',
                expected: '1',
            }),
        );
        expect(collectionViewContracts.empty).toContainEqual(
            expect.objectContaining({
                kind: 'countAtMost',
                requiresGrid: 'grid',
                selector: '[role="grid"] [role="row"] [role="gridcell"]',
                max: 0,
            }),
        );
    });
});

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
        expect(routes).toHaveLength(222);
        expect(new Set(routes.map((route): string => route.path)).size).toBe(222);
        for (const route of routes) expect(parseScenarioRoute(route.path)).toEqual(route);
    });

    it('provides the Collection View fixture presets and contracts in every theme', (): void => {
        const expected = [
            'mixed-types',
            'missing-vs-null',
            'heterogeneous',
            'deep-nesting',
            'arrays',
            'page-500',
            'html-values',
            'empty',
            'no-id',
            'first-load',
            'step-in',
            'selection',
            'identity',
            'late-delete',
            'late-query',
            'loading-to-results',
            'paging',
        ];
        expect(Object.keys(collectionViewFixtures)).toEqual(expected);
        for (const name of expected) {
            expect(
                scenarioRoutes()
                    .filter((route): boolean => route.view === 'collectionView' && route.scenario === name)
                    .map((route) => route.theme),
            ).toEqual(['dark', 'light', 'high-contrast']);
            expect(scenarios.collectionView[name as keyof typeof scenarios.collectionView].readiness.content).toEqual([
                'Documents',
                ...(name === 'empty' ? ['No results found'] : []),
            ]);
            expect(
                scenarios.collectionView[name as keyof typeof scenarios.collectionView].readiness.selectors,
            ).not.toContainEqual(expect.stringMatching(/row|gridcell/i));
        }
    });

    it('provides exactly 500 distinct physical Collection View fixture rows', (): void => {
        const page = collectionViewFixtures['page-500'].tablePage;
        expect(page.rows).toHaveLength(500);
        expect(new Set(page.rows.map((row) => row.rowKey)).size).toBe(500);
        expect(collectionViewFixtures['page-500'].config.defaultPageSize).toBe(500);
    });

    it('keeps browse-only Collection View rows distinct from ordinary action targets', (): void => {
        const page = collectionViewFixtures['no-id'].tablePage;
        expect(page.rows[0]).toMatchObject({ rowKey: 'pos:0' });
        expect(page.rows[0]).not.toHaveProperty('documentId');
        expect(page.rows[1]).toMatchObject({
            rowKey: 'id:"ordinary-target"',
            documentId: '"ordinary-target"',
        });
    });

    it('keeps the first-load query pending and readiness shell-based', (): void => {
        const scenario = scenarios.collectionView['first-load'];
        expect(scenario.rpc['mongoClusters.collectionView.runFindQuery']).toEqual({
            type: 'query',
            results: [],
            keepOpen: true,
        });
        expect(scenario.readiness).toMatchObject({
            selectors: ['.collectionView', '.monaco-editor'],
            noProgressbar: false,
        });
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
        expect(runnerRoutes('/scenarios/run-all.js')).toHaveLength(222);
        expect(runnerRoutes('/scenarios/run-all/connectionDiagnostics.js')).toHaveLength(84);
        expect(runnerRoutes('/scenarios/run-all/localQuickStart.js')).toHaveLength(75);
        expect(runnerRoutes('/scenarios/run-all/localQuickStart/dark.js')).toHaveLength(25);
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
            const scenario: Scenario<'localQuickStart'> = scenarios.localQuickStart[name];
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
                input: { preferredEngine: 'podman', expectedAction: 'startPodmanMachine' },
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
                input: { id: 'linuxStartPodmanSocket' },
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
        expect(scenario.assertions).toContainEqual(
            expect.objectContaining({
                kind: 'calls',
                path: 'localQuickStart.startQuickStart',
                input: { preferredEngine: 'podman', port: 10260 },
                count: 1,
                steps: [
                    { action: 'click', role: 'button', name: 'Start DocumentDB Local' },
                    { action: 'click', role: 'button', name: 'Cancel' },
                ],
            }),
        );
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
            expect(scenario.readiness.content).toEqual(['Ready to set up', 'Continue setup', 'Podman CLI 6.0.2 found']);
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
