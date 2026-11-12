/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// eslint-disable-next-line import/no-internal-modules
import { getSessionFromVSCode } from '@microsoft/vscode-azext-azureauth/out/src/getSessionFromVSCode';
import * as l10n from '@vscode/l10n';
import { randomUUID } from 'crypto';
import { type OIDCCallbackParams, type OIDCResponse } from 'mongodb';
import type * as vscode from 'vscode';
import { ext } from '../../extensionVariables';
import { traceAuthFlow, traceAuthOperation, traceEntraDestination, type AuthTraceContext } from '../../utils/authTrace';
import { type CachedClusterCredentials } from '../CredentialCache';
import { withTokenAcquisitionTiming, type ConnectionStartupTimings } from '../utils/ConnectionStartupTimings';
import {
    AuthInputUnavailableError,
    notifyAuthPhaseObserver,
    type AuthCallerPolicy,
    type AuthPhaseObserver,
} from './authCallerPolicy';
import { type AuthHandler, type AuthHandlerResponse } from './AuthHandler';
import { resolveInteractiveTokenResource, TokenResourceResolutionError } from './documentdbTokenResource';
import { evaluateEntraDestinationFromSettings, getEntraCustomHostnameSuffix } from './entraDestinationSettings';
import { classifyEntraError } from './entraErrors/classifyEntraError';
import { clearEntraTokenFailure, recordEntraTokenFailure } from './entraErrors/entraTokenFailures';
import { EntraDestinationRejectedError } from './oidcAllowedHosts';
import { buildOidcClientConfiguration, createOidcDestinationPolicy } from './oidcClientOptions';

/**
 * Handler for Microsoft Entra ID authentication via OIDC.
 *
 * An interactive policy may open sign-in (`createIfNone`). A non-interactive policy only looks up
 * an existing session silently and reports a missing one as {@link AuthInputUnavailableError}.
 */
export class MicrosoftEntraIDAuthHandler implements AuthHandler {
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
        const authCorrelationId = randomUUID();
        const { connectionString, clusterId } = this.clusterCredentials;
        const tenantId = this.clusterCredentials.entraIdConfig?.tenantId;
        const decision = evaluateEntraDestinationFromSettings(connectionString);
        traceEntraDestination(decision, authCorrelationId, traceContext);
        if (!decision.allowed) {
            throw new EntraDestinationRejectedError(decision);
        }
        const policy = createOidcDestinationPolicy(connectionString, getEntraCustomHostnameSuffix);
        let resolved: Awaited<ReturnType<typeof resolveInteractiveTokenResource>>;
        try {
            resolved = await resolveInteractiveTokenResource(connectionString);
            traceAuthFlow('entraCloud.resolved', resolved.details, authCorrelationId, traceContext);
        } catch (error) {
            if (error instanceof TokenResourceResolutionError) {
                traceAuthFlow('entraCloud.unresolved', error.details, authCorrelationId, traceContext);
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

        // Get Microsoft Entra ID token. Only an interactive caller may open sign-in; a non-interactive
        // caller looks up an existing session silently and never forces a new one.
        const interactive = this.policy.interactive;
        let session: vscode.AuthenticationSession | undefined;
        this.notify((observer) => observer.onTokenStarted?.());
        try {
            session = await traceAuthOperation(
                'interactiveEntra.getSession',
                () =>
                    withTokenAcquisitionTiming(timings, () =>
                        getSessionFromVSCode(
                            [resolved.scope],
                            tenantId,
                            interactive ? { createIfNone: true } : { silent: true },
                        ),
                    ),
                {
                    tenantSpecified: !!tenantId,
                    ...(interactive ? { createIfNone: true } : { silent: true }),
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
                if (!interactive) {
                    throw new AuthInputUnavailableError('entraSession');
                }
                throw new Error(l10n.t('Failed to obtain Entra ID token.'));
            }
        } catch (error) {
            // A silent lookup without a session is not a token failure: recording it would change how
            // the next real connect's error is explained.
            if (!(error instanceof AuthInputUnavailableError)) {
                if (traceContext?.startupProperties) {
                    traceContext.startupProperties.entraFailureKind = 'tokenAcquisitionFailed';
                }
                recordEntraTokenFailure(clusterId, {
                    cloudCategory: resolved.cloudCategory,
                    authMethod: 'interactive',
                    ruleId: classifyEntraError(error instanceof Error ? error.message : String(error))?.ruleId,
                });
            }
            this.notify((observer) => observer.onTokenFailed?.(error));
            throw error;
        }

        policy.assertAllowed();
        clearEntraTokenFailure(clusterId);
        const acquiredSession = session;
        this.notify((observer) =>
            observer.onTokenAcquired?.({
                accessToken: acquiredSession.accessToken,
                account: acquiredSession.account
                    ? { label: acquiredSession.account.label, id: acquiredSession.account.id }
                    : undefined,
                tenantId,
            }),
        );

        const configuration = buildOidcClientConfiguration({
            connectionString,
            policy,
            oidcCallback: (_params: OIDCCallbackParams): Promise<OIDCResponse> =>
                Promise.resolve({
                    accessToken: session.accessToken,
                    expiresInSeconds: 0,
                }),
        });
        if (configuration.ignoredTlsBypass || this.clusterCredentials.emulatorConfiguration?.disableEmulatorSecurity) {
            ext.outputChannel.info(
                l10n.t('[Auth] TLS validation bypass parameters are ignored for Microsoft Entra ID connections.'),
            );
        }

        traceAuthFlow(
            'interactiveEntra.oidcConfigured',
            { sessionAvailable: true, tls: true },
            authCorrelationId,
            traceContext,
        );
        return {
            connectionString: configuration.connectionString,
            options: configuration.options,
        };
    }
}
