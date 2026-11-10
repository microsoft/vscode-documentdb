/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import {
    apiCompatibilityText,
    formatDuration,
    formatEvidence,
    formatEvidenceSegment,
    tlsProtocolText,
} from './formatEvidence';
import { type EvidenceSegment } from './panelTypes';

describe('connection preparation evidence formatting', (): void => {
    it.each([
        [{ kind: 'preparedBy', providerId: 'kubernetes-port-forward' }, 'Using port forward'],
        [{ kind: 'preparedBy', providerId: 'other' }, 'Prepared'],
        [{ kind: 'preparationFailed', providerId: 'kubernetes-port-forward' }, 'Port forward failed'],
        [{ kind: 'preparationFailed', providerId: 'other' }, 'Preparation failed'],
    ] as readonly (readonly [EvidenceSegment, string])[])('formats %j', (segment, expected): void => {
        expect(formatEvidenceSegment(segment)).toBe(expected);
    });
});

describe('authentication and database evidence formatting', (): void => {
    const cases: readonly (readonly [EvidenceSegment, string])[] = [
        [{ kind: 'authMethod', method: 'native' }, 'Username and password'],
        [{ kind: 'authMethod', method: 'entraId' }, 'Microsoft Entra ID'],
        [{ kind: 'authMethod', method: 'managedIdentity' }, 'Managed identity'],
        [{ kind: 'authMethod', method: 'none' }, 'No authentication'],
        [{ kind: 'account', label: 'alice@contoso.com' }, 'alice@contoso.com'],
        [{ kind: 'authMechanism', mechanism: 'SCRAM-SHA-256' }, 'SCRAM-SHA-256'],
        [{ kind: 'cloud', cloud: 'usGovernment' }, 'Azure US Government'],
        [{ kind: 'cloud', cloud: 'china' }, 'Azure China'],
        [{ kind: 'cloud', cloud: 'custom' }, 'Custom cloud'],
        [{ kind: 'managedIdentityKind', identityKind: 'systemAssigned' }, 'System-assigned'],
        [{ kind: 'managedIdentityKind', identityKind: 'userAssigned' }, 'User-assigned'],
        [{ kind: 'noSilentSignIn' }, 'No sign-in available without a prompt'],
        [{ kind: 'signInFailed' }, 'Sign-in failed'],
        [{ kind: 'signedInNotAccepted' }, 'Token obtained · Token rejected by the cluster'],
        [{ kind: 'credentialsRejected' }, 'Credentials rejected by the cluster'],
        [{ kind: 'clusterCloud', cloud: 'AzureUSGovernment' }, 'Cluster in Azure US Government'],
        [{ kind: 'signedInCloud', cloud: 'AzureCloud' }, 'Sign-in set to Azure'],
        [{ kind: 'ping', ms: 12 }, 'Ping 12 ms'],
        [{ kind: 'clockOffset', offsetMs: 720_000 }, 'Clock 12 min behind the server'],
        [{ kind: 'clockOffset', offsetMs: -480_000 }, 'Clock 8 min ahead of the server'],
        [{ kind: 'databasesVisible', count: 5 }, '5 databases visible'],
        [{ kind: 'databasesVisible', count: 1 }, '1 database visible'],
        [{ kind: 'databasesVisible', count: 0 }, '0 databases visible'],
        [{ kind: 'connected' }, 'Connected'],
    ];
    it.each(cases)('formats %j in the view', (segment, expected): void => {
        expect(formatEvidenceSegment(segment)).toBe(expected);
    });

    it('joins cloud mismatch and database observations without exposing diagnostic codes', (): void => {
        expect(
            formatEvidence([
                { kind: 'authMethod', method: 'entraId' },
                { kind: 'clusterCloud', cloud: 'AzureUSGovernment' },
                { kind: 'signedInCloud', cloud: 'AzureCloud' },
            ]),
        ).toBe('Microsoft Entra ID · Cluster in Azure US Government · Sign-in set to Azure');
        expect(
            formatEvidence([
                { kind: 'ping', ms: 12 },
                { kind: 'databasesVisible', count: 5 },
            ]),
        ).toBe('Ping 12 ms · 5 databases visible');
        expect(
            formatEvidence([
                { kind: 'authMethod', method: 'native' },
                { kind: 'authMechanism', mechanism: 'SCRAM-SHA-256' },
                { kind: 'account', label: 'stage0user' },
            ]),
        ).toBe('Username and password · SCRAM-SHA-256 · stage0user');
        expect(formatEvidence([{ kind: 'connected' }, { kind: 'finding', title: 'Listing databases denied' }])).toBe(
            'Connected · Listing databases denied',
        );
    });
});

