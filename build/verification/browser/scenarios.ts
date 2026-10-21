/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type WebviewName } from '../../../src/webviews/_integration/WebviewRegistry';
import {
    type FixtureAtPath,
    type FixtureInputs,
    type FixtureOutputs,
    type FixturePaths,
    type TypedRpcFixtures,
} from './core/fixtures';
import { previewAvailableModels } from '../../../src/webviews/documentdb/queryInsightsShared/designPreview/mockModels';
import { fixtures, type StyleExpectation } from './fixtures';

export interface ScenarioReadiness {
    readonly content: readonly string[];
    readonly selectors?: readonly string[];
    readonly noProgressbar: boolean;
}

export type ScenarioStep =
    | { readonly action: 'click'; readonly role: 'button' | 'link'; readonly name: string }
    | { readonly action: 'fill'; readonly role: 'textbox'; readonly name: string; readonly value: string };

type CallAssertion = {
    [P in FixturePaths]: {
        readonly kind: 'calls';
        readonly name: string;
        readonly path: P;
        readonly input: FixtureAtPath<FixtureInputs, P>;
        readonly count: number;
        readonly steps: readonly ScenarioStep[];
    };
}[FixturePaths];

export type ScenarioAssertion = CallAssertion | ({ readonly kind: 'style' } & StyleExpectation);

export interface Scenario<V extends WebviewName = WebviewName> {
    readonly config: (typeof fixtures)[V]['config'];
    readonly rpc: TypedRpcFixtures;
    readonly readiness: ScenarioReadiness;
    readonly steps?: readonly ScenarioStep[];
    readonly assertions?: readonly ScenarioAssertion[];
}

type ScenarioTable = { readonly [V in WebviewName]: Readonly<Record<string, Scenario<V>>> };
type QuickStartOutputs = FixtureOutputs['localQuickStart'];

const continueSteps = [
    { action: 'click', role: 'button', name: 'Continue' },
] as const satisfies readonly ScenarioStep[];
const setupSteps = [
    ...continueSteps,
    { action: 'click', role: 'button', name: 'Start DocumentDB Local' },
] as const satisfies readonly ScenarioStep[];
const atlasSteps = [
    { action: 'fill', role: 'textbox', name: 'Public Key', value: 'stage0-public-key' },
    { action: 'fill', role: 'textbox', name: 'Private Key', value: 'stage0-private-key' },
    { action: 'click', role: 'button', name: 'Verify & Save' },
] as const satisfies readonly ScenarioStep[];

function defaultScenario<V extends WebviewName>(view: V, steps: readonly ScenarioStep[] = []): Scenario<V> {
    const fixture = fixtures[view];
    return {
        config: fixture.config,
        rpc: fixture.rpc,
        readiness: {
            content: fixture.content,
            selectors: fixture.styles.map((style): string => style.selector),
            noProgressbar: true,
        },
        steps,
        assertions: fixture.styles.map((style): ScenarioAssertion => ({ kind: 'style', ...style })),
    };
}

const explorerBase = fixtures.queryInsightsStandalone;
const explorerSteps = [
    { action: 'click', role: 'button', name: 'Continue' },
    { action: 'click', role: 'button', name: 'Analyze query' },
] as const satisfies readonly ScenarioStep[];
const explorerStage2 = explorerBase.rpc['queryInsightsStandalone.getStage2'].results[0];
const explorerInspection = explorerBase.rpc['queryInsightsStandalone.inspectInput'].results[0];
type ExplorerInspection = FixtureOutputs['queryInsightsStandalone']['inspectInput'];
const explorerAnalysisInput = {
    explain: explorerBase.config.explain ?? '', query: '{}', commandType: 'find', collectionStats: '', indexes: '',
    databaseName: 'demo', collectionName: 'items', clusterType: 'azure-documentdb', modelId: 'copilot-utility',
} as const;

