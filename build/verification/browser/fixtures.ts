/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    InstanceState,
    type DockerStatusResult,
    type InstanceStatusUpdate,
} from '../../../src/services/localQuickStart/quickStartTypes';
import { type CellValue } from '../../../src/utils/slickgrid/CellValue';
import { type WebviewName } from '../../../src/webviews/_integration/WebviewRegistry';
import { type AtlasCredentialsWebviewConfig } from '../../../src/webviews/documentdb/atlasCredentials/atlasCredentialsController';
import { type ClusterDashboardWebviewConfigurationType } from '../../../src/webviews/documentdb/clusterDashboard/clusterDashboardController';
import { type CollectionViewWebviewConfigurationType } from '../../../src/webviews/documentdb/collectionView/collectionViewController';
import { type ConnectionDiagnosticsConfiguration } from '../../../src/webviews/documentdb/connectionDiagnostics/connectionDiagnosticsTypes';
import { panelRowIds } from '../../../src/webviews/documentdb/connectionDiagnostics/panelTypes';
import { type DocumentsViewWebviewConfigurationType } from '../../../src/webviews/documentdb/documentView/documentsViewController';
import { type LocalQuickStartConfigurationType } from '../../../src/webviews/documentdb/localQuickStart/localQuickStartController';
import { type QueryInsightsPrefill } from '../../../src/webviews/documentdb/queryInsightsStandalone/types';
import { type FixtureInputs, type FixtureOutputs, type RpcFixture, type RpcFixtures } from './core/fixtures';

type Inputs = FixtureInputs;
type Outputs = FixtureOutputs;
type CollectionOutputs = Outputs['mongoClusters']['collectionView'];
// The router's serialized stream item: what the fake host can send, with tRPC's mutable arrays.
export type DiagnosticsRunUpdate =
    Outputs['connectionDiagnostics']['run'] extends AsyncIterable<infer Update> ? Update : never;
export type DiagnosticsRow = Extract<DiagnosticsRunUpdate, { type: 'started' }>['rows'][number];
export type DiagnosticsCard = Extract<DiagnosticsRunUpdate, { type: 'finished' }>['result'];

export interface ViewFixture {
    readonly config: unknown;
    readonly rpc: RpcFixtures;
    readonly content: readonly string[];
    readonly styles: readonly StyleExpectation[];
    readonly monaco: boolean;
}

export interface StyleExpectation {
    readonly selector: string;
    readonly property: string;
    readonly expected: string;
}

export interface HarnessFixture extends ViewFixture {
    readonly view: WebviewName;
    readonly assetRoot: string;
    readonly brokenCss: false | 'bundle-stylesheet';
}

function reply<T>(
    type: RpcFixture['type'],
    result: T,
): Omit<RpcFixture, 'results'> & { readonly results: readonly T[] } {
    if (result === undefined) {
        return { type, results: [], undefinedResult: true };
    }
    return { type, results: [result] };
}

const collectionConfig: CollectionViewWebviewConfigurationType = {
    sessionId: 'stage0-session',
    clusterId: 'stage0-cluster',
    clusterDisplayName: 'Stage 0 fixture cluster',
    viewId: 'connectionsView',
    databaseName: 'stage0_inventory',
    collectionName: 'stage0_documents',
    defaultPageSize: 50,
    enableAIQueryGeneration: false,
};
const documentConfig: DocumentsViewWebviewConfigurationType = {
    id: 'stage0-document',
    clusterId: 'stage0-cluster',
    viewId: 'connectionsView',
    databaseName: 'stage0_inventory',
    collectionName: 'stage0_documents',
    documentId: '"stage0-1"',
    mode: 'edit',
};
const dashboardConfig: ClusterDashboardWebviewConfigurationType = {
    clusterId: 'stage0-cluster',
    clusterDisplayName: 'Stage 0 fixture cluster',
    viewId: 'connectionsView',
    refreshIntervalMs: 60000,
    showDashboardOnConnect: true,
};
const quickStartConfig: LocalQuickStartConfigurationType = {
    id: 'stage0-quickstart',
    initialInstanceState: InstanceState.NotInstalled,
};
const atlasConfig: AtlasCredentialsWebviewConfig = { mode: 'add', authMethod: 'apikey' };
/** A fresh open opens on Welcome; scenarios add {@link queryInsightsSampleExplain} to start on Configure. */
const queryInsightsConfig: QueryInsightsPrefill = { databaseName: 'demo', collectionName: 'items' };
export const queryInsightsSampleExplain =
    '{"queryPlanner":{"winningPlan":{"stage":"COLLSCAN"}},"executionStats":{"nReturned":2,"executionTimeMillis":12,"totalDocsExamined":100,"totalKeysExamined":0}}';
