/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type initWebviewTrpc as InitWebviewTrpc } from '@microsoft/vscode-ext-webview';

const mockListProjects = jest.fn();
const mockFetchServiceAccountToken = jest.fn();
const mockGetAtlasCredential = jest.fn();
const mockUpsertAtlasCredential = jest.fn();
const mockReplaceAtlasCredentialSecrets = jest.fn();

jest.mock('vscode', () => ({
    l10n: {
        t: jest.fn((message: string, ...args: string[]) =>
            args.reduce<string>((result, value, index) => result.replace(`{${String(index)}}`, value), message),
        ),
    },
}));

jest.mock('@vscode/l10n', () => ({
    t: jest.fn((message: string, ...args: string[]) =>
        args.reduce<string>((result, value, index) => result.replace(`{${String(index)}}`, value), message),
    ),
}));

jest.mock('../../../extensionVariables', () => ({
    ext: {
        outputChannel: {
            error: jest.fn(),
            warn: jest.fn(),
            info: jest.fn(),
            trace: jest.fn(),
            show: jest.fn(),
        },
    },
}));

jest.mock('../../../plugins/service-atlas-mongodb/api/AtlasApiClient', () => {
    class AtlasApiErrorMock extends Error {
        constructor(
            message: string,
            public readonly statusCode: number,
            public readonly detail?: string,
            public readonly errorCode?: string,
            public readonly parameters?: readonly unknown[],
        ) {
            super(message);
            this.name = 'AtlasApiError';
        }
    }

    return {
        AtlasApiError: AtlasApiErrorMock,
        AtlasApiClient: class AtlasApiClientMock {
            public listProjects(): Promise<unknown> {
                return mockListProjects() as Promise<unknown>;
            }
        },
        // Mirrors the real predicate in AtlasApiClient.ts (the module is fully mocked here, so the
        // shared implementation is not available and has to be reproduced for the mock error class).
        isAtlasIpAccessListError: (error: unknown): boolean => {
            if (!(error instanceof AtlasApiErrorMock) || error.statusCode !== 403) {
                return false;
            }
            if (error.errorCode && /ACCESS_LIST/i.test(error.errorCode)) {
                return true;
            }
            return `${error.detail ?? ''} ${error.message}`.toLowerCase().includes('access list');
        },
    };
});

jest.mock('../../../plugins/service-atlas-mongodb/auth/AtlasServiceAccountClient', () => ({
    fetchServiceAccountToken: (...args: unknown[]) => mockFetchServiceAccountToken(...args) as unknown,
}));

jest.mock('../../../plugins/service-atlas-mongodb/credentials/atlasCredentialStore', () => ({
    getAtlasCredential: (...args: unknown[]) => mockGetAtlasCredential(...args) as unknown,
    replaceAtlasCredentialSecrets: (...args: unknown[]) => mockReplaceAtlasCredentialSecrets(...args) as unknown,
    upsertAtlasCredential: (...args: unknown[]) => mockUpsertAtlasCredential(...args) as unknown,
}));

jest.mock('../../_integration/trpc', () => {
    const { initWebviewTrpc } = jest.requireActual<{ initWebviewTrpc: typeof InitWebviewTrpc }>(
        '@microsoft/vscode-ext-webview',
    );
    const trpc = initWebviewTrpc();
    return {
        createCallerFactory: trpc.createCallerFactory,
        publicProcedureWithTelemetry: trpc.publicProcedure,
        router: trpc.router,
    };
});

import { API } from '../../../DocumentDBExperiences';
import { AtlasApiError } from '../../../plugins/service-atlas-mongodb/api/AtlasApiClient';
import { createCallerFactory } from '../../_integration/trpc';
import { atlasCredentialsRouter, type RouterContext } from './atlasCredentialsRouter';

function createContext(credentialId?: string): RouterContext & {
    telemetry: { properties: Record<string, string>; measurements: Record<string, number> };
} {
    return {
        dbExperience: API.DocumentDB,
        webviewName: 'atlasCredentials',
        credentialId,
        credentialState: { credentialsStored: false },
        onCredentialPersisted: jest.fn(),
        onCredentialsStored: jest.fn(),
        telemetry: { properties: {}, measurements: {} },
    };
}

beforeEach(() => {
    mockListProjects.mockReset();
    mockFetchServiceAccountToken.mockReset();
    mockGetAtlasCredential.mockReset();
    mockUpsertAtlasCredential.mockReset();
    mockReplaceAtlasCredentialSecrets.mockReset();
});

