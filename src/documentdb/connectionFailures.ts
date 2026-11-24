/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { UserCancelledError } from '@microsoft/vscode-azext-utils';
import {
    MongoNetworkError,
    MongoNotConnectedError,
    MongoOperationTimeoutError,
    MongoServerError,
    MongoServerSelectionError,
    MongoTopologyClosedError,
    type TopologyDescription,
} from 'mongodb';
import { networkCode } from '../utils/connectionErrorClassification';
import { AuthMethodId } from './auth/AuthMethod';
import { isEntraDestinationRejectedError } from './auth/oidcAllowedHosts';
import { ConnectionUnavailableError } from './ConnectionUnavailableError';

export interface ConnectionFailure {
    readonly kind:
        | 'signInRequired'
        | 'identityChanged'
        | 'credentialsMissing'
        | 'credentialsRejected'
        | 'clientClosed'
        | 'transient'
        | 'other';
    readonly generation: 'keep' | 'evict' | 'replaceOnRecovery' | 'replaceOnNextForeground' | 'none';
    readonly note?:
        | 'cancelled'
        | 'destinationRejected'
        | 'alreadyUnavailable'
        | 'mixedServerErrors'
        | 'incompleteEvidence';
}

const OTHER: ConnectionFailure = { kind: 'other', generation: 'keep' };
const TRANSIENT: ConnectionFailure = { kind: 'transient', generation: 'keep' };
const INCOMPLETE: ConnectionFailure = { ...OTHER, note: 'incompleteEvidence' };
const MAX_DEPTH = 8;
const MAX_NODES = 64;

/** Classifies failures using the auth method actually used (RU key connections use NativeAuth). */
export function classifyConnectionFailure(error: unknown, authMethod?: AuthMethodId): ConnectionFailure {
    let remaining = MAX_NODES;
    const path = new Set<Error>();

    function inspect(candidate: unknown, depth: number): ConnectionFailure | undefined {
        if (!(candidate instanceof Error)) {
            return undefined;
        }
        if (depth >= MAX_DEPTH || remaining-- <= 0 || path.has(candidate)) {
            return INCOMPLETE;
        }
        path.add(candidate);
        try {
            return classify(candidate, depth);
        } finally {
            path.delete(candidate);
        }
    }

    function classify(candidate: Error, depth: number): ConnectionFailure {
        if (candidate instanceof UserCancelledError) {
            return { ...OTHER, note: 'cancelled' };
        }
        if (isEntraDestinationRejectedError(candidate)) {
            return { ...OTHER, note: 'destinationRejected' };
        }
        if (candidate instanceof ConnectionUnavailableError) {
            switch (candidate.reason) {
                case 'identityChanged':
                    return { kind: 'identityChanged', generation: 'evict' };
                case 'credentialsMissing':
                    return { kind: 'credentialsMissing', generation: 'none' };
                case 'credentialsRejected':
                case 'signInRequired':
                    return { kind: candidate.reason, generation: 'none', note: 'alreadyUnavailable' };
                default:
                    return { ...OTHER, note: 'alreadyUnavailable' };
            }
        }
        if (candidate instanceof MongoServerSelectionError && candidate.reason?.servers instanceof Map) {
            return classifyServers(candidate.reason.servers, depth + 1);
        }

        const cause = inspect(candidate.cause, depth + 1);
        if (cause?.note !== undefined) {
            return cause;
        }
        switch (candidate.name) {
            case 'EntraSignInRequiredError':
                return authMethod === undefined || authMethod === AuthMethodId.MicrosoftEntraID
                    ? { kind: 'signInRequired', generation: 'replaceOnRecovery' }
                    : OTHER;
            case 'EntraIdentityMismatchError':
                return { kind: 'identityChanged', generation: 'evict' };
            case 'TokenCallbackError':
                return { kind: 'transient', generation: 'replaceOnNextForeground' };
        }
        if (candidate instanceof MongoServerError && candidate.code === 18) {
            // The OIDC workflow already tries its callback after a cached token is rejected.
            return authMethod === AuthMethodId.NativeAuth || authMethod === AuthMethodId.MicrosoftEntraID
                ? { kind: 'credentialsRejected', generation: 'evict' }
                : OTHER;
        }
        if (candidate instanceof MongoNotConnectedError || candidate instanceof MongoTopologyClosedError) {
            return { kind: 'clientClosed', generation: 'replaceOnNextForeground' };
        }
        if (cause && cause.kind !== 'other') {
            return cause;
        }
        if (
            candidate instanceof MongoNetworkError ||
            candidate instanceof MongoOperationTimeoutError ||
            candidate instanceof MongoServerSelectionError ||
            networkCode(candidate)
        ) {
            return TRANSIENT;
        }
        return OTHER;
    }

    function classifyServers(servers: TopologyDescription['servers'], depth: number): ConnectionFailure {
        // In 7.2.0, selection.cause and .code summarize the *first* server error, not the topology.
        // Consider the per-server errors instead, so reversing the map cannot change the verdict.
        let agreed: ConnectionFailure | undefined;
        let mixed = false;
        let constraint: ConnectionFailure | undefined;
        for (const server of servers.values()) {
            if (remaining <= 0) {
                return constraint ?? INCOMPLETE;
            }
            remaining--; // Bound map iteration even when descriptions have no error.
            const result = inspect(server?.error, depth);
            if (!result) {
                continue;
            }
            if (result.note === 'cancelled' || result.note === 'destinationRejected') {
                // Preserve both constraints without enlarging either policy.
                constraint = result.note === 'cancelled' ? result : (constraint ?? result);
            }
            if (agreed) {
                mixed ||=
                    result.kind !== agreed.kind ||
                    result.generation !== agreed.generation ||
                    result.note !== agreed.note;
            } else {
                agreed = result;
            }
        }
        if (constraint) {
            return constraint;
        }
        if (mixed) {
            return { ...TRANSIENT, note: 'mixedServerErrors' };
        }
        return agreed && (agreed.kind !== 'other' || agreed.note) ? agreed : TRANSIENT;
    }

    return inspect(error, 0) ?? OTHER;
}
