/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * tRPC router for the guided MongoDB Atlas credential-entry webview (Item 6).
 *
 * This router runs in the extension host, so it can safely import plugin code
 * (`AtlasApiClient`, the credential store) and validate + persist credentials
 * without the secret ever leaving the host: the webview posts the entered
 * values up exactly once via a mutation, the host validates them against the
 * MongoDB Atlas Admin API, stores them, and reports success/failure
 * back for inline display.
 *
 * Validation happens **before** anything is written. A rejected credential is therefore never
 * stored, and an "update credentials" attempt that fails leaves the previous working secret
 * untouched. The webview stays open with the entered values retained so the user can correct an
 * Atlas-side access problem and resubmit.
 */

import * as l10n from '@vscode/l10n';
import { z } from 'zod';
import { AtlasApiClient, AtlasApiError } from '../../../plugins/service-atlas-mongodb/api/AtlasApiClient';
import {
    replaceAtlasCredentialSecrets,
    upsertAtlasCredential,
    type AtlasCredentialSecrets,
} from '../../../plugins/service-atlas-mongodb/credentials/atlasCredentialStore';
import { type BaseRouterContext } from '../../_integration/appRouter';
import { publicProcedureWithTelemetry, router, type WithTelemetry } from '../../_integration/trpc';

/**
 * Context for the MongoDB Atlas credential webview. Carries the target credential (when updating)
 * and a one-shot completion callback invoked when credentials are validated and stored, so the
 * opener can resume.
 */
export type RouterContext = BaseRouterContext & {
    /**
     * When set, the submitted secret replaces this credential's secret in place instead of
     * creating a new credential record. Keeps the record ID - and therefore tree paths and saved
     * connections - stable across a rotation.
     */
    credentialId?: string;
    /** Optional user-supplied friendly name persisted alongside the credential. */
    credentialLabel?: string;
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

/**
 * Persists a validated credential: replacing an existing record's secret when the webview was
 * opened in edit mode, otherwise adding (or refreshing) a record for that Atlas identity.
 */
async function persistCredential(ctx: WithTelemetry<RouterContext>, secrets: AtlasCredentialSecrets): Promise<void> {
    const metadata = ctx.credentialLabel ? { label: ctx.credentialLabel } : {};

    if (ctx.credentialId) {
        const updated = await replaceAtlasCredentialSecrets(ctx.credentialId, secrets, metadata);
        if (updated) {
            ctx.telemetry.properties.credentialUpdated = 'true';
            return;
        }
        // The record disappeared while the webview was open; fall through and add it back.
    }

    const { created } = await upsertAtlasCredential(secrets, metadata);
    ctx.telemetry.properties.credentialCreated = created ? 'true' : 'false';
}

export const atlasCredentialsRouter = router({
    /**
     * Validates and stores a MongoDB Atlas API Key (public + private key pair).
     * The key is validated with a real discovery call first, so a credential that authenticates
     * but cannot list projects is rejected inline instead of being stored as "working".
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

            try {
                const client = new AtlasApiClient({ type: 'apikey', publicKey, privateKey });
                await client.listProjects();
            } catch (error) {
                myCtx.telemetry.properties.authSuccess = 'false';
                return { success: false, errorMessage: describeAtlasError(error) };
            }

            await persistCredential(myCtx, { authMethod: 'apikey', publicKey, privateKey });
            myCtx.telemetry.properties.authSuccess = 'true';
            myCtx.onCredentialsStored();
            return { success: true };
        }),

    /**
     * Validates and stores a MongoDB Atlas Service Account (client id + secret) by
     * acquiring a token via the client_credentials grant and confirming it can discover projects.
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

            let accessToken: string;
            let expiresIn: number;

            try {
                const { fetchServiceAccountToken } =
                    await import('../../../plugins/service-atlas-mongodb/auth/AtlasServiceAccountClient');
                const tokenResponse = await fetchServiceAccountToken(clientId, clientSecret);
                accessToken = tokenResponse.access_token;
                expiresIn = tokenResponse.expires_in;

                const client = new AtlasApiClient({ type: 'serviceaccount', accessToken });
                await client.listProjects();
            } catch (error) {
                myCtx.telemetry.properties.authSuccess = 'false';
                return { success: false, errorMessage: describeAtlasError(error) };
            }

            await persistCredential(myCtx, {
                authMethod: 'serviceaccount',
                clientId,
                clientSecret,
                accessToken,
                expiresAt: String(Date.now() + expiresIn * 1000),
            });

            myCtx.telemetry.properties.authSuccess = 'true';
            myCtx.onCredentialsStored();
            return { success: true };
        }),
});
