/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Exercises the REAL `ManagedIdentityCredential` against a local HTTP server standing in for the
 * identity endpoint. No Azure resources are involved.
 *
 * `@azure/identity` delegates managed identity to `@azure/msal-node`, whose App Service source reads
 * `IDENTITY_ENDPOINT` and `IDENTITY_HEADER` from the environment (verified in `node_modules`, API
 * version `2019-08-01`). Pointing those at an `http.Server` therefore drives the genuine credential
 * end to end.
 *
 * The point of this suite is not coverage. It is to pin down what failures actually look like, so
 * the substring matching in `managedIdentityErrors.ts` is written against observed shapes rather
 * than guesses (plan risk #5). If an `@azure/identity` upgrade changes the wording, this fails
 * before a user sees an unhelpful message.
 *
 * Note that every failure observed here arrives as a `CredentialUnavailableError` regardless of
 * cause, which is why the classifier cannot key off the error name.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http';
import { classifyManagedIdentityError, describeManagedIdentityError } from './managedIdentityErrors';

const CLIENT_ID = '11111111-2222-3333-4444-555555555555';
const RESOURCE = 'https://ossrdbms-aad.database.windows.net';

/** A port nothing listens on, used to force a transport failure deterministically. */
const CLOSED_PORT_ENDPOINT = 'http://127.0.0.1:1/';

interface CapturedRequest {
    readonly query: URLSearchParams;
    readonly headers: NodeJS.Dict<string | string[]>;
}

type Responder = (request: IncomingMessage, response: ServerResponse) => void;

function respondJson(response: ServerResponse, statusCode: number, body: unknown): void {
    const payload = JSON.stringify(body);
    response.writeHead(statusCode, { 'Content-Type': 'application/json', 'Content-Length': payload.length });
    response.end(payload);
}

/** The success payload shape of the App Service identity endpoint. */
function successBody(lifetimeSeconds: number = 3600): Record<string, string> {
    return {
        access_token: 'fake-access-token',
        expires_on: String(Math.floor(Date.now() / 1000) + lifetimeSeconds),
        resource: RESOURCE,
        token_type: 'Bearer',
        client_id: CLIENT_ID,
    };
}

/** The failure payload shape: a 400 whose `error_description` carries the useful sentence. */
function failureBody(description: string): Record<string, string> {
    return { error: 'invalid_request', error_description: description };
}

describe('ManagedIdentityCredential against a fake identity endpoint', () => {
    const originalEnv = { ...process.env };
    let server: Server | undefined;
    let requests: CapturedRequest[] = [];

    beforeEach(() => {
        requests = [];
        // A fresh module registry per test: MSAL selects and caches its identity source from the
        // environment, so a reused module would keep talking to the previous test's server.
        jest.resetModules();
    });

    afterEach(async () => {
        if (server) {
            const toClose = server;
            server = undefined;
            await new Promise<void>((resolve) => toClose.close(() => resolve()));
        }
        process.env = { ...originalEnv };
    });

    function useEndpoint(url: string): void {
        process.env.IDENTITY_ENDPOINT = url;
        process.env.IDENTITY_HEADER = 'fake-identity-header';
        // Keep the other managed identity sources out of the way so App Service is the one selected.
        delete process.env.MSI_ENDPOINT;
        delete process.env.IDENTITY_SERVER_THUMBPRINT;
        delete process.env.IMDS_ENDPOINT;
    }

    async function startEndpoint(responder: Responder): Promise<void> {
        const created = createServer((request, response) => {
            const url = new URL(request.url ?? '/', 'http://127.0.0.1');
            requests.push({ query: url.searchParams, headers: request.headers });
            responder(request, response);
        });
        server = created;

        await new Promise<void>((resolve) => created.listen(0, '127.0.0.1', resolve));
        const address = created.address();
        const port = typeof address === 'object' && address !== null ? address.port : 0;
        useEndpoint(`http://127.0.0.1:${port}/`);
    }

    async function acquireToken(clientId?: string): Promise<{ token: string; expiresOnTimestamp: number }> {
        const { ManagedIdentityCredential } = await import('@azure/identity');
        const credential = clientId ? new ManagedIdentityCredential({ clientId }) : new ManagedIdentityCredential();
        const token = await credential.getToken(`${RESOURCE}/.default`);
        if (!token) {
            throw new Error('The credential returned no token.');
        }
        return token;
    }

    async function captureFailure(clientId?: string): Promise<unknown> {
        return acquireToken(clientId).then(
            () => {
                throw new Error('Expected the credential to fail, but it succeeded.');
            },
            (error: unknown) => error,
        );
    }

    it('acquires a token for the system-assigned identity and sends no identity selector', async () => {
        await startEndpoint((_request, response) => respondJson(response, 200, successBody()));

        const token = await acquireToken();

        expect(token.token).toBe('fake-access-token');
        expect(token.expiresOnTimestamp).toBeGreaterThan(Date.now());

        const captured = requests.at(-1)!;
        expect(captured.query.get('resource')).toBe(RESOURCE);
        expect(captured.query.get('client_id')).toBeNull();
        expect(captured.query.get('principal_id')).toBeNull();
        expect(captured.query.get('mi_res_id')).toBeNull();
    }, 30_000);

    it('sends the client ID for a user-assigned identity', async () => {
        await startEndpoint((_request, response) => respondJson(response, 200, successBody()));

        await acquireToken(CLIENT_ID);

        expect(requests.at(-1)!.query.get('client_id')).toBe(CLIENT_ID);
    }, 30_000);

    it('propagates a usable expiry, so the driver can cache the token', async () => {
        await startEndpoint((_request, response) => respondJson(response, 200, successBody(3600)));

        const { expiresInSecondsFromTimestamp } = await import('./ManagedIdentityAuthHandler');
        const token = await acquireToken();
        const expiresInSeconds = expiresInSecondsFromTimestamp(token.expiresOnTimestamp);

        expect(expiresInSeconds).toBeGreaterThan(0);
        expect(expiresInSeconds).toBeLessThanOrEqual(3600);
    }, 30_000);

    it('maps the multiple-identity failure to a readable message', async () => {
        await startEndpoint((_request, response) =>
            respondJson(
                response,
                400,
                failureBody(
                    'Multiple user assigned identities exist, please specify the clientId / resourceId of the identity in the token request',
                ),
            ),
        );

        const error = await captureFailure();

        expect(classifyManagedIdentityError(error)).toBe('multipleIdentities');
        expect(describeManagedIdentityError(error)).toMatch(/more than one managed identity/i);
    }, 30_000);

    it('maps an identity that is not assigned to a readable message', async () => {
        await startEndpoint((_request, response) => respondJson(response, 400, failureBody('Identity not found')));

        const error = await captureFailure(CLIENT_ID);

        expect(classifyManagedIdentityError(error)).toBe('identityNotAssigned');
        expect(describeManagedIdentityError(error, CLIENT_ID)).toContain(CLIENT_ID);
    }, 30_000);

    it('maps an unreachable identity endpoint to the Azure VM requirement message', async () => {
        // Deliberately does NOT rely on the absence of an instance metadata service: some developer
        // machines, including Azure-hosted Cloud PCs, do answer on 169.254.169.254, which would make
        // an "unset the environment variables" version of this test environment dependent.
        useEndpoint(CLOSED_PORT_ENDPOINT);

        const error = await captureFailure();

        expect(classifyManagedIdentityError(error)).toBe('endpointUnreachable');
        expect(describeManagedIdentityError(error)).toMatch(/try again/i);
    }, 30_000);
});
