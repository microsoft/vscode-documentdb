/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { apiCompatibilityText, formatEvidence, formatEvidenceSegment } from './formatEvidence';
import { type EvidenceSegment } from './panelTypes';

describe('authentication and database evidence formatting', (): void => {
    const cases: readonly (readonly [EvidenceSegment, string])[] = [
        [{ kind: 'authMethod', method: 'native' }, 'Username and password'],
        [{ kind: 'authMethod', method: 'entraId' }, 'Microsoft Entra ID'],
        [{ kind: 'authMethod', method: 'managedIdentity' }, 'Managed identity'],
        [{ kind: 'authMethod', method: 'none' }, 'No authentication'],
        [{ kind: 'account', label: 'alice@contoso.com' }, 'alice@contoso.com'],
        [{ kind: 'cloud', cloud: 'usGovernment' }, 'Azure US Government'],
        [{ kind: 'cloud', cloud: 'china' }, 'Azure China'],
        [{ kind: 'cloud', cloud: 'custom' }, 'Custom cloud'],
        [{ kind: 'managedIdentityKind', identityKind: 'systemAssigned' }, 'System-assigned'],
        [{ kind: 'managedIdentityKind', identityKind: 'userAssigned' }, 'User-assigned'],
        [{ kind: 'noSilentSignIn' }, 'No sign-in available without a prompt'],
        [{ kind: 'signInFailed' }, 'Sign-in failed'],
        [{ kind: 'signedInNotAccepted' }, 'Token obtained · The cluster rejected the token'],
        [{ kind: 'credentialsRejected' }, 'The cluster rejected the user name or password'],
        [{ kind: 'clusterCloud', cloud: 'AzureUSGovernment' }, 'Cluster in Azure US Government'],
        [{ kind: 'signedInCloud', cloud: 'AzureCloud' }, 'VS Code signed in to Azure'],
        [{ kind: 'ping', ms: 12 }, 'Ping 12 ms'],
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
        ).toBe('Microsoft Entra ID · Cluster in Azure US Government · VS Code signed in to Azure');
        expect(
            formatEvidence([
                { kind: 'ping', ms: 12 },
                { kind: 'databasesVisible', count: 5 },
            ]),
        ).toBe('Ping 12 ms · 5 databases visible');
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
