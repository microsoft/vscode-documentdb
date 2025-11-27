/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// eslint-disable-next-line import/no-internal-modules
import { getSessionFromVSCode } from '@microsoft/vscode-azext-azureauth/out/src/getSessionFromVSCode';
import * as l10n from '@vscode/l10n';
import { type MongoClientOptions, type OIDCCallbackParams, type OIDCResponse } from 'mongodb';
import { type CachedClusterCredentials } from '../CredentialCache';
import { DocumentDBConnectionString } from '../utils/DocumentDBConnectionString';
import { type AuthHandler, type AuthHandlerResponse } from './AuthHandler';

/**
 * Handler for Microsoft Entra ID authentication via OIDC
 */
export class MicrosoftEntraIDAuthHandler implements AuthHandler {
    constructor(private readonly clusterCredentials: CachedClusterCredentials) {}

    public async configureAuth(): Promise<AuthHandlerResponse> {
        // Get Microsoft Entra ID token
        const session = await getSessionFromVSCode(
            ['https://ossrdbms-aad.database.windows.net/.default'],
            this.clusterCredentials.entraIdConfig?.tenantId,
            {
                createIfNone: true,
            },
        );

        if (!session) {
            throw new Error(l10n.t('Failed to obtain Entra ID token.'));
        }

        // Prepare connection string
        const dbConnectionString = new DocumentDBConnectionString(this.clusterCredentials.connectionString);
        dbConnectionString.username = ''; // required to move forward with Entra ID
        dbConnectionString.password = ''; // required to move forward with Entra ID
        dbConnectionString.searchParams.delete('authMechanism');
        dbConnectionString.searchParams.delete('tls');

        // Configure MongoDB client options for OIDC
        const options: MongoClientOptions = {
            authMechanism: 'MONGODB-OIDC',
            tls: true,
            authMechanismProperties: {
                ALLOWED_HOSTS: ['*.azure.com'],
                OIDC_CALLBACK: (_params: OIDCCallbackParams): Promise<OIDCResponse> =>
                    Promise.resolve({
                        accessToken: session.accessToken,
                        expiresInSeconds: 0,
                    }),
            },
        };

        return {
            connectionString: dbConnectionString.toString(),
            options,
        };
    }
}
