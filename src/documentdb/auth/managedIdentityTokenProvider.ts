/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type TokenCredential } from '@azure/identity';
import { randomUUID } from 'crypto';
import { traceAuthFlow, traceAuthOperation, type AuthTraceContext } from '../../utils/authTrace';
import { classifyManagedIdentityError, describeManagedIdentityError } from './managedIdentityErrors';
import { reportManagedIdentityTokenFailure } from './managedIdentityTelemetry';
import { verifyManagedIdentityTenant } from './managedIdentityTenant';

/**
 * One credential per identity, for the lifetime of the window.
 *
 * `ManagedIdentityCredential` keeps its own token cache, and for managed identity a cache miss is a
 * real network round trip to the identity endpoint, unlike the interactive path where the VS Code
 * session is already cached. Reusing the credential is what makes that cache useful.
 */
const credentialsByClientId = new Map<string, TokenCredential>();

/**
 * Acquires a managed identity access token on the main thread.
 *
 * Worker threads request tokens over IPC rather than importing `@azure/identity` themselves, so that
 * there is a single credential and a single token cache per window.
 *
 * @throws An error whose message is already user-readable (see `describeManagedIdentityError`).
 */
export async function getManagedIdentityAccessToken(
    scopes: string[],
    clientId: string | undefined,
    clusterTenantId?: string,
    correlationId?: string,
    traceContext?: AuthTraceContext,
): Promise<{ accessToken: string; expiresOnTimestamp: number }> {
    const tokenCorrelationId = correlationId ?? randomUUID();
    return await traceAuthOperation(
        'managedIdentity.tokenRequest',
        async () => {
            const credential = await getCredential(clientId, tokenCorrelationId, traceContext);

            let token: { token: string; expiresOnTimestamp: number } | null;
            try {
                token = await traceAuthOperation(
                    'managedIdentity.sdk.getToken',
                    () => credential.getToken(scopes),
                    { scopeCount: scopes.length },
                    tokenCorrelationId,
                    traceContext,
                );
            } catch (error) {
                traceAuthFlow(
                    'managedIdentity.tokenFailure',
                    { reason: classifyManagedIdentityError(error) },
                    tokenCorrelationId,
                    traceContext,
                );
                reportManagedIdentityTokenFailure(error, clientId, tokenCorrelationId, traceContext);
                throw new Error(describeManagedIdentityError(error, clientId));
            }

            if (!token) {
                traceAuthFlow(
                    'managedIdentity.tokenFailure',
                    { reason: 'emptyTokenResponse' },
                    tokenCorrelationId,
                    traceContext,
                );
                reportManagedIdentityTokenFailure(undefined, clientId, tokenCorrelationId, traceContext);
                throw new Error(describeManagedIdentityError(undefined, clientId));
            }

            verifyManagedIdentityTenant(token.token, clusterTenantId, clientId, tokenCorrelationId, traceContext);
            traceAuthFlow(
                'managedIdentity.tokenReady',
                {
                    expiryAvailable: Number.isFinite(token.expiresOnTimestamp),
                    expired: token.expiresOnTimestamp <= Date.now(),
                },
                tokenCorrelationId,
                traceContext,
            );

            return { accessToken: token.token, expiresOnTimestamp: token.expiresOnTimestamp };
        },
        {
            identityKind: clientId ? 'userAssigned' : 'systemAssigned',
            clusterTenantKnown: !!clusterTenantId,
            credentialType: 'ManagedIdentityCredential',
            platform: process.platform,
            architecture: process.arch,
            identityEndpointConfigured: !!process.env.IDENTITY_ENDPOINT,
            msiEndpointConfigured: !!process.env.MSI_ENDPOINT,
            imdsEndpointConfigured: !!process.env.IMDS_ENDPOINT,
            identityHeaderConfigured: !!process.env.IDENTITY_HEADER,
            msiSecretConfigured: !!process.env.MSI_SECRET,
            proxyConfigured: !!(
                process.env.HTTPS_PROXY ||
                process.env.HTTP_PROXY ||
                process.env.https_proxy ||
                process.env.http_proxy
            ),
            noProxyConfigured: !!(process.env.NO_PROXY || process.env.no_proxy),
        },
        tokenCorrelationId,
        traceContext,
    );
}

async function getCredential(
    clientId: string | undefined,
    correlationId: string,
    traceContext?: AuthTraceContext,
): Promise<TokenCredential> {
    const key = clientId ?? '';
    const cached = credentialsByClientId.get(key);
    if (cached) {
        traceAuthFlow('managedIdentity.credential', { outcome: 'reused' }, correlationId, traceContext);
        return cached;
    }

    // Dynamic import: @azure/identity pulls in MSAL and must stay out of the activation path.
    const { ManagedIdentityCredential } = await traceAuthOperation(
        'managedIdentity.loadSdk',
        () => import('@azure/identity'),
        {},
        correlationId,
        traceContext,
    );
    const cachedAfterImport = credentialsByClientId.get(key);
    if (cachedAfterImport) {
        traceAuthFlow(
            'managedIdentity.credential',
            { outcome: 'reusedAfterConcurrentImport' },
            correlationId,
            traceContext,
        );
        return cachedAfterImport;
    }

    const credential = clientId ? new ManagedIdentityCredential({ clientId }) : new ManagedIdentityCredential();
    credentialsByClientId.set(key, credential);
    traceAuthFlow('managedIdentity.credential', { outcome: 'created' }, correlationId, traceContext);
    return credential;
}
