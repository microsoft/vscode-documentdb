/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { UserCancelledError } from '@microsoft/vscode-azext-utils';
import {
    MongoNetworkError,
    MongoNetworkTimeoutError,
    MongoNotConnectedError,
    MongoOperationTimeoutError,
    MongoServerError,
    MongoServerSelectionError,
    MongoTopologyClosedError,
    TopologyType,
    type ServerDescription,
    type TopologyDescription,
} from 'mongodb';
// eslint-disable-next-line import/no-internal-modules -- These constructors are not public runtime exports.
import { ServerDescription as DriverServerDescription } from 'mongodb/lib/sdam/server_description.js';
// eslint-disable-next-line import/no-internal-modules -- Use the real .error getter, which aliases the first failed server.
import { TopologyDescription as DriverTopologyDescription } from 'mongodb/lib/sdam/topology_description.js';
import { describe, expect, it } from 'vitest';
import { AuthMethodId } from './auth/AuthMethod';
import {
    EntraIdentityMismatchError,
    EntraSignInRequiredError,
    TokenCallbackError,
} from './auth/entraErrors/entraCallbackErrors';
import { EntraDestinationRejectedError } from './auth/oidcAllowedHosts';
import { classifyConnectionFailure } from './connectionFailures';
import { ConnectionUnavailableError } from './ConnectionUnavailableError';

const makeServer = DriverServerDescription as new (
    address: string,
    hello: undefined,
    options: { error: Error | null },
) => ServerDescription;
const makeTopology = DriverTopologyDescription as typeof TopologyDescription;

function selectionError(...errors: (Error | null)[]): MongoServerSelectionError {
    const servers = new Map(
        errors.map((error, index): [string, ServerDescription] => {
            const server = new makeServer(`example-${index}.test:27017`, undefined, { error });
            return [server.address, server];
        }),
    );
    return new MongoServerSelectionError('Server selection timed out', new makeTopology(TopologyType.Unknown, servers));
}

const entra = AuthMethodId.MicrosoftEntraID;
const native = AuthMethodId.NativeAuth;
const rejected = new MongoServerError({ code: 18, errmsg: 'Authentication failed' });
const network = new MongoNetworkError('connection closed');
const refused = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:27017'), { code: 'ECONNREFUSED' });

