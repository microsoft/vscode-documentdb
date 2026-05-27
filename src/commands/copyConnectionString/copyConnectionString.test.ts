/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const mockClipboardWriteText = jest.fn();
const mockShowQuickPick = jest.fn();
const mockShowInformationMessage = jest.fn();
const mockShowErrorMessage = jest.fn();
const mockShowWarningMessage = jest.fn();

jest.mock('vscode', () => ({
    ThemeIcon: class ThemeIcon {
        constructor(public readonly id: string) {}
    },
    env: {
        clipboard: {
            writeText: (...args: unknown[]) => mockClipboardWriteText(...args),
        },
    },
    window: {
        showInformationMessage: (...args: unknown[]) => mockShowInformationMessage(...args),
        showErrorMessage: (...args: unknown[]) => mockShowErrorMessage(...args),
        showWarningMessage: (...args: unknown[]) => mockShowWarningMessage(...args),
    },
    l10n: {
        t: jest.fn((message: string) => message),
    },
}));

jest.mock('@vscode/l10n', () => ({
    t: jest.fn((message: string) => message),
}));

jest.mock('../../extensionVariables', () => ({
    ext: {
        state: {
            // Pass-through wrapper used as runWithTemporaryDescription(_id, _label, callback)
            runWithTemporaryDescription: async (_id: string, _label: string, callback: () => Promise<unknown>) =>
                await callback(),
        },
    },
}));

import { AuthMethodId } from '../../documentdb/auth/AuthMethod';
import { copyConnectionString } from './copyConnectionString';

interface FakeNode {
    id: string;
    contextValue: string;
    experience: { api: string };
    getCredentials: jest.Mock;
    getCredentialsForCopy?: jest.Mock;
}

interface FakeContext {
    telemetry: {
        properties: Record<string, string | undefined>;
        measurements: Record<string, number>;
    };
    valuesToMask: string[];
    ui: {
        showQuickPick: jest.Mock;
    };
    errorHandling: Record<string, unknown>;
}

function makeContext(): FakeContext {
    return {
        telemetry: { properties: {}, measurements: {} },
        valuesToMask: [],
        ui: { showQuickPick: mockShowQuickPick },
        errorHandling: {},
    };
}

function makeNode(contextValue: string, credentials: unknown): FakeNode {
    return {
        id: 'test-node',
        contextValue,
        experience: { api: 'documentdb' },
        getCredentials: jest.fn().mockResolvedValue(credentials),
    };
}

const baseConnString = 'mongodb://127.0.0.1:27017/?directConnection=true';

