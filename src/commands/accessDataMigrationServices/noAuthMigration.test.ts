/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AuthMethodId } from '../../documentdb/auth/AuthMethod';
import { CredentialCache } from '../../documentdb/CredentialCache';
import { DocumentDBConnectionString } from '../../documentdb/utils/DocumentDBConnectionString';

/**
 * Locks the contract that the migration command relies on when sharing a connection
 * with a whitelisted external extension. The command builds the shared
 * `options.connectionString` by injecting the cached username/password into the stored
 * connection string. For a NoAuth connection both are `undefined` (→ ''), which must
 * yield a credential-free URI while preserving any `tls`/`ssl` overrides.
 *
 * This intentionally re-creates the exact transformation from
 * `accessDataMigrationServices.ts` rather than importing the command (which pulls in
 * heavy VS Code host dependencies).
 */
function buildSharedConnectionString(clusterId: string, storedConnectionString: string): string {
    const parsed = new DocumentDBConnectionString(storedConnectionString);
    parsed.username = CredentialCache.getConnectionUser(clusterId) ?? '';
    parsed.password = CredentialCache.getConnectionPassword(clusterId) ?? '';
    return parsed.toString();
}

describe('Migration: NoAuth connection sharing', () => {
    const clusterId = 'migration-no-auth-cluster';

    beforeEach(() => {
        CredentialCache.deleteCredentials(clusterId);
    });

    it('produces a credential-free connection string for a NoAuth connection', () => {
        CredentialCache.setAuthCredentials(clusterId, AuthMethodId.NoAuth, 'mongodb://anon-host:27017/');

        const shared = buildSharedConnectionString(clusterId, 'mongodb://anon-host:27017/');

        expect(shared).not.toContain('@');
        expect(shared).toContain('anon-host:27017');
    });

    it('preserves tls=false from the stored connection string', () => {
        CredentialCache.setAuthCredentials(clusterId, AuthMethodId.NoAuth, 'mongodb://anon-host:27017/?tls=false');

        const shared = buildSharedConnectionString(clusterId, 'mongodb://anon-host:27017/?tls=false');

        expect(shared).toContain('tls=false');
        expect(shared).not.toContain('@');
    });

    it('preserves ssl=false from the stored connection string', () => {
        CredentialCache.setAuthCredentials(clusterId, AuthMethodId.NoAuth, 'mongodb://anon-host:27017/?ssl=false');

        const shared = buildSharedConnectionString(clusterId, 'mongodb://anon-host:27017/?ssl=false');

        expect(shared).toContain('ssl=false');
    });
});