describe('classifyConnectionFailure', (): void => {
    it.each(['noSession', 'providerChanged'] as const)('recognizes typed Entra sign-in: %s', (reason): void => {
        const error = new Error('Wrapper', { cause: new EntraSignInRequiredError(reason) });
        expect(classifyConnectionFailure(error, entra)).toEqual({
            kind: 'signInRequired',
            generation: 'replaceOnRecovery',
        });
        expect(classifyConnectionFailure(error, native)).toEqual({ kind: 'other', generation: 'keep' });
    });

    it.each([new EntraIdentityMismatchError(), new ConnectionUnavailableError('identityChanged')])(
        'requires a rebind for %s',
        (error): void => {
            expect(classifyConnectionFailure(new Error('Wrapper', { cause: error }))).toEqual({
                kind: 'identityChanged',
                generation: 'evict',
            });
        },
    );

    it('reports missing credentials without inventing a generation to evict', (): void => {
        expect(classifyConnectionFailure(new ConnectionUnavailableError('credentialsMissing'))).toEqual({
            kind: 'credentialsMissing',
            generation: 'none',
        });
    });

    it.each([AuthMethodId.MicrosoftEntraID, AuthMethodId.ManagedIdentity] as const)(
        'distinguishes a broken %s callback from its underlying network cause',
        (authMethod): void => {
            const error = new TokenCallbackError(network, authMethod);
            expect(classifyConnectionFailure(error, authMethod)).toEqual({
                kind: 'transient',
                generation: 'replaceOnNextForeground',
            });
        },
    );

    it('classifies code 18 for native or RU key auth, including through real selection errors', (): void => {
        const error = selectionError(rejected, null, new MongoServerError({ code: 18 }));
        expect(error.cause).toBe(rejected);
        expect(error.code).toBe(18);
        expect(classifyConnectionFailure(error, native)).toEqual({ kind: 'credentialsRejected', generation: 'evict' });
    });

    it('evicts a rejected Entra client without classifying the failure as a missing session', (): void => {
        expect(classifyConnectionFailure(selectionError(rejected), entra)).toEqual({
            kind: 'credentialsRejected',
            generation: 'evict',
        });
        expect(classifyConnectionFailure(rejected, AuthMethodId.ManagedIdentity)).toEqual({
            kind: 'other',
            generation: 'keep',
        });
    });

    it.each([
        new MongoTopologyClosedError(),
        new MongoNotConnectedError('Client must be connected before running operations'),
    ])('recognizes a typed closed client or topology: %s', (error): void => {
        expect(classifyConnectionFailure(new Error('Wrapper', { cause: error }))).toEqual({
            kind: 'clientClosed',
            generation: 'replaceOnNextForeground',
        });
    });

    it.each([
        network,
        new MongoNetworkError('Sign in again (AADSTS50058)'),
        new MongoNetworkTimeoutError('timed out'),
        new MongoOperationTimeoutError('Timed out during server selection', { cause: selectionError(null) }),
        selectionError(new Error('unrecognized server error')),
    ])('keeps an Entra client on plain network, timeout, or selection failures: %s', (error): void => {
        expect(classifyConnectionFailure(error, entra)).toEqual({ kind: 'transient', generation: 'keep' });
    });

    it('keeps the generation when a Kubernetes port-forward refuses the connection', (): void => {
        const socketError = new MongoNetworkError(refused.message, { cause: refused });
        expect(classifyConnectionFailure(selectionError(socketError), native)).toEqual({
            kind: 'transient',
            generation: 'keep',
        });
        expect(classifyConnectionFailure(refused, native)).toEqual({ kind: 'transient', generation: 'keep' });
    });

    it('does not treat the first server’s code 18 as authoritative when peers failed differently', (): void => {
        const firstAuth = selectionError(rejected, network);
        const firstNetwork = selectionError(network, rejected);
        expect(firstAuth.cause).toBe(rejected);
        expect(firstNetwork.cause).toBe(network);
        for (const error of [firstAuth, firstNetwork]) {
            expect(classifyConnectionFailure(error, native)).toEqual({
                kind: 'transient',
                generation: 'keep',
                note: 'mixedServerErrors',
            });
        }
    });

    it('distinguishes consistent and mixed typed causes in constructed driver descriptions', (): void => {
        // A MongoError can be retained by SDAM. The installed OIDC path does not create this wrapper.
        const wrappedMiss = new MongoNetworkError('wrapped failure', {
            cause: new EntraSignInRequiredError('noSession'),
        });
        expect(classifyConnectionFailure(selectionError(null, wrappedMiss), entra)).toEqual({
            kind: 'signInRequired',
            generation: 'replaceOnRecovery',
        });
        for (const error of [selectionError(wrappedMiss, network), selectionError(network, wrappedMiss)]) {
            expect(classifyConnectionFailure(error, entra)).toEqual({
                kind: 'transient',
                generation: 'keep',
                note: 'mixedServerErrors',
            });
        }
    });

    it('leaves cancellation and destination rejection to their existing handlers', (): void => {
        const cancellation = new TokenCallbackError(new UserCancelledError());
        const rejectedHost = new EntraDestinationRejectedError({ firstHost: 'not-allowed.test', hostCount: 1 });
        const tlsError = new MongoNetworkError('TLS failed', { cause: rejectedHost });

        expect(classifyConnectionFailure(cancellation, entra)).toEqual({
            kind: 'other',
            generation: 'keep',
            note: 'cancelled',
        });
        expect(classifyConnectionFailure(selectionError(network, tlsError), entra)).toEqual({
            kind: 'other',
            generation: 'keep',
            note: 'destinationRejected',
        });
        const disconnected = new ConnectionUnavailableError('userDisconnected', { cause: rejected });
        expect(classifyConnectionFailure(disconnected)).toEqual({
            kind: 'other',
            generation: 'keep',
            note: 'alreadyUnavailable',
        });
    });

    it('does not classify messages or an arbitrary code as typed failures', (): void => {
        for (const error of [
            'EntraSignInRequiredError',
            new Error('Client must be connected before running operations'),
            Object.assign(new Error('Sign in again (AADSTS50058)'), { code: 18 }),
        ]) {
            expect(classifyConnectionFailure(error, entra)).toEqual({ kind: 'other', generation: 'keep' });
        }
    });

    it('keeps the generation on cyclic or uninspected server evidence', (): void => {
        const cyclic = new Error('cycle');
        cyclic.cause = cyclic;
        const tooManyServers = Array<null>(64).fill(null);
        for (const error of [cyclic, selectionError(rejected, ...tooManyServers, network)]) {
            expect(classifyConnectionFailure(error, native)).toEqual({
                kind: 'other',
                generation: 'keep',
                note: 'incompleteEvidence',
            });
        }
    });
});
