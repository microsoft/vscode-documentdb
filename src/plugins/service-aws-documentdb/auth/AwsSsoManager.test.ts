/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({ l10n: { t: (message: string): string => message } }));
vi.mock('@aws-sdk/client-sso-oidc', () => ({
    SSOOIDCClient: class {
        public send(command: unknown, options: unknown): Promise<unknown> {
            return oidcSend(command, options);
        }
        public destroy(): void {}
    },
    RegisterClientCommand: class { constructor(public input: unknown) {} },
    StartDeviceAuthorizationCommand: class { constructor(public input: unknown) {} },
    CreateTokenCommand: class { constructor(public input: unknown) {} },
}));
vi.mock('@aws-sdk/client-sso', () => ({
    SSOClient: class {
        public send(command: unknown, options: unknown): Promise<unknown> {
            return ssoSend(command, options);
        }
        public destroy(): void {}
    },
    GetRoleCredentialsCommand: class { constructor(public input: unknown) {} },
    paginateListAccounts: (...args: unknown[]): unknown => accountPages(...args),
    paginateListAccountRoles: (...args: unknown[]): unknown => rolePages(...args),
}));

import { AwsSsoManager, resolveSsoCredentials } from './AwsSsoManager';
import { AwsInteractionRequiredError } from './errors';

const oidcSend = vi.hoisted(() => vi.fn());
const ssoSend = vi.hoisted(() => vi.fn());
const accountPages = vi.hoisted(() => vi.fn());
const rolePages = vi.hoisted(() => vi.fn());

