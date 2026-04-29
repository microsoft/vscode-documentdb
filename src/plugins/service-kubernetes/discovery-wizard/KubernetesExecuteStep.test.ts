/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type NewConnectionWizardContext } from '../../../commands/newConnection/NewConnectionWizardContext';
import { AuthMethodId } from '../../../documentdb/auth/AuthMethod';
import { type KubeContextInfo, type KubeServiceEndpoint, type KubeServiceInfo } from '../kubernetesClient';
import { KUBERNETES_PORT_FORWARD_METADATA_PROPERTY } from '../portForwardMetadata';
import { KubernetesExecuteStep } from './KubernetesExecuteStep';
import { KubernetesWizardProperties } from './SelectContextStep';

const mockLoadConfiguredKubeConfig = jest.fn();
const mockCreateCoreApi = jest.fn();
const mockResolveServiceEndpoint = jest.fn();
const mockResolveDocumentDBCredentials = jest.fn();
const mockResolveGenericServiceCredentials = jest.fn();
const mockBuildPortForwardConnectionString = jest.fn();
const mockStartTunnel = jest.fn();
const mockPromptForLocalPort = jest.fn();
const mockShowWarningMessage = jest.fn();
const mockShowInformationMessage = jest.fn();
const mockAppendLine = jest.fn();

jest.mock('@microsoft/vscode-azext-utils', () => ({
    AzureWizardExecuteStep: class AzureWizardExecuteStep {},
    AzureWizardPromptStep: class AzureWizardPromptStep {},
    UserCancelledError: class UserCancelledError extends Error {},
}));

jest.mock('vscode', () => ({
    ThemeIcon: class ThemeIcon {
        constructor(public readonly id: string) {}
    },
    l10n: {
        t: jest.fn((template: string, ...args: unknown[]) =>
            template.replace(/\{(\d+)\}/g, (_match: string, index: string) => String(args[Number(index)])),
        ),
    },
    window: {
        showWarningMessage: (...args: unknown[]) => mockShowWarningMessage(...args),
        showInformationMessage: (...args: unknown[]) => mockShowInformationMessage(...args),
    },
}));

jest.mock('../../../extensionVariables', () => ({
    ext: {
        outputChannel: {
            appendLine: (...args: unknown[]) => mockAppendLine(...args),
        },
    },
}));

jest.mock('../kubernetesClient', () => ({
    loadConfiguredKubeConfig: (...args: unknown[]) => mockLoadConfiguredKubeConfig(...args),
    createCoreApi: (...args: unknown[]) => mockCreateCoreApi(...args),
    resolveServiceEndpoint: (...args: unknown[]) => mockResolveServiceEndpoint(...args),
    resolveDocumentDBCredentials: (...args: unknown[]) => mockResolveDocumentDBCredentials(...args),
    resolveGenericServiceCredentials: (...args: unknown[]) => mockResolveGenericServiceCredentials(...args),
    buildPortForwardConnectionString: (...args: unknown[]) => mockBuildPortForwardConnectionString(...args),
}));

jest.mock('../portForwardTunnel', () => ({
    PortForwardTunnelManager: {
        getInstance: () => ({
            startTunnel: (...args: unknown[]) => mockStartTunnel(...args),
        }),
    },
}));

jest.mock('../promptForLocalPort', () => ({
    promptForLocalPort: (...args: unknown[]) => mockPromptForLocalPort(...args),
}));

interface MockUi {
    readonly showQuickPick: jest.Mock;
    readonly showInputBox: jest.Mock;
    readonly onDidFinishPrompt: jest.Mock;
    readonly showWarningMessage: jest.Mock;
    readonly showOpenDialog: jest.Mock;
    readonly showWorkspaceFolderPick: jest.Mock;
}

const selectedContext: KubeContextInfo = {
    name: 'kind-documentdb-dev',
    cluster: 'kind-documentdb-dev',
    user: 'kind-documentdb-dev',
    server: 'https://127.0.0.1:6443',
};

const mockKubeConfig = { name: 'mock-kube-config' };
const mockCoreApi = { name: 'mock-core-api' };

function createUi(): MockUi {
    return {
        showQuickPick: jest.fn(),
        showInputBox: jest.fn(),
        onDidFinishPrompt: jest.fn(),
        showWarningMessage: jest.fn(),
        showOpenDialog: jest.fn(),
        showWorkspaceFolderPick: jest.fn(),
    };
}

