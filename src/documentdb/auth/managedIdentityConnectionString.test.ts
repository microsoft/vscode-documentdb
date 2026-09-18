/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DocumentDBConnectionString } from '../utils/DocumentDBConnectionString';
import {
    getConnectionStringAuthFacts,
    MANAGED_IDENTITY_AUTH_MECHANISM_PROPERTIES,
    stripManagedIdentityMarkers,
} from './managedIdentityConnectionString';

const CLIENT_ID = '11111111-2222-3333-4444-555555555555';
const HOST = 'my-cluster.mongocluster.cosmos.azure.com';

function parse(uri: string): DocumentDBConnectionString {
    return new DocumentDBConnectionString(uri);
}

describe('getConnectionStringAuthFacts', () => {
    it('reports the documented driver-native form as an Azure machine workflow', () => {
        const cs = parse(
            `mongodb+srv://${CLIENT_ID}@${HOST}/?authMechanism=MONGODB-OIDC&authMechanismProperties=${MANAGED_IDENTITY_AUTH_MECHANISM_PROPERTIES}`,
        );

        expect(getConnectionStringAuthFacts(cs)).toEqual({
            usesOidc: true,
            declaresAzureMachineWorkflow: true,
            tokenResource: 'https://ossrdbms-aad.database.windows.net',
            username: CLIENT_ID,
            usernameIsGuid: true,
        });
    });

    it('reports an omitted username for the system-assigned form', () => {
        const cs = parse(
            `mongodb+srv://${HOST}/?authMechanism=MONGODB-OIDC&authMechanismProperties=${MANAGED_IDENTITY_AUTH_MECHANISM_PROPERTIES}`,
        );

        expect(getConnectionStringAuthFacts(cs)).toMatchObject({ username: undefined, usernameIsGuid: false });
    });

    it('reports OIDC plus a GUID username without assigning confidence', () => {
        const cs = parse(`mongodb+srv://${CLIENT_ID}@${HOST}/?authMechanism=MONGODB-OIDC`);

        expect(getConnectionStringAuthFacts(cs)).toMatchObject({
            usesOidc: true,
            declaresAzureMachineWorkflow: false,
            username: CLIENT_ID,
            usernameIsGuid: true,
        });
    });

    it('finds ENVIRONMENT:azure among other authMechanismProperties entries', () => {
        const cs = parse(
            `mongodb+srv://${HOST}/?authMechanism=MONGODB-OIDC&authMechanismProperties=TOKEN_RESOURCE:https://ossrdbms-aad.database.windows.net,ENVIRONMENT:azure`,
        );

        expect(getConnectionStringAuthFacts(cs).declaresAzureMachineWorkflow).toBe(true);
    });

    it('is case insensitive on the mechanism and the ENVIRONMENT entry', () => {
        const cs = parse(`mongodb+srv://${HOST}/?authMechanism=mongodb-oidc&authMechanismProperties=Environment:Azure`);

        expect(getConnectionStringAuthFacts(cs)).toMatchObject({
            usesOidc: true,
            declaresAzureMachineWorkflow: true,
        });
    });

    it('works for a plain mongodb:// host as well as +srv', () => {
        const cs = parse(
            `mongodb://${CLIENT_ID}@${HOST}:10260/?authMechanism=MONGODB-OIDC&authMechanismProperties=${MANAGED_IDENTITY_AUTH_MECHANISM_PROPERTIES}`,
        );

        expect(getConnectionStringAuthFacts(cs)).toMatchObject({ username: CLIENT_ID, usernameIsGuid: true });
    });

    it('keeps a username that is not GUID shaped as a supplied identity to review', () => {
        const cs = parse(
            `mongodb+srv://alice@${HOST}/?authMechanism=MONGODB-OIDC&authMechanismProperties=${MANAGED_IDENTITY_AUTH_MECHANISM_PROPERTIES}`,
        );

        expect(getConnectionStringAuthFacts(cs)).toMatchObject({ username: 'alice', usernameIsGuid: false });
    });

    it('reports bare OIDC without inventing a token source', () => {
        const cs = parse(`mongodb+srv://${HOST}/?authMechanism=MONGODB-OIDC`);

        expect(getConnectionStringAuthFacts(cs)).toMatchObject({
            usesOidc: true,
            declaresAzureMachineWorkflow: false,
            username: undefined,
            usernameIsGuid: false,
        });
    });

    it('reports a plain native-auth connection string without interpreting it as OIDC', () => {
        const cs = parse(`mongodb+srv://alice:secret@${HOST}/?retryWrites=true`);

        expect(getConnectionStringAuthFacts(cs)).toMatchObject({
            usesOidc: false,
            declaresAzureMachineWorkflow: false,
            username: 'alice',
            usernameIsGuid: false,
        });
    });

    it('reports ENVIRONMENT:azure independently of the authentication mechanism', () => {
        const cs = parse(`mongodb+srv://${HOST}/?authMechanismProperties=ENVIRONMENT:azure`);

        expect(getConnectionStringAuthFacts(cs)).toMatchObject({
            usesOidc: false,
            declaresAzureMachineWorkflow: true,
        });
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