describe('AWS staged SSO flow', () => {
    let manager: AwsSsoManager;
    let now: number;

    beforeEach(() => {
        vi.useFakeTimers();
        now = Date.now();
        manager = new AwsSsoManager();
        oidcSend.mockReset();
        ssoSend.mockReset();
        accountPages.mockReset();
        rolePages.mockReset();
        oidcSend.mockResolvedValueOnce({
            clientId: 'private-client-id',
            clientSecret: 'private-client-secret',
            clientSecretExpiresAt: Math.floor(now / 1000) + 3600,
        }).mockResolvedValueOnce({
            deviceCode: 'private-device-code',
            userCode: 'AAAA-BBBB',
            verificationUri: 'https://device.sso.us-east-1.amazonaws.com/',
            interval: 5,
            expiresIn: 600,
        });
        accountPages.mockImplementation(async function* (): AsyncGenerator<unknown> {
            yield { accountList: [{ accountId: '123456789012', accountName: 'First' }] };
            yield { accountList: [{ accountId: '210987654321', accountName: 'Second' }] };
        });
        rolePages.mockImplementation(async function* (): AsyncGenerator<unknown> {
            yield { roleList: [{ roleName: 'ReadOnly' }] };
            yield { roleList: [{ roleName: 'Admin' }] };
        });
    });

    afterEach(() => {
        manager.dispose();
        vi.useRealTimers();
    });

    async function authorize(): Promise<string> {
        const started = await manager.begin('https://example.awsapps.com/start', 'us-east-1');
        vi.setSystemTime(now + 5000);
        oidcSend.mockResolvedValueOnce({ accessToken: 'private-access-token', refreshToken: 'private-refresh-token', expiresIn: 3600 });
        const polled = await manager.poll(started.flowId);
        expect(polled.status).toBe('authorized');
        return started.flowId;
    }

    it('returns only public device approval information and opaque flow IDs', async () => {
        const start = await manager.begin('https://example.awsapps.com/start', 'us-east-1');
        expect(start.flowId).toMatch(/^[a-f\d-]{36}$/);
        expect(start.userCode).toBe('AAAA-BBBB');
        expect(JSON.stringify(start)).not.toContain('private-');
        expect(() => manager.staged(start.flowId, '123456789012')).toThrow(AwsInteractionRequiredError);
    });

    it('performs one poll at a time and honors pending and slow-down intervals', async () => {
        const start = await manager.begin('https://example.awsapps.com/start', 'us-east-1');
        expect(await manager.poll(start.flowId)).toEqual({ status: 'pending' });
        expect(oidcSend).toHaveBeenCalledTimes(2);
        vi.setSystemTime(now + 5000);
        oidcSend.mockRejectedValueOnce(Object.assign(new Error('pending'), { name: 'AuthorizationPendingException' }));
        expect(await manager.poll(start.flowId)).toEqual({ status: 'pending' });
        expect(oidcSend).toHaveBeenCalledTimes(3);
        vi.setSystemTime(now + 10_000);
        oidcSend.mockRejectedValueOnce(Object.assign(new Error('slow down'), { name: 'SlowDownException' }));
        expect(await manager.poll(start.flowId)).toEqual({ status: 'pending' });
        vi.setSystemTime(now + 15_000);
        expect(await manager.poll(start.flowId)).toEqual({ status: 'pending' });
        expect(oidcSend).toHaveBeenCalledTimes(4);
    });

    it('keeps authorized tokens host-side while paginating accounts and roles', async () => {
        const id = await authorize();
        const result = await manager.poll(id);
        expect(result.accounts).toHaveLength(2);
        expect(JSON.stringify(result)).not.toContain('private-');
        expect(await manager.roles(id, '123456789012')).toEqual(['Admin', 'ReadOnly']);
        expect(manager.staged(id, '123456789012').secrets.accessToken).toBe('private-access-token');
        await expect(manager.roles(id, '999999999999')).rejects.toBeInstanceOf(AwsInteractionRequiredError);
    });

    it('makes cancel idempotent and invalidates staged state before it can be committed', async () => {
        const id = await authorize();
        const staged = manager.staged(id, '123456789012');
        manager.cancel(id);
        manager.cancel(id);
        expect(staged.assertCurrent).toThrow();
        expect(() => manager.staged(id, '123456789012')).toThrow(AwsInteractionRequiredError);
        await expect(manager.poll(id)).rejects.toBeInstanceOf(AwsInteractionRequiredError);
    });

    it('rejects late token responses after cancelling the flow', async () => {
        const start = await manager.begin('https://example.awsapps.com/start', 'us-east-1');
        vi.setSystemTime(now + 5000);
        let finish: (value: unknown) => void = (): void => {};
        oidcSend.mockImplementationOnce((): Promise<unknown> => new Promise((resolve) => { finish = resolve; }));
        const polling = manager.poll(start.flowId);
        manager.cancel(start.flowId);
        finish({ accessToken: 'late-token', expiresIn: 3600 });
        await expect(polling).rejects.toMatchObject({ name: 'AbortError' });
        expect(() => manager.staged(start.flowId, '123456789012')).toThrow(AwsInteractionRequiredError);
        expect(accountPages).not.toHaveBeenCalled();
    });

    it('discards an unfinished begin operation when its caller cancels', async () => {
        oidcSend.mockReset();
        let finish: (value: unknown) => void = (): void => {};
        oidcSend.mockImplementationOnce((): Promise<unknown> => new Promise((resolve) => { finish = resolve; }));
        const controller = new AbortController();
        const starting = manager.begin('https://example.awsapps.com/start', 'us-east-1', controller.signal);
        controller.abort();
        finish({ clientId: 'id', clientSecret: 'secret', clientSecretExpiresAt: now / 1000 + 3600 });
        await expect(starting).rejects.toMatchObject({ name: 'AbortError' });
        expect(oidcSend).toHaveBeenCalledTimes(1);
    });

    it('expires abandoned flows without persisting their tokens', async () => {
        const start = await manager.begin('https://example.awsapps.com/start', 'us-east-1');
        vi.advanceTimersByTime(600_001);
        await expect(manager.poll(start.flowId)).rejects.toBeInstanceOf(AwsInteractionRequiredError);
    });

    it('refreshes SSO tokens silently and passes abort signals to both AWS clients', async () => {
        oidcSend.mockReset();
        oidcSend.mockResolvedValue({ accessToken: 'renewed-token', refreshToken: 'renewed-refresh', expiresIn: 3600 });
        ssoSend.mockResolvedValue({
            roleCredentials: { accessKeyId: 'key', secretAccessKey: 'secret', sessionToken: 'session', expiration: now + 3600_000 },
        });
        const controller = new AbortController();
        const result = await resolveSsoCredentials({
            kind: 'sso',
            clientId: 'id',
            clientSecret: 'client-secret',
            clientSecretExpiresAt: now + 3600_000,
            accessToken: 'expired-token',
            accessTokenExpiresAt: now - 1,
            refreshToken: 'refresh',
        }, 'us-east-1', '123456789012', 'ReadOnly', controller.signal);
        expect(result.secrets.accessToken).toBe('renewed-token');
        expect(result.credentials.sessionToken).toBe('session');
        expect(oidcSend.mock.calls[0][1]).toEqual({ abortSignal: controller.signal });
        expect(ssoSend.mock.calls[0][1]).toEqual({ abortSignal: controller.signal });
    });
});