describe('server greeting formatting', (): void => {
    it('says the greeting answered before sign-in, after the server type', (): void => {
        expect(
            formatEvidence([{ kind: 'topology', topology: 'shardedRouter' }, { kind: 'answeredBeforeSignIn' }]),
        ).toBe('Sharded cluster router · Answered before sign-in');
    });

    it.each([
        [25, 'MongoDB API 8.0 (wire 25)'],
        [21, 'MongoDB API 7.0 (wire 21)'],
        [27, 'MongoDB API 8.0 or later (wire 27)'],
        [22, 'MongoDB API 7.0 or later (wire 22)'],
        [6, 'MongoDB API 3.6 (wire 6)'],
        [5, 'Wire version 5'],
    ] as const)('names wire version %i as %s', (wireVersion, expected): void => {
        expect(apiCompatibilityText(wireVersion)).toBe(expected);
    });
});

describe('row duration formatting (decision 0050)', (): void => {
    // Built with the same platform call, so the test holds in any locale; what it pins is the
    // thresholds and rounding, not the unit words.
    const unit = (
        value: number,
        name: 'millisecond' | 'second' | 'minute',
        options: Intl.NumberFormatOptions,
    ): string =>
        new Intl.NumberFormat(undefined, { style: 'unit', unit: name, unitDisplay: 'short', ...options }).format(value);

    it('shows a sub-millisecond step as less than one millisecond', (): void => {
        expect(formatDuration(0)).toBe(`< ${unit(1, 'millisecond', {})}`);
        expect(formatDuration(0.4)).toBe(`< ${unit(1, 'millisecond', {})}`);
    });

    it('shows whole milliseconds below one second', (): void => {
        expect(formatDuration(2)).toBe(unit(2, 'millisecond', {}));
        expect(formatDuration(146.6)).toBe(unit(147, 'millisecond', {}));
        expect(formatDuration(999.4)).toBe(unit(999, 'millisecond', {}));
    });

    it('switches to seconds with three significant digits from one second', (): void => {
        expect(formatDuration(999.6)).toBe(unit(1, 'second', {}));
        expect(formatDuration(4378)).toBe(unit(4.38, 'second', {}));
        expect(formatDuration(12_449)).toBe(unit(12.4, 'second', {}));
    });

    it('shows minutes and whole seconds from one minute, dropping zero seconds', (): void => {
        expect(formatDuration(59_960)).toBe(unit(1, 'minute', {}));
        expect(formatDuration(65_000)).toBe(`${unit(1, 'minute', {})} ${unit(5, 'second', {})}`);
        expect(formatDuration(120_000)).toBe(unit(2, 'minute', {}));
    });

    it('never shows a negative duration', (): void => {
        expect(formatDuration(-5)).toBe(`< ${unit(1, 'millisecond', {})}`);
    });
});

describe('ping formatting (decision 0050)', (): void => {
    it('formats the ping like every other duration, never as a raw number', (): void => {
        for (const ms of [0.4, 12, 1234.5]) {
            expect(formatEvidenceSegment({ kind: 'ping', ms })).toBe(`Ping ${formatDuration(ms)}`);
        }
        expect(formatEvidenceSegment({ kind: 'ping', ms: 0.4 })).toBe('Ping < 1 ms');
    });
});

describe('TLS protocol wording (decision 0050)', (): void => {
    it.each([
        ['TLSv1', 'TLS 1.0'],
        ['TLSv1.1', 'TLS 1.1'],
        ['TLSv1.2', 'TLS 1.2'],
        ['TLSv1.3', 'TLS 1.3'],
        ['SSLv3', 'SSLv3'],
        ['TLSv1.4', 'TLSv1.4'],
        ['unknown', 'unknown'],
    ] as const)('words %s as %s', (protocol, expected): void => {
        expect(tlsProtocolText(protocol)).toBe(expected);
    });
});
