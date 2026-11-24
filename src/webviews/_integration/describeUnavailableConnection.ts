/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { type ConnectionUnavailableReason } from '../../documentdb/ConnectionUnavailableError';
import { type ConnectionUnavailableResponse } from './connectionUnavailable';

interface RecoveryCapabilities {
    readonly canRetrySignIn: boolean;
    readonly canUpdateCredentials: boolean;
}

export function describeUnavailableConnection(
    reason: ConnectionUnavailableReason,
    { canRetrySignIn, canUpdateCredentials }: RecoveryCapabilities,
): ConnectionUnavailableResponse {
    switch (reason) {
        case 'signInRequired':
            return {
                unavailable: {
                    reason,
                    text: l10n.t('Microsoft sign-in is required.'),
                    action: canRetrySignIn ? 'signInAgain' : 'close',
                },
            };
        case 'credentialsRejected':
            return {
                unavailable: {
                    reason,
                    text: l10n.t('The database rejected the connection credentials.'),
                    action: canRetrySignIn ? 'signInAgain' : canUpdateCredentials ? 'updateCredentials' : 'close',
                },
            };
        case 'credentialsMissing':
            return {
                unavailable: {
                    reason,
                    text: l10n.t('No credentials found.'),
                    action: canUpdateCredentials ? 'updateCredentials' : 'close',
                },
            };
        case 'identityChanged':
        case 'credentialsChanged':
            return {
                unavailable: {
                    reason,
                    text: l10n.t('The connection identity or settings have changed.'),
                    action: 'reconnect',
                },
            };
        case 'userDisconnected':
            return { unavailable: { reason, text: l10n.t('The connection is disconnected.'), action: 'reconnect' } };
        case 'connectionRemoved':
            return { unavailable: { reason, text: l10n.t('The connection was removed.'), action: 'close' } };
        case 'unreachable':
            return { unavailable: { reason, text: l10n.t('Connection lost.'), action: 'reconnect' } };
    }
}
