/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { UserCancelledError } from '@microsoft/vscode-azext-utils';
import { traceAuthFlow, traceEntraDestination, type AuthTraceContext } from '../../utils/authTrace';
import { ClustersClient } from '../ClustersClient';
import {
    getWorkerAuthReason,
    type MainToWorkerMessage,
    type WorkerAuthReason,
    type WorkerToMainMessage,
} from '../playground/workerTypes';
import { withTokenAcquisitionTiming, type ConnectionStartupTimings } from '../utils/ConnectionStartupTimings';
import { type VerifiedEntraIdentity } from './AuthHandler';
import { AuthMethodId } from './AuthMethodId';
import {
    resolveInteractiveTokenResource,
    resolveManagedIdentityTokenResource,
    TokenResourceResolutionError,
    type ResolvedTokenResource,
} from './documentdbTokenResource';
import { evaluateEntraDestinationFromSettings } from './entraDestinationSettings';
import {
    EntraIdentityMismatchError,
    EntraSignInRequiredError,
    TokenCallbackError,
} from './entraErrors/entraCallbackErrors';
import { clearEntraTokenFailure, recordEntraTokenFailure } from './entraErrors/entraTokenFailures';
import { getEntraSession, readEntraSignInEnvironment } from './entraSession';
import { EntraDestinationRejectedError } from './oidcAllowedHosts';

export function sameEntraIdentity(a: VerifiedEntraIdentity, b: VerifiedEntraIdentity): boolean {
    return a.providerId === b.providerId && a.accountId === b.accountId && a.tenantId === b.tenantId;
}

export function createWorkerAuthError(reason: WorkerAuthReason, method?: AuthMethodId): Error {
    switch (reason) {
        case 'signInRequired':
            return new EntraSignInRequiredError('noSession');
        case 'identityMismatch':
            return new EntraIdentityMismatchError();
        case 'destinationRejected':
            return new EntraDestinationRejectedError({ hostCount: 0 });
        case 'refreshFailed':
            return new TokenCallbackError(undefined, method === AuthMethodId.ManagedIdentity ? method : undefined);
    }
}

/** Host-only token relay for a single worker. The worker cannot select its own identity or destination. */
export class WorkerTokenRelay {
    private resource: ResolvedTokenResource | undefined;
    private pending: Promise<void> = Promise.resolve();

    constructor(
        private readonly clusterId: string,
        private readonly init: Extract<MainToWorkerMessage, { type: 'init' }>,
        readonly epoch: number,
        private readonly correlationId: string,
        private pin: VerifiedEntraIdentity | undefined,
        private readonly onIdentity?: (identity: VerifiedEntraIdentity) => void,
    ) {}

