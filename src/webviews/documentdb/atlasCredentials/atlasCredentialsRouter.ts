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
import { buildAtlasAccessUrl } from '../../../plugins/service-atlas-mongodb/atlasDeepLinks';
import {
    getAtlasCredential,
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
     * Tracks whether this panel stored a credential, including when the user closes the success
     * screen instead of selecting Done.
     */
    credentialsStored: boolean;
    /** Invoked from the success screen's Done action to resolve the opener and dispose the panel. */
    onCredentialsStored: () => void;
};

export type CredentialErrorKind = 'authentication' | 'ipAccess' | 'permissions' | 'rateLimit' | 'network' | 'unknown';

export interface CredentialErrorAction {
    readonly label: string;
    readonly url: string;
}

export interface CredentialSubmitError {
    readonly kind: CredentialErrorKind;
    readonly title: string;
    readonly message: string;
    readonly action?: CredentialErrorAction;
}

/**
 * Result returned to the webview after a submit attempt. On failure the
 * structured error is rendered inline so the user can correct and retry without
 * leaving the form.
 */
export type SubmitResult =
    | { readonly success: true }
    | { readonly success: false; readonly error: CredentialSubmitError; readonly failedStage: number };

/**
 * Builds a user-facing message for a MongoDB Atlas API rejection, adding the
 * Access-List / permissions hint for authentication failures (401/403).
 */
async function describeAtlasError(
    ctx: WithTelemetry<RouterContext>,
    error: unknown,
    authMethod: 'apikey' | 'serviceaccount',
    clientId?: string,
): Promise<CredentialSubmitError> {
    const isNetworkError =
        error instanceof TypeError ||
        (error instanceof Error && /network|fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT/i.test(error.message));
    if (isNetworkError) {
        return {
            kind: 'network',
            title: l10n.t("We couldn't reach MongoDB Atlas"),
            message: l10n.t('Check your internet connection or proxy settings, then try again.'),
        };
    }

    if (!(error instanceof AtlasApiError)) {
        return {
            kind: 'unknown',
            title: l10n.t("We couldn't check this credential"),
            message: error instanceof Error ? error.message : String(error),
        };
    }

    if (error.statusCode === 401) {
        return {
            kind: 'authentication',
            title: l10n.t("We couldn't sign in"),
            message:
                authMethod === 'apikey'
                    ? l10n.t(
                          'MongoDB Atlas did not accept the public and private key. Check both values and try again.',
                      )
                    : l10n.t('MongoDB Atlas did not accept the Client ID and secret. Check both values and try again.'),
        };
    }

    if (error.statusCode === 429) {
        return {
            kind: 'rateLimit',
            title: l10n.t('MongoDB Atlas asked us to slow down'),
            message: l10n.t('Too many requests were made. Wait briefly, then try again.'),
        };
    }

    if (error.statusCode === 403) {
        const action = await buildAtlasErrorAction(ctx, authMethod, clientId);
        if (error.errorCode === 'IP_ADDRESS_NOT_ON_ACCESS_LIST') {
            return {
                kind: 'ipAccess',
                title: l10n.t('This IP address is not allowed'),
                message: l10n.t(
                    "MongoDB Atlas blocked requests from this IP address. Add it to this credential's API access list, then try again.",
                ),
                action,
            };
        }

        return {
            kind: 'permissions',
            title: l10n.t('More access is required'),
            message: l10n.t(
                'The credential was accepted, but it cannot list projects. Add an appropriate organization or project role, then try again.',
            ),
            action,
        };
    }

    return {
        kind: 'unknown',
        title: l10n.t("We couldn't check this credential"),
        message: error.message,
    };
}

async function buildAtlasErrorAction(
    ctx: WithTelemetry<RouterContext>,
    authMethod: 'apikey' | 'serviceaccount',
    clientId?: string,
): Promise<CredentialErrorAction> {
    const record = ctx.credentialId ? await getAtlasCredential(ctx.credentialId) : undefined;
    const url = record
        ? buildAtlasAccessUrl(record, authMethod === 'serviceaccount' ? clientId : undefined)
        : 'https://cloud.mongodb.com';

    return {
        label: l10n.t('Open access settings in MongoDB Atlas'),
        url,
    };
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
                return { success: false, error: await describeAtlasError(myCtx, error, 'apikey'), failedStage: 0 };
            }

            try {
                await persistCredential(myCtx, { authMethod: 'apikey', publicKey, privateKey });
            } catch (error) {
                return { success: false, error: await describeAtlasError(myCtx, error, 'apikey'), failedStage: 1 };
            }
            myCtx.credentialsStored = true;
            myCtx.telemetry.properties.authSuccess = 'true';
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
            } catch (error) {
                myCtx.telemetry.properties.authSuccess = 'false';
                const networkError = await describeAtlasError(myCtx, error, 'serviceaccount', clientId);
                return {
                    success: false,
                    error:
                        networkError.kind === 'network'
                            ? networkError
                            : {
                                  kind: 'authentication',
                                  title: l10n.t("We couldn't sign in"),
                                  message: l10n.t(
                                      'MongoDB Atlas did not accept the Client ID and secret. Check both values and try again.',
                                  ),
                              },
                    failedStage: 0,
                };
            }

            try {
                const client = new AtlasApiClient({ type: 'serviceaccount', accessToken });
                await client.listProjects();
            } catch (error) {
                myCtx.telemetry.properties.authSuccess = 'false';
                return {
                    success: false,
                    error: await describeAtlasError(myCtx, error, 'serviceaccount', clientId),
                    failedStage: 1,
                };
            }

            try {
                await persistCredential(myCtx, {
                    authMethod: 'serviceaccount',
                    clientId,
                    clientSecret,
                    accessToken,
                    expiresAt: String(Date.now() + expiresIn * 1000),
                });
            } catch (error) {
                return {
                    success: false,
                    error: await describeAtlasError(myCtx, error, 'serviceaccount', clientId),
                    failedStage: 2,
                };
            }

            myCtx.credentialsStored = true;
            myCtx.telemetry.properties.authSuccess = 'true';
            return { success: true };
        }),

    complete: publicProcedureWithTelemetry.mutation(({ ctx }): void => {
        const myCtx = ctx as WithTelemetry<RouterContext>;
        if (myCtx.credentialsStored) {
            myCtx.onCredentialsStored();
        }
    }),
});
