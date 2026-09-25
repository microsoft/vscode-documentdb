/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type AtlasDatabaseUser } from '../models/AtlasProjectModel';
import { describeAtlasUserAuthMethod, toAtlasDatabaseUserCandidates } from './atlasDatabaseUsers';

jest.mock('@vscode/l10n', () => ({
    t: jest.fn((message: string) => message),
}));

function user(overrides: Partial<AtlasDatabaseUser> & { username: string }): AtlasDatabaseUser {
    return {
        databaseName: 'admin',
        x509Type: 'NONE',
        awsIAMType: 'NONE',
        ldapAuthType: 'NONE',
        oidcAuthType: 'NONE',
        ...overrides,
    };
}

describe('describeAtlasUserAuthMethod', () => {
    it('treats an admin-database user as a supported SCRAM user', () => {
        expect(describeAtlasUserAuthMethod(user({ username: 'app_rw' }))).toEqual({
            supported: true,
            authMethodLabel: 'Username and password',
        });
    });

    it.each([
        ['x509Type', 'CUSTOMER', 'X.509'],
        ['awsIAMType', 'ROLE', 'AWS IAM'],
        ['ldapAuthType', 'GROUP', 'LDAP'],
        ['oidcAuthType', 'IDP_GROUP', 'OIDC'],
    ])('names the %s method and marks it unsupported', (field, value, expectedLabel) => {
        const result = describeAtlasUserAuthMethod(
            user({ username: 'federated', databaseName: '$external', [field]: value }),
        );

        expect(result).toEqual({ supported: false, authMethodLabel: expectedLabel });
    });

    it('falls back to a generic label for an external user with no known method flag', () => {
        // Atlas can add authentication methods faster than this extension learns about them.
        const result = describeAtlasUserAuthMethod(user({ username: 'future', databaseName: '$external' }));

        expect(result).toEqual({ supported: false, authMethodLabel: 'Federated' });
    });
});

describe('toAtlasDatabaseUserCandidates', () => {
    it('keeps users with no scopes, because they apply to every cluster in the project', () => {
        const candidates = toAtlasDatabaseUserCandidates([user({ username: 'app_rw' })], 'Cluster0');

        expect(candidates.map((candidate) => candidate.username)).toEqual(['app_rw']);
    });

    it('keeps a user scoped to this cluster and drops one scoped elsewhere', () => {
        const users = [
            user({ username: 'here', scopes: [{ name: 'Cluster0', type: 'CLUSTER' }] }),
            user({ username: 'elsewhere', scopes: [{ name: 'Cluster9', type: 'CLUSTER' }] }),
        ];

        expect(toAtlasDatabaseUserCandidates(users, 'Cluster0').map((c) => c.username)).toEqual(['here']);
    });

    it('ignores non-cluster scopes when deciding whether a user applies', () => {
        const users = [user({ username: 'streamer', scopes: [{ name: 'SomeStream', type: 'STREAM' }] })];

        expect(toAtlasDatabaseUserCandidates(users, 'Cluster0').map((c) => c.username)).toEqual(['streamer']);
    });

    it('keeps unsupported users so the list can explain why they cannot be used', () => {
        const users = [
            user({ username: 'app_rw' }),
            user({ username: 'CN=svc,OU=eng', databaseName: '$external', x509Type: 'CUSTOMER' }),
        ];

        expect(toAtlasDatabaseUserCandidates(users, 'Cluster0').map((c) => [c.username, c.supported])).toEqual([
            ['app_rw', true],
            ['CN=svc,OU=eng', false],
        ]);
    });

    it('sorts case-insensitively and drops entries without a username', () => {
        const users = [
            user({ username: 'zeta' }),
            user({ username: 'Alpha' }),
            user({ username: '' }),
            user({ username: 'beta' }),
        ];

        expect(toAtlasDatabaseUserCandidates(users, 'Cluster0').map((c) => c.username)).toEqual([
            'Alpha',
            'beta',
            'zeta',
        ]);
    });
});