const diagnosticsConfig: ConnectionDiagnosticsConfiguration = {
    connectionName: 'Stage 0 fixture connection',
    diagnosticsSessionId: 'stage0-diagnostics-session',
    feedbackPermitted: true,
    // Static states render at once, so layout assertions see the final state; `paced-run` paces (0043).
    stepPacing: { stepMs: 0, jitterMs: 0 },
};
export const diagnosticsStartedAt = 1790884800000;
export const diagnosticsPendingRows: DiagnosticsRow[] = panelRowIds.map(
    (id): DiagnosticsRow => ({ id, status: 'pending', segments: [] }),
);
export const diagnosticsHost = 'c-stage0.mongocluster.cosmos.azure.com';

// WI-18 prototype: expandable row details. Fixture data only; the live host builds the same shape.
// The panel always shows full identifiers; Hide identifiers applies to the report only (WI-19).
export type DiagnosticsDetails = NonNullable<DiagnosticsRow['details']>;
export type DiagnosticsFinding = DiagnosticsDetails['findings'][number];
export type DiagnosticsEvidence = DiagnosticsDetails['evidence'][number];

/** A row's details, as the host sends them. */
export function diagnosticsDetails(
    findings: DiagnosticsFinding[],
    evidence: DiagnosticsEvidence[] = [],
): DiagnosticsDetails {
    return { findings, evidence };
}

/** A finding the host would send, with no identifiers in it. */
export function diagnosticsFinding(
    severity: DiagnosticsFinding['severity'],
    title: string,
    explanation: string,
    nextStep?: string,
    targets?: string[],
): DiagnosticsFinding {
    return { severity, title, explanation, ...(nextStep ? { nextStep } : {}), ...(targets ? { targets } : {}) };
}

/** `fc-0123456789ab-00N.<cluster>`: the SRV target names Azure DocumentDB returns, fixture-safe. */
export const diagnosticsSrvTargets = [0, 1, 2].map((index): string => `fc-0123456789ab-00${index}.${diagnosticsHost}`);
export const diagnosticsPrivateLinkAlias = 'fc-0123456789ab-000.privatelink.mongocluster.cosmos.azure.com';
export const diagnosticsPublicAliasTitle = 'Public address for this Azure host name';
export const diagnosticsPublicAliasExplanation =
    "The name goes through Azure's private-link alias and resolves to a public address. That is normal outside the cluster's private network.";
export const diagnosticsPrivateAccessHint =
    'This name resolved to a public address. If the cluster allows only private access, connect from its virtual network or a network that resolves the private endpoint (VPN, peering or a private DNS zone).';
const diagnosticsDnsServer = '172.20.192.1';

interface HealthyRunShape {
    readonly hosts: readonly string[];
    readonly addresses: readonly string[];
    readonly cnameChains?: readonly (readonly string[])[];
    readonly dnsFindings?: DiagnosticsFinding[];
    readonly pingMs: number;
    readonly databaseCount: number;
    /** An address the first host refused before its own connected, so its Details compare two attempts. */
    readonly firstHostRefused?: string;
}

