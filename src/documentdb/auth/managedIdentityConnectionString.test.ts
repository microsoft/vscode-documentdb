/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DocumentDBConnectionString } from '../utils/DocumentDBConnectionString';
import {
    detectManagedIdentityHint,
    MANAGED_IDENTITY_AUTH_MECHANISM_PROPERTIES,
    managedIdentityConfigFromHint,
    stripManagedIdentityMarkers,
} from './managedIdentityConnectionString';

const CLIENT_ID = '11111111-2222-3333-4444-555555555555';
const HOST = 'my-cluster.mongocluster.cosmos.azure.com';

function parse(uri: string): DocumentDBConnectionString {
    return new DocumentDBConnectionString(uri);
}

describe('detectManagedIdentityHint', () => {
    it('reports an explicit hint for the documented driver-native form', () => {
        const cs = parse(
            `mongodb+srv://${CLIENT_ID}@${HOST}/?authMechanism=MONGODB-OIDC&authMechanismProperties=${MANAGED_IDENTITY_AUTH_MECHANISM_PROPERTIES}`,
        );

        expect(detectManagedIdentityHint(cs)).toEqual({ clientId: CLIENT_ID, confidence: 'explicit' });
    });

    it('reports an explicit hint without a client ID for a system-assigned identity', () => {
        const cs = parse(
            `mongodb+srv://${HOST}/?authMechanism=MONGODB-OIDC&authMechanismProperties=${MANAGED_IDENTITY_AUTH_MECHANISM_PROPERTIES}`,
        );

        expect(detectManagedIdentityHint(cs)).toEqual({ clientId: undefined, confidence: 'explicit' });
    });

    it('reports a weak hint for OIDC plus a GUID username without an ENVIRONMENT entry', () => {
        const cs = parse(`mongodb+srv://${CLIENT_ID}@${HOST}/?authMechanism=MONGODB-OIDC`);

        expect(detectManagedIdentityHint(cs)).toEqual({ clientId: CLIENT_ID, confidence: 'weak' });
    });

    it('finds ENVIRONMENT:azure among other authMechanismProperties entries', () => {
        const cs = parse(
            `mongodb+srv://${HOST}/?authMechanism=MONGODB-OIDC&authMechanismProperties=TOKEN_RESOURCE:https://ossrdbms-aad.database.windows.net,ENVIRONMENT:azure`,
        );

        expect(detectManagedIdentityHint(cs)?.confidence).toBe('explicit');
    });

    it('is case insensitive on the mechanism and the ENVIRONMENT entry', () => {
        const cs = parse(`mongodb+srv://${HOST}/?authMechanism=mongodb-oidc&authMechanismProperties=Environment:Azure`);

        expect(detectManagedIdentityHint(cs)?.confidence).toBe('explicit');
    });

    it('works for a plain mongodb:// host as well as +srv', () => {
        const cs = parse(
            `mongodb://${CLIENT_ID}@${HOST}:10260/?authMechanism=MONGODB-OIDC&authMechanismProperties=${MANAGED_IDENTITY_AUTH_MECHANISM_PROPERTIES}`,
        );

        expect(detectManagedIdentityHint(cs)).toEqual({ clientId: CLIENT_ID, confidence: 'explicit' });
    });

    it('keeps a username that is not GUID shaped as a supplied identity to review', () => {
        const cs = parse(
            `mongodb+srv://alice@${HOST}/?authMechanism=MONGODB-OIDC&authMechanismProperties=${MANAGED_IDENTITY_AUTH_MECHANISM_PROPERTIES}`,
        );

        expect(detectManagedIdentityHint(cs)).toEqual({
            clientId: undefined,
            suppliedIdentity: 'alice',
            confidence: 'explicit',
        });
    });

    it('returns undefined for interactive Entra ID, which has no identity selector', () => {
        const cs = parse(`mongodb+srv://${HOST}/?authMechanism=MONGODB-OIDC`);

        expect(detectManagedIdentityHint(cs)).toBeUndefined();
    });

    it('returns undefined for a plain native-auth connection string', () => {
        const cs = parse(`mongodb+srv://alice:secret@${HOST}/?retryWrites=true`);

        expect(detectManagedIdentityHint(cs)).toBeUndefined();
    });

    it('returns undefined when ENVIRONMENT:azure appears without the OIDC mechanism', () => {
        const cs = parse(`mongodb+srv://${HOST}/?authMechanismProperties=ENVIRONMENT:azure`);

        expect(detectManagedIdentityHint(cs)).toBeUndefined();
    });
});

describe('stripManagedIdentityMarkers', () => {
    it('removes the mechanism markers and the credentials but keeps everything else', () => {
        const cs = parse(
            `mongodb+srv://${CLIENT_ID}@${HOST}/?authMechanism=MONGODB-OIDC&authMechanismProperties=${MANAGED_IDENTITY_AUTH_MECHANISM_PROPERTIES}&retryWrites=true&appName=demo`,
        );

        stripManagedIdentityMarkers(cs);
        const result = cs.toString();

        expect(result).not.toContain('authMechanism');
        expect(result).not.toContain(CLIENT_ID);
        expect(result).toContain('retryWrites=true');
        expect(result).toContain('appName=demo');
    });
});

describe('managedIdentityConfigFromHint', () => {
    it('maps a client ID through', () => {
        expect(managedIdentityConfigFromHint({ clientId: CLIENT_ID, confidence: 'explicit' })).toEqual({
            clientId: CLIENT_ID,
        });
    });

    it('maps a missing client ID to an empty object, meaning system-assigned', () => {
        expect(managedIdentityConfigFromHint({ confidence: 'explicit' })).toEqual({});
    });

    it('does not store a supplied identity that still needs review', () => {
        expect(managedIdentityConfigFromHint({ suppliedIdentity: 'alice', confidence: 'explicit' })).toEqual({});
    });
});
