/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * tRPC router for the Local Quick Start webview (WI-2).
 *
 * - `getDockerStatus` (query): readiness pre-check + current instance status.
 * - `startQuickStart` (subscription): drives {@link QuickStartService.provision}
 *   and yields one {@link StageEvent} per stage. Cancellation flows from the
 *   subscription's `ctx.signal` (aborted on unsubscribe) into a mirrored
 *   `AbortController` passed to the service — so a Cancel/close also cancels the
 *   in-flight docker command (via the runtime's cancellation token).
 * - `closePanel` (mutation): dispose the panel — only the explicit Close button.
 *
 * Per the circular-import rule, tRPC primitives are imported from
 * `../../_integration/trpc`, never from `appRouter.ts`.
 */

import * as vscode from 'vscode';
import { z } from 'zod';
import {
    ContainerRuntime,
    getQuickStartOutputChannel,
    startDockerDesktop,
} from '../../../services/localQuickStart/ContainerRuntime';
import { QuickStartService } from '../../../services/localQuickStart/QuickStartService';
import {
    type AdvancedQuickStartOptions,
    type DockerStatusResult,
    type QuickStartStatus,
    type StageEvent,
} from '../../../services/localQuickStart/quickStartTypes';
import { type BaseRouterContext } from '../../_integration/appRouter';
import { publicProcedure, publicProcedureWithTelemetry, router, type WithTelemetry } from '../../_integration/trpc';

/**
 * Advanced provisioning overrides (P1-4). All optional; the webview only sends the
 * fields the user filled in. `port` is validated to a sane TCP range and credentials
 * are length-bounded — the service applies the host-gating / reuse rules.
 */
const advancedOptionsSchema = z
    .object({
        port: z.number().int().min(1024).max(65535).optional(),
        // Disallow control characters (newlines/tabs/NUL): credentials are written to a
        // line-based docker `--env-file` (KEY=VALUE), where a newline would inject extra
        // environment variables. Other printable specials (including `%`, for strong
        // passwords) are safe: creds reach the container only via the env-file and the
        // percent-encoded connection string, never the host shell argv (sample-data
        // seeding references `$USERNAME`/`$PASSWORD` from the container's own environment).
        // `.trim()` normalizes surrounding whitespace identically to the service, so a
        // whitespace-only value collapses to empty (rejected here / auto-generated there)
        // and the webview's "Custom" indication can never disagree with what is applied.
        username: z
            .string()
            .trim()
            .min(1)
            .max(128)
            // eslint-disable-next-line no-control-regex
            .regex(/^[^\u0000-\u001f\u007f]+$/, 'Username must not contain control characters')
            .optional(),
        password: z
            .string()
            .trim()
            .min(1)
            .max(256)
            // eslint-disable-next-line no-control-regex
            .regex(/^[^\u0000-\u001f\u007f]+$/, 'Password must not contain control characters')
            .optional(),
        imageTag: z
            .string()
            .min(1)
            .max(128)
            .regex(/^[\w][\w.-]*$/, 'Invalid image tag')
            .optional(),
        loadSampleData: z.boolean().optional(),
    })
    // Mirror the webview's both-or-neither rule server-side: a username without a password
    // (or vice versa) is rejected rather than silently auto-generating, so a direct tRPC
    // caller gets the same contract the UI enforces.
    .refine((v) => (v.username === undefined) === (v.password === undefined), {
        message: 'Provide both a username and a password, or neither.',
        path: ['password'],
    })
    .optional();

export type RouterContext = BaseRouterContext & {
    /** Disposes the webview panel (explicit Close button). Wired by the controller. */
    closePanel: () => void;
};

export const localQuickStartRouter = router({
    /** Readiness pre-check + current managed-instance status (powers the review cards). */
    getDockerStatus: publicProcedureWithTelemetry.query(async ({ ctx }): Promise<DockerStatusResult> => {
        const readiness = await ContainerRuntime.isDockerReady();
        // Refresh the live container state so the panel opens with an accurate badge
        // (e.g. Missing when the container was removed in another window), which drives
        // whether the Advanced credential/image fields are shown (§12).
        await QuickStartService.refreshLiveState();
        const tctx = ctx as WithTelemetry<BaseRouterContext>;
        // Design §14 quickstart.docker_readiness — never includes names/ports/creds.
        tctx.telemetry.properties.dockerReadiness = !readiness.cliInstalled
            ? 'cliMissing'
            : !readiness.daemonReachable
              ? 'daemonStopped'
              : 'ok';
        tctx.telemetry.properties.platformSupported = String(readiness.platformSupported !== false);
        const willReuse = await QuickStartService.willReuseExistingInstance();
        return { readiness, status: QuickStartService.getStatus(), busy: QuickStartService.isBusy, willReuse };
    }),

    /** Lightweight status poll (no docker call). */
    getStatus: publicProcedure.query((): QuickStartStatus => QuickStartService.getStatus()),

    /** Disposes the panel when the user explicitly clicks Close. */
    closePanel: publicProcedure.mutation(({ ctx }) => {
        (ctx as RouterContext).closePanel();
    }),

    /** Reveal the OutputChannel with the (masked) docker command output. */
    showOutput: publicProcedure.mutation(() => {
        getQuickStartOutputChannel().show(true);
    }),

    /** Best-effort launch of Docker Desktop (design §5.3). Returns true if attempted. */
    startDockerDesktop: publicProcedure.mutation((): Promise<boolean> => startDockerDesktop()),

    /** Success hand-off (§5.5): focus the Connections view where the instance now lives. */
    openConnection: publicProcedure.mutation(async () => {
        await vscode.commands.executeCommand('connectionsView.focus');
    }),

    /** Success hand-off (§5.5): copy the managed instance's connection string. */
    copyConnectionString: publicProcedure.mutation(() => {
        const metadata = QuickStartService.getStatus().metadata;
        if (metadata) {
            void vscode.env.clipboard.writeText(metadata.connectionString);
        }
    }),

    /**
     * Provision the managed instance, streaming stage transitions to the webview.
     * Optional Advanced overrides (port / credentials / image tag / sample-data) are
     * validated by {@link advancedOptionsSchema} and threaded into the service.
     */
    startQuickStart: publicProcedureWithTelemetry.input(advancedOptionsSchema).subscription(async function* ({
        ctx,
        input,
    }): AsyncGenerator<StageEvent, void, void> {
        const myCtx = ctx as BaseRouterContext;

        // Mirror the subscription's abort signal so cancelling the subscription
        // (Cancel button / panel close) cancels the in-flight provisioning and
        // its underlying docker command.
        const abortController = new AbortController();
        const onCtxAbort = (): void => abortController.abort();
        if (myCtx.signal?.aborted) {
            abortController.abort();
        } else {
            myCtx.signal?.addEventListener('abort', onCtxAbort);
        }

        try {
            const advanced: AdvancedQuickStartOptions | undefined = input ?? undefined;
            for await (const event of QuickStartService.provision(abortController.signal, advanced)) {
                yield event;
            }
        } finally {
            myCtx.signal?.removeEventListener('abort', onCtxAbort);
            // Guarantee provisioning is cancelled if the consumer stopped iterating.
            abortController.abort();
        }
    }),
});