describe('atlasCredentialsRouter', () => {
    it('returns an actionable IP access error with the existing credential deep link', async () => {
        mockListProjects.mockRejectedValue(
            new AtlasApiError(
                'Access denied',
                403,
                'IP address 203.0.113.9 is not allowed.',
                'IP_ADDRESS_NOT_ON_ACCESS_LIST',
                ['203.0.113.9'],
            ),
        );
        mockGetAtlasCredential.mockResolvedValue({
            id: 'credential-1',
            authMethod: 'apikey',
            orgId: 'org-1',
            order: 0,
        });
        const context = createContext('credential-1');
        const caller = createCallerFactory(atlasCredentialsRouter)({ ...context });

        const result = await caller.submitApiKey({ publicKey: 'public-key', privateKey: 'private-key' });

        expect(result).toEqual({
            success: false,
            failedStage: 0,
            error: {
                kind: 'ipAccess',
                title: 'This IP address is not allowed',
                message:
                    "MongoDB Atlas blocked this request because IP address 203.0.113.9 isn't on the allowed access list. Add this IP address in MongoDB Atlas, then retry.",
                action: {
                    label: 'Open access settings in MongoDB Atlas',
                    url: 'https://cloud.mongodb.com/v2#/org/org-1/access/apiKeys',
                },
            },
        });
        expect(context.credentialState.credentialsStored).toBe(false);
    });

    it('uses the generic IP access error when Atlas omits the rejected address', async () => {
        mockListProjects.mockRejectedValue(
            new AtlasApiError('Access denied', 403, 'Access list denied the request.', 'IP_ADDRESS_NOT_ON_ACCESS_LIST'),
        );
        mockGetAtlasCredential.mockResolvedValue({
            id: 'credential-1',
            authMethod: 'apikey',
            orgId: 'org-1',
            order: 0,
        });
        const caller = createCallerFactory(atlasCredentialsRouter)({ ...createContext('credential-1') });

        const result = await caller.submitApiKey({ publicKey: 'public-key', privateKey: 'private-key' });

        expect(result).toMatchObject({
            success: false,
            error: {
                kind: 'ipAccess',
                message:
                    "MongoDB Atlas blocked this request because your IP address isn't on the allowed access list. Add your current IP address in MongoDB Atlas, then retry.",
            },
        });
    });

    it('keeps the panel open after saving until the success screen is completed', async () => {
        mockListProjects.mockResolvedValue([{ id: 'project-1' }]);
        mockUpsertAtlasCredential.mockResolvedValue({
            created: true,
            record: { id: 'credential-1', authMethod: 'apikey', order: 0 },
        });
        const context = createContext();
        const submitCaller = createCallerFactory(atlasCredentialsRouter)({ ...context });

        await expect(
            submitCaller.submitApiKey({ publicKey: 'public-key', privateKey: 'private-key' }),
        ).resolves.toEqual({ success: true });

        expect(context.credentialState.credentialsStored).toBe(true);
        expect(context.onCredentialPersisted).toHaveBeenCalledTimes(1);
        expect(context.onCredentialsStored).not.toHaveBeenCalled();

        const completeCaller = createCallerFactory(atlasCredentialsRouter)({ ...context });
        await completeCaller.complete();

        expect(context.onCredentialsStored).toHaveBeenCalledTimes(1);
    });

    it('does not store a credential when Atlas returns no accessible projects', async () => {
        mockListProjects.mockResolvedValue([]);
        const context = createContext();
        const caller = createCallerFactory(atlasCredentialsRouter)(context);

        await expect(caller.submitApiKey({ publicKey: 'public-key', privateKey: 'private-key' })).resolves.toEqual({
            success: false,
            failedStage: 0,
            error: {
                kind: 'noProjects',
                title: 'No accessible projects found',
                message:
                    'MongoDB Atlas accepted the credential but returned no projects. The organization may not contain any projects, or the credential may need an organization or project role.',
                action: {
                    label: 'Open access settings in MongoDB Atlas',
                    url: 'https://cloud.mongodb.com',
                },
            },
        });

        expect(mockUpsertAtlasCredential).not.toHaveBeenCalled();
        expect(context.credentialState.credentialsStored).toBe(false);
    });

    it('reports the project-access stage for a service account with no accessible projects', async () => {
        mockFetchServiceAccountToken.mockResolvedValue({ access_token: 'access-token', expires_in: 3600 });
        mockListProjects.mockResolvedValue([]);
        const context = createContext();
        const caller = createCallerFactory(atlasCredentialsRouter)(context);

        const result = await caller.submitServiceAccount({
            clientId: 'client-id',
            clientSecret: 'client-secret',
        });

        expect(result).toMatchObject({
            success: false,
            failedStage: 1,
            error: {
                kind: 'noProjects',
                title: 'No accessible projects found',
            },
        });
        expect(mockUpsertAtlasCredential).not.toHaveBeenCalled();
        expect(context.credentialState.credentialsStored).toBe(false);
    });

    it('trims surrounding whitespace from submitted credentials before validating and storing', async () => {
        mockListProjects.mockResolvedValue([{ id: 'project-1' }]);
        mockUpsertAtlasCredential.mockResolvedValue({
            created: true,
            record: { id: 'credential-1', authMethod: 'apikey', order: 0 },
        });
        const context = createContext();
        const caller = createCallerFactory(atlasCredentialsRouter)(context);

        await expect(
            caller.submitApiKey({ publicKey: '  abcdef12  ', privateKey: '\t private-key \n' }),
        ).resolves.toEqual({ success: true });

        // The stored secret carries no leading/trailing whitespace.
        expect(mockUpsertAtlasCredential).toHaveBeenCalledWith(
            { authMethod: 'apikey', publicKey: 'abcdef12', privateKey: 'private-key' },
            {},
        );
    });
});