function createDkoService(overrides: Partial<KubeServiceInfo> = {}): KubeServiceInfo {
    return {
        sourceKind: 'dko',
        name: 'documentdb-service-orders',
        displayName: 'orders',
        serviceName: 'documentdb-service-orders',
        namespace: 'prod',
        type: 'LoadBalancer',
        port: 10260,
        externalAddress: '10.0.0.5',
        connectionParams: 'directConnection=true',
        ...overrides,
    };
}

function createGenericService(overrides: Partial<KubeServiceInfo> = {}): KubeServiceInfo {
    return {
        sourceKind: 'generic',
        name: 'orders-generic',
        displayName: 'orders-generic',
        serviceName: 'orders-generic',
        namespace: 'prod',
        type: 'LoadBalancer',
        port: 27017,
        externalAddress: '10.0.0.6',
        credentialSecretName: 'orders-credentials',
        connectionParams: 'directConnection=true',
        ...overrides,
    };
}

function createWizardContext(selectedService: KubeServiceInfo): NewConnectionWizardContext {
    return {
        telemetry: { properties: {}, measurements: {} },
        errorHandling: { issueProperties: {} },
        ui: createUi(),
        valuesToMask: [],
        parentId: '',
        properties: {
            [KubernetesWizardProperties.SelectedContext]: selectedContext,
            [KubernetesWizardProperties.SelectedService]: selectedService,
            [KubernetesWizardProperties.SelectedSourceId]: 'default',
            [KubernetesWizardProperties.SelectedSourceLabel]: 'Default kubeconfig',
        },
    } as unknown as NewConnectionWizardContext;
}

