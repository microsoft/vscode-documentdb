/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, it } from 'vitest';
import { readJwtTimes } from './tokenExpiry';

it.each([
    ['{"iat":100,"exp":200,"sub":"unused"}', { iatSec: 100, expSec: 200 }],
    ['{"exp":200}', { expSec: 200 }],
    ['{"iat":100,"exp":"200"}', { iatSec: 100 }],
    ['{"iat":1e309,"exp":null}', {}],
    ['not json', {}],
])('reads only finite numeric JWT times from %s', (payload, expected) => {
    const token = `header.${Buffer.from(payload).toString('base64url')}.signature`;
    expect(readJwtTimes(token)).toEqual(expected);
});

it('does not infer expiry from an opaque token', () => {
    expect(readJwtTimes('opaque-token')).toEqual({});
});