function explorerConfigure(
    inspection: ExplorerInspection,
    content: readonly string[],
    extra: { config?: Partial<typeof explorerBase.config>; steps?: readonly ScenarioStep[] } = {},
): Scenario<'queryInsightsStandalone'> {
    return {
        config: { ...explorerBase.config, ...extra.config },
        rpc: { ...explorerBase.rpc, 'queryInsightsStandalone.inspectInput': { type: 'query', results: [inspection] } },
        steps: [{ action: 'click', role: 'button', name: 'Continue' }, ...(extra.steps ?? [])],
        readiness: { content, selectors: ['.monaco-editor .view-lines'], noProgressbar: true },
    };
}

function explorerProfile(profile: 'aggregate' | 'count'): Scenario<'queryInsightsStandalone'> {
    const isCount = profile === 'count';
    const commandType = profile as FixtureOutputs['queryInsightsStandalone']['validateInput']['commandType'];
    const stage2: FixtureOutputs['queryInsightsStandalone']['getStage2'] = {
        ...explorerStage2,
        analysisProfile: profile, documentsReturned: isCount ? 80 : 35,
        totalDocsExamined: isCount ? 0 : 100, totalKeysExamined: isCount ? 80 : 0,
        notApplicable: isCount ? ['selectivity', 'fetchOverhead', 'inMemorySort', 'examinedToReturnedRatio'] : ['inMemorySort'],
        analysisNotes: isCount ? [] : ['Only the initial cursor stage ($match/$sort) is analyzed; later pipeline stages ($group, $sort) are not rated.'],
        efficiencyAnalysis: {
            ...explorerStage2.efficiencyAnalysis,
            selectivity: isCount ? null : 17.5,
            ...(isCount ? { indexUsed: 'status_1', performanceRating: { score: 'excellent' as const, diagnostics: [] } } : {}),
        },
        ...(isCount ? {
            executionStrategy: 'Index-only count', indexUsed: true, usedIndexNames: ['status_1'],
            hadCollectionScan: false, isCoveringQuery: true, keysToDocsRatio: null,
            stages: [{ stage: 'COUNT', name: 'Count', nReturned: 0 }, { stage: 'COUNT_SCAN', name: 'Index count scan', nReturned: 80 }],
        } : {}),
    };
    const initial = explorerBase.rpc['queryInsightsStandalone.getStage1'].results[0];
    const stage1: FixtureOutputs['queryInsightsStandalone']['getStage1'] = isCount ? {
        ...initial, stages: stage2.stages,
        efficiencyAnalysis: { executionStrategy: 'Index-only count', indexUsed: 'status_1', hasInMemorySort: false },
    } : initial;
    const cursor = {
        queryPlanner: { winningPlan: { stage: 'COLLSCAN' }, parsedQuery: { status: 'active' } },
        executionStats: { executionTimeMillis: 12, nReturned: 35, totalDocsExamined: 100, totalKeysExamined: 0,
            executionStages: { stage: 'COLLSCAN', nReturned: 35, docsExamined: 100 } },
    };
    const explain = isCount ? {
        queryPlanner: { winningPlan: { stage: 'COUNT', inputStage: { stage: 'COUNT_SCAN', indexName: 'status_1' } } },
        executionStats: { executionTimeMillis: 12, nReturned: 0, totalDocsExamined: 0, totalKeysExamined: 80,
            executionStages: { stage: 'COUNT', nCounted: 80, inputStage: { stage: 'COUNT_SCAN', indexName: 'status_1' } } },
        command: { count: 'items', query: { status: 'active' } },
    } : { stages: [{ $cursor: cursor }, { $group: { _id: '$status' }, nReturned: 1 }, { $sort: { _id: 1 }, nReturned: 1 }] };
    return {
        config: { ...explorerBase.config, explain: JSON.stringify(explain), commandType: profile },
        rpc: {
            ...explorerBase.rpc,
            'queryInsightsStandalone.inspectInput': { type: 'query', results: [{
                ...explorerInspection,
                explain: { ok: true, detectedCommandType: commandType, databaseName: 'shop', collectionName: 'items',
                    planStages: isCount ? ['COUNT_SCAN', 'COUNT'] : ['COLLSCAN', '$group', '$sort'] },
                commandType, query: isCount ? '{}' : '[]',
            }] },
            'queryInsightsStandalone.getStage2': { type: 'query', results: [stage2] },
            'queryInsightsStandalone.getStage1': { type: 'query', results: [stage1] },
        },
        steps: explorerSteps,
        readiness: {
            content: ['Feature preview', 'Preview · tuned for find queries', 'Query Plan Summary', 'Copy command',
                isCount ? 'Documents counted' : 'Documents passed to pipeline',
                isCount ? 'Not applicable' : 'Not rated for pipeline $sort'],
            selectors: ['.leftColumn', '.rightColumn'], noProgressbar: true,
        },
    };
}

