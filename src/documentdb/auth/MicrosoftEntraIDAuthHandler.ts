/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

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
import { type AuthHandler, type AuthHandlerResponse, type VerifiedEntraIdentity } from './AuthHandler';
import { AuthMethodId } from './AuthMethod';
import { resolveInteractiveTokenResource, TokenResourceResolutionError } from './documentdbTokenResource';
import { evaluateEntraDestinationFromSettings, getEntraCustomHostnameSuffix } from './entraDestinationSettings';
import { classifyEntraError } from './entraErrors/classifyEntraError';
import {
    EntraIdentityMismatchError,
    EntraSignInRequiredError,
    TokenCallbackError,
} from './entraErrors/entraCallbackErrors';
import { clearEntraTokenFailure, recordEntraTokenFailure } from './entraErrors/entraTokenFailures';
import { getEntraSession, readEntraSignInEnvironment, type EntraSignInEnvironment } from './entraSession';
import { EntraDestinationRejectedError } from './oidcAllowedHosts';
import { buildOidcClientConfiguration, createOidcDestinationPolicy } from './oidcClientOptions';
import { readJwtTimes } from './tokenExpiry';

interface EntraTokenLookupObservation {
    readonly outcome: 'returned' | 'noSession' | 'identityMismatch' | 'failed';
    readonly lifetimeSeconds?: number;
}

interface EntraCallerPolicy extends AuthCallerPolicy {
    readonly onTokenLookup?: (observation: EntraTokenLookupObservation) => void;
}

function assertEntraSignInEnvironment(expected: EntraSignInEnvironment | undefined): EntraSignInEnvironment {
    let current: EntraSignInEnvironment;
    try {
        current = readEntraSignInEnvironment();
    } catch {
        throw new EntraSignInRequiredError('providerChanged');
    }
    if (
        !expected ||
        current.providerId !== expected.providerId ||
        current.cloudName !== expected.cloudName ||
        current.authority !== expected.authority
    ) {
        throw new EntraSignInRequiredError('providerChanged');
    }
    return expected;
}

/**
 * Handler for Microsoft Entra ID authentication via OIDC.
 *
 * An interactive policy may open sign-in (`createIfNone`) only without a pin. Pinned lookups and
 * diagnostics are silent; only diagnostics report a missing session as {@link AuthInputUnavailableError}.
 */
export class MicrosoftEntraIDAuthHandler implements AuthHandler {
    constructor(
        private readonly clusterCredentials: CachedClusterCredentials,
        public readonly policy: EntraCallerPolicy = { interactive: true },
    ) {}

    private notify(notify: (observer: AuthPhaseObserver) => void): void {
        notifyAuthPhaseObserver(this.policy.observer, notify);
    }

