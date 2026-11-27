/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    BSON,
    MongoNetworkError,
    MongoServerError,
    type Binary,
    type MongoCredentials,
    type MongoDBNamespace,
    type OIDCCallbackFunction,
    type OIDCResponse,
} from 'mongodb';
// eslint-disable-next-line import/no-internal-modules -- Exercise the installed driver's real OIDC workflow.
import { AutomatedCallbackWorkflow as DriverWorkflow } from 'mongodb/lib/cmap/auth/mongodb_oidc/automated_callback_workflow.js';
// eslint-disable-next-line import/no-internal-modules -- The workflow needs the driver's real token cache.
import { TokenCache as DriverTokenCache } from 'mongodb/lib/cmap/auth/mongodb_oidc/token_cache.js';
import { describe, expect, it, vi } from 'vitest';
import { classifyConnectionFailure } from '../connectionFailures';
import { AuthMethodId } from './AuthMethod';

// The driver's public declarations omit these internals. Type only the surface the suite uses.
interface SaslStart {
    saslStart: number;
    mechanism: string;
    payload: Binary;
}

interface FakeConnection {
    command(namespace: MongoDBNamespace, command: SaslStart, options: undefined): Promise<{ ok: number }>;
}

interface OidcTokenCache {
    put(response: OIDCResponse): void;
}

type WorkflowCredentials = Pick<MongoCredentials, 'source' | 'username' | 'mechanismProperties'>;

interface OidcWorkflow {
    fetchAccessToken(credentials: WorkflowCredentials): Promise<OIDCResponse>;
    speculativeAuth(
        connection: FakeConnection,
        credentials: WorkflowCredentials,
    ): Promise<{ speculativeAuthenticate?: SaslStart & { db: string } }>;
    execute(connection: FakeConnection, credentials: WorkflowCredentials): Promise<void>;
}

const TokenCache = DriverTokenCache as new () => OidcTokenCache;
const AutomatedCallbackWorkflow = DriverWorkflow as new (
    cache: OidcTokenCache,
    callback: OIDCCallbackFunction,
) => OidcWorkflow;

const credentials: WorkflowCredentials = {
    source: '$external',
    username: 'dummy-user',
    mechanismProperties: {},
};

describe('driver contract: mongodb OIDC workflow (7.2.0)', () => {
    it('rethrows the identical callback error on the next fetch without calling the callback again', async () => {
        const error = new Error('dummy callback failure');
        const callback = vi.fn<OIDCCallbackFunction>().mockRejectedValueOnce(error);
        const workflow = new AutomatedCallbackWorkflow(new TokenCache(), callback);

        await expect(workflow.fetchAccessToken(credentials)).rejects.toBe(error);
        await expect(workflow.fetchAccessToken(credentials)).rejects.toBe(error);
        expect(callback).toHaveBeenCalledTimes(1);
    });

    it('offers the cached token in speculative authentication after its advertised lifetime', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        try {
            vi.setSystemTime(1_000);
            const cache = new TokenCache();
            cache.put({ accessToken: 'dummy-cached-token', expiresInSeconds: 1 });
            const callback = vi.fn<OIDCCallbackFunction>();
            const workflow = new AutomatedCallbackWorkflow(cache, callback);
            const command = vi.fn<FakeConnection['command']>();
            vi.setSystemTime(3_000);

            const { speculativeAuthenticate } = await workflow.speculativeAuth({ command }, credentials);

            expect(speculativeAuthenticate).toMatchObject({
                db: '$external',
                saslStart: 1,
                mechanism: 'MONGODB-OIDC',
            });
            expect(speculativeAuthenticate && BSON.deserialize(speculativeAuthenticate.payload.value())).toEqual({
                jwt: 'dummy-cached-token',
            });
            expect(callback).not.toHaveBeenCalled();
            expect(command).not.toHaveBeenCalled();
        } finally {
            vi.useRealTimers();
        }
    });

    it('calls the callback again on code 18 and retries authentication with the new token', async () => {
        const callback = vi
            .fn<OIDCCallbackFunction>()
            .mockResolvedValueOnce({ accessToken: 'dummy-cached-token' })
            .mockResolvedValueOnce({ accessToken: 'dummy-renewed-token' });
        const workflow = new AutomatedCallbackWorkflow(new TokenCache(), callback);
        await workflow.execute(
            { command: vi.fn<FakeConnection['command']>().mockResolvedValue({ ok: 1 }) },
            credentials,
        );
        expect(callback).toHaveBeenCalledTimes(1);

        const command = vi
            .fn<FakeConnection['command']>()
            .mockRejectedValueOnce(new MongoServerError({ code: 18, errmsg: 'dummy authentication failure' }))
            .mockResolvedValue({ ok: 1 });
        await workflow.execute({ command }, credentials);

        expect(callback).toHaveBeenCalledTimes(2);
        expect(command.mock.calls.map(([, request]) => BSON.deserialize(request.payload.value()))).toEqual([
            { jwt: 'dummy-cached-token' },
            { jwt: 'dummy-renewed-token' },
        ]);
    });

    it('propagates the final code 18 unchanged when the callback-supplied token is also rejected', async (): Promise<void> => {
        const cache = new TokenCache();
        cache.put({ accessToken: 'dummy-cached-token' });
        const callback = vi.fn<OIDCCallbackFunction>().mockResolvedValue({ accessToken: 'dummy-callback-token' });
        const workflow = new AutomatedCallbackWorkflow(cache, callback);
        const finalError = new MongoServerError({ code: 18, errmsg: 'dummy authentication failure' });
        const command = vi
            .fn<FakeConnection['command']>()
            .mockRejectedValueOnce(new MongoServerError({ code: 18, errmsg: 'dummy authentication failure' }))
            .mockRejectedValueOnce(finalError);

        await expect(workflow.execute({ command }, credentials)).rejects.toBe(finalError);
        expect(classifyConnectionFailure(finalError, AuthMethodId.MicrosoftEntraID)).toEqual({
            kind: 'credentialsRejected',
            generation: 'evict',
        });
        expect(callback).toHaveBeenCalledTimes(1);
        expect(command.mock.calls.map(([, request]) => BSON.deserialize(request.payload.value()))).toEqual([
            { jwt: 'dummy-cached-token' },
            { jwt: 'dummy-callback-token' },
        ]);
    });

    it('propagates a network error without calling the callback again or retrying the command', async () => {
        const callback = vi.fn<OIDCCallbackFunction>().mockResolvedValue({ accessToken: 'dummy-cached-token' });
        const workflow = new AutomatedCallbackWorkflow(new TokenCache(), callback);
        await workflow.execute(
            { command: vi.fn<FakeConnection['command']>().mockResolvedValue({ ok: 1 }) },
            credentials,
        );
        expect(callback).toHaveBeenCalledTimes(1);

        const error = new MongoNetworkError('dummy network failure');
        const command = vi.fn<FakeConnection['command']>().mockRejectedValueOnce(error).mockResolvedValue({ ok: 1 });

        await expect(workflow.execute({ command }, credentials)).rejects.toBe(error);
        expect(callback).toHaveBeenCalledTimes(1);
        expect(command).toHaveBeenCalledTimes(1);
    });
});