const base = fixtures.localQuickStart;
const readyDocker = base.rpc['localQuickStart.getDockerStatus'].results[0];
const completedStages = [
    { stage: 'checking', status: 'done' },
    { stage: 'pulling', status: 'done' },
    { stage: 'creating', status: 'done' },
    { stage: 'starting', status: 'done' },
] as const;

const missingReadiness = {
    outcome: 'diagnosed',
    environment: 'windows',
    endpointKind: 'namedPipe',
    endpointSource: 'platformDefault',
    provider: 'unknown',
    providerEvidence: 'none',
    executionTarget: 'local',
    failureKind: 'cliMissing',
    checkedAtMs: 1791199200000,
    cliInstalled: false,
    arch: 'x64',
    platformSupported: true,
    canContinueAnyway: false,
    daemonReachable: false,
} as const satisfies QuickStartOutputs['getDockerStatus']['readiness'];

function dockerMissing(
    readiness: QuickStartOutputs['getDockerStatus']['readiness'],
    label: string,
    url: string,
): Scenario<'localQuickStart'> {
    return {
        config: base.config,
        rpc: {
            ...base.rpc,
            'localQuickStart.getDockerStatus': { type: 'query', results: [{ ...readyDocker, readiness }] },
            'localQuickStart.startQuickStart': {
                type: 'subscription',
                results: [
                    {
                        stage: 'checking',
                        status: 'error',
                        message: { key: 'dockerCliMissing' },
                        dockerReadiness: readiness,
                    },
                ],
            },
            'common.openUrl': { type: 'mutation', results: [true] },
        } as const satisfies TypedRpcFixtures,
        steps: setupSteps,
        readiness: {
            content: ['Docker CLI not found', label],
            selectors: ['[role="button"], button'],
            noProgressbar: true,
        },
        assertions: [
            {
                kind: 'calls',
                name: `${label} opens the platform install guide exactly once`,
                path: 'common.openUrl',
                input: { url },
                count: 1,
                steps: [{ action: 'click', role: 'button', name: label }],
            },
        ],
    };
}

