/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, it } from 'vitest';
import { describeUnavailableConnection } from './describeUnavailableConnection';

it.each(['signInRequired', 'credentialsRejected', 'credentialsMissing'] as const)(
    'does not offer to reconnect a tab with %s and no supported repair',
    (reason): void => {
        const { unavailable } = describeUnavailableConnection(reason, {
            canRetrySignIn: false,
            canUpdateCredentials: false,
            canReconnect: false,
        });

        expect(unavailable).toMatchObject({ reason, action: 'close' });
        expect(unavailable.text).not.toBe('');
    },
);

it('offers the available credential repair without clearing the rejection', (): void => {
    expect(
        describeUnavailableConnection('credentialsRejected', {
            canRetrySignIn: true,
            canUpdateCredentials: true,
            canReconnect: true,
        }).unavailable.action,
    ).toBe('signInAgain');
    expect(
        describeUnavailableConnection('credentialsRejected', {
            canRetrySignIn: false,
            canUpdateCredentials: true,
            canReconnect: true,
        }).unavailable.action,
    ).toBe('updateCredentials');
});

it.each(['identityChanged', 'credentialsChanged', 'userDisconnected', 'unreachable'] as const)(
    'does not offer an unsupported reconnect for %s',
    (reason): void => {
        expect(
            describeUnavailableConnection(reason, {
                canRetrySignIn: false,
                canUpdateCredentials: false,
                canReconnect: false,
            }).unavailable.action,
        ).toBe('close');
    },
);
