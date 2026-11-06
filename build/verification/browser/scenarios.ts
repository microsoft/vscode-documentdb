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
import {
    diagnosticsCard,
    diagnosticsConnectedCard,
    diagnosticsConnectedRows,
    diagnosticsConnectedSummary,
    diagnosticsDetails,
    diagnosticsFinding,
    diagnosticsFullCoverage,
    diagnosticsHealthyDetails,
    diagnosticsHost,
    diagnosticsPendingRows,
    diagnosticsPrivateAccessHint,
    diagnosticsPrivateLinkAlias,
    diagnosticsPublicAliasExplanation,
    diagnosticsPublicAliasTitle,
    diagnosticsRowLabels,
    diagnosticsSrvTargets,
    diagnosticsStartedAt,
    fixtures,
    type DiagnosticsCard,
    type DiagnosticsFinding,
    type DiagnosticsRow,
    type DiagnosticsRunUpdate,
    type StyleExpectation,
} from './fixtures';

export interface ScenarioReadiness {
    readonly content: readonly string[];
    readonly selectors?: readonly string[];
    readonly noProgressbar: boolean;
}

export type ScenarioStep =
    | { readonly action: 'click'; readonly role: 'button' | 'link' | 'switch' | 'menuitem'; readonly name: string }
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

/** The elements matching `selector`, in document order, contain `texts` one to one and in order. */
interface OrderAssertion {
    readonly kind: 'order';
    readonly name: string;
    readonly selector: string;
    readonly texts: readonly string[];
}

/** `below` follows `above` in the document and starts at or under its bottom edge. */
interface BelowAssertion {
    readonly kind: 'below';
    readonly name: string;
    readonly above: string;
    readonly below: string;
}

/**
 * The whitespace-normalized text of the first element matching `selector` contains every `includes`
 * string and matches none of the `excludes` patterns (regular expression sources, case-insensitive).
 */
interface TextAssertion {
    readonly kind: 'text';
    readonly name: string;
    readonly selector: string;
    readonly includes: readonly string[];
    readonly excludes: readonly string[];
}

/**
 * Exactly `count` elements match `selector`, and their heights differ by at most `tolerance` px at the
 * page's current viewport width. Also records that width and the top offset of `list`.
 */
interface RowHeightsAssertion {
    readonly kind: 'rowHeights';
    readonly name: string;
    readonly list: string;
    readonly selector: string;
    readonly count: number;
    readonly tolerance: number;
}

/**
 * Every `inner` element inside each element matching `container` has its vertical centre within that
 * container's top and bottom edges, so a control reads as part of its own row. At least `minimum`
 * `inner` elements must exist across all containers. With `under`, a selector run against each
 * container (`:scope` works), every `inner` element also starts at or below the bottom of that
 * container's first match, for example a control that belongs on the line under a row's title.
 */
interface InsideAssertion {
    readonly kind: 'inside';
    readonly name: string;
    readonly container: string;
    readonly inner: string;
    readonly minimum: number;
    readonly under?: string;
}

/**
 * After `steps`, the first element matching `selector` has `attribute` equal to `expected`. `null`
 * expects no matching element, or one without the attribute.
 */
interface AttributeAssertion {
    readonly kind: 'attribute';
    readonly name: string;
    readonly selector: string;
    readonly attribute: string;
    readonly expected: string | null;
    readonly steps?: readonly ScenarioStep[];
}

/**
 * The whitespace-normalized text of the first element matching `selector` is the same after `steps` as
 * before them, for a control that must not change what the page shows.
 */
interface StableTextAssertion {
    readonly kind: 'stableText';
    readonly name: string;
    readonly selector: string;
    readonly steps: readonly ScenarioStep[];
}

/** The first element matching `selector` starts `top` px (rounded) below the top of the document. */
interface TopAssertion {
    readonly kind: 'top';
    readonly name: string;
    readonly selector: string;
    readonly top: number;
}

/**
 * Recorded from page load by the scenario runtime, for presentation paced over time: each selector in
 * `milestones` first matches an element in the given order, each at least `minimumGapMs` after the one
 * before, and the last at least `minimumSpanMs` after the first.
 */
interface SequenceAssertion {
    readonly kind: 'sequence';
    readonly name: string;
    readonly milestones: readonly string[];
    readonly minimumGapMs: number;
    readonly minimumSpanMs: number;
}

export type ScenarioAssertion =
    | CallAssertion
    | SequenceAssertion
    | ({ readonly kind: 'style' } & StyleExpectation)
    | OrderAssertion
    | BelowAssertion
    | TextAssertion
    | RowHeightsAssertion
    | TopAssertion
    | AttributeAssertion
    | InsideAssertion
    | StableTextAssertion;

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

const diagnostics = fixtures.connectionDiagnostics;

/** `id` values in `src/documentdb/auth/entraErrors/entraErrorRules.ts`; a test keeps the two in step. */
export const diagnosticsEntraRuleIds = [
    'firstPartyPreauthorization',
    'resourceNotInTenant',
    'invalidResource',
    'accountNotInTenant',
    'applicationNotInDirectory',
    'tenantNotFound',
    'crossCloudNotAllowed',
    'conditionalAccess',
    'additionalVerification',
    'brokerOpaque',
    'oidcHostNotAllowed',
    'unknownAadsts',
] as const;

/**
 * What the panel never shows (design 5.2): finding codes, AADSTS codes, URLs and Entra rule IDs; and
 * the names of Node.js's DNS libraries (decision 0041).
 */
export const diagnosticsForbiddenText = [
    '\\b(?:env|cs|srv|dns|tcp|tls|hello|auth|access|check|prepare)\\.[a-z][a-z]+\\b',
    'AADSTS',
    'http',
    `\\b(?:${diagnosticsEntraRuleIds.join('|')})\\b`,
    '\\bc[-_]?ares\\b',
    'getaddrinfo',
] as const;

const firewallSentence =
    'A firewall or IP allowlist may be blocking this connection. Check access from the computer or remote host where these checks ran, including VPN and network rules.';
const supportLine = 'Contacting support? Use Share report at the bottom of the page to copy or save the report.';
/** A successful connection's card when rows need attention (decision 0041, review R6). */
const attentionLine = 'The connection works, but these checks need attention:';
const detailsPointer = 'Select Details on a row to see why and what to do.';
/** What the card no longer repeats from the rows' Details (decision 0041). */
const serverFacts = ['Ping', '0.107.0', 'API 7'];
const reportIdentifiersShown =
    'The report will include host and identity details. Hide identifiers in the report. Review the report before sharing.';
const reportIdentifiersHidden =
    'The report will replace host and identity details with placeholders. Show identifiers in the report. Review the report before sharing.';
/** The share warning `common.confirm` shows before Copy or Save with identifiers (decision 0040). */
function shareWarning(confirmLabel: 'Copy report' | 'Save report'): {
    message: string;
    detail: string;
    confirmLabel: string;
    severity: 'warning';
} {
    return {
        message: 'This report includes host and identity details.',
        detail: 'Host names, addresses and the user name are not hidden. To hide them, cancel, select Hide identifiers in the report, and then share again.',
        confirmLabel,
        severity: 'warning',
    };
}

/**
 * Where the list starts, in px from the top of the document, in every connection diagnostics scenario. Only the
 * static header and connection section heading are above it, so neither the run's progress nor the
 * result card below may move it.
 */
export const diagnosticsListTop = 197;

/** A row's title: the first line of its text column (`StatusListItem`: icon, then text column). */
const diagnosticsRowTitle = ':scope > div > :first-child';

/** What holds for the header and the list in every connection diagnostics state, with or without a result card. */
const diagnosticsListLayout = [
    {
        kind: 'text',
        name: 'The wizard-style header names the task',
        selector: 'h1',
        includes: ['Connection Diagnostics'],
        excludes: [],
    },
    {
        kind: 'text',
        name: 'The header describes the task without the connection or live run status',
        selector: 'h1 + div',
        includes: ['Check a connection step by step and review the results.'],
        excludes: [literal(diagnostics.config.connectionName), 'Elapsed', 'Checked', 'cancelled'],
    },
    {
        kind: 'text',
        name: 'The content heading names the connection being checked',
        selector: 'main h2',
        includes: [diagnostics.config.connectionName],
        excludes: [],
    },
    {
        kind: 'below',
        name: 'The connection heading renders above the checks',
        above: 'main h2',
        below: '#connectivity-checks',
    },
    {
        kind: 'below',
        name: 'The header renders above the list',
        above: 'h1',
        below: '#connectivity-checks',
    },
    {
        kind: 'order',
        name: 'The eight row labels are present in order',
        selector: '#connectivity-checks [role="listitem"]',
        texts: diagnosticsRowLabels,
    },
    {
        kind: 'rowHeights',
        name: 'Pending, active, settled and skipped rows, with or without a collapsed Details toggle, are one height',
        list: '#connectivity-checks',
        selector: '#connectivity-checks [role="listitem"]',
        count: diagnosticsRowLabels.length,
        tolerance: 1,
    },
    {
        kind: 'top',
        name: 'The list starts at the same offset in every state',
        selector: '#connectivity-checks',
        top: diagnosticsListTop,
    },
    {
        kind: 'inside',
        name: 'Each Details toggle sits on its own row, on the evidence line under the row title',
        container: '#connectivity-checks [role="listitem"]',
        inner: 'button[aria-expanded]',
        minimum: 1,
        under: diagnosticsRowTitle,
    },
    {
        kind: 'text',
        name: 'No internal codes, DNS library name, absolute checked time or elapsed counter is rendered',
        selector: 'body',
        includes: [],
        excludes: [...diagnosticsForbiddenText, 'Elapsed', 'Checked at'],
    },
] as const satisfies readonly ScenarioAssertion[];

