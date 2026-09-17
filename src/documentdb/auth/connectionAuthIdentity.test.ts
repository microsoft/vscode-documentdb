/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AuthMethodId } from './AuthMethod';
import { getConnectionAuthIdentity } from './connectionAuthIdentity';

describe('getConnectionAuthIdentity', () => {
    it('normalizes Microsoft Entra tenant ID casing', () => {
        const lowercase = getConnectionAuthIdentity({
            authMethod: AuthMethodId.MicrosoftEntraID,
            entraIdAuthConfig: { tenantId: 'abcdefab-1234-5678-90ab-abcdefabcdef' },
        });
        const uppercase = getConnectionAuthIdentity({
            authMethod: AuthMethodId.MicrosoftEntraID,
            entraIdAuthConfig: { tenantId: 'ABCDEFAB-1234-5678-90AB-ABCDEFABCDEF' },
        });

        expect(uppercase).toBe(lowercase);
    });

    it('normalizes managed identity client ID casing', () => {
        const lowercase = getConnectionAuthIdentity({
            authMethod: AuthMethodId.ManagedIdentity,
            managedIdentityAuthConfig: { clientId: 'abcdefab-1234-5678-90ab-abcdefabcdef' },
        });
        const uppercase = getConnectionAuthIdentity({
            authMethod: AuthMethodId.ManagedIdentity,
            managedIdentityAuthConfig: { clientId: 'ABCDEFAB-1234-5678-90AB-ABCDEFABCDEF' },
        });

        expect(uppercase).toBe(lowercase);
    });
});