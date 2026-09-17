/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AuthMethodId } from '../../documentdb/auth/AuthMethod';
import { buildSavedConnectionSecrets } from './savedConnectionSecrets';

describe('buildSavedConnectionSecrets', () => {
    const entraIdAuthConfig = { tenantId: 'tenant', subscriptionId: 'subscription' };

    it('preserves Entra configuration when Entra ID is selected', () => {
        const secrets = buildSavedConnectionSecrets({
            connectionString: 'mongodb://example.test:27017/',
            authMethod: AuthMethodId.MicrosoftEntraID,
            entraIdAuthConfig,
        });

        expect(secrets.entraIdAuthConfig).toEqual(entraIdAuthConfig);
        expect(secrets.nativeAuthConfig).toBeUndefined();
        expect(secrets.managedIdentityAuthConfig).toBeUndefined();
    });

    it('does not retain Entra configuration for another authentication method', () => {
        const secrets = buildSavedConnectionSecrets({
            connectionString: 'mongodb://example.test:27017/',
            authMethod: AuthMethodId.NoAuth,
            entraIdAuthConfig,
        });

        expect(secrets.entraIdAuthConfig).toBeUndefined();
    });
});