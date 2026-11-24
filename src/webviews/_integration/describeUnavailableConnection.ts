/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { type ConnectionUnavailableReason } from '../../documentdb/ConnectionUnavailableError';
import { type ConnectionUnavailableResponse } from './connectionUnavailable';

export function describeUnavailableConnection(
    reason: ConnectionUnavailableReason,
): ConnectionUnavailableResponse {
    switch (reason) {
        case 'signInRequired':
            return {
                unavailable: {
                    reason,
                    title: l10n.t('Sign-in required'),
                    detail: l10n.t('Sign in from the connection tree, then click Retry.'),
                    action: 'retry',
                },
            };
        case 'credentialsRejected':
            return {
                unavailable: {
                    reason,
                    title: l10n.t('Authentication failed'),
                    detail: l10n.t('Repair the connection in the tree, then click Retry.'),
                    action: 'retry',
                },
            };
        case 'credentialsMissing':
        case 'userDisconnected':
            return {
                unavailable: {
                    reason,
                    title: l10n.t('Disconnected'),
                    detail: l10n.t('Connect from the connection tree, then click Retry.'),
                    action: 'retry',
                },
            };
        case 'identityChanged':
        case 'credentialsChanged':
            return {
                unavailable: {
                    reason,
                    title: l10n.t('Connection changed'),
                    detail: l10n.t('This view is tied to the previous connection. Close it and reopen it from the tree.'),
                    action: 'close',
                },
            };
        case 'connectionRemoved':
            return {
                unavailable: {
                    reason,
                    title: l10n.t('Connection removed'),
                    detail: l10n.t('This connection is no longer in the tree. Close this view.'),
                    action: 'close',
                },
            };
        case 'unreachable':
            return {
                unavailable: {
                    reason,
                    title: l10n.t('Connection lost'),
                    detail: l10n.t('Check the network or server, then click Retry.'),
                    action: 'retry',
                },
            };
    }
}
