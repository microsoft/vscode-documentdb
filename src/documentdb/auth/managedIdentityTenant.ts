/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { traceAuthFlow } from '../../utils/authTrace';
import { describeManagedIdentityTenantMismatch } from './managedIdentityErrors';
import { reportManagedIdentityFailureReason } from './managedIdentityTelemetry';

/**
 * Reads the `tid` (tenant ID) claim from an access token.
 *
 * The token is not verified, and does not need to be: it was just handed to us by the identity
 * endpoint, and the claim is only used to produce a better error message. Returns `undefined` for
 * anything that does not parse, so a format change can never break authentication.
 */
export function readTenantIdFromAccessToken(accessToken: string): string | undefined {
    try {
        const payload = accessToken.split('.')[1];
        if (!payload) {
            return undefined;
        }

        const decoded: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString());
        if (typeof decoded !== 'object' || decoded === null) {
            return undefined;
        }

        const { tid } = decoded as { tid?: unknown };
        return typeof tid === 'string' && tid.length > 0 ? tid : undefined;
    } catch {
        return undefined;
    }
}

/**
 * Fails early when a managed identity token was issued by a different Microsoft Entra tenant than
 * the one that owns the cluster.
 *
 * A managed identity is a service principal in exactly one tenant, the tenant of the subscription
 * that owns the Azure resource, and it cannot be a guest anywhere else. So a mismatch here is not a
 * misconfiguration that could be fixed by retrying: the cluster is certain to reject the token, and
 * it does so with a generic authentication failure that names no cause. Diagnosing it at the point
 * where both tenant IDs are still in hand turns that dead end into a sentence.
 *
 * Deliberately conservative: the check only runs when the cluster's tenant is actually known, which
 * today means the connection came from Azure Resources or Discovery, where the value is read from the
 * cluster's own subscription.
 *
 * @throws An error whose message is already user-readable.
 */
export function verifyManagedIdentityTenant(
    accessToken: string,
    clusterTenantId: string | undefined,
    clientId: string | undefined,
    correlationId: string,
): void {
    if (!clusterTenantId) {
        traceAuthFlow(
            'managedIdentity.tenantCheck',
            { outcome: 'skipped', reason: 'clusterTenantUnknown' },
            correlationId,
        );
        return;
    }

    const identityTenantId = readTenantIdFromAccessToken(accessToken);
    if (!identityTenantId || identityTenantId.toLowerCase() === clusterTenantId.toLowerCase()) {
        traceAuthFlow(
            'managedIdentity.tenantCheck',
            {
                outcome: identityTenantId ? 'matched' : 'skipped',
                reason: identityTenantId ? 'sameTenant' : 'tokenTenantUnavailable',
            },
            correlationId,
        );
        return;
    }

    traceAuthFlow('managedIdentity.tenantCheck', { outcome: 'failed', reason: 'tenantMismatch' }, correlationId);
    reportManagedIdentityFailureReason('tenantMismatch', clientId, correlationId);
    throw new Error(describeManagedIdentityTenantMismatch(identityTenantId, clusterTenantId));
}