describe('KubernetesExecuteStep', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockLoadConfiguredKubeConfig.mockResolvedValue(mockKubeConfig);
        mockCreateCoreApi.mockResolvedValue(mockCoreApi);
        mockResolveServiceEndpoint.mockResolvedValue({
            kind: 'ready',
            connectionString: 'mongodb://10.0.0.5:10260/?directConnection=true',
        } satisfies KubeServiceEndpoint);
        mockResolveDocumentDBCredentials.mockResolvedValue(undefined);
        mockResolveGenericServiceCredentials.mockResolvedValue(undefined);
    });

    it('sets native auth credentials and masks the password for DKO services', async () => {
        mockResolveDocumentDBCredentials.mockResolvedValue({
            username: 'dko-admin',
            password: 'dko-password',
            connectionParams: 'directConnection=true',
        });

        const selectedService = createDkoService();
        const context = createWizardContext(selectedService);

        await new KubernetesExecuteStep().execute(context);

        expect(mockResolveDocumentDBCredentials).toHaveBeenCalledWith(
            mockCoreApi,
            mockKubeConfig,
            'prod',
            'documentdb-service-orders',
        );
        expect(mockResolveGenericServiceCredentials).not.toHaveBeenCalled();
        expect(context.nativeAuthConfig).toEqual({
            connectionUser: 'dko-admin',
            connectionPassword: 'dko-password',
        });
        expect(context.availableAuthenticationMethods).toEqual([AuthMethodId.NativeAuth]);
        expect(context.selectedAuthenticationMethod).toBe(AuthMethodId.NativeAuth);
        expect(context.valuesToMask).toContain('dko-password');
        expect(context.connectionString).toBe('mongodb://10.0.0.5:10260/?directConnection=true');
        expect(context.connectionString).not.toContain('dko-admin');
        expect(context.connectionString).not.toContain('dko-password');
    });

    it('sets native auth credentials and masks the password for annotated generic services', async () => {
        mockResolveServiceEndpoint.mockResolvedValue({
            kind: 'ready',
            connectionString: 'mongodb://10.0.0.6:27017/?directConnection=true',
        } satisfies KubeServiceEndpoint);
        mockResolveGenericServiceCredentials.mockResolvedValue({
            username: 'generic-admin',
            password: 'generic-password',
        });

        const selectedService = createGenericService();
        const context = createWizardContext(selectedService);

        await new KubernetesExecuteStep().execute(context);

        expect(mockResolveDocumentDBCredentials).not.toHaveBeenCalled();
        expect(mockResolveGenericServiceCredentials).toHaveBeenCalledWith(mockCoreApi, 'prod', 'orders-credentials');
        expect(context.nativeAuthConfig).toEqual({
            connectionUser: 'generic-admin',
            connectionPassword: 'generic-password',
        });
        expect(context.availableAuthenticationMethods).toEqual([AuthMethodId.NativeAuth]);
        expect(context.selectedAuthenticationMethod).toBe(AuthMethodId.NativeAuth);
        expect(context.valuesToMask).toContain('generic-password');
        expect(context.connectionString).toBe('mongodb://10.0.0.6:27017/?directConnection=true');
        expect(context.connectionString).not.toContain('generic-admin');
        expect(context.connectionString).not.toContain('generic-password');
    });

    it('continues without auth state when auto credentials are unavailable', async () => {
        const selectedService = createGenericService();
        const context = createWizardContext(selectedService);

        await expect(new KubernetesExecuteStep().execute(context)).resolves.toBeUndefined();

        expect(mockResolveGenericServiceCredentials).toHaveBeenCalledWith(mockCoreApi, 'prod', 'orders-credentials');
        expect(context.connectionString).toBe('mongodb://10.0.0.5:10260/?directConnection=true');
        expect(context.nativeAuthConfig).toBeUndefined();
        expect(context.availableAuthenticationMethods).toBeUndefined();
        expect(context.selectedAuthenticationMethod).toBeUndefined();
        expect(context.telemetry.properties.hasAutoCredentials).toBe('false');
    });

    it('keeps auto-resolved credentials out of the connection string', async () => {
        mockResolveDocumentDBCredentials.mockResolvedValue({
            username: 'connection-string-user',
            password: 'connection-string-password',
            connectionParams: '',
        });

        const context = createWizardContext(createDkoService());

        await new KubernetesExecuteStep().execute(context);

        expect(context.nativeAuthConfig?.connectionUser).toBe('connection-string-user');
        expect(context.nativeAuthConfig?.connectionPassword).toBe('connection-string-password');
        expect(context.connectionString).toBe('mongodb://10.0.0.5:10260/?directConnection=true');
        expect(context.connectionString).not.toContain('connection-string-user');
        expect(context.connectionString).not.toContain('connection-string-password');
    });

    it('surfaces endpoint warnings and records telemetry for ready endpoints', async () => {
        const warningText =
            'Using node InternalIP for NodePort service — this address may not be reachable outside the cluster.';
        mockResolveServiceEndpoint.mockResolvedValue({
            kind: 'ready',
            connectionString: 'mongodb://10.0.0.7:30017/',
            warning: warningText,
        } satisfies KubeServiceEndpoint);

        const context = createWizardContext(
            createGenericService({
                name: 'orders-nodeport',
                displayName: 'orders-nodeport',
                serviceName: 'orders-nodeport',
                type: 'NodePort',
                nodePort: 30017,
            }),
        );

        await new KubernetesExecuteStep().execute(context);

        expect(mockShowWarningMessage).toHaveBeenCalledWith(warningText);
        expect(mockAppendLine).toHaveBeenCalledWith(warningText);
        expect(context.telemetry.properties.endpointWarning).toBe('internalIpMayBeUnreachable');
    });

    it('stores port-forward metadata for ClusterIP service-discovery connections', async () => {
        mockResolveServiceEndpoint.mockResolvedValue({
            kind: 'needsPortForward',
            serviceName: 'orders-clusterip',
            namespace: 'prod',
            remotePort: 10260,
            suggestedLocalPort: 10260,
        } satisfies KubeServiceEndpoint);
        mockPromptForLocalPort.mockResolvedValue(10260);
        mockStartTunnel.mockResolvedValue({ outcome: 'started' });
        mockBuildPortForwardConnectionString.mockReturnValue('mongodb://127.0.0.1:10260/?directConnection=true');

        const context = createWizardContext(
            createDkoService({
                name: 'orders-clusterip',
                displayName: 'orders-clusterip',
                serviceName: 'orders-clusterip',
                type: 'ClusterIP',
            }),
        );

        await new KubernetesExecuteStep().execute(context);

        expect(context.connectionString).toBe('mongodb://127.0.0.1:10260/?directConnection=true');
        expect(context.connectionProperties?.[KUBERNETES_PORT_FORWARD_METADATA_PROPERTY]).toEqual({
            kind: 'kubernetesClusterIpPortForward',
            sourceId: 'default',
            sourceLabel: 'Default kubeconfig',
            contextName: 'kind-documentdb-dev',
            namespace: 'prod',
            serviceName: 'orders-clusterip',
            servicePort: 10260,
            servicePortName: undefined,
            localPort: 10260,
        });
    });
});
