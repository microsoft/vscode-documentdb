/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type initWebviewTrpc as InitWebviewTrpc } from '@microsoft/vscode-ext-webview';

const mockVerifyAndSave = vi.hoisted(() => vi.fn());
const mockBeginSso = vi.hoisted(() => vi.fn());
const mockPollSso = vi.hoisted(() => vi.fn());
const mockListSsoRoles = vi.hoisted(() => vi.fn());
const mockCancelSso = vi.hoisted(() => vi.fn());
const mockOpenExternal = vi.hoisted(() => vi.fn());
const mockListProfiles = vi.hoisted(() => vi.fn());

vi.mock('vscode', () => ({
    l10n: { t: (message: string): string => message },
    env: { openExternal: (...args: unknown[]): unknown => mockOpenExternal(...args) },
    Uri: { parse: (value: string): string => value },
}));
vi.mock('@vscode/l10n', () => ({ t: (message: string): string => message }));
vi.mock('../../../plugins/service-aws-documentdb/discovery/AwsDiscoveryService', () => ({
    awsDiscoveryService: {
        verifyAndSave: (...args: unknown[]): unknown => mockVerifyAndSave(...args),
        beginSso: (...args: unknown[]): unknown => mockBeginSso(...args),
        pollSso: (...args: unknown[]): unknown => mockPollSso(...args),
        listSsoRoles: (...args: unknown[]): unknown => mockListSsoRoles(...args),
        cancelSso: (...args: unknown[]): unknown => mockCancelSso(...args),
        listProfiles: (...args: unknown[]): unknown => mockListProfiles(...args),
    },
}));
vi.mock('../../_integration/trpc', async () => {
    const { initWebviewTrpc } = await vi.importActual<{ initWebviewTrpc: typeof InitWebviewTrpc }>(
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
import { AwsInteractionRequiredError, AwsValidationError } from '../../../plugins/service-aws-documentdb/auth/errors';
import { type AwsCredentialRecord } from '../../../plugins/service-aws-documentdb/types';
import { createCallerFactory } from '../../_integration/trpc';
import {
    awsCredentialsRouter,
    credentialInputSchema,
    disposeAwsCredentialState,
    isAwsVerificationUrl,
    type RouterContext,
} from './awsCredentialsRouter';

function createContext(): RouterContext & {
    actionContext: { telemetry: { properties: Record<string, string>; measurements: Record<string, number> } };
} {
    return {
        dbExperience: API.DocumentDB,
        webviewName: 'awsCredentials',
        credentialState: {
            credentialsStored: false,
            submitting: false,
            ssoGeneration: 0,
            lifetime: new AbortController(),
            ssoFlows: new Set(),
        },
        onCredentialPersisted: vi.fn(),
        onCancelled: vi.fn(),
        onCredentialsStored: vi.fn(),
        actionContext: { telemetry: { properties: {}, measurements: {} } },
    };
}

const record: AwsCredentialRecord = {
    id: 'entry-one',
    label: 'Work',
    authMethod: 'accessKey',
    regions: ['us-east-1'],
    accountId: '123456789012',
    arn: 'arn:aws:iam::123456789012:user/test',
};
const input = {
    authMethod: 'accessKey' as const,
    regions: ['us-east-1'],
    accessKeyId: 'key-id',
    secretAccessKey: 'secret-value',
};
const flow = {
    flowId: 'flow-one',
    verificationUri: 'https://device.sso.us-east-1.amazonaws.com/',
    userCode: 'ABCD-EFGH',
    intervalSeconds: 5,
};
const createCaller = createCallerFactory(awsCredentialsRouter);

beforeEach(() => {
    vi.clearAllMocks();
    mockVerifyAndSave.mockReset().mockResolvedValue(record);
    mockBeginSso.mockReset().mockResolvedValue(flow);
    mockOpenExternal.mockReset().mockResolvedValue(true);
    mockPollSso.mockReset().mockResolvedValue({ status: 'pending' });
});

describe('AWS credential validation', () => {
    it('requires at least one region and the fields for each selected method', () => {
        expect(credentialInputSchema.safeParse({ ...input, regions: [] }).success).toBe(false);
        expect(
            credentialInputSchema.safeParse({
                authMethod: 'temporary',
                regions: ['us-east-1'],
                accessKeyId: 'id',
                secretAccessKey: 'secret',
            }).success,
        ).toBe(false);
        expect(
            credentialInputSchema.safeParse({ authMethod: 'profile', regions: ['us-east-1'], profile: '' }).success,
        ).toBe(false);
        expect(
            credentialInputSchema.safeParse({
                authMethod: 'sso',
                regions: ['us-east-1'],
                ssoFlowId: 'flow',
                accountId: '123456789012',
            }).success,
        ).toBe(false);
    });

    it('deduplicates regions and strips fields outside the chosen method', () => {
        const parsed = credentialInputSchema.parse({
            authMethod: 'profile',
            regions: ['us-east-1', 'us-east-1'],
            profile: 'work',
            secretAccessKey: 'never-forward',
        });
        expect(parsed).toEqual({ authMethod: 'profile', regions: ['us-east-1'], profile: 'work' });
    });
});

describe('awsCredentialsRouter', () => {
    it('persists a verified identity without imposing cluster count or regional permission requirements', async () => {
        const context = createContext();
        context.credentialId = 'entry-one';
        const result = await createCaller(context).submit(input);
        expect(result).toEqual({ success: true, credential: record });
        expect(mockVerifyAndSave).toHaveBeenCalledWith(input, expect.any(AbortSignal), 'entry-one');
        expect(context.credentialState.credentialsStored).toBe(true);
        expect(context.onCredentialPersisted).toHaveBeenCalledTimes(1);
        expect(JSON.stringify(context.actionContext.telemetry)).not.toContain('secret-value');
    });

    it('does not claim persistence or expose raw SDK errors after verification fails', async () => {
        const context = createContext();
        mockVerifyAndSave.mockRejectedValue(new Error('SDK request contains secret-value'));
        const result = await createCaller(context).submit(input);
        expect(result.success).toBe(false);
        expect(JSON.stringify(result)).not.toContain('secret-value');
        expect(context.onCredentialPersisted).not.toHaveBeenCalled();
        expect(context.credentialState.credentialsStored).toBe(false);
        expect(context.credentialState.submitting).toBe(false);
    });

    it('preserves the typed interaction-required recovery message', async () => {
        const error = new AwsInteractionRequiredError();
        mockVerifyAndSave.mockRejectedValue(error);
        const result = await createCaller(createContext()).submit(input);
        expect(result).toMatchObject({ success: false, error: { message: error.message } });
    });

    it('does not permit duplicate submissions or completion before persistence', async () => {
        const context = createContext();
        await expect(createCaller(context).complete()).rejects.toThrow('Verify your AWS credential first.');
        context.credentialState.submitting = true;
        await expect(createCaller(context).submit(input)).rejects.toThrow('already being saved');
        expect(mockVerifyAndSave).not.toHaveBeenCalled();
    });

    it('opens only checked AWS device URLs and owns the returned flow', async () => {
        const context = createContext();
        await expect(
            createCaller(context).startSso({ startUrl: 'https://example.awsapps.com/start', ssoRegion: 'us-east-1' }),
        ).resolves.toEqual(flow);
        expect(context.credentialState.ssoFlows.has(flow.flowId)).toBe(true);
        expect(mockOpenExternal).toHaveBeenCalledWith(flow.verificationUri);
    });

    it('opens the directory access-portal verification URL returned by AWS device authorization', async () => {
        const portalFlow = {
            ...flow,
            verificationUri: 'https://directory-alias-example.awsapps.com/start/#/device?user_code=EXAMPLE',
        };
        mockBeginSso.mockResolvedValue(portalFlow);
        const context = createContext();
        await expect(
            createCaller(context).startSso({
                startUrl: 'https://directory-alias-example.awsapps.com/start',
                ssoRegion: 'us-east-1',
            }),
        ).resolves.toEqual(portalFlow);
        expect(mockOpenExternal).toHaveBeenCalledWith(portalFlow.verificationUri);
        expect(context.credentialState.ssoFlows.has(portalFlow.flowId)).toBe(true);
        expect(mockCancelSso).not.toHaveBeenCalled();
    });

    it('preserves a safe startup diagnostic without exposing raw AWS request details', async () => {
        const message = 'AWS could not start device authorization. Check the SSO start URL and Identity Center region.';
        mockBeginSso.mockRejectedValue(new AwsValidationError(message));
        await expect(
            createCaller(createContext()).startSso({
                startUrl: 'https://example.awsapps.com/start',
                ssoRegion: 'us-east-1',
            }),
        ).rejects.toThrow(message);
        mockBeginSso.mockRejectedValue(new Error('private-client-secret'));
        await expect(
            createCaller(createContext()).startSso({
                startUrl: 'https://example.awsapps.com/start',
                ssoRegion: 'us-east-1',
            }),
        ).rejects.not.toThrow('private-client-secret');
    });

    it('reports an actionable error and cleans up when no browser can be opened', async () => {
        mockOpenExternal.mockResolvedValue(false);
        await expect(
            createCaller(createContext()).startSso({
                startUrl: 'https://example.awsapps.com/start',
                ssoRegion: 'us-east-1',
            }),
        ).rejects.toThrow('browser');
        expect(mockCancelSso).toHaveBeenCalledWith(flow.flowId);
    });

    it('rejects a foreign flow for polling, role listing, cancellation, and submission', async () => {
        const caller = createCaller(createContext());
        await expect(caller.pollSso({ flowId: 'foreign' })).rejects.toThrow('in this panel');
        await expect(caller.listSsoRoles({ flowId: 'foreign', accountId: '123456789012' })).rejects.toThrow(
            'in this panel',
        );
        await expect(caller.cancelSso({ flowId: 'foreign' })).rejects.toThrow('in this panel');
        await expect(
            caller.submit({
                authMethod: 'sso',
                regions: ['us-east-1'],
                ssoFlowId: 'foreign',
                accountId: '123456789012',
                roleName: 'ReadOnly',
            }),
        ).rejects.toThrow('in this panel');
        expect(mockPollSso).not.toHaveBeenCalled();
        expect(mockListSsoRoles).not.toHaveBeenCalled();
        expect(mockCancelSso).not.toHaveBeenCalled();
        expect(mockVerifyAndSave).not.toHaveBeenCalled();
    });

    it('cleans up a staged flow when browser opening fails', async () => {
        const context = createContext();
        mockOpenExternal.mockRejectedValue(new Error('Browser failure'));
        await expect(
            createCaller(context).startSso({ startUrl: 'https://example.awsapps.com/start', ssoRegion: 'us-east-1' }),
        ).rejects.toThrow();
        expect(mockCancelSso).toHaveBeenCalledWith(flow.flowId);
        expect(context.credentialState.ssoFlows.size).toBe(0);
    });

    it('cleans up a staged flow if cancellation races with opening the browser', async () => {
        const context = createContext();
        mockOpenExternal.mockImplementation(() => {
            context.credentialState.lifetime.abort();
            return Promise.resolve(true);
        });
        await expect(
            createCaller(context).startSso({ startUrl: 'https://example.awsapps.com/start', ssoRegion: 'us-east-1' }),
        ).rejects.toThrow('cancelled');
        expect(mockCancelSso).toHaveBeenCalledWith(flow.flowId);
        expect(context.credentialState.ssoFlows.size).toBe(0);
    });

    it('cleans up a late SSO start when Back arrived before the webview knew its flow ID', async () => {
        const context = createContext();
        const caller = createCaller(context);
        mockBeginSso.mockImplementation(async () => {
            await caller.cancelSso({});
            return flow;
        });
        await expect(
            caller.startSso({
                startUrl: 'https://example.awsapps.com/start',
                ssoRegion: 'us-east-1',
            }),
        ).rejects.toThrow();
        expect(mockCancelSso).toHaveBeenCalledWith(flow.flowId);
        expect(context.credentialState.ssoFlows.size).toBe(0);
        expect(mockOpenExternal).not.toHaveBeenCalled();
        expect(context.credentialState.lifetime.signal.aborted).toBe(false);
    });

    it('does not return a cancelled flow if Back races with browser opening', async () => {
        const context = createContext();
        const caller = createCaller(context);
        mockOpenExternal.mockImplementation(async () => {
            await caller.cancelSso({});
            return true;
        });
        await expect(
            caller.startSso({
                startUrl: 'https://example.awsapps.com/start',
                ssoRegion: 'us-east-1',
            }),
        ).rejects.toThrow();
        expect(mockCancelSso).toHaveBeenCalledWith(flow.flowId);
        expect(context.credentialState.ssoFlows.size).toBe(0);
    });

    it('cancels all staged flows and rejects new operations after panel cancellation', async () => {
        const context = createContext();
        context.credentialState.ssoFlows.add('first').add('second');
        await createCaller(context).cancel();
        expect(context.credentialState.lifetime.signal.aborted).toBe(true);
        expect(mockCancelSso).toHaveBeenCalledWith('first');
        expect(mockCancelSso).toHaveBeenCalledWith('second');
        expect(context.credentialState.ssoFlows.size).toBe(0);
        expect(context.onCancelled).toHaveBeenCalledTimes(1);
        await expect(createCaller(context).submit(input)).rejects.toThrow('cancelled');
    });

    it('aborts in-flight verification when the panel is disposed', async () => {
        const context = createContext();
        mockVerifyAndSave.mockImplementation(
            (_input: unknown, signal: AbortSignal) =>
                new Promise((_resolve, reject) => {
                    signal.addEventListener('abort', () => reject(new Error('Cancelled')), { once: true });
                    disposeAwsCredentialState(context.credentialState);
                }),
        );
        await expect(createCaller(context).submit(input)).rejects.toThrow('cancelled');
        expect(context.onCredentialPersisted).not.toHaveBeenCalled();
    });
});

describe('AWS verification URL allowlist', () => {
    it.each([
        'https://device.sso.us-east-1.amazonaws.com/?user_code=EXAMPLE',
        'https://oidc.us-east-1.amazonaws.com/authorize',
        'https://device.sso.cn-north-1.amazonaws.com.cn/',
        'https://directory-alias-example.awsapps.com/start/#/device',
        'https://d-example.awsapps.com/start/#/device?user_code=EXAMPLE',
        'https://d-example.awsapps.cn/start/#/device?user_code=EXAMPLE',
    ])('accepts AWS device authorization URL %s', (url) => {
        expect(isAwsVerificationUrl(url)).toBe(true);
    });

    it.each([
        'not a URL',
        'http://device.sso.us-east-1.amazonaws.com/',
        'https://device.sso.us-east-1.amazonaws.com.evil.example/',
        'https://user@device.sso.us-east-1.amazonaws.com/',
        'https://device.sso.us-east-1.amazonaws.com:444/',
        'https://example.com/',
        'http://directory.awsapps.com/start/#/device',
        'https://directory.awsapps.com.evil.example/start/#/device',
        'https://user@directory.awsapps.com/start/#/device',
        'https://directory.awsapps.com:444/start/#/device',
        'https://awsapps.com/start/#/device',
        'https://a.b.awsapps.com/start/#/device',
        'https://directory.awsapps.com/unrelated-path',
    ])('rejects %s', (url) => {
        expect(isAwsVerificationUrl(url)).toBe(false);
    });
});
