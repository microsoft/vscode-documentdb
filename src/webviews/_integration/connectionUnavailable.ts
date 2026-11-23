/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ConnectionUnavailableReason } from '../../documentdb/ConnectionUnavailableError';

export type ConnectionRecoveryAction = 'reconnect' | 'signInAgain' | 'updateCredentials' | 'close';

export interface ConnectionUnavailableDetails {
    readonly reason: ConnectionUnavailableReason;
    readonly text: string;
    readonly action: ConnectionRecoveryAction;
}

export interface ConnectionUnavailableResponse {
    readonly unavailable: ConnectionUnavailableDetails;
}
