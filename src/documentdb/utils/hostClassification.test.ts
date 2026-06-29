/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { extractHostname, isLocalOrPrivateHost } from './hostClassification';

describe('hostClassification (TLS-exception gating, design §7.1)', () => {
    describe('extractHostname', () => {
        it('strips an optional port', () => {
            expect(extractHostname('localhost:10260')).toBe('localhost');
            expect(extractHostname('10.0.0.5:27017')).toBe('10.0.0.5');
        });

        it('strips IPv6 brackets and port', () => {
            expect(extractHostname('[fe80::1]:10260')).toBe('fe80::1');
            expect(extractHostname('[::1]')).toBe('::1');
        });

        it('returns bare IPv6 unchanged', () => {
            expect(extractHostname('fe80::1')).toBe('fe80::1');
        });

        it('lowercases the host', () => {
            expect(extractHostname('MyDevBox')).toBe('mydevbox');
        });
    });

    describe('isLocalOrPrivateHost — should OFFER the TLS exception (true)', () => {
        it.each([
            'localhost',
            'localhost:10260',
            'db.localhost',
            '127.0.0.1',
            '127.5.6.7',
            '::1',
            '[::1]:10260',
            '10.0.0.1',
            '10.255.255.255',
            '172.16.0.0',
            '172.16.0.1',
            '172.31.255.255',
            '192.168.1.1',
            '192.168.255.255',
            '169.254.0.1',
            'devbox', // single-word hostname
            'home',
            'my-server.local', // mDNS
            'fc00::', // IPv6 ULA lower boundary
            'fc00::1',
            'fd12:3456::1',
            'fdff::1', // IPv6 ULA upper boundary
            'fe80::1', // IPv6 link-local
            'febf::1', // IPv6 link-local upper boundary
            '[fe80::abcd]:10260',
        ])('%s → true', (host) => {
            expect(isLocalOrPrivateHost(host)).toBe(true);
        });
    });

    describe('isLocalOrPrivateHost — should NOT offer the TLS exception (false)', () => {
        it.each([
            'example.com',
            'cluster0.mongodb.net',
            'my-cluster.documents.azure.com',
            '8.8.8.8',
            '172.15.0.1', // just below the 172.16/12 range
            '172.32.0.1', // just above the 172.16/12 range
            '192.169.0.1', // not 192.168
            '169.255.0.1', // not 169.254
            '11.0.0.1', // not 10/8
            'fec0::1', // just above fe80::/10 (not link-local)
            '2001:db8::1', // public IPv6
            '', // empty
            'example\u3002com', // U+3002 ideographic full stop — DNS resolves as public example.com
            'example\uFF0Ecom', // U+FF0E fullwidth full stop
            'example\uFF61com', // U+FF61 halfwidth ideographic full stop
            '8\u30028\u30028\u30028', // public IPv4 written with Unicode dots → 8.8.8.8
            'cluster0\u3002mongodb\u3002net', // public host with mixed Unicode separators
        ])('%s → false', (host) => {
            expect(isLocalOrPrivateHost(host)).toBe(false);
        });
    });

    describe('isLocalOrPrivateHost — IDNA/homograph normalization keeps genuinely-local hosts local', () => {
        it.each([
            '127\u30020\u30020\u30021', // loopback IPv4 with Unicode dots → 127.0.0.1
            '10\u30020\u30020\u30021', // private IPv4 with Unicode dots → 10.0.0.1
            'devbox', // legitimate single-label local host (no dots at all)
        ])('%s → true', (host) => {
            expect(isLocalOrPrivateHost(host)).toBe(true);
        });
    });
});
