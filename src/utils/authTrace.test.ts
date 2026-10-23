/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { describeAuthError } from './authTrace';

describe('describeAuthError', () => {
    it('labels platform broker errors without exposing the raw message', (): void => {
        expect(describeAuthError(new Error('platform_broker_error: private sign-in failure'))).toBe(
            'type=Error; code=unknown; httpStatus=unknown; aadsts=none; broker=platform_broker_error',
        );
    });

    it('labels other errors as not brokered', (): void => {
        expect(describeAuthError(new Error('private sign-in failure'))).toBe(
            'type=Error; code=unknown; httpStatus=unknown; aadsts=none; broker=none',
        );
    });
});
