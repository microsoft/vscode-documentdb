/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type AnyProcedure, type AnyRouter, type inferRouterInputs, type inferRouterOutputs } from '@trpc/server';
import { type WebviewName } from '../../../src/webviews/_integration/WebviewRegistry';
import { type AppRouter } from '../../../src/webviews/_integration/appRouter';
import { type AtlasCredentialsWebviewConfig } from '../../../src/webviews/documentdb/atlasCredentials/atlasCredentialsController';
import { type ClusterDashboardWebviewConfigurationType } from '../../../src/webviews/documentdb/clusterDashboard/clusterDashboardController';
import { type CollectionViewWebviewConfigurationType } from '../../../src/webviews/documentdb/collectionView/collectionViewController';
import { type DocumentsViewWebviewConfigurationType } from '../../../src/webviews/documentdb/documentView/documentsViewController';
import { type LocalQuickStartConfigurationType } from '../../../src/webviews/documentdb/localQuickStart/localQuickStartController';
import { InstanceState, type DockerStatusResult, type InstanceStatusUpdate } from '../../../src/services/localQuickStart/quickStartTypes';
import { type CellValue } from '../../../src/utils/slickgrid/CellValue';

type Inputs = inferRouterInputs<AppRouter>;
type Outputs = inferRouterOutputs<AppRouter>;
type CollectionOutputs = Outputs['mongoClusters']['collectionView'];
type ProcedurePaths<T> = {
    [K in keyof T & string]: T[K] extends AnyProcedure ? K :
        T[K] extends AnyRouter ? `${K}.${ProcedurePaths<T[K]['_def']['record']>}` :
            T[K] extends Record<string, unknown> ? `${K}.${ProcedurePaths<T[K]>}` : never;
}[keyof T & string];
type FixturePaths = ProcedurePaths<AppRouter['_def']['record']>;

export interface RpcFixture {
    readonly type: 'query' | 'mutation' | 'subscription';
    readonly results: readonly unknown[];
    readonly keepOpen?: boolean;
    readonly undefinedResult?: boolean;
}

export interface ViewFixture {
    readonly config: unknown;
    readonly rpc: Readonly<Record<string, RpcFixture>>;
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
    readonly brokenCss: false | 'bundle-stylesheet' | 'all-styles';
}

function reply<T>(type: RpcFixture['type'], result: T): RpcFixture {
    if (result === undefined) {
        return { type, results: [], undefinedResult: true };
    }
    return { type, results: [result] };
}

const collectionConfig: CollectionViewWebviewConfigurationType = {
    sessionId: 'stage0-session', clusterId: 'stage0-cluster', clusterDisplayName: 'Stage 0 fixture cluster',
    viewId: 'connectionsView', databaseName: 'stage0_inventory', collectionName: 'stage0_documents',
    defaultPageSize: 50, feedbackSignalsEnabled: false, enableAIQueryGeneration: false,
};
const documentConfig: DocumentsViewWebviewConfigurationType = {
    id: 'stage0-document', clusterId: 'stage0-cluster', viewId: 'connectionsView',
    databaseName: 'stage0_inventory', collectionName: 'stage0_documents', documentId: '"stage0-1"', mode: 'edit',
};
const dashboardConfig: ClusterDashboardWebviewConfigurationType = {
    clusterId: 'stage0-cluster', clusterDisplayName: 'Stage 0 fixture cluster', viewId: 'connectionsView',
    refreshIntervalMs: 60000, feedbackSignalsEnabled: false, showDashboardOnConnect: true,
};
const quickStartConfig: LocalQuickStartConfigurationType = {
    id: 'stage0-quickstart', initialInstanceState: InstanceState.NotInstalled,
};
const atlasConfig: AtlasCredentialsWebviewConfig = { mode: 'add', authMethod: 'apikey' };
interface FixtureTableRow {
    readonly id: string;
    readonly 'x-objectid': string;
    readonly _id: CellValue;
    readonly name: CellValue;
    readonly quantity: CellValue;
    readonly [key: string]: unknown;
}
const rows: FixtureTableRow[] = [
    { id: 'stage0-row-1', 'x-objectid': '"stage0-1"', _id: { value: 'stage0-1', type: 'string' },
        name: { value: 'Stage 0 fixture row Alpha', type: 'string' }, quantity: { value: '7', type: 'number' } },
    { id: 'stage0-row-2', 'x-objectid': '"stage0-2"', _id: { value: 'stage0-2', type: 'string' },
        name: { value: 'Stage 0 fixture row Beta', type: 'string' }, quantity: { value: '11', type: 'number' } },
];
const table: CollectionOutputs['getCurrentPageAsTable'] = {
    path: [], headers: ['_id', 'name', 'quantity'],
    data: rows,
};
const stage1: CollectionOutputs['queryInsights']['getQueryInsightsStage1'] = {
    executionTime: 2, stages: [{ stage: 'IXSCAN', name: 'fixture_index', nReturned: 2 }],
    efficiencyAnalysis: { executionStrategy: 'IXSCAN', indexUsed: 'fixture_index', hasInMemorySort: false },
};
const docker: DockerStatusResult = {
    readiness: {
        outcome: 'ready', environment: 'linux', endpointKind: 'unixSocket', provider: 'dockerEngine',
        providerEvidence: 'liveDaemon', executionTarget: 'local', checkedAtMs: 1790884800000,
        cliInstalled: true, cliVersion: '27.0.0', canContinueAnyway: false, daemonReachable: true,
        osType: 'linux', daemonArchitecture: 'amd64', arch: 'x64', platformSupported: true,
    },
    status: { state: InstanceState.NotInstalled }, busy: false, canReuseExistingData: false, suggestedPort: 10260,
};
const instance: InstanceStatusUpdate = { status: docker.status, canReuseExistingData: false };