describe('copyConnectionString', () => {
    beforeEach(() => {
        mockClipboardWriteText.mockReset();
        mockShowQuickPick.mockReset();
        mockShowInformationMessage.mockReset();
        mockShowErrorMessage.mockReset();
        mockShowWarningMessage.mockReset();
    });

    it('T-01 connections view + native + password, picks WITH password -> includes password', async () => {
        mockShowQuickPick.mockResolvedValue({ includePassword: true });
        const ctx = makeContext();
        const node = makeNode('connectionsView;treeitem_documentdbcluster', {
            connectionString: baseConnString,
            availableAuthMethods: [AuthMethodId.NativeAuth],
            selectedAuthMethod: AuthMethodId.NativeAuth,
            nativeAuthConfig: { connectionUser: 'alice', connectionPassword: 's3cr3t' },
        });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await copyConnectionString(ctx as any, node as any);

        expect(mockShowQuickPick).toHaveBeenCalledTimes(1);
        const written = mockClipboardWriteText.mock.calls[0][0] as string;
        expect(written).toContain('alice:s3cr3t@127.0.0.1');
        expect(ctx.valuesToMask).toContain('s3cr3t');
        expect(ctx.telemetry.properties.copyOrigin).toBe('connectionsView');
        expect(ctx.telemetry.properties.passwordIncluded).toBe('true');
    });

    it('T-02 connections view + native + password, picks WITHOUT password -> omits password', async () => {
        mockShowQuickPick.mockResolvedValue({ includePassword: false });
        const ctx = makeContext();
        const node = makeNode('connectionsView;treeitem_documentdbcluster', {
            connectionString: baseConnString,
            availableAuthMethods: [AuthMethodId.NativeAuth],
            selectedAuthMethod: AuthMethodId.NativeAuth,
            nativeAuthConfig: { connectionUser: 'alice', connectionPassword: 's3cr3t' },
        });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await copyConnectionString(ctx as any, node as any);

        const written = mockClipboardWriteText.mock.calls[0][0] as string;
        expect(written).toContain('alice@127.0.0.1');
        expect(written).not.toContain('s3cr3t');
        expect(ctx.telemetry.properties.passwordIncluded).toBe('false');
    });

    it('T-03 K8s discovery + native + password, picks WITH password -> includes password', async () => {
        mockShowQuickPick.mockResolvedValue({ includePassword: true });
        const ctx = makeContext();
        const node = makeNode(
            'treeItem_documentdbcluster;documentdbTargetLeaf;discovery.kubernetesService;experience_documentdb',
            {
                connectionString: baseConnString,
                availableAuthMethods: [AuthMethodId.NativeAuth],
                selectedAuthMethod: AuthMethodId.NativeAuth,
                nativeAuthConfig: { connectionUser: 'alice', connectionPassword: 's3cr3t' },
            },
        );

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await copyConnectionString(ctx as any, node as any);

        expect(mockShowQuickPick).toHaveBeenCalledTimes(1);
        const written = mockClipboardWriteText.mock.calls[0][0] as string;
        expect(written).toContain('alice:s3cr3t@127.0.0.1');
        expect(ctx.valuesToMask).toContain('s3cr3t');
        expect(ctx.telemetry.properties.copyOrigin).toBe('kubernetesDiscovery');
        expect(ctx.telemetry.properties.passwordIncluded).toBe('true');
    });

    it('T-04 K8s discovery + native + password, picks WITHOUT password -> omits password', async () => {
        mockShowQuickPick.mockResolvedValue({ includePassword: false });
        const ctx = makeContext();
        const node = makeNode(
            'treeItem_documentdbcluster;documentdbTargetLeaf;discovery.kubernetesService;experience_documentdb',
            {
                connectionString: baseConnString,
                availableAuthMethods: [AuthMethodId.NativeAuth],
                selectedAuthMethod: AuthMethodId.NativeAuth,
                nativeAuthConfig: { connectionUser: 'alice', connectionPassword: 's3cr3t' },
            },
        );

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await copyConnectionString(ctx as any, node as any);

        const written = mockClipboardWriteText.mock.calls[0][0] as string;
        expect(written).toContain('alice@127.0.0.1');
        expect(written).not.toContain('s3cr3t');
        expect(ctx.telemetry.properties.passwordIncluded).toBe('false');
    });

    it('T-05 K8s discovery + native + NO password -> no prompt, copies username only', async () => {
        const ctx = makeContext();
        const node = makeNode(
            'treeItem_documentdbcluster;documentdbTargetLeaf;discovery.kubernetesService;experience_documentdb',
            {
                connectionString: baseConnString,
                availableAuthMethods: [AuthMethodId.NativeAuth],
                selectedAuthMethod: AuthMethodId.NativeAuth,
                nativeAuthConfig: { connectionUser: 'alice', connectionPassword: '' },
            },
        );

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await copyConnectionString(ctx as any, node as any);

        expect(mockShowQuickPick).not.toHaveBeenCalled();
        const written = mockClipboardWriteText.mock.calls[0][0] as string;
        expect(written).toContain('alice@127.0.0.1');
        expect(ctx.telemetry.properties.passwordIncluded).toBe('notPrompted');
        expect(ctx.telemetry.properties.copyOrigin).toBe('kubernetesDiscovery');
    });

    it('T-06 K8s discovery + EntraID -> no password prompt, sets MONGODB-OIDC authMechanism', async () => {
        const ctx = makeContext();
        const node = makeNode(
            'treeItem_documentdbcluster;documentdbTargetLeaf;discovery.kubernetesService;experience_documentdb',
            {
                connectionString: baseConnString,
                availableAuthMethods: [AuthMethodId.MicrosoftEntraID],
                selectedAuthMethod: AuthMethodId.MicrosoftEntraID,
                entraIdAuthConfig: { connectionUser: 'alice@contoso' },
            },
        );

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await copyConnectionString(ctx as any, node as any);

        expect(mockShowQuickPick).not.toHaveBeenCalled();
        const written = mockClipboardWriteText.mock.calls[0][0] as string;
        expect(written).toContain('authMechanism=MONGODB-OIDC');
        expect(ctx.telemetry.properties.passwordIncluded).toBe('notPrompted');
    });

    it('T-07 other discovery (regression guard) -> no prompt even when password present', async () => {
        const ctx = makeContext();
        const node = makeNode('treeItem_documentdbcluster;discovery.azureMongoVCore;experience_documentdb', {
            connectionString: baseConnString,
            availableAuthMethods: [AuthMethodId.NativeAuth],
            selectedAuthMethod: AuthMethodId.NativeAuth,
            nativeAuthConfig: { connectionUser: 'alice', connectionPassword: 's3cr3t' },
        });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await copyConnectionString(ctx as any, node as any);

        expect(mockShowQuickPick).not.toHaveBeenCalled();
        const written = mockClipboardWriteText.mock.calls[0][0] as string;
        expect(written).toContain('alice@127.0.0.1');
        expect(written).not.toContain('s3cr3t');
        expect(ctx.telemetry.properties.copyOrigin).toBe('other');
        expect(ctx.telemetry.properties.passwordIncluded).toBe('notPrompted');
    });

    it('T-08 saved Kubernetes port-forward connection -> warns after copying', async () => {
        const ctx = makeContext();
        const node = makeNode('connectionsView;treeitem_documentdbcluster', {
            connectionString: 'mongodb://127.0.0.1:10260/?directConnection=true',
            availableAuthMethods: [AuthMethodId.NativeAuth],
            selectedAuthMethod: AuthMethodId.NativeAuth,
            nativeAuthConfig: { connectionUser: 'alice', connectionPassword: '' },
            connectionProperties: {
                kubernetesPortForward: {
                    kind: 'kubernetesClusterIpPortForward',
                    sourceId: 'default',
                    contextName: 'kind-documentdb-dev',
                    namespace: 'default',
                    serviceName: 'documentdb-service',
                    servicePort: 10260,
                    localPort: 10260,
                },
            },
        });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await copyConnectionString(ctx as any, node as any);

        expect(mockClipboardWriteText).toHaveBeenCalledWith(expect.stringContaining('127.0.0.1:10260'));
        expect(mockShowInformationMessage).not.toHaveBeenCalled();
        expect(mockShowWarningMessage).toHaveBeenCalledWith(expect.stringContaining('uses port-forwarding'));
        expect(ctx.telemetry.properties.kubernetesPortForwardCopy).toBe('true');
    });

    it('T-09 K8s discovery copy uses read-only credentials provider', async () => {
        const ctx = makeContext();
        const node = makeNode(
            'treeItem_documentdbcluster;documentdbTargetLeaf;discovery.kubernetesService;experience_documentdb',
            {
                connectionString: 'mongodb://should-not-be-used:10260/',
                availableAuthMethods: [AuthMethodId.NativeAuth],
                selectedAuthMethod: AuthMethodId.NativeAuth,
            },
        );
        node.getCredentialsForCopy = jest.fn().mockResolvedValue({
            connectionString: 'mongodb://127.0.0.1:10260/?directConnection=true',
            availableAuthMethods: [AuthMethodId.NativeAuth],
            selectedAuthMethod: AuthMethodId.NativeAuth,
            connectionProperties: {
                kubernetesPortForward: {
                    kind: 'kubernetesClusterIpPortForward',
                    sourceId: 'default',
                    contextName: 'kind-documentdb-dev',
                    namespace: 'default',
                    serviceName: 'documentdb-service',
                    servicePort: 10260,
                    localPort: 10260,
                },
            },
        });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await copyConnectionString(ctx as any, node as any);

        expect(node.getCredentialsForCopy).toHaveBeenCalledTimes(1);
        expect(node.getCredentials).not.toHaveBeenCalled();
        expect(mockClipboardWriteText).toHaveBeenCalledWith(expect.stringContaining('127.0.0.1:10260'));
        expect(mockShowWarningMessage).toHaveBeenCalledWith(expect.stringContaining('uses port-forwarding'));
    });
});
