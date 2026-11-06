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
import { notifyAuthPhaseObserver, type AuthCallerPolicy, type AuthPhaseObserver } from './authCallerPolicy';
import { buildAuthConnectionTarget } from './authConnectionTarget';
import { type AuthHandler, type AuthHandlerResponse } from './AuthHandler';
import { AuthMethodId } from './AuthMethod';
import {
    resolveManagedIdentityTokenResource,
    TokenResourceResolutionError,
    type DocumentDBCustomEnvironment,
} from './documentdbTokenResource';
import { classifyEntraError } from './entraErrors/classifyEntraError';
import { clearEntraTokenFailure, recordEntraTokenFailure } from './entraErrors/entraTokenFailures';
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
 *
 * Managed identity never prompts, so the caller policy does not change the flow; only its observer
 * is notified. The token phase runs inside the driver's `OIDC_CALLBACK`, after the driver connected.
 */
export class ManagedIdentityAuthHandler implements AuthHandler {
    private readonly tokenCorrelationId = randomUUID();

    constructor(
        private readonly clusterCredentials: CachedClusterCredentials,
        public readonly policy: AuthCallerPolicy = { interactive: true },
    ) {}

    private notify(notify: (observer: AuthPhaseObserver) => void): void {
        notifyAuthPhaseObserver(this.policy.observer, notify);
    }

    public async configureAuth(
        timings?: ConnectionStartupTimings,
        traceContext?: AuthTraceContext,
    ): Promise<AuthHandlerResponse> {
        const clientId = this.clusterCredentials.managedIdentityConfig?.clientId;
        const tenantId = this.clusterCredentials.managedIdentityConfig?.tenantId;
        let resolved: Awaited<ReturnType<typeof resolveManagedIdentityTokenResource>>;
        try {
            resolved = await resolveManagedIdentityTokenResource(this.clusterCredentials.connectionString);
            traceAuthFlow('entraCloud.resolved', resolved.details, this.tokenCorrelationId, traceContext);
        } catch (error) {
            if (error instanceof TokenResourceResolutionError) {
                traceAuthFlow('entraCloud.unresolved', error.details, this.tokenCorrelationId, traceContext);
            }
            this.notify((observer) =>
                observer.onSignInConfigurationFailed?.(
                    error instanceof TokenResourceResolutionError
                        ? { kind: error.kind, details: error.details }
                        : { kind: 'unknown', details: {} },
                ),
            );
            throw error;
        }
        const customHostnameSuffix = vscode.workspace
            .getConfiguration()
            .get<DocumentDBCustomEnvironment>(settingsKeys.customEnvironment)?.hostnameSuffix;
        const allowedHosts = getOidcAllowedHosts(this.clusterCredentials.connectionString, customHostnameSuffix);
        this.notify((observer) =>
            observer.onSignInConfigurationResolved?.({
                details: resolved.details,
                cloudCategory: resolved.cloudCategory,
                tokenResourceReason: resolved.reason,
                allowedHosts,
            }),
        );
        traceAuthFlow(
            'managedIdentity.configureOidc',
            {
                identityKind: clientId ? 'userAssigned' : 'systemAssigned',
                clusterTenantKnown: !!tenantId,
                tokenAcquisition: 'deferredUntilDriverCallback',
                cloudCategory: resolved.cloudCategory,
                tokenResourceReason: resolved.reason,
                allowedHosts: allowedHosts.join(','),
            },
            this.tokenCorrelationId,
            traceContext,
        );

        // Credential-free connection string and OIDC network options (forced TLS and the same
        // host-gated TLS exception policy as every other handler).
        const { connectionString, networkOptions } = buildAuthConnectionTarget(
            AuthMethodId.ManagedIdentity,
            this.clusterCredentials,
        );

        const options: MongoClientOptions = {
            ...networkOptions,
            authMechanismProperties: {
                ALLOWED_HOSTS: allowedHosts,
                OIDC_CALLBACK: async (): Promise<OIDCResponse> => {
                    this.notify((observer) => observer.onTokenStarted?.());
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

                        clearEntraTokenFailure(this.clusterCredentials.clusterId);
                        this.notify((observer) =>
                            observer.onTokenAcquired?.({ accessToken: token.accessToken, tenantId }),
                        );
                        return {
                            accessToken: token.accessToken,
                            expiresInSeconds: expiresInSecondsFromTimestamp(token.expiresOnTimestamp),
                        };
                    } catch (error) {
                        if (traceContext?.startupProperties) {
                            traceContext.startupProperties.entraFailureKind = 'tokenAcquisitionFailed';
                        }
                        recordEntraTokenFailure(this.clusterCredentials.clusterId, {
                            cloudCategory: resolved.cloudCategory,
                            authMethod: 'managedIdentity',
                            ruleId: classifyEntraError(error instanceof Error ? error.message : String(error))?.ruleId,
                        });
                        this.notify((observer) => observer.onTokenFailed?.(error));
                        throw error;
                    }
                },
            },
        };

        return {
            connectionString,
            options,
        };
    }
}