/**
 * The details a healthy DocumentDB run sends for rows 2 to 8.
 */
export function diagnosticsHealthyDetails(
    shape: HealthyRunShape,
): Record<
    | 'connectionSettings'
    | 'serverAddress'
    | 'networkConnection'
    | 'secureConnection'
    | 'serverResponse'
    | 'authentication'
    | 'databaseAccess',
    DiagnosticsDetails
> {
    const query = `_mongodb._tcp.${diagnosticsHost}`;
    const certificate = `*.${diagnosticsHost}`;
    // Each host's check time, sent only when a row has two or more hosts (decision 0050, WI-33); host
    // checks run in parallel, so the row's badge is the longest of them, not their sum.
    const hostTime = (times: readonly number[], index: number): { durationMs?: number } =>
        shape.hosts.length >= 2 ? { durationMs: times[index % times.length] } : {};
    const address = (index: number): DiagnosticsEvidence & { kind: 'dnsHost' } => {
        const answer = [{ address: shape.addresses[index], family: 4 as const, addressClass: 'public' as const }];
        return {
            kind: 'dnsHost',
            host: shape.hosts[index],
            cnameChain: [...(shape.cnameChains?.[index] ?? [])],
            system: answer,
            direct: answer,
            systemFailed: false,
            directFailed: false,
            agree: true,
            ...hostTime([1.6, 0.9, 1.2], index),
        };
    };
    return {
        connectionSettings: diagnosticsDetails(
            [],
            [
                {
                    kind: 'connectionSettings',
                    scheme: 'mongodb+srv',
                    hosts: [diagnosticsHost],
                    user: 'stage0user',
                    passwordPresent: false,
                    authMethod: 'native',
                    authSource: { value: 'admin', origin: 'dns' },
                    options: [
                        { name: 'tls', value: 'true', hidden: false, source: 'uri' },
                        { name: 'appName', value: 'stage0-fixture', hidden: false, source: 'uri' },
                        { name: 'authSource', value: 'admin', hidden: false, source: 'dns' },
                    ],
                },
            ],
        ),
        serverAddress: diagnosticsDetails(shape.dnsFindings ?? [], [
            {
                kind: 'srv',
                query,
                targets: shape.hosts.map((name): string => `${name}:10260`),
                omittedTargets: 0,
                resolver: 'system',
                dnsServers: [diagnosticsDnsServer],
                txtOptions: [{ name: 'authSource', value: 'admin' }],
                failed: false,
            },
            ...shape.hosts.map((_name, index) => address(index)),
        ]),
        networkConnection: diagnosticsDetails(
            [],
            shape.hosts.map(
                (name, index): DiagnosticsEvidence => ({
                    kind: 'tcpHost',
                    host: name,
                    port: 10260,
                    connectedAddress: shape.addresses[index],
                    // Connect times only for a host that made two or more attempts (WI-33).
                    ...(index === 0 && shape.firstHostRefused !== undefined
                        ? { connectMs: 31, failedAddresses: [{ address: shape.firstHostRefused, connectMs: 2 }] }
                        : { failedAddresses: [] }),
                    ...hostTime([34, 105, 48], index),
                }),
            ),
        ),
        secureConnection: diagnosticsDetails(
            [],
            shape.hosts.map(
                (name, index): DiagnosticsEvidence => ({
                    kind: 'tlsHost',
                    host: name,
                    protocol: 'TLSv1.3',
                    subject: certificate,
                    issuer: 'Microsoft Azure RSA TLS Issuing CA 03',
                    validTo: '2027-03-01T00:00:00.000Z',
                    trusted: true,
                    hostNameMatched: true,
                    ...hostTime([612, 761, 540], index),
                }),
            ),
        ),
        serverResponse: diagnosticsDetails(
            [],
            shape.hosts.map(
                (name, index): DiagnosticsEvidence => ({
                    kind: 'serverHost',
                    host: name,
                    topology: 'documentdbGateway',
                    documentdbVersion: '0.107.0',
                    command: 'hello',
                    maxWireVersion: 21,
                    passwordMechanisms: ['SCRAM-SHA-256'],
                    ...hostTime([71, 88, 64], index),
                }),
            ),
        ),
        authentication: diagnosticsDetails(
            [],
            [
                {
                    kind: 'auth',
                    method: 'native',
                    mechanism: 'SCRAM-SHA-256',
                    mechanismNegotiated: true,
                    user: 'stage0user',
                    authSource: { value: 'admin', origin: 'default' },
                    stages: [{ stage: 'sendPassword', outcome: 'done' }],
                },
            ],
        ),
        databaseAccess: diagnosticsDetails(
            [],
            [
                {
                    kind: 'access',
                    commands: [
                        { command: 'ping', outcome: 'ok' },
                        { command: 'connectionStatus', outcome: 'ok' },
                        { command: 'listDatabases', outcome: 'ok' },
                        { command: 'buildInfo', outcome: 'ok' },
                        { command: 'hello', outcome: 'ok' },
                    ],
                    pingMs: shape.pingMs,
                    databaseCount: shape.databaseCount,
                    serverVersion: '7.0.0',
                },
            ],
        ),
    };
}