    public async configureAuth(
        timings?: ConnectionStartupTimings,
        traceContext?: AuthTraceContext,
        acquireRecoverySession?: (request: Parameters<typeof getEntraSession>[0]) => ReturnType<typeof getEntraSession>,
    ): Promise<AuthHandlerResponse> {
        const authCorrelationId = randomUUID();
        const { connectionString, clusterId } = this.clusterCredentials;
        const pin = this.policy.pinnedEntraIdentity;
        const tenantId = pin ? pin.tenantId : this.clusterCredentials.entraIdConfig?.tenantId;
        const decision = evaluateEntraDestinationFromSettings(connectionString);
        traceEntraDestination(decision, authCorrelationId, traceContext);
        if (!decision.allowed) {
            throw new EntraDestinationRejectedError(decision);
        }
        const policy = createOidcDestinationPolicy(connectionString, getEntraCustomHostnameSuffix);
        let environmentBeforeResolution: EntraSignInEnvironment | undefined;
        try {
            environmentBeforeResolution = readEntraSignInEnvironment();
        } catch {
            // Let resource resolution report invalid cloud configuration with its existing diagnostics.
        }
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
        const interactive = this.policy.interactive && !pin;
        let session: vscode.AuthenticationSession | undefined;
        let signInEnvironment: EntraSignInEnvironment;
        const resource = resolved.scope;
        this.notify((observer) => observer.onTokenStarted?.());
        try {
            ({ session, signInEnvironment } = await traceAuthOperation(
                'interactiveEntra.getSession',
                () =>
                    withTokenAcquisitionTiming(timings, async () => {
                        const signInEnvironment = assertEntraSignInEnvironment(environmentBeforeResolution);
                        if (pin && pin.providerId !== signInEnvironment.providerId) {
                            throw new EntraSignInRequiredError('providerChanged');
                        }
                        try {
                            const session = await (acquireRecoverySession ?? getEntraSession)({
                                providerId: pin?.providerId ?? signInEnvironment.providerId,
                                resource,
                                tenantId,
                                account: pin ? { id: pin.accountId, label: pin.accountLabel } : undefined,
                                mode: acquireRecoverySession ? 'forceNew' : interactive ? 'interactive' : 'silent',
                            });
                            return { session, signInEnvironment };
                        } finally {
                            assertEntraSignInEnvironment(signInEnvironment);
                        }
                    }),
                {
                    tenantSpecified: !!tenantId,
                    ...(interactive ? { createIfNone: true } : { silent: true }),
                    cloudCategory: resolved.cloudCategory,
                    tokenResourceReason: resolved.reason,
                },
                authCorrelationId,
                traceContext,
            ));

            if (!session) {
                traceAuthFlow(
                    'interactiveEntra.sessionUnavailable',
                    { reason: 'noSessionReturned' },
                    authCorrelationId,
                    traceContext,
                );
                if (pin) {
                    throw new EntraSignInRequiredError('noSession');
                }
                if (!interactive) {
                    throw new AuthInputUnavailableError('entraSession');
                }
                throw new Error(l10n.t('Failed to obtain Entra ID token.'));
            }
            if (pin && !acquireRecoverySession && session.account.id !== pin.accountId) {
                throw new EntraIdentityMismatchError();
            }
        } catch (error) {
            // Missing input or configuration drift must not alter the next connect's failure context.
            if (
                !(error instanceof AuthInputUnavailableError) &&
                !(error instanceof EntraSignInRequiredError) &&
                !(error instanceof EntraIdentityMismatchError)
            ) {
                if (traceContext?.startupProperties) {
                    traceContext.startupProperties.entraFailureKind = 'tokenAcquisitionFailed';
                }
                const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
                recordEntraTokenFailure(clusterId, {
                    cloudCategory: resolved.cloudCategory,
                    authMethod: 'interactive',
                    ruleId: classifyEntraError(message)?.ruleId,
                });
            }
            this.notify((observer) => observer.onTokenFailed?.(error));
            throw error;
        }

        policy.assertAllowed();
        clearEntraTokenFailure(clusterId);
        const { providerId } = signInEnvironment;
        const { id: accountId, label: accountLabel } = session.account;
        const verifiedIdentity: VerifiedEntraIdentity = {
            kind: 'entra',
            providerId,
            accountId,
            accountLabel,
            tenantId,
        };
        const account: vscode.AuthenticationSessionAccountInformation = { id: accountId, label: accountLabel };
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

        let invocation = 0;
        const configuration = buildOidcClientConfiguration({
            connectionString,
            policy,
            callbackAuthMethod: AuthMethodId.MicrosoftEntraID,
            oidcCallback: async (_params: OIDCCallbackParams): Promise<OIDCResponse> => {
                const currentInvocation = ++invocation;
                let observation: EntraTokenLookupObservation = { outcome: 'failed' };
                try {
                    assertEntraSignInEnvironment(signInEnvironment);
                    let renewed: vscode.AuthenticationSession | undefined;
                    try {
                        renewed = await getEntraSession({ providerId, resource, tenantId, account, mode: 'silent' });
                    } finally {
                        // Drift takes precedence even if the lookup rejects with an error from the new provider.
                        assertEntraSignInEnvironment(signInEnvironment);
                    }
                    if (!renewed) {
                        throw new EntraSignInRequiredError('noSession');
                    }
                    if (renewed.account.id !== accountId) {
                        observation = { outcome: 'identityMismatch' };
                        throw new EntraIdentityMismatchError();
                    }
                    const { accessToken } = renewed;
                    const { iatSec, expSec } = readJwtTimes(accessToken);
                    const lifetimeSeconds = iatSec !== undefined && expSec !== undefined ? expSec - iatSec : undefined;
                    observation = {
                        outcome: 'returned',
                        ...(lifetimeSeconds !== undefined && Number.isFinite(lifetimeSeconds)
                            ? { lifetimeSeconds }
                            : {}),
                    };
                    return expSec === undefined
                        ? { accessToken }
                        : { accessToken, expiresInSeconds: Math.max(0, Math.floor(expSec - Date.now() / 1000)) };
                } catch (error) {
                    if (error instanceof EntraSignInRequiredError) {
                        observation = { outcome: 'noSession' };
                        throw error;
                    }
                    if (error instanceof EntraIdentityMismatchError || error instanceof EntraDestinationRejectedError) {
                        throw error;
                    }
                    recordEntraTokenFailure(clusterId, {
                        cloudCategory: resolved.cloudCategory,
                        authMethod: 'interactive',
                        ruleId: classifyEntraError(error instanceof Error ? error.message : String(error))?.ruleId,
                    });
                    throw error;
                } finally {
                    traceAuthFlow(
                        'interactiveEntra.oidcCallback',
                        {
                            invocation: currentInvocation,
                            outcome: observation.outcome === 'returned' ? 'returned' : 'threw',
                        },
                        authCorrelationId,
                        traceContext,
                    );
                    try {
                        this.policy.onTokenLookup?.(observation);
                    } catch {
                        // Observers never change the auth flow.
                    }
                }
            },
        });
        const properties = configuration.options.authMechanismProperties;
        const callback = properties?.OIDC_CALLBACK;
        if (this.policy.observer?.onCallbackTokenObserved && properties && callback) {
            properties.OIDC_CALLBACK = async (params): Promise<OIDCResponse> => {
                try {
                    // Report acquisition only after the configured callback re-checks destination trust.
                    const response = await callback(params);
                    this.notify((observer) =>
                        observer.onCallbackTokenObserved?.({
                            outcome: 'acquired',
                            accessToken: response.accessToken,
                            tenantId,
                        }),
                    );
                    return response;
                } catch (error) {
                    if (
                        error instanceof EntraSignInRequiredError ||
                        error instanceof EntraIdentityMismatchError ||
                        error instanceof TokenCallbackError
                    ) {
                        this.notify((observer) => observer.onCallbackTokenObserved?.({ outcome: 'failed', error }));
                    }
                    throw error;
                }
            };
        }
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
            verifiedIdentity,
        };
    }
}
