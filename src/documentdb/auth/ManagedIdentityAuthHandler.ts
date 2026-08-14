/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type AccessToken } from '@azure/identity';
import { type MongoClientOptions, type OIDCResponse } from 'mongodb';
import { type CachedClusterCredentials } from '../CredentialCache';
import { DocumentDBConnectionString } from '../utils/DocumentDBConnectionString';
import { resolveAllowInvalidCertificates } from '../utils/tlsException';
import { type AuthHandler, type AuthHandlerResponse } from './AuthHandler';
import { DOCUMENTDB_ENTRA_SCOPE } from './entraScopes';
import { describeManagedIdentityError } from './managedIdentityErrors';
import { reportManagedIdentityTokenFailure } from './managedIdentityTelemetry';
import { verifyManagedIdentityTenant } from './managedIdentityTenant';
import { getOidcAllowedHosts } from './oidcAllowedHosts';

/**
 * Seconds until an absolute expiry timestamp (milliseconds since the epoch), floored at zero.
 *
 * A small safety margin is subtracted so the driver refreshes slightly early rather than presenting
 * a token that expires in flight.
 */
export function expiresInSecondsFromTimestamp(expiresOnTimestamp: number, now: number = Date.now()): number {
    if (!Number.isFinite(expiresOnTimestamp)) {
        return 0;
    }

    const EXPIRY_SAFETY_MARGIN_SECONDS = 300;
    const remaining = Math.floor((expiresOnTimestamp - now) / 1000) - EXPIRY_SAFETY_MARGIN_SECONDS;
    return remaining > 0 ? remaining : 0;
}

/**
 * Handler for Microsoft Entra ID authentication using the managed identity of the Azure VM that is
 * hosting VS Code.
 *
 * The token always comes from `@azure/identity`'s `ManagedIdentityCredential` (decision D1); the
 * driver's own `ENVIRONMENT: 'azure'` machine flow is never used at runtime, because its failures
 * surface as an opaque HTTP status code, which is exactly the wrong experience for the
 * multiple-identity case this feature exists to fix.
 */
export class ManagedIdentityAuthHandler implements AuthHandler {
    constructor(private readonly clusterCredentials: CachedClusterCredentials) {}

    public async configureAuth(): Promise<AuthHandlerResponse> {
        // Dynamic import: @azure/identity pulls in MSAL and must stay out of the activation path.
        const { ManagedIdentityCredential } = await import('@azure/identity');

        const clientId = this.clusterCredentials.managedIdentityConfig?.clientId;
        const credential = clientId ? new ManagedIdentityCredential({ clientId }) : new ManagedIdentityCredential();

        const dbConnectionString = new DocumentDBConnectionString(this.clusterCredentials.connectionString);
        dbConnectionString.username = '';
        dbConnectionString.password = '';
        // The URL form must not compete with `MongoClientOptions.authMechanismProperties`; leaving
        // `ENVIRONMENT:azure` in place risks the driver taking its own instance-metadata path.
        dbConnectionString.searchParams.delete('authMechanism');
        dbConnectionString.searchParams.delete('authMechanismProperties');
        dbConnectionString.searchParams.delete('tls');

        const options: MongoClientOptions = {
            authMechanism: 'MONGODB-OIDC',
            tls: true,
            authMechanismProperties: {
                ALLOWED_HOSTS: getOidcAllowedHosts(this.clusterCredentials.connectionString),
                OIDC_CALLBACK: async (): Promise<OIDCResponse> => {
                    let token: AccessToken | null;
                    try {
                        token = await credential.getToken(DOCUMENTDB_ENTRA_SCOPE);
                    } catch (error) {
                        reportManagedIdentityTokenFailure(error, clientId);
                        throw new Error(describeManagedIdentityError(error, clientId));
                    }

                    if (!token) {
                        reportManagedIdentityTokenFailure(undefined, clientId);
                        throw new Error(describeManagedIdentityError(undefined, clientId));
                    }

                    verifyManagedIdentityTenant(
                        token.token,
                        this.clusterCredentials.managedIdentityConfig?.tenantId,
                        clientId,
                    );

                    return {
                        accessToken: token.token,
                        expiresInSeconds: expiresInSecondsFromTimestamp(token.expiresOnTimestamp),
                    };
                },
            },
        };

        // Same host-gated TLS exception policy as every other handler.
        if (
            resolveAllowInvalidCertificates(
                this.clusterCredentials.emulatorConfiguration?.disableEmulatorSecurity,
                this.clusterCredentials.connectionString,
            )
        ) {
            options.tlsAllowInvalidCertificates = true;
        }

        return {
            connectionString: dbConnectionString.toString(),
            options,
        };
    }
}