const diagnosticsConnectedDetails = diagnosticsHealthyDetails({
    hosts: diagnosticsSrvTargets,
    addresses: ['203.0.113.10', '203.0.113.11', '203.0.113.12'],
    pingMs: 12,
    databaseCount: 5,
    firstHostRefused: '2001:db8::10',
});

/** A healthy DocumentDB connection, with evidence on every row the host fills today. */
export const diagnosticsConnectedRows: DiagnosticsRow[] = [
    {
        id: 'setup',
        status: 'done',
        durationMs: 0.4,
        segments: [
            { kind: 'location', remoteKind: 'local' },
            { kind: 'platform', platform: 'linux' },
            { kind: 'arch', arch: 'x64' },
        ],
    },
    {
        id: 'connectionSettings',
        status: 'done',
        durationMs: 147,
        segments: [
            { kind: 'scheme', scheme: 'mongodb+srv' },
            { kind: 'user', userName: 'stage0user' },
            { kind: 'optionCount', count: 2 },
        ],
        details: diagnosticsConnectedDetails.connectionSettings,
    },
    {
        id: 'serverAddress',
        status: 'done',
        durationMs: 2,
        segments: [
            { kind: 'srvHosts', count: 3 },
            { kind: 'resolved', resolved: 3, total: 3 },
        ],
        details: diagnosticsConnectedDetails.serverAddress,
    },
    {
        id: 'networkConnection',
        status: 'done',
        durationMs: 105,
        segments: [
            { kind: 'reachable', reachable: 3, total: 3 },
            { kind: 'port', port: 10260 },
        ],
        details: diagnosticsConnectedDetails.networkConnection,
    },
    {
        id: 'secureConnection',
        status: 'done',
        durationMs: 761,
        segments: [{ kind: 'certificateTrusted' }, { kind: 'validUntil', date: '2027-03-01T00:00:00.000Z' }],
        details: diagnosticsConnectedDetails.secureConnection,
    },
    {
        id: 'serverResponse',
        status: 'done',
        durationMs: 88,
        segments: [{ kind: 'topology', topology: 'documentdbGateway' }, { kind: 'answeredBeforeSignIn' }],
        details: diagnosticsConnectedDetails.serverResponse,
    },
    {
        id: 'authentication',
        status: 'done',
        durationMs: 4378,
        segments: [
            { kind: 'authMethod', method: 'native' },
            { kind: 'authMechanism', mechanism: 'SCRAM-SHA-256' },
            { kind: 'account', label: 'stage0user' },
        ],
        details: diagnosticsConnectedDetails.authentication,
    },
    {
        id: 'databaseAccess',
        status: 'done',
        durationMs: 692,
        segments: [
            { kind: 'ping', ms: 12 },
            { kind: 'databasesVisible', count: 5 },
        ],
        details: diagnosticsConnectedDetails.databaseAccess,
    },
];
/** The result card data for a run; every flag is off unless the scenario sets it. */
export function diagnosticsCard(
    outcome: DiagnosticsCard['outcome'],
    extra: Partial<Omit<DiagnosticsCard, 'outcome'>> = {},
): DiagnosticsCard {
    return {
        outcome,
        firewallHint: false,
        earlierSignInFailure: false,
        runTimeoutBeforeAttempt: false,
        authenticated: outcome === 'connected',
        ...extra,
    };
}
export const diagnosticsConnectedCard = diagnosticsCard('connected', {
    serverLine: { engineVersion: '0.107.0', apiVersion: '7.0', host: diagnosticsHost, pingMs: 12 },
});
/** The card's sentence for a clean, signed-in connection; server facts live in the rows' Details (decision 0041). */
export const diagnosticsConnectedSummary = 'All checks passed. Sign-in succeeded and the database answered.';
export const diagnosticsFullCoverage = { limited: false, retryWouldHelp: false, connectionTimeoutLimited: false };
const diagnosticsConnectedRun: DiagnosticsRunUpdate[] = [
    {
        type: 'started',
        runId: 'stage0-run-connected',
        startedAt: diagnosticsStartedAt,
        rows: diagnosticsPendingRows,
    },
    {
        type: 'finished',
        runId: 'stage0-run-connected',
        finishedAt: diagnosticsStartedAt + 4000,
        rows: diagnosticsConnectedRows,
        outcome: 'connected',
        result: diagnosticsConnectedCard,
        coverage: diagnosticsFullCoverage,
    },
];
/** The fixed row labels, in order; spelled out so the scenarios check the view's own strings. */
export const diagnosticsRowLabels = [
    'Diagnosis setup',
    'Connection settings',
    'Server address (DNS)',
    'Network connection (TCP)',
    'Secure connection (TLS)',
    'Server greeting (hello)',
    'Authentication',
    'Database access',
] as const;
interface FixtureTableRow {
    readonly id: string;
    readonly 'x-objectid': string;
    readonly _id: CellValue;
    readonly name: CellValue;
    readonly quantity: CellValue;
    readonly [key: string]: unknown;
}
const rows: FixtureTableRow[] = [
    {
        id: 'stage0-row-1',
        'x-objectid': '"stage0-1"',
        _id: { value: 'stage0-1', type: 'string' },
        name: { value: 'Stage 0 fixture row Alpha', type: 'string' },
        quantity: { value: '7', type: 'number' },
    },
    {
        id: 'stage0-row-2',
        'x-objectid': '"stage0-2"',
        _id: { value: 'stage0-2', type: 'string' },
        name: { value: 'Stage 0 fixture row Beta', type: 'string' },
        quantity: { value: '11', type: 'number' },
    },
];
const table: CollectionOutputs['getCurrentPageAsTable'] = {
    path: [],
    headers: ['_id', 'name', 'quantity'],
    data: rows,
};
const stage1: CollectionOutputs['queryInsights']['getQueryInsightsStage1'] = {
    executionTime: 2,
    stages: [{ stage: 'IXSCAN', name: 'fixture_index', nReturned: 2 }],
    efficiencyAnalysis: { executionStrategy: 'IXSCAN', indexUsed: 'fixture_index', hasInMemorySort: false },
};
const docker: DockerStatusResult = {
    readiness: {
        outcome: 'ready',
        environment: 'linux',
        endpointKind: 'unixSocket',
        provider: 'dockerEngine',
        providerEvidence: 'liveDaemon',
        executionTarget: 'local',
        checkedAtMs: 1790884800000,
        cliInstalled: true,
        cliVersion: '27.0.0',
        canContinueAnyway: false,
        daemonReachable: true,
        osType: 'linux',
        daemonArchitecture: 'amd64',
        arch: 'x64',
        platformSupported: true,
    },
    status: { state: InstanceState.NotInstalled },
    busy: false,
    canReuseExistingData: false,
    suggestedPort: 10260,
};
const instance: InstanceStatusUpdate = { status: docker.status, canReuseExistingData: false };