const diagnosticsLayout = [
    ...diagnosticsListLayout,
    {
        kind: 'below',
        name: 'The result card renders below the list',
        above: '#connectivity-checks',
        below: '#connectivity-result',
    },
] as const satisfies readonly ScenarioAssertion[];

const checkedStatus = {
    kind: 'text',
    name: 'The completed run uses relative last-checked wording',
    selector: 'main',
    includes: ['Checked '],
    excludes: [
        'Checked at',
        'Elapsed',
        'Checked (?!(?:a few seconds|less than a minute|1 minute|[0-9]+ minutes|1 hour|[0-9]+ hours) ago|on )',
    ],
} as const satisfies ScenarioAssertion;

function literal(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The card contains `includes` and none of `absent`, both plain text. */
function cardText(includes: readonly string[], absent: readonly string[] = []): ScenarioAssertion {
    return {
        kind: 'text',
        name: 'The result card says what happened and what to do next',
        selector: '#connectivity-result',
        includes,
        excludes: absent.map(literal),
    };
}

type DiagnosticsEnd =
    | {
          readonly type: 'finished';
          readonly result: DiagnosticsCard;
          readonly rows: DiagnosticsRow[];
          readonly coverage?: Extract<DiagnosticsRunUpdate, { type: 'finished' }>['coverage'];
      }
    | { readonly type: 'cancelled'; readonly shown: DiagnosticsRow[] };

function diagnosticsRun(runId: string, final: DiagnosticsEnd): DiagnosticsRunUpdate[] {
    const started: DiagnosticsRunUpdate = {
        type: 'started',
        runId,
        startedAt: diagnosticsStartedAt,
        rows: diagnosticsPendingRows,
    };
    if (final.type === 'cancelled') {
        return [started, { type: 'rows', runId, rows: final.shown }, { type: 'cancelled', runId, rows: final.shown }];
    }
    return [
        started,
        {
            type: 'finished',
            runId,
            finishedAt: diagnosticsStartedAt + 4000,
            rows: final.rows,
            outcome: final.result.outcome,
            result: final.result,
            coverage: final.coverage ?? diagnosticsFullCoverage,
        },
    ];
}

function withRows(replacements: DiagnosticsRow[]): DiagnosticsRow[] {
    return diagnosticsConnectedRows.map(
        (row): DiagnosticsRow => replacements.find((replacement): boolean => replacement.id === row.id) ?? row,
    );
}

/**
 * For a scenario whose `rows` have an evidence line too long to share one line with its Details toggle
 * (WI-19): the line wraps around the toggle like a word, so only the other rows must share one height.
 */
function withWrappedEvidence(
    scenario: Scenario<'connectionDiagnostics'>,
    rows: readonly DiagnosticsRow['id'][],
): Scenario<'connectionDiagnostics'> {
    return {
        ...scenario,
        assertions: (scenario.assertions ?? []).map(
            (assertion): ScenarioAssertion =>
                assertion.kind === 'rowHeights'
                    ? {
                          ...assertion,
                          name: `Rows other than ${rows.map(rowLabel).join(', ')} are one height; a long evidence line wraps around its Details toggle`,
                          selector: `${assertion.selector}${rows.map((id): string => `:not(#connectivity-checks-${id})`).join('')}`,
                          count: assertion.count - rows.length,
                      }
                    : assertion,
        ),
    };
}

function diagnosticsScenario(
    updates: DiagnosticsRunUpdate[],
    content: readonly string[],
    extra: Pick<Scenario<'connectionDiagnostics'>, 'steps' | 'assertions'> = {},
): Scenario<'connectionDiagnostics'> {
    return {
        config: diagnostics.config,
        rpc: { ...diagnostics.rpc, 'connectionDiagnostics.run': { type: 'subscription', results: updates } },
        steps: extra.steps,
        readiness: {
            content: [...diagnosticsRowLabels, ...content],
            selectors: ['#connectivity-result'],
            noProgressbar: true,
        },
        assertions: [
            ...diagnosticsLayout,
            ...(updates.at(-1)?.type === 'finished' ? [checkedStatus] : []),
            ...(extra.assertions ?? []),
        ],
    };
}

/** A finished run whose card must contain `card`; the readiness content waits for the evidence lines. */
function finishedScenario(
    runId: string,
    rows: DiagnosticsRow[],
    result: DiagnosticsCard,
    evidence: readonly string[],
    card: readonly string[],
    cardExcludes: readonly string[] = [],
): Scenario<'connectionDiagnostics'> {
    return diagnosticsScenario(diagnosticsRun(runId, { type: 'finished', result, rows }), [...evidence, ...card], {
        assertions: [cardText(card, cardExcludes)],
    });
}

const notChecked = (
    id: DiagnosticsRow['id'],
    becauseRow: DiagnosticsRow['id'],
    reason: 'dependencyFailed' | 'dependencySkipped' = 'dependencyFailed',
): DiagnosticsRow => ({ id, status: 'skipped', segments: [{ kind: 'notChecked', reason, becauseRow }] });
const notStartedInTime = (id: DiagnosticsRow['id']): DiagnosticsRow => ({
    id,
    status: 'skipped',
    segments: [{ kind: 'notChecked', reason: 'runTimeoutExceeded' }],
});
const dnsFailureRun = diagnosticsRun('stage0-run-dns', {
    type: 'finished',
    result: diagnosticsCard('failed', {
        stoppedAtRow: 'serverAddress',
        headline: {
            title: 'Host name not found',
            explanation: 'The system DNS resolver could not find this host name.',
            nextStep:
                'Check the host name and the DNS settings used by the computer or remote host running these checks.',
            target: diagnosticsHost,
        },
    }),
    rows: withRows([
        {
            id: 'serverAddress',
            status: 'error',
            segments: [
                { kind: 'finding', title: 'Host name not found', target: diagnosticsHost },
                { kind: 'resolved', resolved: 0, total: 1 },
            ],
            details: diagnosticsDetails(
                [
                    diagnosticsFinding(
                        'error',
                        'Host name not found',
                        'The system DNS resolver could not find this host name.',
                        'Check the host name and the DNS settings used by the computer or remote host running these checks.',
                        [diagnosticsHost],
                    ),
                ],
                [
                    {
                        kind: 'dnsHost',
                        host: diagnosticsHost,
                        cnameChain: [],
                        system: [],
                        direct: [],
                        systemFailed: true,
                        directFailed: true,
                        agree: false,
                    },
                ],
            ),
        },
        notChecked('networkConnection', 'serverAddress'),
        notChecked('secureConnection', 'serverAddress'),
        notChecked('serverResponse', 'serverAddress'),
        notChecked('authentication', 'serverAddress'),
        notChecked('databaseAccess', 'serverAddress'),
    ]),
});

const entraHost = 'c-stage0.mongocluster.cosmos.azure.us';
const entraAccount = 'alice@contoso.com';
const entraRow = (status: DiagnosticsRow['status'], ...segments: DiagnosticsRow['segments']): DiagnosticsRow => ({
    id: 'authentication',
    status,
    segments: [{ kind: 'authMethod', method: 'entraId' }, ...segments],
});
/** Authentication ended without a usable sign-in; Database access was not reached. */
const afterAuthentication = (
    authentication: DiagnosticsRow,
    reason: 'dependencyFailed' | 'dependencySkipped',
): DiagnosticsRow[] => withRows([authentication, notChecked('databaseAccess', 'authentication', reason)]);
const authenticationHeadline = (
    title: string,
    explanation: string,
    nextStep: string,
): Pick<DiagnosticsCard, 'stoppedAtRow' | 'headline'> => ({
    stoppedAtRow: 'authentication',
    headline: { title, explanation, nextStep },
});

/** A row with details holding only `findings`, which name no identifiers. */
const explained = (row: DiagnosticsRow, ...findings: DiagnosticsFinding[]): DiagnosticsRow => ({
    ...row,
    details: diagnosticsDetails(findings),
});

const rowLabel = (id: DiagnosticsRow['id']): string =>
    diagnosticsRowLabels[
        (
            [
                'setup',
                'connectionSettings',
                'serverAddress',
                'networkConnection',
                'secureConnection',
                'serverResponse',
                'authentication',
                'databaseAccess',
            ] as const
        ).indexOf(id)
    ];

/** The row's disclosure starts collapsed, then a click on "Details for <row>" expands it in place. */
function expandDetails(id: DiagnosticsRow['id']): ScenarioAssertion[] {
    const selector = `#connectivity-checks-${id} button[aria-expanded]`;
    return [
        {
            kind: 'attribute',
            name: `${rowLabel(id)} offers collapsed details`,
            selector,
            attribute: 'aria-expanded',
            expected: 'false',
        },
        {
            kind: 'attribute',
            name: `Details for ${rowLabel(id)} expands on click`,
            selector,
            attribute: 'aria-expanded',
            expected: 'true',
            steps: [{ action: 'click', role: 'button', name: `Details for ${rowLabel(id)}` }],
        },
    ];
}

/**
 * The expanded row shows `includes`; the row's rendered text never shows codes or URLs. `region` checks
 * only the details, for exclusions the evidence line above them does not honour (Hide identifiers).
 */
function detailsText(
    id: DiagnosticsRow['id'],
    includes: readonly string[],
    excludes: readonly string[] = [],
    region = false,
): ScenarioAssertion {
    return {
        kind: 'text',
        name: `The expanded ${rowLabel(id)} details explain the row`,
        selector: region ? `#connectivity-checks-${id} [role="region"]` : `#connectivity-checks-${id}`,
        includes,
        excludes: [...diagnosticsForbiddenText, ...excludes],
    };
}

/** A report placeholder such as `host-1`; the panel never shows one (decision 0040). */
const placeholderText = '\\b(?:host|address|user|database|certificate)-\\d+\\b';

/** The footer's info line, whose inline link chooses whether the report hides identifiers. */
function identifiersNote(text: string): ScenarioAssertion {
    return {
        kind: 'text',
        name: 'The info line says what the report will include, with the Hide identifiers link inline',
        selector: ':has(> #connectivity-identifiers-note)',
        includes: [text],
        excludes: [],
    };
}

/** Expanded details push the following row down instead of overlapping it. */
function pushesDown(id: DiagnosticsRow['id'], next: DiagnosticsRow['id']): ScenarioAssertion {
    return {
        kind: 'below',
        name: `Expanded ${rowLabel(id)} details push ${rowLabel(next)} down`,
        above: `#connectivity-checks-${id} [role="region"]`,
        below: `#connectivity-checks-${next}`,
    };
}

const privateEndpointAddress = '203.0.113.24';
const privateEndpointDetails = diagnosticsHealthyDetails({
    hosts: [diagnosticsSrvTargets[0]],
    addresses: [privateEndpointAddress],
    cnameChains: [[diagnosticsPrivateLinkAlias]],
    dnsFindings: [
        diagnosticsFinding('info', diagnosticsPublicAliasTitle, diagnosticsPublicAliasExplanation, undefined, [
            diagnosticsSrvTargets[0],
        ]),
    ],
    pingMs: 31,
    databaseCount: 3,
});
/** The operator's report: Azure DocumentDB from WSL, a private-link alias that resolves publicly. */
const privateEndpointRows: DiagnosticsRow[] = [
    {
        id: 'setup',
        status: 'done',
        segments: [
            { kind: 'location', remoteKind: 'wsl' },
            { kind: 'platform', platform: 'linux' },
            { kind: 'arch', arch: 'x64' },
        ],
        details: diagnosticsDetails(
            [
                diagnosticsFinding(
                    'info',
                    'Known DNS issue in this VS Code version',
                    "Some DNS servers send server list (SRV) replies that this VS Code version can't read. The extension works around this automatically.",
                ),
                diagnosticsFinding(
                    'info',
                    'Checks run on a remote host',
                    'Database checks run in WSL, not on this computer.',
                    'Check network access, DNS and certificates on that remote host. VS Code sign-in runs on your local computer.',
                ),
            ],
            [
                {
                    kind: 'setup',
                    remoteKind: 'wsl',
                    platform: 'linux',
                    release: '6.6.87.2-microsoft-standard-WSL2',
                    arch: 'x64',
                },
            ],
        ),
    },
    { ...diagnosticsConnectedRows[1], details: privateEndpointDetails.connectionSettings },
    {
        id: 'serverAddress',
        status: 'done',
        segments: [
            { kind: 'srvHosts', count: 1 },
            { kind: 'resolved', resolved: 1, total: 1 },
        ],
        details: privateEndpointDetails.serverAddress,
    },
    {
        id: 'networkConnection',
        status: 'done',
        segments: [
            { kind: 'reachable', reachable: 1, total: 1 },
            { kind: 'port', port: 10260 },
        ],
        details: privateEndpointDetails.networkConnection,
    },
    { ...diagnosticsConnectedRows[4], details: privateEndpointDetails.secureConnection },
    { ...diagnosticsConnectedRows[5], details: privateEndpointDetails.serverResponse },
    { ...diagnosticsConnectedRows[6], details: privateEndpointDetails.authentication },
    {
        id: 'databaseAccess',
        status: 'done',
        segments: [
            { kind: 'ping', ms: 31 },
            { kind: 'databasesVisible', count: 3 },
        ],
        details: privateEndpointDetails.databaseAccess,
    },
];
const privateEndpointCard = diagnosticsCard('connected', {
    serverLine: { engineVersion: '0.107.0', apiVersion: '7.0', host: diagnosticsHost, pingMs: 31 },
});
const privateEndpointRun = diagnosticsRun('stage0-run-private-endpoint', {
    type: 'finished',
    result: privateEndpointCard,
    rows: privateEndpointRows,
});
const privateEndpointEvidence = [
    'Running on remote host WSL, not this computer · Linux · x64',
    'SRV record lists 1 host · All resolve',
] as const;

const seedA = 'mongo-a.stage0.example.test';
const seedB = 'mongo-b.stage0.example.test';
/** Two seed hosts: one resolves to this computer (information), the other does not resolve (error). */
const severalFindingsRows = withRows([
    {
        id: 'connectionSettings',
        status: 'done',
        segments: [
            { kind: 'scheme', scheme: 'mongodb' },
            { kind: 'user', userName: 'stage0user' },
            { kind: 'optionCount', count: 1 },
        ],
    },
    {
        id: 'serverAddress',
        status: 'error',
        segments: [
            { kind: 'finding', title: 'Host name not found', target: seedB },
            { kind: 'resolved', resolved: 1, total: 2 },
        ],
        details: diagnosticsDetails(
            [
                diagnosticsFinding(
                    'error',
                    'Host name not found',
                    'The system DNS resolver could not find this host name.',
                    'Check the host name and the DNS settings used by the computer or remote host running these checks.',
                    [seedB],
                ),
                diagnosticsFinding(
                    'info',
                    'Host points to this computer',
                    'The host name resolves to a loopback address on the host running these checks.',
                    'Confirm that the database or local tunnel is running on that host, especially in remote VS Code sessions.',
                    [seedA],
                ),
            ],
            [
                {
                    kind: 'dnsHost',
                    host: seedA,
                    cnameChain: [],
                    system: [{ address: '127.0.0.1', family: 4, addressClass: 'loopback' }],
                    direct: [{ address: '127.0.0.1', family: 4, addressClass: 'loopback' }],
                    systemFailed: false,
                    directFailed: false,
                    agree: true,
                },
                {
                    kind: 'dnsHost',
                    host: seedB,
                    cnameChain: [],
                    system: [],
                    direct: [],
                    systemFailed: true,
                    directFailed: true,
                    agree: false,
                },
            ],
        ),
    },
    {
        id: 'networkConnection',
        status: 'error',
        segments: [
            { kind: 'finding', title: 'Network connection refused', target: seedA },
            { kind: 'reachable', reachable: 0, total: 1 },
            { kind: 'port', port: 27017 },
        ],
        details: diagnosticsDetails(
            [
                diagnosticsFinding(
                    'error',
                    'Network connection refused',
                    'The TCP connection was refused. The service may be stopped or listening on a different port.',
                    `Check the port and that the database service or tunnel is running. ${firewallSentence}`,
                    [seedA],
                ),
            ],
            [{ kind: 'tcpHost', host: seedA, port: 27017, failedAddresses: [{ address: '127.0.0.1' }] }],
        ),
    },
    notChecked('secureConnection', 'networkConnection'),
    notChecked('serverResponse', 'networkConnection'),
    notChecked('authentication', 'networkConnection'),
    notChecked('databaseAccess', 'networkConnection'),
]);

const pacedRunId = 'stage0-run-paced';

/**
 * A connected run whose checks all finish at once, as on a fast local connection: every row starts and
 * settles in one burst. The panel's default pacing (decision 0043) must still settle the rows one at a
 * time, in order, and show the card last, each at least 300 ms after the one before.
 */
const pacedRun: DiagnosticsRunUpdate[] = [
    { type: 'started', runId: pacedRunId, startedAt: diagnosticsStartedAt, rows: diagnosticsPendingRows },
    ...diagnosticsConnectedRows.map(
        (row, index): DiagnosticsRunUpdate => ({
            type: 'rows',
            runId: pacedRunId,
            rows: [
                ...diagnosticsConnectedRows.slice(0, index),
                { id: row.id, status: 'active', segments: [{ kind: 'checking' }] },
                ...diagnosticsPendingRows.slice(index + 1),
            ],
        }),
    ),
    {
        type: 'finished',
        runId: pacedRunId,
        finishedAt: diagnosticsStartedAt + 40,
        rows: diagnosticsConnectedRows,
        outcome: 'connected',
        result: diagnosticsConnectedCard,
        coverage: diagnosticsFullCoverage,
    },
];

const pacedRunScenario: Scenario<'connectionDiagnostics'> = diagnosticsScenario(
    pacedRun,
    ['Connection successful', diagnosticsConnectedSummary],
    {
        assertions: [
            cardText(['Connection successful', diagnosticsConnectedSummary]),
            {
                kind: 'sequence',
                name: 'The rows settle one at a time and in order, then the card appears, over about 2 s or more',
                // The list renders as the run starts; the fake host then replays the whole run at once.
                milestones: [
                    '#connectivity-checks',
                    ...diagnosticsConnectedRows.map(
                        (row): string => `#connectivity-checks-${row.id}[data-status="done"]`,
                    ),
                    '#connectivity-result',
                ],
                // Each step is drawn from 300 to 500 ms; the slack covers rendering after the timer.
                minimumGapMs: 150,
                // Nine steps (eight rows and the card) of at least 300 ms each; 1,800 ms remains a lower bound.
                minimumSpanMs: 1_800,
            },
        ],
    },
);

/** No `stepPacing`: the panel's own default applies, as in the extension. */
const pacedRunConfig: (typeof diagnostics)['config'] = {
    connectionName: diagnostics.config.connectionName,
    diagnosticsSessionId: diagnostics.config.diagnosticsSessionId,
    feedbackPermitted: diagnostics.config.feedbackPermitted,
};

/** `tcp.timeout`'s wording, which a timed-out TCP probe now shares (WI-27). */
const unreachable = {
    title: 'Network connection timed out',
    explanation: 'The TCP connection attempt timed out without connecting. This does not identify what blocked it.',
    nextStep: `Check the endpoint and network path, then try again. ${firewallSentence}`,
};
/** `access.signInRequired` (decision 0048). */
const signInRequired = {
    title: 'Sign-in required to use this connection',
    explanation:
        'The server answered, but it requires sign-in to list or read databases. This connection is set to No authentication.',
    nextStep:
        'Choose an authentication method for this connection (Update Credentials…), then run the diagnosis again.',
};

const diagnosticsScenarios = {
    'paced-run': {
        ...pacedRunScenario,
        config: pacedRunConfig,
    },
    default: {
        ...defaultScenario('connectionDiagnostics'),
        assertions: [
            ...diagnostics.styles.map((style): ScenarioAssertion => ({ kind: 'style', ...style })),
            ...diagnosticsLayout,
            checkedStatus,
            cardText(
                ['Connection successful', diagnosticsConnectedSummary],
                ['warning', 'Contacting support?', ...serverFacts],
            ),
            {
                kind: 'calls',
                name: 'Show report opens the finished run with identifiers included',
                path: 'connectionDiagnostics.showDiagnostics',
                input: { runId: 'stage0-run-connected', hideIdentifiers: false },
                count: 1,
                steps: [{ action: 'click', role: 'button', name: 'Show report' }],
            },
            {
                kind: 'calls',
                name: 'Give Feedback in the header opens the feedback view once',
                path: 'common.openFeedback',
                input: {},
                count: 1,
                steps: [{ action: 'click', role: 'button', name: 'Give Feedback' }],
            },
            {
                kind: 'calls',
                name: 'Share report copies the finished run with identifiers included, after the share warning',
                path: 'connectionDiagnostics.copyReport',
                input: { runId: 'stage0-run-connected', hideIdentifiers: false, shareWarningOutcome: 'continued' },
                count: 1,
                steps: [
                    { action: 'click', role: 'button', name: 'Share report' },
                    { action: 'click', role: 'menuitem', name: 'Copy report to clipboard' },
                ],
            },
            {
                kind: 'calls',
                name: 'Copy with identifiers asks common.confirm once, naming the action',
                path: 'common.confirm',
                input: shareWarning('Copy report'),
                count: 1,
                steps: [],
            },
            {
                kind: 'calls',
                name: 'Hide identifiers refreshes the open report for the current run',
                path: 'connectionDiagnostics.setReportIdentifiers',
                input: { runId: 'stage0-run-connected', hideIdentifiers: true },
                count: 1,
                steps: [{ action: 'click', role: 'button', name: 'Hide identifiers in the report' }],
            },
            // Three hosts: each says how long it took; the host with two attempts names both (WI-33).
            ...expandDetails('networkConnection'),
            detailsText('networkConnection', [
                'Connected to 203.0.113.10:10260 in 31 ms',
                'Could not connect to [2001:db8::10]:10260 after 2 ms',
                'Took 34 ms',
                'Took 105 ms',
            ]),
        ] satisfies readonly ScenarioAssertion[],
    },
    running: {
        config: diagnostics.config,
        rpc: {
            ...diagnostics.rpc,
            'connectionDiagnostics.run': {
                type: 'subscription',
                results: [
                    {
                        type: 'started',
                        runId: 'stage0-run-running',
                        startedAt: diagnosticsStartedAt,
                        rows: diagnosticsPendingRows,
                    },
                    {
                        type: 'rows',
                        runId: 'stage0-run-running',
                        rows: [
                            ...diagnosticsConnectedRows.slice(0, 3),
                            { id: 'networkConnection', status: 'active', segments: [{ kind: 'checking' }] },
                            ...diagnosticsPendingRows.slice(4),
                        ],
                    },
                ],
                keepOpen: true,
            },
        },
        readiness: {
            content: [...diagnosticsRowLabels, 'Checking the connection…', 'Checking…'],
            selectors: ['#connectivity-checks-networkConnection .fui-Spinner'],
            noProgressbar: false,
        },
        assertions: [
            ...diagnosticsListLayout,
            {
                kind: 'order',
                name: 'Rows 1 to 3 have settled, row 4 is checking and rows 5 to 8 wait',
                selector: '#connectivity-checks [role="listitem"]',
                texts: [
                    'Running on this computer · Linux · x64',
                    'mongodb+srv · User stage0user · 2 options',
                    'SRV record lists 3 hosts · All resolve',
                    'Checking…',
                    'pending',
                    'pending',
                    'pending',
                    'pending',
                ],
            },
            {
                kind: 'attribute',
                name: 'A settled row offers its details while the run continues',
                selector: '#connectivity-checks-serverAddress button[aria-expanded]',
                attribute: 'aria-expanded',
                expected: 'false',
            },
            {
                kind: 'attribute',
                name: 'Active and pending rows never offer details',
                selector: [
                    'networkConnection',
                    'secureConnection',
                    'serverResponse',
                    'authentication',
                    'databaseAccess',
                ]
                    .map((id): string => `#connectivity-checks-${id} button[aria-expanded]`)
                    .join(', '),
                attribute: 'aria-expanded',
                expected: null,
            },
        ],
    },
    'dns-failure': diagnosticsScenario(
        dnsFailureRun,
        [
            'Connection failed at Server address (DNS)',
            `Host name not found (${diagnosticsHost})`,
            'Not checked: Server address (DNS) did not succeed',
            supportLine,
        ],
        {
            assertions: [
                cardText(
                    [
                        'Connection failed at Server address (DNS)',
                        `Host name not found (${diagnosticsHost})`,
                        'The system DNS resolver could not find this host name.',
                        'Next: Check the host name and the DNS settings used by the computer or remote host running these checks.',
                        supportLine,
                    ],
                    ['A firewall or IP allowlist'],
                ),
                {
                    kind: 'calls',
                    name: 'Save report saves the failed run after the share warning',
                    path: 'connectionDiagnostics.saveReport',
                    input: { runId: 'stage0-run-dns', hideIdentifiers: false, shareWarningOutcome: 'continued' },
                    count: 1,
                    steps: [
                        { action: 'click', role: 'button', name: 'Share report' },
                        { action: 'click', role: 'menuitem', name: 'Save report to file…' },
                    ],
                },
                {
                    kind: 'calls',
                    name: 'Save with identifiers asks common.confirm once, naming the action',
                    path: 'common.confirm',
                    input: shareWarning('Save report'),
                    count: 1,
                    steps: [],
                },
                ...expandDetails('serverAddress'),
                detailsText('serverAddress', [
                    'Host name not found',
                    'Next: Check the host name and the DNS settings',
                    `${diagnosticsHost} Your system's lookup No answer Direct DNS query No answer`,
                ]),
                pushesDown('serverAddress', 'networkConnection'),
            ],
        },
    ),
    'private-endpoint-public': diagnosticsScenario(
        privateEndpointRun,
        [...privateEndpointEvidence, 'Connection successful'],
        {
            assertions: [
                cardText(
                    ['Connection successful', diagnosticsConnectedSummary],
                    [supportLine, ...serverFacts, 'warning', literal(diagnosticsPrivateAccessHint)],
                ),
                {
                    kind: 'text',
                    name: 'The Azure alias is information, not a DNS warning',
                    selector: '#connectivity-checks-serverAddress',
                    includes: ['Server address (DNS)', ', done'],
                    excludes: ['warning'],
                },
                ...expandDetails('connectionSettings'),
                detailsText('connectionSettings', [
                    'Scheme mongodb+srv',
                    `Host ${diagnosticsHost}`,
                    'User stage0user',
                    'Authentication method Username and password',
                    'Authentication database admin (from DNS TXT record)',
                    'tls = true',
                    'appName = stage0-fixture',
                    'authSource = admin (from DNS TXT record)',
                ]),
                ...expandDetails('serverAddress'),
                detailsText('serverAddress', [
                    diagnosticsPublicAliasTitle,
                    diagnosticsPublicAliasExplanation,
                    `Query _mongodb._tcp.${diagnosticsHost}`,
                    `Hosts listed ${diagnosticsSrvTargets[0]}:10260`,
                    'TXT options authSource=admin',
                    'DNS servers 172.20.192.1',
                    `Alias chain (CNAME) ${diagnosticsPrivateLinkAlias}`,
                    `Addresses ${privateEndpointAddress} (IPv4, public)`,
                ]),
                pushesDown('serverAddress', 'networkConnection'),
                ...expandDetails('setup'),
                detailsText('setup', [
                    'Known DNS issue in this VS Code version',
                    'Checks run on a remote host',
                    'Database checks run in WSL, not on this computer.',
                    'Checks ran Running on remote host WSL, not this computer',
                    'Operating system Linux 6.6.87.2-microsoft-standard-WSL2',
                ]),
                ...expandDetails('networkConnection'),
                // One host and one attempt: no per-host or connect time, the badge says it (WI-33).
                detailsText(
                    'networkConnection',
                    [`Connected to ${privateEndpointAddress}:10260`],
                    ['\\bTook\\b', `${privateEndpointAddress}:10260 in `],
                ),
                ...expandDetails('secureConnection'),
                detailsText(
                    'secureConnection',
                    [
                        'Protocol TLS 1.3',
                        `Certificate for *.${diagnosticsHost}`,
                        'Issued by Microsoft Azure RSA TLS Issuing CA 03',
                        'Host name Matches the certificate',
                    ],
                    // Details word the protocol as people write it; the evidence line names none.
                    ['TLSv1', '\\bTook\\b'],
                ),
                ...expandDetails('databaseAccess'),
                detailsText(
                    'databaseAccess',
                    ['ping succeeded', 'listDatabases succeeded', 'Ping 31 ms', 'Server version 7.0.0'],
                    // Only the ping is a timing (design 5.2).
                    ['\\b(?!31\\b)\\d+ ms\\b'],
                ),
                identifiersNote(reportIdentifiersShown),
                {
                    kind: 'stableText',
                    name: 'Hide identifiers in the report changes nothing in the panel, expanded details included (0040)',
                    selector: 'main',
                    steps: [{ action: 'click', role: 'button', name: 'Hide identifiers in the report' }],
                },
                identifiersNote(reportIdentifiersHidden),
            ],
        },
    ),
    // Hide identifiers applies to the report only (decision 0040): the panel keeps every identifier.
    'private-endpoint-report-identifiers-hidden': diagnosticsScenario(
        privateEndpointRun,
        // Text both info-line states share: the last assertion switches the report back to identifiers.
        [...privateEndpointEvidence, 'Review the report before sharing.'],
        {
            steps: [{ action: 'click', role: 'button', name: 'Hide identifiers in the report' }],
            assertions: [
                identifiersNote(reportIdentifiersHidden),
                cardText(
                    ['Connection successful', diagnosticsConnectedSummary],
                    ['warning', literal(diagnosticsPrivateAccessHint)],
                ),
                ...expandDetails('serverAddress'),
                detailsText(
                    'serverAddress',
                    [
                        `Public address for this Azure host name (${diagnosticsSrvTargets[0]})`,
                        `Query _mongodb._tcp.${diagnosticsHost}`,
                        `Hosts listed ${diagnosticsSrvTargets[0]}:10260`,
                        'TXT options authSource=admin',
                        'DNS servers 172.20.192.1',
                        `Alias chain (CNAME) ${diagnosticsPrivateLinkAlias}`,
                        `Addresses ${privateEndpointAddress} (IPv4, public)`,
                    ],
                    [placeholderText],
                ),
                ...expandDetails('authentication'),
                detailsText('authentication', ['User stage0user'], [placeholderText], true),
                ...expandDetails('connectionSettings'),
                detailsText(
                    'connectionSettings',
                    [
                        `Host ${diagnosticsHost}`,
                        'User stage0user',
                        'Authentication database admin',
                        'authSource = admin',
                    ],
                    [placeholderText],
                    true,
                ),
                {
                    kind: 'stableText',
                    name: 'Show identifiers in the report changes nothing in the panel (0040)',
                    selector: 'main',
                    steps: [{ action: 'click', role: 'button', name: 'Show identifiers in the report' }],
                },
                identifiersNote(reportIdentifiersShown),
            ],
        },
    ),
    'private-endpoint-blocked': diagnosticsScenario(
        diagnosticsRun('stage0-run-private-endpoint-blocked', {
            type: 'finished',
            rows: [
                ...privateEndpointRows.slice(0, 3),
                {
                    id: 'networkConnection',
                    status: 'error',
                    segments: [{ kind: 'finding', title: 'Network connection timed out' }],
                    details: diagnosticsDetails(
                        [
                            diagnosticsFinding(
                                'error',
                                'Network connection timed out',
                                'The TCP connection attempt timed out without connecting. This does not identify what blocked it.',
                                `Check network access to this host and port. ${firewallSentence}`,
                                [diagnosticsSrvTargets[0]],
                            ),
                        ],
                        [
                            {
                                kind: 'tcpHost',
                                host: diagnosticsSrvTargets[0],
                                port: 10260,
                                failedAddresses: [{ address: privateEndpointAddress }],
                            },
                        ],
                    ),
                },
                notChecked('secureConnection', 'networkConnection'),
                notChecked('serverResponse', 'networkConnection'),
                notChecked('authentication', 'networkConnection'),
                notChecked('databaseAccess', 'networkConnection'),
            ],
            result: diagnosticsCard('failed', {
                stoppedAtRow: 'networkConnection',
                headline: {
                    title: 'Network connection timed out',
                    target: `${diagnosticsSrvTargets[0]}:10260`,
                    explanation:
                        'The TCP connection attempt timed out without connecting. This does not identify what blocked it.',
                    nextStep: `Check network access to this host and port. ${firewallSentence}`,
                },
                providerHint: diagnosticsPrivateAccessHint,
                firewallHint: true,
            }),
        }),
        [...privateEndpointEvidence, 'Connection failed at Network connection (TCP)', diagnosticsPrivateAccessHint],
        {
            assertions: [
                cardText(
                    [
                        'Connection failed at Network connection (TCP)',
                        'Network connection timed out',
                        diagnosticsPrivateAccessHint,
                        firewallSentence,
                        supportLine,
                    ],
                    ['Connection successful', 'Private endpoint resolves publicly'],
                ),
                {
                    kind: 'text',
                    name: 'The DNS alias stays informational on a failed connection',
                    selector: '#connectivity-checks-serverAddress',
                    includes: ['Server address (DNS)', ', done'],
                    excludes: ['warning'],
                },
                ...expandDetails('serverAddress'),
                detailsText(
                    'serverAddress',
                    [
                        diagnosticsPublicAliasTitle,
                        diagnosticsPublicAliasExplanation,
                        `Addresses ${privateEndpointAddress} (IPv4, public)`,
                    ],
                    ['Next:'],
                ),
                ...expandDetails('networkConnection'),
                detailsText('networkConnection', [
                    'Network connection timed out',
                    `Could not connect to ${privateEndpointAddress}:10260`,
                ]),
            ],
        },
    ),
    'several-findings': diagnosticsScenario(
        diagnosticsRun('stage0-run-several-findings', {
            type: 'finished',
            result: diagnosticsCard('failed', {
                stoppedAtRow: 'serverAddress',
                headline: {
                    title: 'Host name not found',
                    explanation: 'The system DNS resolver could not find this host name.',
                    nextStep:
                        'Check the host name and the DNS settings used by the computer or remote host running these checks.',
                    target: seedB,
                },
            }),
            rows: severalFindingsRows,
        }),
        [`Host name not found (${seedB}) · 1 of 2 resolve`, 'Connection failed at Server address (DNS)'],
        {
            assertions: [
                cardText(['Connection failed at Server address (DNS)']),
                ...expandDetails('serverAddress'),
                detailsText('serverAddress', [
                    `Host name not found (${seedB})`,
                    `Host points to this computer (${seedA})`,
                    `${seedA} Addresses 127.0.0.1 (IPv4, loopback)`,
                    `${seedB} Your system's lookup No answer`,
                ]),
                {
                    kind: 'order',
                    name: 'The error is listed before the information',
                    selector: '#connectivity-checks-serverAddress [role="region"] li',
                    texts: ['Host name not found', 'Host points to this computer'],
                },
                ...expandDetails('networkConnection'),
                detailsText('networkConnection', [
                    'Network connection refused',
                    'Could not connect to 127.0.0.1:27017',
                ]),
            ],
        },
    ),
    'tls-warning': finishedScenario(
        'stage0-run-tls-warning',
        withRows([
            {
                id: 'secureConnection',
                status: 'warning',
                segments: [{ kind: 'finding', title: 'Certificate checks weakened' }],
                details: diagnosticsDetails(
                    [
                        diagnosticsFinding(
                            'warning',
                            'Certificate checks weakened',
                            'Connection options disable certificate or host name verification.',
                            'Restore certificate verification and configure a trusted CA and matching server host name.',
                        ),
                    ],
                    // The version is in Details only, per host (decision 0050).
                    diagnosticsSrvTargets.map((host, index) => ({
                        kind: 'tlsHost' as const,
                        host,
                        protocol: 'TLSv1.2',
                        trusted: false,
                        durationMs: [512, 498, 530][index],
                    })),
                ),
            },
        ]),
        diagnosticsConnectedCard,
        ['Certificate checks weakened'],
        [
            'Connection successful, with 1 warning',
            attentionLine,
            'Certificate checks weakened · Secure connection (TLS)',
            detailsPointer,
        ],
        [...serverFacts, supportLine],
    ),
    'remote-host': finishedScenario(
        'stage0-run-remote',
        withRows([
            {
                id: 'setup',
                status: 'done',
                segments: [
                    { kind: 'location', remoteKind: 'wsl' },
                    { kind: 'platform', platform: 'linux' },
                    { kind: 'arch', arch: 'x64' },
                ],
            },
        ]),
        diagnosticsConnectedCard,
        ['Running on remote host WSL, not this computer'],
        ['Connection successful', diagnosticsConnectedSummary],
        serverFacts,
    ),
    'ip-address-tls-off': finishedScenario(
        'stage0-run-ip',
        withRows([
            {
                id: 'connectionSettings',
                status: 'done',
                segments: [
                    { kind: 'scheme', scheme: 'mongodb' },
                    { kind: 'user', userName: 'stage0user' },
                ],
            },
            { id: 'serverAddress', status: 'skipped', segments: [{ kind: 'notApplicable', reason: 'ipAddress' }] },
            {
                id: 'networkConnection',
                status: 'done',
                segments: [
                    { kind: 'reachable', reachable: 1, total: 1 },
                    { kind: 'port', port: 10260 },
                ],
            },
            { id: 'secureConnection', status: 'skipped', segments: [{ kind: 'notApplicable', reason: 'tlsOff' }] },
            { id: 'serverResponse', status: 'done', segments: [{ kind: 'topology', topology: 'standalone' }] },
            {
                id: 'databaseAccess',
                status: 'done',
                segments: [
                    { kind: 'ping', ms: 2 },
                    { kind: 'databasesVisible', count: 1 },
                ],
            },
        ]),
        diagnosticsCard('connected', { serverLine: { serverVersion: '7.0.12', host: '10.0.0.4', pingMs: 2 } }),
        ['Not needed: the host is an IP address', 'Not used: TLS is off for this connection'],
        ['Connection successful', diagnosticsConnectedSummary],
        ['10.0.0.4', '7.0.12', 'Ping'],
    ),
    'timeout-limited': diagnosticsScenario(
        diagnosticsRun('stage0-run-timeout', {
            type: 'finished',
            result: diagnosticsCard('notTested', { runTimeoutBeforeAttempt: true }),
            rows: withRows([notStartedInTime('authentication'), notStartedInTime('databaseAccess')]),
            coverage: { limited: true, retryWouldHelp: true, connectionTimeoutLimited: true },
        }),
        [
            'Diagnosis stopped at the time limit',
            'Not started: time limit reached',
            'Retry with longer timeouts',
            'Retry without diagnostic timeouts',
            'This may wait until you cancel it.',
            'A timeout configured on the connection limited this check.',
        ],
        {
            assertions: [
                cardText(
                    [
                        'Diagnosis stopped at the time limit',
                        'The time limit was reached before sign-in was attempted. This does not show that the server is unreachable.',
                        supportLine,
                    ],
                    ['A firewall or IP allowlist', 'Connection failed', 'not tested'],
                ),
            ],
        },
    ),
    cancelled: diagnosticsScenario(
        diagnosticsRun('stage0-run-cancelled', {
            type: 'cancelled',
            shown: [
                diagnosticsConnectedRows[0],
                diagnosticsConnectedRows[1],
                { id: 'serverAddress', status: 'active', segments: [{ kind: 'checking' }] },
                ...diagnosticsPendingRows.slice(3),
            ],
        }),
        ['Diagnosis cancelled', 'You cancelled the diagnosis. The results so far are kept.'],
        {
            assertions: [
                cardText(
                    ['Diagnosis cancelled', 'You cancelled the diagnosis. The results so far are kept.'],
                    [supportLine, 'Connection failed'],
                ),
            ],
        },
    ),
    'report-identifiers-hidden': diagnosticsScenario(
        diagnostics.rpc['connectionDiagnostics.run'].results,
        ['Connection successful', 'The report will replace host and identity details with placeholders.'],
        {
            steps: [{ action: 'click', role: 'button', name: 'Hide identifiers in the report' }],
            assertions: [
                cardText(['Connection successful', diagnosticsConnectedSummary]),
                {
                    kind: 'calls',
                    name: 'Save report passes the hidden-identifiers choice',
                    path: 'connectionDiagnostics.saveReport',
                    input: { runId: 'stage0-run-connected', hideIdentifiers: true },
                    count: 1,
                    steps: [
                        { action: 'click', role: 'button', name: 'Share report' },
                        { action: 'click', role: 'menuitem', name: 'Save report to file…' },
                    ],
                },
                {
                    kind: 'calls',
                    name: 'With identifiers hidden, Save shows no share warning',
                    path: 'common.confirm',
                    input: shareWarning('Save report'),
                    count: 0,
                    steps: [],
                },
            ],
        },
    ),
    'entra-connected': finishedScenario(
        'stage0-run-entra',
        withRows([entraRow('done', { kind: 'account', label: entraAccount })]),
        diagnosticsConnectedCard,
        [`Microsoft Entra ID · ${entraAccount}`],
        ['Connection successful', diagnosticsConnectedSummary],
        serverFacts,
    ),
    'entra-us-gov-connected': finishedScenario(
        'stage0-run-entra-us-gov',
        withRows([
            entraRow('done', { kind: 'account', label: entraAccount }, { kind: 'cloud', cloud: 'usGovernment' }),
        ]),
        diagnosticsCard('connected', {
            serverLine: { engineVersion: '0.107.0', apiVersion: '7.0', host: entraHost, pingMs: 31 },
        }),
        [`Microsoft Entra ID · ${entraAccount} · Azure US Government`],
        ['Connection successful', diagnosticsConnectedSummary],
        [entraHost, ...serverFacts],
    ),
    'entra-no-silent-session': finishedScenario(
        'stage0-run-entra-no-session',
        afterAuthentication(entraRow('skipped', { kind: 'noSilentSignIn' }), 'dependencySkipped'),
        diagnosticsCard('notTested', {
            ...authenticationHeadline(
                'Sign-in needed',
                'No Microsoft Entra ID sign-in is available without a prompt.',
                "Connection diagnosis doesn't open sign-in. Connect to the cluster once, then run the check again.",
            ),
            earlierSignInFailure: true,
        }),
        ['Microsoft Entra ID · No sign-in available without a prompt'],
        [
            'Connection not tested',
            'No Microsoft Entra ID sign-in is available without a prompt.',
            "Next: Connection diagnosis doesn't open sign-in. Connect to the cluster once, then run the check again.",
            'A sign-in for this connection failed earlier. Show report has the details.',
            supportLine,
        ],
        ['Connection failed at', 'A firewall or IP allowlist'],
    ),
    'entra-cloud-mismatch': finishedScenario(
        'stage0-run-entra-cloud',
        afterAuthentication(
            explained(
                entraRow(
                    'error',
                    { kind: 'clusterCloud', cloud: 'AzureUSGovernment' },
                    { kind: 'signedInCloud', cloud: 'AzureCloud' },
                ),
                diagnosticsFinding(
                    'error',
                    'Azure cloud mismatch',
                    'The Azure cloud selected for sign-in does not match the cluster cloud.',
                    'Set microsoft-sovereign-cloud.environment to the cluster cloud, then connect again.',
                ),
            ),
            'dependencyFailed',
        ),
        diagnosticsCard(
            'failed',
            authenticationHeadline(
                'Azure cloud mismatch',
                'The Azure cloud selected for sign-in does not match the cluster cloud.',
                'Set microsoft-sovereign-cloud.environment to the cluster cloud, then connect again.',
            ),
        ),
        ['Microsoft Entra ID · Cluster in Azure US Government · Sign-in set to Azure'],
        [
            'Connection failed at Authentication',
            'The Azure cloud selected for sign-in does not match the cluster cloud.',
            'Next: Set microsoft-sovereign-cloud.environment to the cluster cloud, then connect again.',
            supportLine,
        ],
        ['A firewall or IP allowlist'],
    ),
    'entra-token-failed': finishedScenario(
        'stage0-run-entra-token',
        afterAuthentication(
            explained(
                entraRow('error', { kind: 'signInFailed' }),
                diagnosticsFinding(
                    'error',
                    'Microsoft Entra ID sign-in failed',
                    "This account does not appear to belong to the cluster's organization.",
                    'Use Update Credentials to choose another account or tenant, or ask the organization administrator to grant access.',
                ),
            ),
            'dependencyFailed',
        ),
        diagnosticsCard(
            'failed',
            authenticationHeadline(
                'Microsoft Entra ID sign-in failed',
                "This account does not appear to belong to the cluster's organization.",
                'Use Update Credentials to choose another account or tenant, or ask the organization administrator to grant access.',
            ),
        ),
        ['Microsoft Entra ID · Sign-in failed'],
        [
            'Connection failed at Authentication',
            "This account does not appear to belong to the cluster's organization.",
            'Next: Use Update Credentials to choose another account or tenant, or ask the organization administrator to grant access.',
            supportLine,
        ],
        ['A firewall or IP allowlist'],
    ),
    'entra-server-rejected': finishedScenario(
        'stage0-run-entra-rejected',
        afterAuthentication(
            explained(
                entraRow('error', { kind: 'signedInNotAccepted' }),
                diagnosticsFinding(
                    'error',
                    'Authentication rejected',
                    'Sign-in succeeded, but the cluster did not accept this identity.',
                    'Check that this identity is added as a user on the cluster.',
                ),
            ),
            'dependencyFailed',
        ),
        diagnosticsCard(
            'failed',
            authenticationHeadline(
                'Authentication rejected',
                'Sign-in succeeded, but the cluster did not accept this identity.',
                'Check that this identity is added as a user on the cluster.',
            ),
        ),
        ['Microsoft Entra ID · Token obtained · The cluster rejected the token'],
        [
            'Connection failed at Authentication',
            'Sign-in succeeded, but the cluster did not accept this identity.',
            'Next: Check that this identity is added as a user on the cluster.',
            supportLine,
        ],
        ['A firewall or IP allowlist'],
    ),
    'managed-identity-connected': finishedScenario(
        'stage0-run-managed-identity',
        withRows([
            {
                id: 'authentication',
                status: 'done',
                segments: [
                    { kind: 'authMethod', method: 'managedIdentity' },
                    { kind: 'managedIdentityKind', identityKind: 'userAssigned' },
                ],
            },
        ]),
        diagnosticsCard('connected', {
            serverLine: { engineVersion: '0.107.0', host: diagnosticsHost, pingMs: 3 },
        }),
        ['Managed identity · User-assigned'],
        ['Connection successful', diagnosticsConnectedSummary],
        [diagnosticsHost, ...serverFacts],
    ),
    'listing-denied': finishedScenario(
        'stage0-run-listing-denied',
        withRows([
            {
                id: 'databaseAccess',
                status: 'warning',
                segments: [{ kind: 'connected' }, { kind: 'finding', title: 'Listing databases denied' }],
                details: diagnosticsDetails([
                    diagnosticsFinding(
                        'warning',
                        'Listing databases denied',
                        'The connection succeeded, but the server denied the database-list request used by the extension.',
                        'Ask the cluster administrator for permission to list the databases you need. The connection itself is working.',
                    ),
                ]),
            },
        ]),
        diagnosticsConnectedCard,
        ['Connected · Listing databases denied'],
        [
            'Connection successful, with 1 warning',
            attentionLine,
            'Listing databases denied · Database access',
            detailsPointer,
        ],
        [supportLine, ...serverFacts],
    ),
    'compressor-unavailable': finishedScenario(
        'stage0-run-compressor',
        withRows([
            {
                id: 'connectionSettings',
                status: 'done',
                segments: [
                    { kind: 'scheme', scheme: 'mongodb' },
                    { kind: 'user', userName: 'stage0user' },
                    { kind: 'optionCount', count: 1 },
                ],
            },
            {
                id: 'serverResponse',
                status: 'error',
                segments: [
                    { kind: 'finding', title: 'Compressor unavailable', target: 'mongo-stage0.example.internal' },
                ],
                details: diagnosticsDetails(
                    [
                        diagnosticsFinding(
                            'error',
                            'Compressor unavailable',
                            'The server accepted snappy, but the extension cannot use it for commands after sign-in.',
                            'For snappy, remove it from the compressors option, or put zlib first.',
                            ['mongo-stage0.example.internal'],
                        ),
                    ],
                    [],
                ),
            },
            {
                id: 'databaseAccess',
                status: 'error',
                segments: [],
                // No finding of its own: the host's generic line still explains the status.
                details: diagnosticsDetails([
                    diagnosticsFinding(
                        'error',
                        'This check did not succeed',
                        'No further explanation is available here.',
                        'Choose Show report for the technical details of this check.',
                    ),
                ]),
            },
        ]),
        diagnosticsCard('failed', {
            stoppedAtRow: 'databaseAccess',
            headline: {
                title: 'Compressor unavailable',
                explanation: 'The server accepted snappy, but the extension cannot use it for commands after sign-in.',
                nextStep: 'For snappy, remove it from the compressors option, or put zlib first.',
                target: 'mongo-stage0.example.internal:27017',
            },
        }),
        ['Compressor unavailable (mongo-stage0.example.internal)'],
        [
            'Connection failed at Database access',
            'Compressor unavailable (mongo-stage0.example.internal:27017)',
            'The server accepted snappy, but the extension cannot use it for commands after sign-in.',
            'Next: For snappy, remove it from the compressors option, or put zlib first.',
            supportLine,
        ],
        ['A firewall or IP allowlist'],
    ),
    // The refused host's name makes the evidence line wrap around its Details toggle at any width.
    'network-refused': withWrappedEvidence(
        finishedScenario(
            'stage0-run-network-refused',
            withRows([
                {
                    id: 'networkConnection',
                    status: 'error',
                    segments: [
                        { kind: 'finding', title: 'Network connection refused', target: diagnosticsHost },
                        { kind: 'reachable', reachable: 0, total: 1 },
                        { kind: 'port', port: 10260 },
                    ],
                    details: diagnosticsDetails(
                        [
                            diagnosticsFinding(
                                'error',
                                'Network connection refused',
                                'The TCP connection was refused. The service may be stopped or listening on a different port.',
                                `Check the port and that the database service or tunnel is running. ${firewallSentence}`,
                                [diagnosticsHost],
                            ),
                        ],
                        [
                            {
                                kind: 'tcpHost',
                                host: diagnosticsHost,
                                port: 10260,
                                failedAddresses: [{ address: '203.0.113.10' }],
                            },
                        ],
                    ),
                },
                notChecked('secureConnection', 'networkConnection'),
                notChecked('serverResponse', 'networkConnection'),
                notChecked('authentication', 'networkConnection'),
                notChecked('databaseAccess', 'networkConnection'),
            ]),
            diagnosticsCard('failed', {
                stoppedAtRow: 'networkConnection',
                headline: {
                    title: 'Network connection refused',
                    explanation:
                        'The TCP connection was refused. The service may be stopped or listening on a different port.',
                    nextStep: `Check the port and that the database service or tunnel is running. ${firewallSentence}`,
                    target: `${diagnosticsHost}:10260`,
                },
                firewallHint: true,
            }),
            [`Network connection refused (${diagnosticsHost}) · 0 of 1 hosts reachable · Port 10260`],
            [
                'Connection failed at Network connection (TCP)',
                `Network connection refused (${diagnosticsHost}:10260)`,
                'The TCP connection was refused. The service may be stopped or listening on a different port.',
                'Next: Check the port and that the database service or tunnel is running.',
                firewallSentence,
                supportLine,
            ],
        ),
        ['networkConnection'],
    ),
    // Review R6: the driver connected through another member while one seed refused the probe.
    'seed-refused-connected': withWrappedEvidence(
        finishedScenario(
            'stage0-run-seed-refused',
            withRows([
                {
                    id: 'networkConnection',
                    status: 'error',
                    segments: [
                        { kind: 'finding', title: 'Network connection refused', target: seedB },
                        { kind: 'reachable', reachable: 1, total: 2 },
                    ],
                    details: diagnosticsDetails(
                        [
                            diagnosticsFinding(
                                'error',
                                'Network connection refused',
                                'The TCP connection was refused. The service may be stopped or listening on a different port.',
                                `Check the port and that the database service or tunnel is running. ${firewallSentence}`,
                                [seedB],
                            ),
                        ],
                        [{ kind: 'tcpHost', host: seedB, port: 27017, failedAddresses: [{ address: '203.0.113.11' }] }],
                    ),
                },
            ]),
            diagnosticsConnectedCard,
            [`Network connection refused (${seedB}) · 1 of 2 hosts reachable`],
            [
                'Connection successful, but 1 check failed',
                attentionLine,
                'Network connection refused · Network connection (TCP)',
                detailsPointer,
            ],
            [supportLine, firewallSentence, ...serverFacts],
        ),
        ['networkConnection'],
    ),
    'auth-rejected-native': finishedScenario(
        'stage0-run-auth-rejected',
        afterAuthentication(
            {
                id: 'authentication',
                status: 'error',
                segments: [
                    { kind: 'authMethod', method: 'native' },
                    { kind: 'authMechanism', mechanism: 'SCRAM-SHA-256' },
                    { kind: 'credentialsRejected' },
                ],
                details: diagnosticsDetails(
                    [
                        diagnosticsFinding(
                            'error',
                            'Authentication rejected',
                            'The server rejected the selected authentication credentials.',
                            'Check the user name and password, and the authentication database.',
                        ),
                    ],
                    [
                        {
                            kind: 'auth',
                            method: 'native',
                            mechanism: 'SCRAM-SHA-256',
                            mechanismNegotiated: true,
                            user: 'stage0user',
                            authSource: { value: 'admin', origin: 'default' },
                            stages: [{ stage: 'sendPassword', outcome: 'rejected' }],
                        },
                    ],
                ),
            },
            'dependencyFailed',
        ),
        diagnosticsCard(
            'failed',
            authenticationHeadline(
                'Authentication rejected',
                'The server rejected the selected authentication credentials.',
                'Check the user name and password, and the authentication database.',
            ),
        ),
        ['Username and password · SCRAM-SHA-256 · The cluster rejected the user name or password'],
        [
            'Connection failed at Authentication',
            'The server rejected the selected authentication credentials.',
            'Next: Check the user name and password, and the authentication database.',
            supportLine,
        ],
        ['A firewall or IP allowlist'],
    ),
    // WI-27 (decision 0047): the operator's unreachable server. TCP timed out on the only host and the
    // driver selected no server; the card leads with the TCP timeout, and the driver only corroborates it.
    'unreachable-host': withWrappedEvidence(
        diagnosticsScenario(
            diagnosticsRun('stage0-run-unreachable', {
                type: 'finished',
                rows: withRows([
                    {
                        id: 'connectionSettings',
                        status: 'done',
                        segments: [
                            { kind: 'scheme', scheme: 'mongodb' },
                            { kind: 'optionCount', count: 0 },
                        ],
                    },
                    {
                        id: 'serverAddress',
                        status: 'done',
                        segments: [{ kind: 'resolved', resolved: 1, total: 1 }],
                    },
                    {
                        id: 'networkConnection',
                        status: 'error',
                        segments: [
                            { kind: 'finding', title: unreachable.title, target: diagnosticsHost },
                            { kind: 'reachable', reachable: 0, total: 1 },
                            { kind: 'port', port: 27017 },
                        ],
                        details: diagnosticsDetails(
                            [
                                diagnosticsFinding(
                                    'error',
                                    unreachable.title,
                                    unreachable.explanation,
                                    unreachable.nextStep,
                                    [diagnosticsHost],
                                ),
                            ],
                            [{ kind: 'tcpHost', host: diagnosticsHost, port: 27017, failedAddresses: [] }],
                        ),
                    },
                    notChecked('secureConnection', 'networkConnection'),
                    notChecked('serverResponse', 'networkConnection'),
                    {
                        id: 'authentication',
                        status: 'error',
                        segments: [{ kind: 'authMethod', method: 'none' }, { kind: 'serverNotReached' }],
                        details: diagnosticsDetails(
                            [
                                diagnosticsFinding(
                                    'error',
                                    'No server selected',
                                    'The driver could not select a server before its time limit. This does not show that credentials were rejected.',
                                    `Review the per-server errors in the diagnostic report and check the cluster endpoints. If a connection timeout limited the attempt, change that connection setting before retrying. ${firewallSentence}`,
                                ),
                            ],
                            [{ kind: 'auth', method: 'none', stages: [] }],
                        ),
                    },
                    notChecked('databaseAccess', 'authentication'),
                ]),
                result: diagnosticsCard('failed', {
                    stoppedAtRow: 'networkConnection',
                    headline: { ...unreachable, target: `${diagnosticsHost}:27017` },
                    supporting: { title: 'No server selected', corroboration: 'serverSelection' },
                    firewallHint: true,
                    authenticated: false,
                }),
            }),
            [
                `${unreachable.title} (${diagnosticsHost}) · 0 of 1 hosts reachable · Port 27017`,
                'No authentication · Could not reach a server',
                'Connection failed at Network connection (TCP)',
            ],
            {
                assertions: [
                    cardText(
                        [
                            'Connection failed at Network connection (TCP)',
                            `${unreachable.title} (${diagnosticsHost}:27017)`,
                            unreachable.explanation,
                            'Next: Check the endpoint and network path, then try again.',
                            firewallSentence,
                            'The driver also could not reach a server.',
                            supportLine,
                        ],
                        [
                            'Connection failed at Authentication',
                            'No server selected',
                            'Also detected',
                            'Step timed out',
                            'credentials',
                        ],
                    ),
                    {
                        kind: 'text',
                        name: 'The TCP row names the timeout, not a generic "did not finish"',
                        selector: '#connectivity-checks-networkConnection',
                        includes: [`${unreachable.title} (${diagnosticsHost}) · 0 of 1 hosts reachable · Port 27017`],
                        excludes: ['Did not finish in time', 'Step timed out'],
                    },
                    {
                        kind: 'text',
                        name: 'The Authentication row says no server was reached, not a credential problem',
                        selector: '#connectivity-checks-authentication',
                        includes: ['No authentication · Could not reach a server'],
                        excludes: [literal('No authentication · No server selected')],
                    },
                ],
            },
        ),
        ['networkConnection'],
    ),
    // WI-27 (decision 0048): the operator's screenshot. Azure DocumentDB answered every probe with No
    // authentication, but the gateway refuses to list databases until the connection signs in.
    'no-auth-signin-required': diagnosticsScenario(
        diagnosticsRun('stage0-run-no-auth-signin', {
            type: 'finished',
            rows: withRows([
                {
                    id: 'connectionSettings',
                    status: 'done',
                    segments: [
                        { kind: 'scheme', scheme: 'mongodb+srv' },
                        { kind: 'optionCount', count: 2 },
                    ],
                    details: diagnosticsConnectedRows.find((row) => row.id === 'connectionSettings')?.details,
                },
                {
                    id: 'authentication',
                    status: 'done',
                    segments: [{ kind: 'authMethod', method: 'none' }],
                    details: diagnosticsDetails([], [{ kind: 'auth', method: 'none', stages: [] }]),
                },
                {
                    id: 'databaseAccess',
                    status: 'warning',
                    segments: [{ kind: 'ping', ms: 93 }, { kind: 'listingNeedsSignIn' }],
                    details: diagnosticsDetails(
                        [
                            diagnosticsFinding(
                                'warning',
                                signInRequired.title,
                                signInRequired.explanation,
                                signInRequired.nextStep,
                            ),
                        ],
                        [
                            {
                                kind: 'access',
                                commands: [
                                    { command: 'ping', outcome: 'ok' },
                                    { command: 'connectionStatus', outcome: 'signInRequired' },
                                    { command: 'listDatabases', outcome: 'signInRequired' },
                                    { command: 'buildInfo', outcome: 'ok' },
                                    { command: 'hello', outcome: 'ok' },
                                ],
                                pingMs: 93,
                                serverVersion: '7.0.0',
                            },
                        ],
                    ),
                },
            ]),
            result: diagnosticsCard('connected', {
                authenticated: false,
                signInRequired: true,
                headline: signInRequired,
                serverLine: { engineVersion: '0.107.0', apiVersion: '7.0', host: diagnosticsHost, pingMs: 93 },
            }),
        }),
        [
            'No authentication',
            'Ping 93 ms · Listing databases needs sign-in',
            'Connection works, but sign-in is required',
        ],
        {
            assertions: [
                cardText(
                    [
                        'Connection works, but sign-in is required',
                        signInRequired.explanation,
                        `Next: ${signInRequired.nextStep}`,
                    ],
                    [
                        'Connection successful',
                        'All checks passed',
                        attentionLine,
                        `${signInRequired.title} · Database access`,
                        detailsPointer,
                        supportLine,
                        ...serverFacts,
                    ],
                ),
                {
                    kind: 'text',
                    name: 'The Database access row warns that listing databases needs sign-in',
                    selector: '#connectivity-checks-databaseAccess',
                    includes: ['Ping 93 ms · Listing databases needs sign-in'],
                    excludes: [],
                },
                ...expandDetails('databaseAccess'),
                detailsText(
                    'databaseAccess',
                    [
                        signInRequired.title,
                        signInRequired.explanation,
                        'ping succeeded',
                        'connectionStatus requires sign-in',
                        'listDatabases requires sign-in',
                        'buildInfo succeeded',
                    ],
                    ['not supported', 'Unauthorized', 'not authenticated yet', '\\b13\\b'],
                    true,
                ),
            ],
        },
    ),
} as const satisfies Readonly<Record<string, Scenario<'connectionDiagnostics'>>>;

export const scenarios = {
    collectionView: { default: defaultScenario('collectionView') },
    documentView: { default: defaultScenario('documentView') },
    clusterDashboard: { default: defaultScenario('clusterDashboard') },
    atlasCredentials: { default: defaultScenario('atlasCredentials', atlasSteps) },
    connectionDiagnostics: diagnosticsScenarios,
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
