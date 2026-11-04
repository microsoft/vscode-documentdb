/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';

vi.mock('vscode', () => ({ l10n: { t: (message: string): string => message } }));
vi.mock('../../../extensionVariables', () => ({ ext: {} }));

import { type AwsCredentialIdentity } from '@aws-sdk/types';
import { type AwsIdentity } from '../api/documentDb';
import { AwsSsoManager } from '../auth/AwsSsoManager';
import { AwsInteractionRequiredError } from '../auth/errors';
import { AwsCredentialStore, type AwsCredentialStorage } from '../credentials/awsCredentialStore';
import { type AwsCluster, type AwsCredentialInput } from '../types';
import { AwsDiscoveryService, type AwsDiscoveryDependencies } from './AwsDiscoveryService';

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: Error) => void } {
    let resolve: (value: T) => void = (): void => {};
    let reject: (error: Error) => void = (): void => {};
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

function backing(): { storage: AwsCredentialStorage; secrets: Map<string, string>; writes: Mock } {
    let records: ReturnType<AwsCredentialStorage['read']> = [];
    const secrets = new Map<string, string>();
    const writes = vi.fn(async (value: ReturnType<AwsCredentialStorage['read']>): Promise<void> => {
        records = value;
    });
    return {
        secrets,
        writes,
        storage: {
            read: (): ReturnType<AwsCredentialStorage['read']> => records,
            write: writes,
            getSecret: async (key): Promise<string | undefined> => secrets.get(key),
            storeSecret: async (key, value): Promise<void> => {
                secrets.set(key, value);
            },
            deleteSecret: async (key): Promise<void> => {
                secrets.delete(key);
            },
        },
    };
}

const input: AwsCredentialInput = {
    authMethod: 'accessKey',
    regions: ['us-east-1', 'eu-west-1'],
    accessKeyId: 'test-key',
    secretAccessKey: 'secret-only-in-secure-storage',
};
const identity: AwsIdentity = { accountId: '123456789012', arn: 'arn:aws:iam::123456789012:user/test' };

function cluster(ownerCredentialId: string, region = 'us-east-1'): AwsCluster {
    const arn = `arn:aws:rds:${region}:123456789012:cluster:test`;
    return {
        id: arn,
        arn,
        accountId: identity.accountId,
        name: 'test',
        region,
        port: 27017,
        status: 'available',
        ownerCredentialId,
    };
}

describe('AWS credential acceptance and discovery', () => {
    const services: AwsDiscoveryService[] = [];

    function setup(overrides: AwsDiscoveryDependencies = {}): {
        service: AwsDiscoveryService;
        store: AwsCredentialStore;
        state: ReturnType<typeof backing>;
        verify: Mock;
        discover: Mock;
    } {
        const state = backing();
        const store = new AwsCredentialStore(state.storage);
        const verify = vi.fn(async (): Promise<AwsIdentity> => identity);
        const discover = vi.fn(async (): Promise<AwsCluster[]> => []);
        const service = new AwsDiscoveryService({
            store,
            verifyIdentity: verify,
            discoverRegion: discover,
            ...overrides,
        });
        services.push(service);
        return { service, store, state, verify, discover };
    }

    afterEach(() => {
        services.splice(0).forEach((service) => service.dispose());
    });

    it('never persists candidate keys before STS verification completes', async () => {
        const gate = deferred<AwsIdentity>();
        const { service, state } = setup({ verifyIdentity: (): Promise<AwsIdentity> => gate.promise });
        const saving = service.verifyAndSave(input);
        await Promise.resolve();
        expect(state.writes).not.toHaveBeenCalled();
        expect(state.secrets.size).toBe(0);
        gate.resolve(identity);
        const record = await saving;
        expect(record.id).toMatch(/^[a-f\d-]{36}$/);
        expect(state.secrets.size).toBe(1);
        expect(JSON.stringify(state.storage.read())).not.toContain(input.secretAccessKey);
        expect(JSON.stringify(state.storage.read())).not.toContain(input.accessKeyId);
    });

    it('preserves a previous credential after failed replacement and sanitizes errors', async () => {
        const { service, store, verify } = setup();
        const previous = await service.verifyAndSave(input);
        verify.mockRejectedValueOnce(new Error(`request leaked ${input.secretAccessKey}`));
        await expect(
            service.verifyAndSave({ ...input, secretAccessKey: 'replacement' }, undefined, previous.id),
        ).rejects.not.toThrow(input.secretAccessKey);
        expect(await service.listCredentials()).toEqual([previous]);
        expect(await store.secrets(previous.id)).toMatchObject({ secretAccessKey: input.secretAccessKey });
    });

    it('preserves prior metadata and secrets if a verified update cannot be committed', async () => {
        const { service, store, state } = setup();
        const record = await service.verifyAndSave(input);
        state.writes.mockRejectedValueOnce(new Error('storage failure'));
        await expect(
            service.verifyAndSave({ ...input, secretAccessKey: 'replacement' }, undefined, record.id),
        ).rejects.toThrow();
        expect(await service.listCredentials()).toEqual([record]);
        expect(await store.secrets(record.id)).toMatchObject({ secretAccessKey: input.secretAccessKey });
        expect(state.secrets.size).toBe(1);
    });

    it('keeps multiple entries for the same account independent', async () => {
        const { service, store } = setup();
        const first = await service.verifyAndSave(input);
        const second = await service.verifyAndSave({
            ...input,
            label: 'Second role',
            secretAccessKey: 'second-secret',
            regions: ['us-west-2'],
        });
        expect(first.id).not.toBe(second.id);
        await service.removeCredential(first.id);
        expect(await service.listCredentials()).toEqual([second]);
        expect(await store.secrets(second.id)).toMatchObject({ secretAccessKey: 'second-secret' });
        expect(await store.secrets(first.id)).toBeUndefined();
    });

    it('keeps temporary credentials and metadata entirely in memory', async () => {
        const { service, store, state } = setup();
        const record = await service.verifyAndSave({
            ...input,
            authMethod: 'temporary',
            sessionToken: 'session-secret',
            expiration: new Date(Date.now() + 3600_000).toISOString(),
        });
        expect(await store.secrets(record.id)).toMatchObject({ sessionToken: 'session-secret' });
        expect(state.secrets.size).toBe(0);
        expect(state.writes).not.toHaveBeenCalled();
        const restored = new AwsCredentialStore(state.storage);
        expect(await restored.list()).toEqual([]);
        service.dispose();
        expect(await store.list()).toEqual([]);
    });

    it('accepts a verified identity when every discovery region denies access', async () => {
        const { service, discover } = setup();
        const denied = new Error(`denied ${input.secretAccessKey}`);
        denied.name = 'AccessDeniedException';
        discover.mockRejectedValue(denied);
        const record = await service.verifyAndSave(input);
        const snapshot = await service.listAll();
        expect(snapshot.clusters).toEqual([]);
        expect(snapshot.errors).toHaveLength(2);
        expect(snapshot.errors.every((error) => error.kind === 'permission' && error.credentialId === record.id)).toBe(
            true,
        );
        expect(JSON.stringify(snapshot)).not.toContain(input.secretAccessKey);
        expect(await service.listCredentials()).toHaveLength(1);
    });

    it('preserves healthy regions independently and treats empty discovery as valid', async () => {
        const { service, discover } = setup();
        const record = await service.verifyAndSave(input);
        discover.mockImplementation(async (_record, _credentials, region: string): Promise<AwsCluster[]> => {
            if (region === 'eu-west-1') {
                const error = new Error('denied');
                error.name = 'AccessDeniedException';
                throw error;
            }
            return [cluster(record.id)];
        });
        expect(await service.listAll()).toMatchObject({
            clusters: [cluster(record.id)],
            errors: [{ region: 'eu-west-1', kind: 'permission' }],
        });
        discover.mockResolvedValue([]);
        expect(await service.listAll(true)).toEqual({ clusters: [], errors: [] });
    });

    it('does not save when verification is cancelled', async () => {
        const gate = deferred<AwsIdentity>();
        const { service, state } = setup({ verifyIdentity: (): Promise<AwsIdentity> => gate.promise });
        const controller = new AbortController();
        const saving = service.verifyAndSave(input, controller.signal);
        controller.abort();
        gate.resolve(identity);
        await expect(saving).rejects.toMatchObject({ name: 'AbortError' });
        expect(state.secrets.size).toBe(0);
        expect(await service.listCredentials()).toEqual([]);
    });

    it('rolls back a staged secret if cancellation happens while secure storage writes', async () => {
        const { service, state } = setup();
        const controller = new AbortController();
        const original = state.storage.storeSecret;
        state.storage.storeSecret = async (key, value): Promise<void> => {
            await original(key, value);
            controller.abort();
        };
        await expect(service.verifyAndSave(input, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
        expect(state.secrets.size).toBe(0);
        expect(state.writes).not.toHaveBeenCalled();
    });

    it('does not revive a removed credential after late verification', async () => {
        const { service, verify } = setup();
        const record = await service.verifyAndSave(input);
        const started = deferred<void>();
        const gate = deferred<AwsIdentity>();
        verify.mockImplementationOnce((): Promise<AwsIdentity> => {
            started.resolve();
            return gate.promise;
        });
        const saving = service.verifyAndSave({ ...input, label: 'Late update' }, undefined, record.id);
        await started.promise;
        await service.removeCredential(record.id);
        gate.resolve(identity);
        await expect(saving).rejects.toMatchObject({ name: 'AbortError' });
        expect(await service.listCredentials()).toEqual([]);
    });

    it('rejects a stale scan and never caches clusters after credential removal', async () => {
        const { service, discover } = setup();
        const record = await service.verifyAndSave({ ...input, regions: ['us-east-1'] });
        const started = deferred<void>();
        const gate = deferred<AwsCluster[]>();
        discover.mockImplementation((): Promise<AwsCluster[]> => {
            started.resolve();
            return gate.promise;
        });
        const scanning = service.listAll();
        await started.promise;
        await service.removeCredential(record.id);
        gate.resolve([cluster(record.id)]);
        await expect(scanning).rejects.toMatchObject({ name: 'AbortError' });
        expect(await service.listAll()).toEqual({ clusters: [], errors: [] });
    });

    it('does not repopulate the identity cache from a late profile refresh after removal', async () => {
        const started = deferred<void>();
        const gate = deferred<AwsCredentialIdentity>();
        const provider = vi.fn(
            (_profile: string, _region: string, interactive: boolean) => async (): Promise<AwsCredentialIdentity> => {
                if (interactive) {
                    return { accessKeyId: 'old-key', secretAccessKey: 'old-secret' };
                }
                started.resolve();
                return gate.promise;
            },
        );
        const { service } = setup({ profileProvider: provider });
        const record = await service.verifyAndSave({ authMethod: 'profile', profile: 'role', regions: ['us-east-1'] });
        service.invalidate(record.id);
        const scanning = service.listAll();
        const result = expect(scanning).rejects.toMatchObject({ name: 'AbortError' });
        await started.promise;
        await service.removeCredential(record.id);
        gate.resolve({ accessKeyId: 'late-key', secretAccessKey: 'late-secret' });
        await result;
        expect(await service.listAll()).toEqual({ clusters: [], errors: [] });
    });

    it('uses foreground profile resolution only for explicit verification', async () => {
        const provider = vi.fn(
            (_profile: string, _region: string, interactive: boolean) => async (): Promise<AwsCredentialIdentity> => {
                if (!interactive) {
                    throw new AwsInteractionRequiredError();
                }
                return { accessKeyId: 'profile-key', secretAccessKey: 'profile-secret' };
            },
        );
        const { service } = setup({ profileProvider: provider });
        const record = await service.verifyAndSave({
            authMethod: 'profile',
            profile: 'role-with-mfa',
            regions: ['us-east-1'],
        });
        service.invalidate(record.id);
        const snapshot = await service.listAll();
        expect(provider.mock.calls.map((call) => call[2])).toEqual([true, false]);
        expect(snapshot).toMatchObject({ clusters: [], errors: [{ credentialId: record.id, kind: 'auth' }] });
    });

    it('preserves verified profile identities when discovery is refreshed', async () => {
        const provider = vi.fn(
            (_profile: string, _region: string, interactive: boolean) => async (): Promise<AwsCredentialIdentity> => {
                if (!interactive) {
                    throw new AwsInteractionRequiredError();
                }
                return { accessKeyId: 'profile-key', secretAccessKey: 'profile-secret' };
            },
        );
        const { service, discover } = setup({ profileProvider: provider });
        const record = await service.verifyAndSave({
            authMethod: 'profile',
            profile: 'role-with-mfa',
            regions: ['us-east-1'],
        });

        service.refreshDiscovery();

        expect(await service.listAll()).toMatchObject({ clusters: [], errors: [] });
        expect(provider.mock.calls.map((call) => call[2])).toEqual([true]);
        expect(discover).toHaveBeenCalledWith(record, expect.anything(), 'us-east-1', expect.anything());
    });

    it('deduplicates clusters by ARN independently of credential ownership', async () => {
        const { service, discover } = setup();
        const first = await service.verifyAndSave({ ...input, regions: ['us-east-1'] });
        const second = await service.verifyAndSave({ ...input, regions: ['us-east-1'] });
        discover.mockImplementation(async (record): Promise<AwsCluster[]> => [cluster(record.id)]);
        expect((await service.listAll()).clusters).toEqual([cluster(first.id)]);
        await service.removeCredential(first.id);
        expect((await service.listAll()).clusters).toEqual([cluster(second.id)]);
    });

    it('cancels a regional scan without returning a successful empty snapshot', async () => {
        const { service, discover } = setup();
        await service.verifyAndSave({ ...input, regions: ['us-east-1'] });
        const started = deferred<void>();
        const gate = deferred<AwsCluster[]>();
        discover.mockImplementation((): Promise<AwsCluster[]> => {
            started.resolve();
            return gate.promise;
        });
        const controller = new AbortController();
        const scanning = service.listAll(false, controller.signal);
        await started.promise;
        controller.abort();
        gate.resolve([]);
        await expect(scanning).rejects.toMatchObject({ name: 'AbortError' });
    });

    it('limits concurrent regional requests to four', async () => {
        const { service, discover } = setup();
        await service.verifyAndSave({
            ...input,
            regions: Array.from({ length: 8 }, (_, index) => `us-east-${index + 1}`),
        });
        let active = 0;
        let maximum = 0;
        const started = deferred<void>();
        const release = deferred<void>();
        discover.mockImplementation(async (): Promise<AwsCluster[]> => {
            active++;
            maximum = Math.max(maximum, active);
            if (active === 4) {
                started.resolve();
            }
            await release.promise;
            active--;
            return [];
        });
        const scanning = service.listAll();
        await started.promise;
        expect(discover).toHaveBeenCalledTimes(4);
        release.resolve();
        await scanning;
        expect(discover).toHaveBeenCalledTimes(8);
        expect(maximum).toBe(4);
    });

    it('keeps SSO tokens staged until STS succeeds and consumes the flow only after acceptance', async () => {
        const sso = new AwsSsoManager();
        const stagedSecrets = {
            kind: 'sso' as const,
            clientId: 'client-id',
            clientSecret: 'client-secret',
            clientSecretExpiresAt: Date.now() + 3600_000,
            accessToken: 'staged-access-token',
            accessTokenExpiresAt: Date.now() + 3600_000,
            refreshToken: 'staged-refresh-token',
        };
        const stage = vi.spyOn(sso, 'staged').mockReturnValue({
            startUrl: 'https://example.awsapps.com/start',
            region: 'us-east-1',
            secrets: stagedSecrets,
            assertCurrent: (): void => {},
        });
        const cancel = vi.spyOn(sso, 'cancel');
        const verification = deferred<AwsIdentity>();
        const verifying = deferred<void>();
        const { service, state } = setup({
            sso,
            resolveSsoCredentials: async (): Promise<{
                credentials: AwsCredentialIdentity;
                secrets: typeof stagedSecrets;
            }> => ({
                credentials: { accessKeyId: 'role-key', secretAccessKey: 'role-secret', sessionToken: 'role-token' },
                secrets: stagedSecrets,
            }),
            verifyIdentity: (): Promise<AwsIdentity> => {
                verifying.resolve();
                return verification.promise;
            },
        });
        const saving = service.verifyAndSave({
            authMethod: 'sso',
            ssoFlowId: 'opaque-flow',
            accountId: identity.accountId,
            roleName: 'ReadOnly',
            regions: ['us-east-1'],
        });
        await verifying.promise;
        expect(stage).toHaveBeenCalledWith('opaque-flow', identity.accountId);
        expect(state.writes).not.toHaveBeenCalled();
        expect(state.secrets.size).toBe(0);
        expect(cancel).not.toHaveBeenCalled();
        verification.resolve(identity);
        const record = await saving;
        expect(record).toMatchObject({ authMethod: 'sso', roleName: 'ReadOnly', ssoRegion: 'us-east-1' });
        expect([...state.secrets.values()].join('')).toContain('staged-refresh-token');
        expect(JSON.stringify(state.storage.read())).not.toContain('staged-');
        expect(cancel).toHaveBeenCalledWith('opaque-flow');
    });

    it('persists SSO refresh-token rotation and renewed expiry even when the access token is unchanged', async () => {
        const sso = new AwsSsoManager();
        const expiresAt = Date.now() + 3600_000;
        const secrets = {
            kind: 'sso' as const,
            clientId: 'client-id',
            clientSecret: 'client-secret',
            clientSecretExpiresAt: expiresAt + 3600_000,
            accessToken: 'unchanged-access-token',
            accessTokenExpiresAt: expiresAt,
            refreshToken: 'original-refresh-token',
        };
        vi.spyOn(sso, 'staged').mockReturnValue({
            startUrl: 'https://example.awsapps.com/start',
            region: 'us-east-1',
            secrets,
            assertCurrent: (): void => {},
        });
        const credentials: AwsCredentialIdentity = {
            accessKeyId: 'role-key',
            secretAccessKey: 'role-secret',
            sessionToken: 'role-token',
            expiration: new Date(expiresAt),
        };
        const resolveSso = vi.fn(
            async (): Promise<{ credentials: AwsCredentialIdentity; secrets: typeof secrets }> => ({
                credentials,
                secrets,
            }),
        );
        const { service, store } = setup({ sso, resolveSsoCredentials: resolveSso });
        const record = await service.verifyAndSave({
            authMethod: 'sso',
            ssoFlowId: 'opaque-flow',
            accountId: identity.accountId,
            roleName: 'ReadOnly',
            regions: ['us-east-1'],
        });
        const renewedSecrets = {
            ...secrets,
            refreshToken: 'rotated-refresh-token',
            accessTokenExpiresAt: expiresAt + 1800_000,
        };
        resolveSso.mockResolvedValueOnce({
            credentials: { ...credentials, expiration: new Date(expiresAt + 1800_000) },
            secrets: renewedSecrets,
        });
        service.invalidate(record.id);
        await service.listAll();
        expect(await store.secrets(record.id)).toEqual(renewedSecrets);
        expect(await service.listCredentials()).toEqual([{ ...record, expiresAt: expiresAt + 1800_000 }]);
    });
});