export const scenarios = {
    queryInsightsStandalone: {
        default: {
            ...defaultScenario('queryInsightsStandalone'),
            assertions: [
                ...(defaultScenario('queryInsightsStandalone').assertions ?? []),
                {
                    kind: 'calls', name: 'Welcome snippets copy through the shared clipboard RPC',
                    path: 'common.copyToClipboard', count: 1,
                    input: { text: 'db.orders.explain("executionStats").count({ status: "pending" })' },
                    steps: [{ action: 'click', role: 'button', name: 'Copy the count command' }],
                },
            ],
        },
        configure: explorerConfigure(explorerInspection, [
            'Provide your query data', 'Explain plan parsed.', 'Extracted query', 'Optional context',
            'Not provided', 'demo.items', 'Copilot utility', 'Built-in prompt',
            'No additional cost for most GitHub Copilot subscribers.', 'Analyze query sends your inputs to Copilot utility.',
        ]),
        'configure-models': {
            // Opens the details popover, so its facts are part of the readiness text.
            ...explorerConfigure(explorerInspection, [
                'GPT Example', 'The selected model may use premium requests.', 'Default: first Powerful model',
                'Very high cost', 'Credits per 1M tokens', 'Long context', '921,793 tokens', 'gpt-example',
            ], { steps: [{ action: 'click', role: 'button', name: 'Model details' }] }),
            rpc: {
                ...explorerConfigure(explorerInspection, []).rpc,
                'ai.getAvailableModels': {
                    type: 'query',
                    results: [{
                        models: [
                            {
                                id: 'copilot-utility', name: 'Copilot utility', family: 'copilot-utility', vendor: 'copilot',
                                version: '1', maxInputTokens: 64000, isUtility: true, pricing: 'Free', priceCategory: 'low',
                                category: 'lightweight', inputCost: 0, outputCost: 0, cacheCost: 0,
                            },
                            {
                                id: 'gpt-example', name: 'GPT Example', family: 'gpt-example', vendor: 'copilot',
                                version: 'gpt-example', maxInputTokens: 921793, isUtility: false, pricing: '1x',
                                priceCategory: 'very_high', category: 'powerful',
                                inputCost: 800, outputCost: 4000, cacheCost: 80, cacheWriteCost: 1000,
                                longContextInputCost: 1600, longContextOutputCost: 6000,
                                longContextCacheCost: 160, longContextCacheWriteCost: 2000,
                                supportsToolCalling: true, supportsImageToText: true,
                            },
                            {
                                id: 'unpriced', name: 'Unpriced model', family: 'unpriced', vendor: 'copilot',
                                version: '1', maxInputTokens: 200000, isUtility: false, category: 'versatile',
                            },
                            // Enough models that the listbox must scroll within the webview.
                            ...Array.from({ length: 14 }, (_, index) => ({
                                id: `example-${index + 1}`, name: `Example model ${index + 1}`, family: `example-${index + 1}`,
                                vendor: 'copilot', version: '1', maxInputTokens: 128000, isUtility: false,
                                category: ['powerful', 'versatile', 'lightweight'][index % 3],
                                priceCategory: ['low', 'medium', 'high'][index % 3],
                            })),
                        ],
                        savedModelId: null, effectiveModelId: 'gpt-example', effectiveReason: 'first-powerful',
                    }],
                },
            },
        },
        // Dev-only design comparison for the Collection View tab's AI card (not a wizard state).
        'tab-model-options': {
            config: { ...explorerBase.config, designPreview: 'tab-model-selection' },
            rpc: {
                ...explorerBase.rpc,
                'ai.getAvailableModels': { type: 'query', results: [previewAvailableModels] },
                'ai.setSelectedModel': {
                    type: 'mutation',
                    results: [{
                        ...previewAvailableModels,
                        savedModelId: 'copilot-utility', effectiveModelId: 'copilot-utility', effectiveReason: 'saved',
                    }],
                },
            },
            readiness: {
                content: [
                    'Option A — Model pill in the actions row', 'Option B — Split button',
                    'Option C — Settings footer strip', 'Option D — Native VS Code quick pick',
                    'Option E — Header chip with a settings popover', 'Live comparison — six real cards',
                    'A — Model label, Change button and info', 'B — Outline CompoundButton',
                    'C — Outline button with model name', 'D — Dropdown: outline',
                    'E — Dropdown: filled-darker', 'F — Dropdown: underline',
                    'Built-in prompt',
                ],
                noProgressbar: true,
            },
        },
        'configure-invalid': explorerConfigure(
            { explain: { ok: false, message: 'Unexpected token', line: 3, column: 7 }, ready: false },
            ['Line 3, column 7: Unexpected token', 'Fix the explain plan to continue.'],
            { config: { explain: '{\n  "executionStats": {\n    !!bad\n  }\n}' } },
        ),
        'configure-context': explorerConfigure(
            {
                ...explorerInspection,
                collectionStats: { ok: true, documentCount: 48210 },
                indexes: { ok: true, names: ['_id_', 'status_1'] },
            },
            ['Provided · 48,210 documents', 'Provided · 2 indexes', '_id_, status_1', 'getIndexes()'],
            {
                config: { collectionStats: '{"count":48210}', indexes: '[{"name":"_id_"},{"name":"status_1"}]' },
                steps: [{ action: 'click', role: 'button', name: 'Edit indexes' }],
            },
        ),
        analyze: {
            ...defaultScenario('queryInsightsStandalone'),
            steps: explorerSteps,
            readiness: {
                content: ['Feature preview', 'Query Efficiency Analysis', 'Query Performance Analysis', 'Consider indexing the filter.',
                    'Copy command', 'Reconfigure', 'demo.items', 'Prompt: built-in', '0 credits', '1,200 in / 350 out tokens'],
                selectors: ['.leftColumn', '.rightColumn'], noProgressbar: true,
            },
            assertions: [{
                kind: 'calls', name: 'Explorer recommendations are copy-only',
                path: 'common.copyToClipboard', input: { text: 'db.items.createIndex({status: 1})' }, count: 1,
                steps: [{ action: 'click', role: 'button', name: 'Copy command' }],
            }, {
                kind: 'calls', name: 'Raw explain uses the connectionless router',
                path: 'queryInsightsStandalone.openRawExplain', count: 1,
                input: explorerAnalysisInput,
                steps: [{ action: 'click', role: 'button', name: 'View Raw Execution Stats' }],
            }, {
                kind: 'calls', name: 'Reconfigure preserves inputs for another analysis',
                path: 'queryInsightsStandalone.getStage2', count: 2,
                input: explorerAnalysisInput,
                steps: [
                    { action: 'click', role: 'button', name: 'Reconfigure' },
                    { action: 'click', role: 'button', name: 'Analyze query' },
                ],
            }, {
                // Wait for the new recommendation so readiness checks finished content.
                kind: 'calls', name: 'Reconfigured analysis streams recommendations again',
                path: 'common.copyToClipboard', input: { text: 'db.items.createIndex({status: 1})' }, count: 2,
                steps: [{ action: 'click', role: 'button', name: 'Copy command' }],
            }],
        },
        'analyze-aggregate': explorerProfile('aggregate'),
        'analyze-count': explorerProfile('count'),
    },
    collectionView: { default: defaultScenario('collectionView') },
    documentView: { default: defaultScenario('documentView') },
    clusterDashboard: { default: defaultScenario('clusterDashboard') },
    atlasCredentials: { default: defaultScenario('atlasCredentials', atlasSteps) },
    localQuickStart: {
        default: defaultScenario('localQuickStart', continueSteps),
        introduction: {
            config: base.config,
            rpc: base.rpc,
            readiness: { content: ['Develop and test locally', 'Continue'], selectors: ['h2'], noProgressbar: true },
        },
        configure: {
            config: base.config,
            rpc: {
                ...base.rpc,
                'common.openUrl': { type: 'mutation', results: [true] },
            } as const satisfies TypedRpcFixtures,
            steps: continueSteps,
            readiness: {
                content: ['Configure setup', '10260', 'Start DocumentDB Local'],
                selectors: ['table'],
                noProgressbar: true,
            },
            assertions: [
                {
                    kind: 'calls',
                    name: 'The privacy statement link opens the DocumentDB Local privacy statement',
                    path: 'common.openUrl',
                    input: { url: 'https://github.com/documentdb/documentdb/blob/main/documentdb-local/PRIVACY.md' },
                    count: 1,
                    steps: [{ action: 'click', role: 'button', name: 'Open DocumentDB Local privacy statement' }],
                },
            ],
        },
        provisioning: {
            config: base.config,
            rpc: {
                ...base.rpc,
                'localQuickStart.startQuickStart': {
                    type: 'subscription',
                    results: [
                        { stage: 'checking', status: 'done' },
                        { stage: 'pulling', status: 'active' },
                    ],
                    keepOpen: true,
                },
            },
            steps: setupSteps,
            readiness: {
                content: ['Setting up DocumentDB Local', 'Pulling official image', 'View setup log'],
                selectors: ['[aria-label="Setup progress"] [role="listitem"]:nth-child(2) .fui-Spinner'],
                noProgressbar: false,
            },
        },
        success: {
            config: base.config,
            rpc: {
                ...base.rpc,
                'localQuickStart.startQuickStart': {
                    type: 'subscription',
                    results: [
                        ...completedStages,
                        { stage: 'waiting', status: 'done' },
                        {
                            stage: 'done',
                            status: 'done',
                            message: { key: 'instanceRunning', port: 10260 },
                            boundPort: 10260,
                        },
                    ],
                },
            },
            steps: setupSteps,
            readiness: {
                content: ['DocumentDB Local is ready', 'All set', 'Open Connection'],
                selectors: ['h2'],
                noProgressbar: true,
            },
        },
        'failed-port-in-use': {
            config: base.config,
            rpc: {
                ...base.rpc,
                'localQuickStart.startQuickStart': {
                    type: 'subscription',
                    results: [{ stage: 'checking', status: 'error', message: { key: 'portInUse', port: 10260 } }],
                },
            },
            steps: setupSteps,
            readiness: { content: ['Port 10260 is already in use.', 'Retry setup'], noProgressbar: true },
        },
        'failed-timeout': {
            config: base.config,
            rpc: {
                ...base.rpc,
                'localQuickStart.startQuickStart': {
                    type: 'subscription',
                    results: [
                        ...completedStages,
                        { stage: 'waiting', status: 'error', message: { key: 'readinessTimeout' }, timedOut: true },
                    ],
                },
            },
            steps: setupSteps,
            readiness: {
                content: ['DocumentDB did not accept connections in time.', 'Wait longer', 'Start over'],
                noProgressbar: true,
            },
        },
        'docker-missing-windows': dockerMissing(
            missingReadiness,
            'Get Docker Desktop for Windows',
            'https://docs.docker.com/desktop/setup/install/windows-install/',
        ),
        'docker-missing-mac': dockerMissing(
            { ...missingReadiness, environment: 'macos', endpointKind: 'unixSocket' },
            'Get Docker Desktop for Mac',
            'https://docs.docker.com/desktop/setup/install/mac-install/',
        ),
        'docker-missing-linux': dockerMissing(
            { ...missingReadiness, environment: 'linux', endpointKind: 'unixSocket' },
            'Open Docker install guide',
            'https://docs.docker.com/engine/install/',
        ),
    },
} as const satisfies ScenarioTable;

export const themes = ['dark', 'light', 'high-contrast'] as const;
export type ScenarioTheme = (typeof themes)[number];

export interface ScenarioRoute {
    readonly view: WebviewName;
    readonly scenario: string;
    readonly theme: ScenarioTheme;
    readonly path: string;
}

export function scenarioRoutes(): ScenarioRoute[] {
    return Object.entries(scenarios).flatMap(([view, entries]): ScenarioRoute[] =>
        Object.keys(entries).flatMap((scenario): ScenarioRoute[] =>
            themes.map(
                (theme): ScenarioRoute => ({
                    view: view as WebviewName,
                    scenario,
                    theme,
                    path: `/${view}/${scenario}/${theme}`,
                }),
            ),
        ),
    );
}

export function findScenario(route: ScenarioRoute): Scenario {
    const entries: Readonly<Record<string, Scenario>> = scenarios[route.view];
    const scenario = entries[route.scenario];
    if (!scenario) {
        throw new Error(`Unknown scenario: ${route.path}`);
    }
    return scenario;
}
