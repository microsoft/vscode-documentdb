/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * tRPC router for the guided MongoDB Atlas credential-entry webview (Item 6).
 *
 * This router runs in the extension host, so it can safely import plugin code
 * (`AtlasApiClient`, `AtlasSessionManager`) and validate + persist credentials
 * without the secret ever leaving the host: the webview posts the entered
 * values up exactly once via a mutation, the host validates them against the
 * MongoDB Atlas Admin API, stores them in SecretStorage, and reports success/failure
 * back for inline display.
 *
 * The live {@link AtlasSessionManager} and the `onCredentialsStored` completion
 * callback are supplied through the router context (a shallow-cloned, host-side
 * object), which is why non-serialisable references are allowed here.
 */

import * as l10n from '@vscode/l10n';
import { z } from 'zod';
import { AtlasApiClient, AtlasApiError } from '../../../plugins/service-atlas-mongodb/api/AtlasApiClient';
import { type AtlasSessionManager } from '../../../plugins/service-atlas-mongodb/auth/AtlasSessionManager';
import { type BaseRouterContext } from '../../_integration/appRouter';
import { publicProcedureWithTelemetry, router, type WithTelemetry } from '../../_integration/trpc';

/**
 * Context for the MongoDB Atlas credential webview. Carries the live session manager
 * and a one-shot completion callback invoked when credentials are validated
 * and stored, so the opener (an auth flow awaiting a boolean) can resume.
 */
export type RouterContext = BaseRouterContext & {
    /** The single session manager instance owned by the discovery provider. */
    sessionManager: AtlasSessionManager;
    /**
     * Invoked exactly once when credentials have been validated and stored.
     * The opener uses this to resolve its `Promise<boolean>` and dispose the panel.
     */
    onCredentialsStored: () => void;
};

/**
 * Result returned to the webview after a submit attempt. On failure the
 * `errorMessage` is rendered inline so the user can correct and retry without
 * leaving the form.
 */
export interface SubmitResult {
    readonly success: boolean;
    readonly errorMessage?: string;
}

/**
 * Builds a user-facing message for a MongoDB Atlas API rejection, adding the
 * Access-List / permissions hint for authentication failures (401/403).
 */
function describeAtlasError(error: unknown): string {
    if (error instanceof AtlasApiError && (error.statusCode === 401 || error.statusCode === 403)) {
        const reason =
            error.detail && error.detail.trim().length > 0
                ? error.detail
                : l10n.t('Please verify the credentials you entered.');
        return l10n.t(
            '{0}\n\nIf the credentials are correct, make sure your current IP address is on the Access List and that the key has the required project permissions.',
            reason,
        );
    }

    return error instanceof Error ? error.message : String(error);
}

export const atlasCredentialsRouter = router({
    /**
     * Validates and stores a MongoDB Atlas API Key (public + private key pair).
     * Mirrors the previous input-box flow: the credentials are stored for retry
     * first, validated against the MongoDB Atlas API, and only marked active on success.
     */
    submitApiKey: publicProcedureWithTelemetry
        .input(
            z.object({
                publicKey: z.string().min(1),
                privateKey: z.string().min(1),
            }),
        )
        .mutation(async ({ input, ctx }): Promise<SubmitResult> => {
            const myCtx = ctx as WithTelemetry<RouterContext>;
            myCtx.telemetry.properties.authMethod = 'apikey';

            const publicKey = input.publicKey.trim();
            const privateKey = input.privateKey.trim();

            // Store first so the root's retry node keeps working if the user closes the form.
            await myCtx.sessionManager.storeApiKeyCredentialsForRetry(publicKey, privateKey);

            try {
                const client = new AtlasApiClient({ type: 'apikey', publicKey, privateKey });
                await client.listProjects();
            } catch (error) {
                myCtx.telemetry.properties.authSuccess = 'false';
                return { success: false, errorMessage: describeAtlasError(error) };
            }

            await myCtx.sessionManager.storeApiKeyCredentials(publicKey, privateKey);
            myCtx.telemetry.properties.authSuccess = 'true';
            myCtx.onCredentialsStored();
            return { success: true };
        }),

    /**
     * Validates and stores a MongoDB Atlas Service Account (client id + secret) by
     * acquiring a token via the client_credentials grant.
     */
    submitServiceAccount: publicProcedureWithTelemetry
        .input(
            z.object({
                clientId: z.string().min(1),
                clientSecret: z.string().min(1),
            }),
        )
        .mutation(async ({ input, ctx }): Promise<SubmitResult> => {
            const myCtx = ctx as WithTelemetry<RouterContext>;
            myCtx.telemetry.properties.authMethod = 'serviceaccount';

            const clientId = input.clientId.trim();
            const clientSecret = input.clientSecret.trim();

            await myCtx.sessionManager.storeServiceAccountCredentialsForRetry(clientId, clientSecret);

            try {
                const { fetchServiceAccountToken } =
                    await import('../../../plugins/service-atlas-mongodb/auth/AtlasServiceAccountClient');
                const tokenResponse = await fetchServiceAccountToken(clientId, clientSecret);
                await myCtx.sessionManager.storeServiceAccountCredentials(
                    clientId,
                    clientSecret,
                    tokenResponse.access_token,
                    tokenResponse.expires_in,
                );
            } catch (error) {
                myCtx.telemetry.properties.authSuccess = 'false';
                return { success: false, errorMessage: describeAtlasError(error) };
            }

            myCtx.telemetry.properties.authSuccess = 'true';
            myCtx.onCredentialsStored();
            return { success: true };
        }),
});
