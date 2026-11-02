/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { TRPCError } from '@trpc/server';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { z } from 'zod';
import { AwsInteractionRequiredError, AwsValidationError } from '../../../plugins/service-aws-documentdb/auth/errors';
import { awsDiscoveryService } from '../../../plugins/service-aws-documentdb/discovery/AwsDiscoveryService';
import { type AwsCredentialRecord } from '../../../plugins/service-aws-documentdb/types';
import { type BaseRouterContext } from '../../_integration/appRouter';
import { publicProcedureWithTelemetry, router, type WithTelemetry } from '../../_integration/trpc';

export interface AwsCredentialPanelState {
    credentialsStored: boolean;
    submitting: boolean;
    ssoGeneration: number;
    readonly lifetime: AbortController;
    readonly ssoFlows: Set<string>;
}

export type RouterContext = BaseRouterContext & {
    credentialId?: string;
    journeyCorrelationId?: string;
    credentialState: AwsCredentialPanelState;
    onCredentialPersisted: () => void;
    onCancelled: () => void;
    onCredentialsStored: () => void;
};

const regionSchema = z.string().regex(/^[a-z]{2}(?:-[a-z]+)+-\d+$/);
const commonInput = {
    label: z.string().trim().max(128).optional(),
    regions: z.array(regionSchema).min(1).max(50).transform((regions) => [...new Set(regions)]),
};
const nonempty = z.string().trim().min(1);
export const credentialInputSchema = z.discriminatedUnion('authMethod', [
    z.object({ ...commonInput, authMethod: z.literal('profile'), profile: nonempty }),
    z.object({
        ...commonInput,
        authMethod: z.literal('accessKey'),
        accessKeyId: nonempty,
        secretAccessKey: nonempty,
    }),
    z.object({
        ...commonInput,
        authMethod: z.literal('temporary'),
        accessKeyId: nonempty,
        secretAccessKey: nonempty,
        sessionToken: nonempty,
        expiration: z.string().datetime({ offset: true }).optional(),
    }),
    z.object({
        ...commonInput,
        authMethod: z.literal('sso'),
        ssoFlowId: nonempty,
        accountId: z.string().regex(/^\d{12}$/),
        roleName: nonempty,
    }),
]);

export type CredentialSubmitInput = z.input<typeof credentialInputSchema>;

export interface CredentialSubmitError {
    readonly title: string;
    readonly message: string;
}

export type SubmitResult =
    | { readonly success: true; readonly credential: AwsCredentialRecord }
    | { readonly success: false; readonly error: CredentialSubmitError };

function assertActive(context: RouterContext): void {
    if (context.credentialState.lifetime.signal.aborted || context.signal?.aborted) {
        throw new TRPCError({ code: 'CLIENT_CLOSED_REQUEST', message: l10n.t('AWS sign-in was cancelled.') });
    }
}

function assertOwnedFlow(context: RouterContext, flowId: string): void {
    assertActive(context);
    if (!context.credentialState.ssoFlows.has(flowId)) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: l10n.t('Start AWS browser sign-in in this panel first.') });
    }
}

async function withPanelSignal<T>(context: RouterContext, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    assertActive(context);
    const controller = new AbortController();
    const abort = (): void => controller.abort();
    context.signal?.addEventListener('abort', abort, { once: true });
    context.credentialState.lifetime.signal.addEventListener('abort', abort, { once: true });
    try {
        return await operation(controller.signal);
    } finally {
        context.signal?.removeEventListener('abort', abort);
        context.credentialState.lifetime.signal.removeEventListener('abort', abort);
    }
}

/** Never forward raw SDK errors (which may include request material) to RPC telemetry. */
async function safeOperation<T>(context: RouterContext, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    try {
        return await withPanelSignal(context, operation);
    } catch (error) {
        assertActive(context);
        throw new TRPCError({
            code: 'BAD_REQUEST',
            message: error instanceof AwsInteractionRequiredError || error instanceof AwsValidationError
                ? error.message
                : l10n.t('AWS sign-in could not finish. Check your credentials, profile, network, and AWS permissions, then retry.'),
        });
    }
}

function clearAwsSsoFlows(state: AwsCredentialPanelState): void {
    state.ssoGeneration++;
    for (const flowId of state.ssoFlows) {
        awsDiscoveryService.cancelSso(flowId);
    }
    state.ssoFlows.clear();
}

export function disposeAwsCredentialState(state: AwsCredentialPanelState): void {
    state.lifetime.abort();
    clearAwsSsoFlows(state);
}

export function isAwsVerificationUrl(value: string): boolean {
    if (!z.string().url().safeParse(value).success) {
        return false;
    }
    const url = new URL(value);
    return (
        url.protocol === 'https:' &&
        !url.username &&
        !url.password &&
        !url.port &&
        (
            /^(?:device\.sso|oidc)\.[a-z0-9-]+\.amazonaws\.com(?:\.cn)?$/.test(url.hostname) ||
            (
                /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.awsapps\.(?:com|cn)$/.test(url.hostname) &&
                url.pathname === '/start/' &&
                /^#\/device(?:\?|$)/.test(url.hash)
            )
        )
    );
}

