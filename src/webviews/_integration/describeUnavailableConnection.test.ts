/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, it } from 'vitest';
import { describeUnavailableConnection } from './describeUnavailableConnection';

it.each(['signInRequired', 'credentialsRejected', 'credentialsMissing'] as const)(
    'directs credential repair to the tree before retrying %s',
    (reason): void => {
        const { unavailable } = describeUnavailableConnection(reason);
        expect(unavailable).toMatchObject({ reason, action: 'retry' });
        expect(unavailable.detail).toContain('tree');
    },
);

it.each(['identityChanged', 'credentialsChanged', 'connectionRemoved'] as const)(
    'offers only Close view for %s',
    (reason): void => {
        expect(describeUnavailableConnection(reason).unavailable.action).toBe('close');
    },
);
