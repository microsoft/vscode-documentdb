/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';

export type ConnectionUnavailableReason =
    | 'signInRequired'
    | 'credentialsRejected'
    | 'credentialsMissing'
    | 'credentialsUpdating'
    | 'credentialsChanged'
    | 'identityChanged'
    | 'userDisconnected'
    | 'connectionRemoved'
    | 'unreachable';

export class ConnectionUnavailableError extends Error {
    constructor(
        readonly reason: ConnectionUnavailableReason,
        options?: ErrorOptions,
    ) {
        super(
            reason === 'credentialsMissing'
                ? l10n.t('No credentials found.')
                : l10n.t('The connection is unavailable.'),
            options,
        );
        this.name = 'ConnectionUnavailableError';
    }
}