export const awsCredentialsRouter = router({
    listProfiles: publicProcedureWithTelemetry.query(async ({ ctx }) => {
        const context = ctx as RouterContext;
        return safeOperation(context, () => awsDiscoveryService.listProfiles());
    }),
    startSso: publicProcedureWithTelemetry
        .input(z.object({ startUrl: z.string().url().startsWith('https://'), ssoRegion: regionSchema }))
        .mutation(async ({ ctx, input }) => {
            const context = ctx as RouterContext;
            return safeOperation(context, async (signal) => {
                clearAwsSsoFlows(context.credentialState);
                const generation = context.credentialState.ssoGeneration;
                const assertCurrent = (): void => {
                    assertActive(context);
                    if (generation !== context.credentialState.ssoGeneration) {
                        throw new TRPCError({ code: 'CLIENT_CLOSED_REQUEST', message: l10n.t('AWS browser sign-in was cancelled.') });
                    }
                };
                const flow = await awsDiscoveryService.beginSso(input.startUrl, input.ssoRegion, signal);
                try {
                    assertCurrent();
                    context.credentialState.ssoFlows.add(flow.flowId);
                    if (!isAwsVerificationUrl(flow.verificationUri)) {
                        throw new AwsValidationError(l10n.t('AWS returned an unsupported verification URL. Browser sign-in was stopped to protect your credentials.'));
                    }
                    let opened: boolean;
                    try {
                        opened = await vscode.env.openExternal(vscode.Uri.parse(flow.verificationUri));
                    } catch {
                        throw new AwsValidationError(l10n.t('VS Code could not open your browser. Check the default browser configuration and retry.'));
                    }
                    if (!opened) {
                        throw new AwsValidationError(l10n.t('VS Code could not open your browser. Check the default browser configuration and retry.'));
                    }
                    assertCurrent();
                    return flow;
                } catch (error) {
                    awsDiscoveryService.cancelSso(flow.flowId);
                    context.credentialState.ssoFlows.delete(flow.flowId);
                    throw error;
                }
            });
        }),
    pollSso: publicProcedureWithTelemetry.input(z.object({ flowId: nonempty })).query(async ({ ctx, input }) => {
        const context = ctx as WithTelemetry<RouterContext>;
        context.actionContext.telemetry.suppressIfSuccessful = true;
        assertOwnedFlow(context, input.flowId);
        return safeOperation(context, (signal) => awsDiscoveryService.pollSso(input.flowId, signal));
    }),
    listSsoRoles: publicProcedureWithTelemetry
        .input(z.object({ flowId: nonempty, accountId: z.string().regex(/^\d{12}$/) }))
        .query(async ({ ctx, input }) => {
            const context = ctx as RouterContext;
            assertOwnedFlow(context, input.flowId);
            return safeOperation(context, (signal) => awsDiscoveryService.listSsoRoles(input.flowId, input.accountId, signal));
        }),
    cancelSso: publicProcedureWithTelemetry.input(z.object({ flowId: nonempty.optional() })).mutation(({ ctx, input }) => {
        const context = ctx as RouterContext;
        assertActive(context);
        if (input.flowId) {
            assertOwnedFlow(context, input.flowId);
            context.credentialState.ssoGeneration++;
            awsDiscoveryService.cancelSso(input.flowId);
            context.credentialState.ssoFlows.delete(input.flowId);
        } else {
            // Back may arrive before startSso returns its flow ID to the webview.
            clearAwsSsoFlows(context.credentialState);
        }
    }),
    submit: publicProcedureWithTelemetry.input(credentialInputSchema).mutation(async ({ ctx, input }): Promise<SubmitResult> => {
        const context = ctx as WithTelemetry<RouterContext>;
        assertActive(context);
        if (context.credentialState.submitting || context.credentialState.credentialsStored) {
            throw new TRPCError({ code: 'CONFLICT', message: l10n.t('This credential is already being saved or has been saved.') });
        }
        if (input.authMethod === 'sso') {
            assertOwnedFlow(context, input.ssoFlowId);
        }
        context.actionContext.telemetry.properties.authMethod = input.authMethod;
        context.actionContext.telemetry.properties.operationMode = context.credentialId ? 'edit' : 'add';
        if (context.journeyCorrelationId) {
            context.actionContext.telemetry.properties.journeyCorrelationId = context.journeyCorrelationId;
        }
        context.credentialState.submitting = true;
        try {
            const credential = await withPanelSignal(context, (signal) =>
                awsDiscoveryService.verifyAndSave(input, signal, context.credentialId),
            );
            context.credentialState.credentialsStored = true;
            context.onCredentialPersisted();
            return { success: true, credential };
        } catch (error) {
            assertActive(context);
            context.actionContext.telemetry.properties.result = 'Failed';
            return {
                success: false,
                error: {
                    title: l10n.t("We couldn't verify this AWS credential"),
                    message: error instanceof AwsInteractionRequiredError || error instanceof AwsValidationError
                        ? error.message
                        : l10n.t('Check the credential values, profile sign-in or MFA, expiration, and network access, then retry. Your previous credential has not been replaced.'),
                },
            };
        } finally {
            context.credentialState.submitting = false;
        }
    }),
    complete: publicProcedureWithTelemetry.mutation(({ ctx }) => {
        const context = ctx as RouterContext;
        if (!context.credentialState.credentialsStored) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: l10n.t('Verify your AWS credential first.') });
        }
        disposeAwsCredentialState(context.credentialState);
        context.onCredentialsStored();
    }),
    cancel: publicProcedureWithTelemetry.mutation(({ ctx }) => {
        const context = ctx as RouterContext;
        disposeAwsCredentialState(context.credentialState);
        context.onCancelled();
    }),
});
