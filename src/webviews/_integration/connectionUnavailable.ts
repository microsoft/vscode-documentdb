/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ConnectionUnavailableReason } from '../../documentdb/ConnectionUnavailableError';

export type ConnectionRecoveryAction = 'reconnect' | 'signInAgain' | 'updateCredentials' | 'close';

export const connectionRecoveryActions = [
    'reconnect',
    'signInAgain',
    'updateCredentials',
    'close',
] as const satisfies readonly ConnectionRecoveryAction[];

export const connectionUnavailableReasons = [
    'signInRequired',
    'credentialsRejected',
    'credentialsMissing',
    'credentialsChanged',
    'identityChanged',
    'userDisconnected',
    'connectionRemoved',
    'unreachable',
] as const satisfies readonly ConnectionUnavailableReason[];

export interface ConnectionUnavailableDetails {
    readonly reason: ConnectionUnavailableReason;
    readonly text: string;
    readonly action: ConnectionRecoveryAction;
}

export interface ConnectionUnavailableResponse {
    readonly unavailable: ConnectionUnavailableDetails;
}

export interface ConnectionRecoveryRequest {
    readonly reason: ConnectionUnavailableReason;
    readonly action: ConnectionRecoveryAction;
}

export interface ConnectionRecoveryResponse {
    readonly recovered: {
        readonly text: string;
    };
}

export interface ConnectionUnavailableMessage {
    readonly type:
        | 'documentView.connectionUnavailable'
        | 'clusterDashboard.connectionUnavailable'
        | 'collectionView.connectionUnavailable';
    readonly unavailable: ConnectionUnavailableDetails;
}

function isConnectionUnavailableDetails(value: unknown): value is ConnectionUnavailableDetails {
    if (typeof value !== 'object' || value === null) {
        return false;
    }

    const candidate = value as Partial<ConnectionUnavailableDetails>;
    return (
        connectionUnavailableReasons.some((reason) => reason === candidate.reason) &&
        typeof candidate.text === 'string' &&
        connectionRecoveryActions.some((action) => action === candidate.action)
    );
}

export function isConnectionUnavailableResponse(value: unknown): value is ConnectionUnavailableResponse {
    if (typeof value !== 'object' || value === null || !('unavailable' in value)) {
        return false;
    }
    return isConnectionUnavailableDetails(value.unavailable);
}

export function isConnectionUnavailableMessage(value: unknown): value is ConnectionUnavailableMessage {
    return (
        typeof value === 'object' &&
        value !== null &&
        'type' in value &&
        (value.type === 'documentView.connectionUnavailable' ||
            value.type === 'clusterDashboard.connectionUnavailable' ||
            value.type === 'collectionView.connectionUnavailable') &&
        isConnectionUnavailableResponse(value)
    );
}
