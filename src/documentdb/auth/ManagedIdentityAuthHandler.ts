/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { randomUUID } from 'crypto';
import { type MongoClientOptions, type OIDCResponse } from 'mongodb';
import * as vscode from 'vscode';
import { settingsKeys } from '../../settingsKeys';
import { traceAuthFlow, traceAuthOperation, type AuthTraceContext } from '../../utils/authTrace';
import { type CachedClusterCredentials } from '../CredentialCache';
import { withTokenAcquisitionTiming, type ConnectionStartupTimings } from '../utils/ConnectionStartupTimings';
import { DocumentDBConnectionString } from '../utils/DocumentDBConnectionString';
import { resolveAllowInvalidCertificates } from '../utils/tlsException';
import { type AuthHandler, type AuthHandlerResponse } from './AuthHandler';
import { resolveManagedIdentityTokenResource, type DocumentDBCustomEnvironment } from './documentdbTokenResource';
import { recordEntraTokenFailure } from './entraErrors/entraTokenFailures';
import { getManagedIdentityAccessToken } from './managedIdentityTokenProvider';
import { getOidcAllowedHosts } from './oidcAllowedHosts';
import { expiresInSecondsFromTimestamp } from './tokenExpiry';

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
    private readonly tokenCorrelationId = randomUUID();

    constructor(private readonly clusterCredentials: CachedClusterCredentials) {}

    public async configureAuth(
        timings?: ConnectionStartupTimings,
        traceContext?: AuthTraceContext,
    ): Promise<AuthHandlerResponse> {
        const clientId = this.clusterCredentials.managedIdentityConfig?.clientId;
        const tenantId = this.clusterCredentials.managedIdentityConfig?.tenantId;
        const resolved = await resolveManagedIdentityTokenResource(this.clusterCredentials.connectionString);
        const customHostnameSuffix = vscode.workspace
            .getConfiguration()
            .get<DocumentDBCustomEnvironment>(settingsKeys.customEnvironment)?.mongoClusterHostnameSuffix;
        traceAuthFlow(
            'managedIdentity.configureOidc',
            {
                identityKind: clientId ? 'userAssigned' : 'systemAssigned',
                clusterTenantKnown: !!tenantId,
                tokenAcquisition: 'deferredUntilDriverCallback',
                cloudCategory: resolved.cloudCategory,
                tokenResourceReason: resolved.reason,
            },
            this.tokenCorrelationId,
            traceContext,
        );

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
                ALLOWED_HOSTS: getOidcAllowedHosts(this.clusterCredentials.connectionString, customHostnameSuffix),
                OIDC_CALLBACK: async (): Promise<OIDCResponse> => {
                    try {
                        const token = await traceAuthOperation(
                            'managedIdentity.oidcCallback',
                            () =>
                                withTokenAcquisitionTiming(timings, () =>
                                    getManagedIdentityAccessToken(
                                        [resolved.scope],
                                        clientId,
                                        tenantId,
                                        this.tokenCorrelationId,
                                        traceContext,
                                    ),
                                ),
                            {},
                            this.tokenCorrelationId,
                            traceContext,
                        );

                        return {
                            accessToken: token.accessToken,
                            expiresInSeconds: expiresInSecondsFromTimestamp(token.expiresOnTimestamp),
                        };
                    } catch (error) {
                        recordEntraTokenFailure(this.clusterCredentials.clusterId, {
                            cloudCategory: resolved.cloudCategory,
                            authMethod: 'managedIdentity',
                        });
                        throw error;
                    }
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
