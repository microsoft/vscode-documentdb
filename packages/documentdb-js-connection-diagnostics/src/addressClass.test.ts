/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';

import { addressFact } from './addressClass.js';

describe('shared address classification', (): void => {
    it.each([
        { address: '127.23.45.67', family: 4 as const, classification: 'loopback' },
        { address: '::1', family: 6 as const, classification: 'loopback' },
        { address: '0:0:0:0:0:0:0:1', family: 6 as const, classification: 'loopback' },
        { address: '::ffff:127.0.0.1', family: 6 as const, classification: 'loopback' },
        { address: '0:0:0:0:0:ffff:7f00:1', family: 6 as const, classification: 'loopback' },
        { address: '10.0.0.4', family: 4 as const, classification: 'private' },
        { address: '172.31.255.255', family: 4 as const, classification: 'private' },
        { address: '192.168.10.1', family: 4 as const, classification: 'private' },
        { address: '100.64.0.1', family: 4 as const, classification: 'private' },
        { address: 'fc00::1', family: 6 as const, classification: 'private' },
        { address: '::ffff:a00:4', family: 6 as const, classification: 'private' },
        { address: '169.254.10.1', family: 4 as const, classification: 'linkLocal' },
        { address: 'fe80::1', family: 6 as const, classification: 'linkLocal' },
        { address: '::ffff:169.254.1.1', family: 6 as const, classification: 'linkLocal' },
        { address: '203.0.113.4', family: 4 as const, classification: 'public' },
        { address: '2001:0db8:0:0:0:0:0:1', family: 6 as const, classification: 'public' },
        { address: '::ffff:203.0.113.4', family: 6 as const, classification: 'public' },
    ])('classifies $address as $classification without changing its spelling', ({ address, family, classification }): void => {
        expect(addressFact({ address, family })).toEqual({ address, family, class: classification });
    });

    it.each([
        { address: 'localhost', family: 4 as const },
        { address: 'not-an-address', family: 6 as const },
        { address: '::1', family: 4 as const },
    ])('does not classify an unknown address or mismatched family: $address/$family', (address): void => {
        expect(addressFact(address).class).toBeUndefined();
    });
});