const common = {
    'common.reportEvent': reply<void>('mutation', undefined),
    'common.reportError': reply<void>('mutation', undefined),
} satisfies RpcFixtures;

export const fixtures = {
    collectionView: {
        config: collectionConfig,
        monaco: true,
        content: ['Stage 0 fixture row Alpha', 'Stage 0 fixture row Beta'],
        styles: [
            { selector: '.collectionView', property: 'display', expected: 'flex' },
            { selector: '.slick-cell', property: 'position', expected: 'absolute' },
            { selector: '.slick-header-column', property: 'box-sizing', expected: 'content-box' },
            { selector: '.slick-resizable-handle', property: 'cursor', expected: 'col-resize' },
            { selector: '.slick-resizable-handle', property: 'width', expected: '7px' },
            { selector: '.monaco-editor', property: 'position', expected: 'relative' },
            { selector: '.monaco-editor .overflow-guard', property: 'overflow', expected: 'hidden' },
            { selector: '.monaco-editor .view-lines', property: 'position', expected: 'absolute' },
        ],
        rpc: {
            ...common,
            'mongoClusters.collectionView.runFindQuery': reply<CollectionOutputs['runFindQuery']>('query', {
                documentCount: 2,
            }),
            'mongoClusters.collectionView.getCurrentPageAsTable': reply('query', table),
            'mongoClusters.collectionView.getFieldCompletionData': reply<CollectionOutputs['getFieldCompletionData']>(
                'query',
                [],
            ),
            'mongoClusters.collectionView.queryInsights.getQueryInsightsStage1': reply('query', stage1),
        },
    },
    documentView: {
        config: documentConfig,
        monaco: true,
        content: ['Stage 0 document payload'],
        styles: [
            { selector: '.documentView', property: 'display', expected: 'flex' },
            { selector: '.documentView', property: 'flex-direction', expected: 'column' },
            { selector: '.monaco-editor', property: 'position', expected: 'relative' },
            { selector: '.monaco-editor .overflow-guard', property: 'overflow', expected: 'hidden' },
            { selector: '.monaco-editor .view-lines', property: 'position', expected: 'absolute' },
        ],
        rpc: {
            ...common,
            'mongoClusters.documentView.getDocumentById': reply<
                Outputs['mongoClusters']['documentView']['getDocumentById']
            >('query', JSON.stringify({ _id: 'stage0-1', name: 'Stage 0 document payload', quantity: 7 }, null, 2)),
        },
    },
    clusterDashboard: {
        config: dashboardConfig,
        monaco: false,
        content: ['Stage 0 fixture cluster', 'stage0_inventory'],
        styles: [
            { selector: '.clusterDashboard', property: 'display', expected: 'flex' },
            { selector: '.dashboardContent', property: 'display', expected: 'flex' },
        ],
        rpc: {
            ...common,
            'clusterDashboard.getClusterInfo': reply<Outputs['clusterDashboard']['getClusterInfo']>('query', {
                clusterDisplayName: dashboardConfig.clusterDisplayName,
                hosts: ['fixture.example.invalid:10260'],
                metadata: { serverInfo_version: '8.0.0' },
            }),
            'clusterDashboard.getStorageStats': reply<Outputs['clusterDashboard']['getStorageStats']>('query', {
                databases: [
                    {
                        name: 'stage0_inventory',
                        sizeOnDiskBytes: 4096,
                        dataSizeBytes: 2048,
                        indexSizeBytes: 1024,
                        collections: 1,
                        objects: 2,
                        indexes: 1,
                    },
                ],
                totalSizeBytes: 4096,
                omittedDatabaseCount: 0,
                errors: [],
            }),
            'clusterDashboard.measureRtt': reply<Outputs['clusterDashboard']['measureRtt']>('query', {
                pingLatencyMs: 2,
                uptimeSeconds: 3600,
                errors: [],
            }),
        },
    },
    localQuickStart: {
        config: quickStartConfig,
        monaco: false,
        content: ['Configure setup', '10260'],
        styles: [{ selector: 'table', property: 'border-collapse', expected: 'collapse' }],
        rpc: {
            ...common,
            'localQuickStart.getDockerStatus': reply('query', docker),
            'localQuickStart.getStatus': reply<Outputs['localQuickStart']['getStatus']>('query', docker.status),
            'localQuickStart.checkPort': reply<Outputs['localQuickStart']['checkPort']>('query', 'available'),
            'localQuickStart.checkPassword': reply<Outputs['localQuickStart']['checkPassword']>('query', 'ok'),
            'localQuickStart.reportStepChange': reply<void>('mutation', undefined),
            'localQuickStart.onInstanceChanged': { type: 'subscription', results: [instance], keepOpen: true },
        },
    },
    queryInsightsStandalone: {
        config: queryInsightsConfig,
        monaco: false,
        content: [
            'Query Insights Explorer',
            "What you'll need",
            'Get the explain output',
            'What is sent to GitHub Copilot',
        ],
        styles: [{ selector: 'body', property: 'padding-top', expected: '0px' }],
        rpc: {
            ...common,
            'ai.getAvailableModels': reply<Outputs['ai']['getAvailableModels']>('query', {
                models: [
                    {
                        id: 'copilot-utility',
                        name: 'Copilot utility',
                        family: 'copilot-utility',
                        vendor: 'copilot',
                        version: '1',
                        maxInputTokens: 64000,
                        isUtility: true,
                        pricing: 'Free',
                        priceCategory: 'low',
                        category: 'lightweight',
                        inputCost: 0,
                        outputCost: 0,
                        cacheCost: 0,
                        supportsToolCalling: true,
                        supportsImageToText: false,
                    },
                ],
                savedModelId: null,
                effectiveModelId: 'copilot-utility',
                effectiveReason: 'first-available',
            }),
            'queryInsightsStandalone.validateInput': reply<Outputs['queryInsightsStandalone']['validateInput']>(
                'query',
                {
                    commandType: 'find' as Outputs['queryInsightsStandalone']['validateInput']['commandType'],
                    query: '{}',
                },
            ),
            'queryInsightsStandalone.inspectInput': reply<Outputs['queryInsightsStandalone']['inspectInput']>('query', {
                explain: {
                    ok: true,
                    detectedCommandType: 'find' as Outputs['queryInsightsStandalone']['validateInput']['commandType'],
                    planStages: ['COLLSCAN'],
                },
                commandType: 'find' as Outputs['queryInsightsStandalone']['validateInput']['commandType'],
                query: '{}',
                queryIsExtracted: true,
                ready: true,
            }),
            'queryInsightsStandalone.getStage1': reply<Outputs['queryInsightsStandalone']['getStage1']>('query', {
                executionTime: 0,
                stages: [{ stage: 'COLLSCAN', name: 'Collection scan', nReturned: 0 }],
                efficiencyAnalysis: { executionStrategy: 'Collection scan', indexUsed: null, hasInMemorySort: false },
            }),
            'queryInsightsStandalone.getStage2': reply<Outputs['queryInsightsStandalone']['getStage2']>('query', {
                executionTimeMs: 12,
                documentsReturned: 2,
                totalDocsExamined: 100,
                totalKeysExamined: 0,
                examinedToReturnedRatio: 50,
                keysToDocsRatio: 0,
                executionStrategy: 'Collection scan',
                indexUsed: false,
                usedIndexNames: [],
                hadInMemorySort: false,
                hadCollectionScan: true,
                isCoveringQuery: false,
                concerns: [],
                rawExecutionStats: {},
                stages: [{ stage: 'COLLSCAN', name: 'Collection scan', nReturned: 2 }],
                efficiencyAnalysis: {
                    selectivity: null,
                    indexUsed: null,
                    fetchOverhead: 'Collection scan',
                    fetchOverheadKind: 'collectionScan',
                    hasInMemorySort: false,
                    performanceRating: { score: 'poor', diagnostics: [] },
                },
            }),
            'queryInsightsStandalone.streamStage3': {
                type: 'subscription',
                results: [
                    { type: 'summary', markdown: 'Consider indexing the filter.', complete: true },
                    { type: 'recommendationStarted', index: 0 },
                    {
                        type: 'recommendation',
                        index: 0,
                        recommendation: {
                            action: 'create',
                            indexSpec: { status: 1 },
                            indexName: 'status_1',
                            shellCommand: 'db.items.createIndex({status: 1})',
                            justification: 'Avoid a collection scan.',
                            priority: 'high',
                        },
                    },
                    {
                        type: 'complete',
                        modelId: 'copilot-utility',
                        modelFamily: 'copilot-utility',
                        modelDisplayName: 'Copilot utility',
                        durationMs: 10,
                        usage: {
                            promptTokens: 1200,
                            responseTokens: 350,
                            credits: 0,
                            reportedPromptTokens: 1200,
                            reportedCompletionTokens: 350,
                            usageSource: 'provider',
                        },
                    },
                ] as const,
            },
            'common.copyToClipboard': reply<Outputs['common']['copyToClipboard']>('mutation', true),
            'queryInsightsStandalone.openRawExplain': reply<Outputs['queryInsightsStandalone']['openRawExplain']>(
                'mutation',
                true,
            ),
        },
    },
    connectionDiagnostics: {
        config: diagnosticsConfig,
        monaco: false,
        content: [
            ...diagnosticsRowLabels,
            'Connection successful',
            'Running on this computer',
            diagnosticsConnectedSummary,
        ],
        styles: [{ selector: '#connectivity-checks', property: 'display', expected: 'flex' }],
        rpc: {
            ...common,
            'connectionDiagnostics.run': { type: 'subscription', results: diagnosticsConnectedRun },
            'connectionDiagnostics.panelEvents': { type: 'subscription', results: [], keepOpen: true },
            'connectionDiagnostics.cancel': reply<void>('mutation', undefined),
            'connectionDiagnostics.showDiagnostics': reply<boolean>('mutation', true),
            'connectionDiagnostics.setReportIdentifiers': reply<boolean>('mutation', false),
            'connectionDiagnostics.copyReport': reply<void>('mutation', undefined),
            'connectionDiagnostics.saveReport': reply<void>('mutation', undefined),
            'common.openFeedback': reply<void>('mutation', undefined),
            // The share warning before a copy or save with identifiers; the fixture always continues.
            'common.confirm': reply<{ confirmed: boolean }>('mutation', { confirmed: true }),
        },
    },
    atlasCredentials: {
        config: atlasConfig,
        monaco: false,
        content: ['All set', 'Your credential was successfully checked and saved'],
        styles: [{ selector: 'main', property: 'display', expected: 'flex' }],
        rpc: {
            ...common,
            'atlasCredentials.submitApiKey': reply<Outputs['atlasCredentials']['submitApiKey']>('mutation', {
                success: true,
            }),
        },
    },
} satisfies Record<WebviewName, ViewFixture>;

// Compile-time input checks keep the fixture interactions aligned with the live routers.
export const atlasInput: Inputs['atlasCredentials']['submitApiKey'] = {
    publicKey: 'stage0-public-key',
    privateKey: 'stage0-private-key',
};
