/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { randomUUID } from 'crypto';
import { type OIDCResponse } from 'mongodb';
import { ext } from '../../extensionVariables';
import { traceAuthFlow, traceAuthOperation, traceEntraDestination, type AuthTraceContext } from '../../utils/authTrace';
import { type CachedClusterCredentials } from '../CredentialCache';
import { withTokenAcquisitionTiming, type ConnectionStartupTimings } from '../utils/ConnectionStartupTimings';
import { notifyAuthPhaseObserver, type AuthCallerPolicy, type AuthPhaseObserver } from './authCallerPolicy';
import { type AuthHandler, type AuthHandlerResponse } from './AuthHandler';
import { resolveManagedIdentityTokenResource, TokenResourceResolutionError } from './documentdbTokenResource';
import { evaluateEntraDestinationFromSettings, getEntraCustomHostnameSuffix } from './entraDestinationSettings';
import { classifyEntraError } from './entraErrors/classifyEntraError';
import { clearEntraTokenFailure, recordEntraTokenFailure } from './entraErrors/entraTokenFailures';
import { getManagedIdentityAccessToken } from './managedIdentityTokenProvider';
import { EntraDestinationRejectedError } from './oidcAllowedHosts';
import { buildOidcClientConfiguration, createOidcDestinationPolicy } from './oidcClientOptions';
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
        const { connectionString, clusterId } = this.clusterCredentials;
        const decision = evaluateEntraDestinationFromSettings(connectionString);
        traceEntraDestination(decision, this.tokenCorrelationId, traceContext);
        if (!decision.allowed) {
            throw new EntraDestinationRejectedError(decision);
        }
        const policy = createOidcDestinationPolicy(connectionString, getEntraCustomHostnameSuffix);
        const clientId = this.clusterCredentials.managedIdentityConfig?.clientId;
        const tenantId = this.clusterCredentials.managedIdentityConfig?.tenantId;
        let resolved: Awaited<ReturnType<typeof resolveManagedIdentityTokenResource>>;
        try {
            resolved = await resolveManagedIdentityTokenResource(connectionString);
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
        policy.assertAllowed();
        this.notify((observer) =>
            observer.onSignInConfigurationResolved?.({
                details: resolved.details,
                cloudCategory: resolved.cloudCategory,
                tokenResourceReason: resolved.reason,
                allowedHosts: policy.allowedHostPatterns,
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
            },
            this.tokenCorrelationId,
            traceContext,
        );

        const configuration = buildOidcClientConfiguration({
            connectionString,
            policy,
            oidcCallback: async (): Promise<OIDCResponse> => {
                const currentDecision = evaluateEntraDestinationFromSettings(connectionString);
                traceEntraDestination(currentDecision, this.tokenCorrelationId, traceContext);
                if (!currentDecision.allowed) {
                    throw new EntraDestinationRejectedError(currentDecision);
                }
                policy.assertAllowed();
                this.notify((observer) => observer.onTokenStarted?.());
                let token: Awaited<ReturnType<typeof getManagedIdentityAccessToken>>;
                try {
                    token = await traceAuthOperation(
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
                } catch (error) {
                    if (traceContext?.startupProperties) {
                        traceContext.startupProperties.entraFailureKind = 'tokenAcquisitionFailed';
                    }
                    recordEntraTokenFailure(clusterId, {
                        cloudCategory: resolved.cloudCategory,
                        authMethod: 'managedIdentity',
                        ruleId: classifyEntraError(error instanceof Error ? error.message : String(error))?.ruleId,
                    });
                    this.notify((observer) => observer.onTokenFailed?.(error));
                    throw error;
                }
                policy.assertAllowed();
                clearEntraTokenFailure(clusterId);
                this.notify((observer) =>
                    observer.onTokenAcquired?.({ accessToken: token.accessToken, tenantId }),
                );
                return {
                    accessToken: token.accessToken,
                    expiresInSeconds: expiresInSecondsFromTimestamp(token.expiresOnTimestamp),
                };
            },
        });
        if (configuration.ignoredTlsBypass || this.clusterCredentials.emulatorConfiguration?.disableEmulatorSecurity) {
            ext.outputChannel.info(
                l10n.t('[Auth] TLS validation bypass parameters are ignored for Microsoft Entra ID connections.'),
            );
        }

        return {
            connectionString: configuration.connectionString,
            options: configuration.options,
        };
    }
}
