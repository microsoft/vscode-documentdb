/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { InstanceState, type InstanceStatus } from '../../services/localQuickStart/quickStartTypes';
import {
    findQuickStartInstanceForHosts,
    hasLoopbackHost,
    normalizeEndpoint,
    normalizeEndpointList,
} from './localEndpoint';

describe('normalizeEndpoint', () => {
    it.each(['localhost:10260', '127.0.0.1:10260', '[::1]:10260', 'LOCALHOST:10260', '0:0:0:0:0:0:0:1'])(
        'collapses the loopback spelling %s',
        (host) => {
            // The last case carries no port, so it normalizes to the wire-protocol default instead.
            const expected = host === '0:0:0:0:0:0:0:1' ? 'localhost:27017' : 'localhost:10260';
            expect(normalizeEndpoint(host)).toBe(expected);
        },
    );

    it('fills in the wire-protocol default port when the host carries none', () => {
        expect(normalizeEndpoint('localhost')).toBe('localhost:27017');
        expect(normalizeEndpoint('localhost', 10260)).toBe('localhost:10260');
        expect(normalizeEndpoint('::1')).toBe('localhost:27017');
    });

    it('keeps a bare IPv6 address whole instead of reading its last group as a port', () => {
        expect(normalizeEndpoint('fe80::1')).toBe('fe80::1:27017');
        expect(normalizeEndpoint('[fe80::1]:10260')).toBe('fe80::1:10260');
    });

    it('leaves non-loopback hosts alone (lowercased)', () => {
        expect(normalizeEndpoint('Example.COM:27017')).toBe('example.com:27017');
        // Loopback at the IP layer, but a service bound to 127.0.0.1 is not reachable here, so
        // treating the two as one endpoint would produce false duplicates.
        expect(normalizeEndpoint('127.0.0.2:10260')).toBe('127.0.0.2:10260');
    });
});

describe('normalizeEndpointList', () => {
    it('is order-independent and spelling-independent', () => {
        expect(normalizeEndpointList(['127.0.0.1:10260', 'example.com:27017'])).toBe(
            normalizeEndpointList(['example.com:27017', 'localhost:10260']),
        );
    });

    it('distinguishes different ports on the same host', () => {
        expect(normalizeEndpointList(['localhost:10260'])).not.toBe(normalizeEndpointList(['localhost:10261']));
    });
});

describe('hasLoopbackHost', () => {
    it('detects every loopback spelling', () => {
        expect(hasLoopbackHost(['example.com:27017', '[::1]:10260'])).toBe(true);
        expect(hasLoopbackHost(['example.com:27017'])).toBe(false);
    });
});

describe('findQuickStartInstanceForHosts', () => {
    function instance(overrides: Partial<InstanceStatus> = {}): InstanceStatus {
        return {
            alias: 'vscode-documentdb-local',
            displayName: 'DocumentDB Local',
            state: InstanceState.Running,
            missing: false,
            port: 10260,
            canResumeReadiness: false,
            ...overrides,
        };
    }

    it('matches a managed instance across loopback spellings', () => {
        expect(findQuickStartInstanceForHosts(['127.0.0.1:10260'], [instance()])).toMatchObject({ port: 10260 });
        expect(findQuickStartInstanceForHosts(['[::1]:10260'], [instance()])).toMatchObject({ port: 10260 });
    });

    it('does not match a different port or a remote host on the same port', () => {
        expect(findQuickStartInstanceForHosts(['localhost:10261'], [instance()])).toBeUndefined();
        expect(findQuickStartInstanceForHosts(['example.com:10260'], [instance()])).toBeUndefined();
    });

    it('ignores instances that have no port yet', () => {
        expect(findQuickStartInstanceForHosts(['localhost:10260'], [instance({ port: undefined })])).toBeUndefined();
    });

    it('matches a stopped instance too — it still owns that port on this machine', () => {
        expect(
            findQuickStartInstanceForHosts(['localhost:10260'], [instance({ state: InstanceState.Stopped })]),
        ).toMatchObject({ port: 10260 });
    });
});