const common = {
    'common.reportEvent': reply<void>('mutation', undefined),
    'common.reportError': reply<void>('mutation', undefined),
    'common.surveyPing': reply<void>('mutation', undefined),
} satisfies Partial<Record<FixturePaths, RpcFixture>>;

export const fixtures = {
    collectionView: {
        config: collectionConfig, monaco: true, content: ['Stage 0 fixture row Alpha', 'Stage 0 fixture row Beta'],
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
            'mongoClusters.collectionView.runFindQuery': reply<CollectionOutputs['runFindQuery']>('query', { documentCount: 2 }),
            'mongoClusters.collectionView.getCurrentPageAsTable': reply('query', table),
            'mongoClusters.collectionView.getFieldCompletionData': reply<CollectionOutputs['getFieldCompletionData']>('query', []),
            'mongoClusters.collectionView.queryInsights.getQueryInsightsStage1': reply('query', stage1),
        },
    },
    documentView: {
        config: documentConfig, monaco: true, content: ['Stage 0 document payload'],
        styles: [
            { selector: '.documentView', property: 'display', expected: 'flex' },
            { selector: '.documentView', property: 'flex-direction', expected: 'column' },
            { selector: '.monaco-editor', property: 'position', expected: 'relative' },
            { selector: '.monaco-editor .overflow-guard', property: 'overflow', expected: 'hidden' },
            { selector: '.monaco-editor .view-lines', property: 'position', expected: 'absolute' },
        ],
        rpc: {
            ...common,
            'mongoClusters.documentView.getDocumentById': reply<Outputs['mongoClusters']['documentView']['getDocumentById']>(
                'query', JSON.stringify({ _id: 'stage0-1', name: 'Stage 0 document payload', quantity: 7 }, null, 2)),
        },
    },
    clusterDashboard: {
        config: dashboardConfig, monaco: false, content: ['Stage 0 fixture cluster', 'stage0_inventory'],
        styles: [
            { selector: '.clusterDashboard', property: 'display', expected: 'flex' },
            { selector: '.dashboardContent', property: 'display', expected: 'flex' },
        ],
        rpc: {
            ...common,
            'clusterDashboard.getClusterInfo': reply<Outputs['clusterDashboard']['getClusterInfo']>('query', {
                clusterDisplayName: dashboardConfig.clusterDisplayName, hosts: ['fixture.example.invalid:10260'],
                metadata: { serverInfo_version: '8.0.0' },
            }),
            'clusterDashboard.getStorageStats': reply<Outputs['clusterDashboard']['getStorageStats']>('query', {
                databases: [{ name: 'stage0_inventory', sizeOnDiskBytes: 4096, dataSizeBytes: 2048,
                    indexSizeBytes: 1024, collections: 1, objects: 2, indexes: 1 }],
                totalSizeBytes: 4096, omittedDatabaseCount: 0, errors: [],
            }),
            'clusterDashboard.measureRtt': reply<Outputs['clusterDashboard']['measureRtt']>('query', {
                pingLatencyMs: 2, uptimeSeconds: 3600, errors: [],
            }),
        },
    },
    localQuickStart: {
        config: quickStartConfig, monaco: false, content: ['Configure setup', '10260'],
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
    atlasCredentials: {
        config: atlasConfig, monaco: false, content: ['All set', 'Your credential was successfully checked and saved'],
        styles: [{ selector: 'main', property: 'display', expected: 'flex' }],
        rpc: {
            ...common,
            'atlasCredentials.submitApiKey': reply<Outputs['atlasCredentials']['submitApiKey']>('mutation', { success: true }),
        },
    },
} satisfies Record<WebviewName, Omit<ViewFixture, 'rpc'> & { rpc: Partial<Record<FixturePaths, RpcFixture>> }>;

// Compile-time input checks keep the fixture interactions aligned with the live routers.
export const atlasInput: Inputs['atlasCredentials']['submitApiKey'] = {
    publicKey: 'stage0-public-key', privateKey: 'stage0-private-key',
};