    async relay(
        { requestId }: Extract<WorkerToMainMessage, { type: 'tokenRequest' }>,
        postResponse: (response: MainToWorkerMessage) => void,
        isCurrentWorker: () => boolean,
        timings?: ConnectionStartupTimings,
        trace?: AuthTraceContext,
        epoch = this.epoch,
    ): Promise<void> {
        const isCurrentEpoch = (): boolean =>
            !ClustersClient.getLatchReason(this.clusterId) &&
            ClustersClient.getEpoch(this.clusterId) === epoch;
        const canReply = (): boolean => {
            if (!isCurrentWorker()) {
                return false;
            }
            if (!isCurrentEpoch()) {
                // The driver is still waiting. Cancel via the supervisor, not an authentication error.
                throw new UserCancelledError('workerTokenRelay');
            }
            return true;
        };
        const activeTrace = (): AuthTraceContext | undefined =>
            isCurrentWorker() && isCurrentEpoch() ? trace : undefined;
        const { connectionString, authMechanism, tenantId, managedIdentityClientId } = this.init;
        const managed = authMechanism === AuthMethodId.ManagedIdentity;
        const assertDestination = (): void => {
            const decision = evaluateEntraDestinationFromSettings(connectionString);
            traceEntraDestination(decision, requestId, activeTrace());
            if (!decision.allowed) {
                throw new EntraDestinationRejectedError(decision);
            }
        };
        const run = async (): Promise<void> => {
            if (!canReply()) {
                return;
            }
            let mode: 'managedIdentity' | 'silent' | 'interactive' | undefined;
            let acquiring = false;
            try {
                if (!managed && authMechanism !== AuthMethodId.MicrosoftEntraID) {
                    throw new Error('Token request from a non-OIDC worker');
                }
                assertDestination();
                const pin = this.pin;
                const environment = managed ? undefined : readEntraSignInEnvironment();
                const assertEnvironment = (): string => {
                    const now = readEntraSignInEnvironment();
                    if (
                        !environment ||
                        (pin && (pin.providerId !== now.providerId || pin.tenantId !== tenantId)) ||
                        environment.providerId !== now.providerId ||
                        environment.cloudName !== now.cloudName ||
                        environment.authority !== now.authority
                    ) {
                        throw new EntraSignInRequiredError('providerChanged');
                    }
                    return environment.providerId;
                };
                mode = managed ? 'managedIdentity' : pin ? 'silent' : 'interactive';
                const resolved =
                    this.resource ??
                    (managed
                        ? await resolveManagedIdentityTokenResource(connectionString)
                        : await resolveInteractiveTokenResource(connectionString));
                if (!canReply()) {
                    return;
                }
                this.resource = resolved;
                const { tokenResource: _resource, ...details } = resolved.details;
                traceAuthFlow('entraCloud.resolved', details, requestId, activeTrace());
                let identity: VerifiedEntraIdentity | undefined;
                let accessToken: string;
                acquiring = true;
                if (managed) {
                    const { getManagedIdentityAccessToken } = await import('./managedIdentityTokenProvider');
                    if (!canReply()) {
                        return;
                    }
                    assertDestination();
                    accessToken = (
                        await withTokenAcquisitionTiming(timings, () =>
                            getManagedIdentityAccessToken(
                                [resolved.scope],
                                managedIdentityClientId,
                                tenantId,
                                this.correlationId,
                                activeTrace(),
                            ),
                        )
                    ).accessToken;
                } else {
                    assertDestination();
                    const providerId = assertEnvironment();
                    const session = await withTokenAcquisitionTiming(timings, () =>
                        getEntraSession({
                            providerId,
                            resource: resolved.scope,
                            tenantId,
                            account: pin ? { id: pin.accountId, label: pin.accountLabel } : undefined,
                            mode: pin ? 'silent' : 'interactive',
                        }),
                    );
                    if (!canReply()) {
                        return;
                    }
                    assertEnvironment();
                    if (!session && pin) {
                        throw new EntraSignInRequiredError('noSession');
                    }
                    if (!session?.account.id) {
                        throw new TokenCallbackError(undefined);
                    }
                    if (pin && session.account.id !== pin.accountId) {
                        throw new EntraIdentityMismatchError();
                    }
                    identity = {
                        kind: 'entra',
                        providerId,
                        tenantId,
                        accountId: session.account.id,
                        accountLabel: session.account.label,
                    };
                    accessToken = session.accessToken;
                }
                if (!canReply()) {
                    return;
                }
                assertDestination();
                if (identity) {
                    // The first interactive lookup may have overlapped a verified tree connection.
                    const verified = pin ? undefined : ClustersClient.getLastVerifiedIdentity(this.clusterId);
                    if (verified?.kind === 'entra' && !sameEntraIdentity(identity, verified)) {
                        throw new EntraIdentityMismatchError();
                    }
                    this.onIdentity?.(identity);
                    this.pin = identity;
                }
                clearEntraTokenFailure(this.clusterId);
                traceAuthFlow('workerTokenRelay.completed', { mode, outcome: 'returned' }, requestId, activeTrace());
                postResponse({ type: 'tokenResponse', requestId, accessToken });
            } catch (error) {
                if (!canReply()) {
                    return;
                }
                const reason = getWorkerAuthReason(error) ?? 'refreshFailed';
                if (error instanceof TokenResourceResolutionError) {
                    traceAuthFlow('entraCloud.unresolved', error.details, requestId, activeTrace());
                }
                if (reason === 'refreshFailed' && acquiring && this.resource) {
                    if (trace?.startupProperties) {
                        trace.startupProperties.entraFailureKind = 'tokenAcquisitionFailed';
                    }
                    recordEntraTokenFailure(this.clusterId, {
                        cloudCategory: this.resource.cloudCategory,
                        authMethod: managed ? 'managedIdentity' : 'interactive',
                    });
                }
                traceAuthFlow(
                    'workerTokenRelay.completed',
                    { mode: mode ?? 'none', outcome: reason },
                    requestId,
                    activeTrace(),
                );
                postResponse({
                    type: 'tokenError',
                    requestId,
                    error: createWorkerAuthError(reason, authMechanism as AuthMethodId).message,
                    reason,
                    ...(reason === 'destinationRejected' ? { errorName: 'EntraDestinationRejectedError' as const } : {}),
                });
            }
        };

        // Serializing relays prevents two first requests from prompting before either has pinned an account.
        const next = this.pending.then(run);
        this.pending = next.catch(() => undefined);
        await next;
    }
}
