/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type WebviewName } from '../../../src/webviews/_integration/WebviewRegistry';
import { type FixtureAtPath, type FixtureInputs, type FixtureOutputs, type FixturePaths, type TypedRpcFixtures } from './core/fixtures';
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

const continueSteps = [{ action: 'click', role: 'button', name: 'Continue' }] as const satisfies readonly ScenarioStep[];
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
        config: fixture.config, rpc: fixture.rpc,
        readiness: { content: fixture.content, selectors: fixture.styles.map((style): string => style.selector), noProgressbar: true },
        steps,
        assertions: fixture.styles.map((style): ScenarioAssertion => ({ kind: 'style', ...style })),
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
    outcome: 'diagnosed', environment: 'windows', endpointKind: 'namedPipe', endpointSource: 'platformDefault',
    provider: 'unknown', providerEvidence: 'none', executionTarget: 'local', failureKind: 'cliMissing',
    checkedAtMs: 1791199200000, cliInstalled: false, arch: 'x64', platformSupported: true,
    canContinueAnyway: false, daemonReachable: false,
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
                results: [{ stage: 'checking', status: 'error', message: { key: 'dockerCliMissing' }, dockerReadiness: readiness }],
            },
            'common.openUrl': { type: 'mutation', results: [true] },
        } as const satisfies TypedRpcFixtures,
        steps: setupSteps,
        readiness: { content: ['Docker CLI not found', label], selectors: ['[role="button"], button'], noProgressbar: true },
        assertions: [{
            kind: 'calls', name: `${label} opens the platform install guide exactly once`,
            path: 'common.openUrl', input: { url }, count: 1,
            steps: [{ action: 'click', role: 'button', name: label }],
        }],
    };
}

export const scenarios = {
    collectionView: { default: defaultScenario('collectionView') },
    documentView: { default: defaultScenario('documentView') },
    clusterDashboard: { default: defaultScenario('clusterDashboard') },
    atlasCredentials: { default: defaultScenario('atlasCredentials', atlasSteps) },
    localQuickStart: {
        default: defaultScenario('localQuickStart', continueSteps),
        introduction: {
            config: base.config, rpc: base.rpc,
            readiness: { content: ['Develop and test locally', 'Continue'], selectors: ['h2'], noProgressbar: true },
        },
        configure: {
            config: base.config, rpc: base.rpc, steps: continueSteps,
            readiness: { content: ['Configure setup', '10260', 'Start DocumentDB Local'], selectors: ['table'], noProgressbar: true },
        },
        provisioning: {
            config: base.config,
            rpc: {
                ...base.rpc,
                'localQuickStart.startQuickStart': {
                    type: 'subscription', results: [{ stage: 'checking', status: 'done' }, { stage: 'pulling', status: 'active' }],
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
                'localQuickStart.startQuickStart': { type: 'subscription', results: [
                    ...completedStages, { stage: 'waiting', status: 'done' },
                    { stage: 'done', status: 'done', message: { key: 'instanceRunning', port: 10260 }, boundPort: 10260 },
                ] },
            },
            steps: setupSteps,
            readiness: { content: ['DocumentDB Local is ready', 'All set', 'Open Connection'], selectors: ['h2'], noProgressbar: true },
        },
        'failed-port-in-use': {
            config: base.config,
            rpc: {
                ...base.rpc,
                'localQuickStart.startQuickStart': { type: 'subscription', results: [
                    { stage: 'checking', status: 'error', message: { key: 'portInUse', port: 10260 } },
                ] },
            },
            steps: setupSteps,
            readiness: { content: ['Port 10260 is already in use.', 'Retry setup'], noProgressbar: true },
        },
        'failed-timeout': {
            config: base.config,
            rpc: {
                ...base.rpc,
                'localQuickStart.startQuickStart': { type: 'subscription', results: [
                    ...completedStages,
                    { stage: 'waiting', status: 'error', message: { key: 'readinessTimeout' }, timedOut: true },
                ] },
            },
            steps: setupSteps,
            readiness: { content: ['DocumentDB did not accept connections in time.', 'Wait longer', 'Start over'], noProgressbar: true },
        },
        'docker-missing-windows': dockerMissing(missingReadiness, 'Get Docker Desktop for Windows',
            'https://docs.docker.com/desktop/setup/install/windows-install/'),
        'docker-missing-mac': dockerMissing({ ...missingReadiness, environment: 'macos', endpointKind: 'unixSocket' },
            'Get Docker Desktop for Mac', 'https://docs.docker.com/desktop/setup/install/mac-install/'),
        'docker-missing-linux': dockerMissing({ ...missingReadiness, environment: 'linux', endpointKind: 'unixSocket' },
            'Open Docker install guide', 'https://docs.docker.com/engine/install/'),
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
            themes.map((theme): ScenarioRoute => ({ view: view as WebviewName, scenario, theme, path: `/${view}/${scenario}/${theme}` }))));
}

export function findScenario(route: ScenarioRoute): Scenario {
    const entries: Readonly<Record<string, Scenario>> = scenarios[route.view];
    const scenario = entries[route.scenario];
    if (!scenario) {
        throw new Error(`Unknown scenario: ${route.path}`);
    }
    return scenario;
}
