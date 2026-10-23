/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// eslint-disable-next-line import/no-internal-modules
import { getSessionFromVSCode } from '@microsoft/vscode-azext-azureauth/out/src/getSessionFromVSCode';
import * as l10n from '@vscode/l10n';
import { randomUUID } from 'crypto';
import { type MongoClientOptions, type OIDCCallbackParams, type OIDCResponse } from 'mongodb';
import * as vscode from 'vscode';
import { settingsKeys } from '../../settingsKeys';
import { traceAuthFlow, traceAuthOperation, type AuthTraceContext } from '../../utils/authTrace';
import { type CachedClusterCredentials } from '../CredentialCache';
import { withTokenAcquisitionTiming, type ConnectionStartupTimings } from '../utils/ConnectionStartupTimings';
import { DocumentDBConnectionString } from '../utils/DocumentDBConnectionString';
import { resolveAllowInvalidCertificates } from '../utils/tlsException';
import { type AuthHandler, type AuthHandlerResponse } from './AuthHandler';
import { resolveInteractiveTokenResource, type DocumentDBCustomEnvironment } from './documentdbTokenResource';
import { recordEntraTokenFailure } from './entraErrors/entraTokenFailures';
import { getOidcAllowedHosts } from './oidcAllowedHosts';

/**
 * Handler for Microsoft Entra ID authentication via OIDC
 */
export class MicrosoftEntraIDAuthHandler implements AuthHandler {
    constructor(private readonly clusterCredentials: CachedClusterCredentials) {}

    public async configureAuth(
        timings?: ConnectionStartupTimings,
        traceContext?: AuthTraceContext,
    ): Promise<AuthHandlerResponse> {
        const authCorrelationId = randomUUID();
        const resolved = await resolveInteractiveTokenResource(this.clusterCredentials.connectionString);
        const customHostnameSuffix = vscode.workspace
            .getConfiguration()
            .get<DocumentDBCustomEnvironment>(settingsKeys.customEnvironment)?.mongoClusterHostnameSuffix;
        // Get Microsoft Entra ID token
        let session: vscode.AuthenticationSession | undefined;
        try {
            session = await traceAuthOperation(
                'interactiveEntra.getSession',
                () =>
                    withTokenAcquisitionTiming(timings, () =>
                        getSessionFromVSCode([resolved.scope], this.clusterCredentials.entraIdConfig?.tenantId, {
                            createIfNone: true,
                        }),
                    ),
                {
                    tenantSpecified: !!this.clusterCredentials.entraIdConfig?.tenantId,
                    createIfNone: true,
                    cloudCategory: resolved.cloudCategory,
                    tokenResourceReason: resolved.reason,
                },
                authCorrelationId,
                traceContext,
            );

            if (!session) {
                traceAuthFlow(
                    'interactiveEntra.sessionUnavailable',
                    { reason: 'noSessionReturned' },
                    authCorrelationId,
                    traceContext,
                );
                throw new Error(l10n.t('Failed to obtain Entra ID token.'));
            }
        } catch (error) {
            recordEntraTokenFailure(this.clusterCredentials.clusterId, {
                cloudCategory: resolved.cloudCategory,
                authMethod: 'interactive',
            });
            throw error;
        }

        // Prepare connection string
        const dbConnectionString = new DocumentDBConnectionString(this.clusterCredentials.connectionString);
        dbConnectionString.username = ''; // required to move forward with Entra ID
        dbConnectionString.password = ''; // required to move forward with Entra ID
        dbConnectionString.searchParams.delete('authMechanism');
        dbConnectionString.searchParams.delete('authMechanismProperties');
        dbConnectionString.searchParams.delete('tls');

        // Configure MongoDB client options for OIDC
        const options: MongoClientOptions = {
            authMechanism: 'MONGODB-OIDC',
            tls: true,
            authMechanismProperties: {
                ALLOWED_HOSTS: getOidcAllowedHosts(this.clusterCredentials.connectionString, customHostnameSuffix),
                OIDC_CALLBACK: (_params: OIDCCallbackParams): Promise<OIDCResponse> =>
                    Promise.resolve({
                        accessToken: session.accessToken,
                        expiresInSeconds: 0,
                    }),
            },
        };

        // Honor the TLS exception (design §7) consistently with the other auth paths, with the same
        // "hybrid" runtime policy (flag honored only for local/private hosts). Entra ID is only
        // offered for Azure (public) hosts, so this is effectively defensive, but it keeps the policy
        // uniform across all builders.
        if (
            resolveAllowInvalidCertificates(
                this.clusterCredentials.emulatorConfiguration?.disableEmulatorSecurity,
                this.clusterCredentials.connectionString,
            )
        ) {
            options.tlsAllowInvalidCertificates = true;
        }

        traceAuthFlow(
            'interactiveEntra.oidcConfigured',
            { sessionAvailable: true, tls: true },
            authCorrelationId,
            traceContext,
        );
        return {
            connectionString: dbConnectionString.toString(),
            options,
        };
    }
}
