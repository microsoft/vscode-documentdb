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

import { CancellationTokenLike } from '@microsoft/vscode-processutils';
import * as vscode from 'vscode';
import { z } from 'zod';
import { getQuickStartOutputChannel, startDockerProvider } from '../../../services/localQuickStart/ContainerRuntime';
import { getDockerRecoveryCommandById } from '../../../services/localQuickStart/dockerRecoveryCommands';
import { QuickStartService } from '../../../services/localQuickStart/QuickStartService';
import {
    type AdvancedQuickStartOptions,
    type DockerStatusResult,
    type InstanceStatusUpdate,
    type PortAvailability,
    type QuickStartStatus,
    type StageEvent,
} from '../../../services/localQuickStart/quickStartTypes';
import { revealQuickStartInstance } from '../../../tree/connections-view/LocalQuickStart/revealQuickStartInstance';
import { type BaseRouterContext } from '../../_integration/appRouter';
import { publicProcedure, publicProcedureWithTelemetry, router, type WithTelemetry } from '../../_integration/trpc';
import { getDockerReadinessTelemetryProperties } from './dockerReadinessTelemetry';

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
        // The user's explicit "Start fresh (erases data)" choice (review M4). The service applies
        // the RR4 volume-wipe gate: this flag is the only way a provision may drop an existing
        // instance's data volume.
        startFresh: z.boolean().optional(),
        continueAnyway: z.boolean().optional(),
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

/**
 * Strip the credential-bearing {@link QuickStartStatus.metadata} before returning status to the
 * webview: its `connectionString`/`username` are secrets the renderer never reads (it only uses
 * `canResumeReadiness`, plus `readiness`/`canReuseExistingData` from the wrapper). Keeping them out of the
 * renderer process is defense-in-depth — the password never crosses into the webview's JS heap, so a
 * future webview vulnerability can't exfiltrate it. All non-sensitive fields are preserved.
 */
function toWebviewStatus(status: QuickStartStatus): QuickStartStatus {
    return {
        state: status.state,
        error: status.error,
        missing: status.missing,
        canResumeReadiness: status.canResumeReadiness,
    };
}

export const localQuickStartRouter = router({
    /** Readiness pre-check + current managed-instance status (powers the review cards). */
    getDockerStatus: publicProcedureWithTelemetry
        .input(
            z
                .object({
                    forceRefresh: z.boolean().optional(),
                    polled: z.boolean().optional(),
                    resetProviderMemory: z.boolean().optional(),
                    suppressCommandEcho: z.boolean().optional(),
                })
                .optional(),
        )
        .query(async ({ ctx, input }): Promise<DockerStatusResult> => {
            const tctx = ctx as WithTelemetry<RouterContext>;
            if (input?.polled) {
                tctx.actionContext.telemetry.suppressAll = true;
            }
            const cancellationToken = ctx.signal ? CancellationTokenLike.fromAbortSignal(ctx.signal) : undefined;
            const readiness = await QuickStartService.checkDockerReadiness({
                forceRefresh: input?.forceRefresh,
                resetProviderMemory: input?.resetProviderMemory,
                suppressCommandEcho: input?.suppressCommandEcho,
                cancellationToken,
            });
            // Refresh the live container state so the panel opens with an accurate badge
            // (e.g. Missing when the container was removed in another window), which drives
            // whether the Advanced credential/image fields are shown (§12).
            await QuickStartService.refreshLiveState();
            // Design §14 quickstart.docker_readiness never includes names, ports, or credentials.
            Object.assign(tctx.actionContext.telemetry.properties, getDockerReadinessTelemetryProperties(readiness));
            tctx.actionContext.telemetry.properties.platformSupported = String(readiness.platformSupported !== false);
            const canReuseExistingData = await QuickStartService.canReuseExistingData();
            return {
                readiness,
                status: toWebviewStatus(QuickStartService.getStatus()),
                busy: QuickStartService.isBusy,
                canReuseExistingData,
                // M6-b: the polled readiness loop reads only `readiness`, and suggestPort() probes a
                // range of host sockets on every call - skip it while polling.
                suggestedPort: input?.polled ? undefined : await QuickStartService.suggestPort(),
            };
        }),

    /**
     * Validate a Configure-step port while the user can still react (review L3). The port is always
     * sent explicitly afterwards, so setup binds exactly this one instead of silently relocating.
     */
    checkPort: publicProcedure
        .input(z.object({ port: z.number().int().min(1024).max(65535) }))
        .query(({ input }): Promise<PortAvailability> => QuickStartService.checkPort(input.port)),

    /** Lightweight status poll (no docker call). */
    getStatus: publicProcedure.query((): QuickStartStatus => toWebviewStatus(QuickStartService.getStatus())),

    /** Disposes the panel when the user explicitly clicks Close. */
    closePanel: publicProcedure.mutation(({ ctx }) => {
        (ctx as RouterContext).closePanel();
    }),

    /** Reveal the OutputChannel with the captured Docker command output. */
    showOutput: publicProcedure.mutation(() => {
        getQuickStartOutputChannel().show(true);
    }),

    /** Copy one fixed, never-executed recovery command selected by the extension host. */
    copyRecoveryCommand: publicProcedureWithTelemetry
        .input(z.enum(['linuxDockerGroup', 'linuxStartService', 'wslStartServiceNoSystemd', 'wslRestartFromWindows']))
        .mutation(async ({ input, ctx }): Promise<void> => {
            const command = getDockerRecoveryCommandById(input);
            await vscode.env.clipboard.writeText(command.commandLine);
            const tctx = ctx as WithTelemetry<RouterContext>;
            tctx.actionContext.telemetry.properties.recoveryCommandId = command.id;
        }),

    /** Revalidate and launch the provider action selected by the extension host. */
    startDockerProvider: publicProcedureWithTelemetry.mutation(async ({ ctx }) => {
        const result = await startDockerProvider();
        const tctx = ctx as WithTelemetry<RouterContext>;
        tctx.actionContext.telemetry.properties.dockerLaunchResult = result;
        return result;
    }),

    /**
     * Success hand-off (§5.5): open the managed instance in the Connections view.
     *
     * This used to run `connectionsView.focus` and nothing else, which is invisible when that view
     * is already the active one in the sidebar — the normal case, since Quick Start is opened FROM
     * it. The success screen's primary action appeared to do nothing at all. It now reveals,
     * selects, and expands the instance row, so the databases load.
     */
    openConnection: publicProcedureWithTelemetry.mutation(async ({ ctx }) => {
        const tctx = ctx as WithTelemetry<RouterContext>;
        await revealQuickStartInstance(tctx.actionContext);
    }),

    /**
     * Start the existing (stopped) instance from the Configure step's guard (review §9.2 Q2): a
     * stopped instance the user reached the wizard for must never be silently recreated when all
     * they wanted was to start it.
     */
    startInstance: publicProcedure.mutation(() => QuickStartService.start()),

    /**
     * "Start over" from a readiness timeout (§9.1): remove the container retained by the
     * timeout (and wipe a fresh attempt's half-initialized volume) so the user can run setup
     * again from a clean slate.
     */
    discardTimedOut: publicProcedure.mutation(() => QuickStartService.discardTimedOutInstance()),

    /**
     * Push the managed instance's status to the panel whenever it changes (review N1).
     *
     * The panel used to read this once on open, so anything that changed the instance afterwards
     * (a tree action, another VS Code window, a container removed in a terminal) left the Configure
     * step's guard describing an instance that no longer existed.
     *
     * Deliberately cheap: it re-reads already-known state and never calls `isDockerReady()` or
     * `refreshLiveState()`. The tree's background probe fires this event on a cooldown, so a
     * Docker call here would put that cost on every panel too.
     */
    onInstanceChanged: publicProcedure.subscription(async function* ({
        ctx,
    }): AsyncGenerator<InstanceStatusUpdate, void, void> {
        const myCtx = ctx as BaseRouterContext;
        let wake: (() => void) | undefined;
        // Start dirty so a panel that connects after a change still receives the current truth.
        let dirty = true;
        let lastStatusKey: string | undefined;

        const subscription = QuickStartService.onDidChangeStatus(() => {
            dirty = true;
            wake?.();
        });
        const onAbort = (): void => wake?.();
        myCtx.signal?.addEventListener('abort', onAbort);

        try {
            while (!myCtx.signal?.aborted) {
                if (dirty) {
                    dirty = false;
                    const status = toWebviewStatus(QuickStartService.getStatus());
                    const statusKey = JSON.stringify(status);
                    // The status event also fires when nothing user-visible changed; skipping those
                    // keeps the credential read below off the repeating path.
                    if (statusKey !== lastStatusKey) {
                        lastStatusKey = statusKey;
                        yield { status, canReuseExistingData: await QuickStartService.canReuseExistingData() };
                    }
                    continue;
                }
                await new Promise<void>((resolve) => (wake = resolve));
                wake = undefined;
            }
        } finally {
            myCtx.signal?.removeEventListener('abort', onAbort);
            subscription.dispose();
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
        const myCtx = ctx as WithTelemetry<RouterContext>;

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
            myCtx.actionContext.telemetry.properties.continueAnyway = String(advanced?.continueAnyway === true);
            for await (const event of QuickStartService.provision(abortController.signal, advanced)) {
                yield event;
            }
        } finally {
            myCtx.signal?.removeEventListener('abort', onCtxAbort);
            // Guarantee provisioning is cancelled if the consumer stopped iterating.
            abortController.abort();
        }
    }),

    /**
     * "Wait longer" (§9.1): re-probe the container retained from a readiness timeout, streaming
     * the same stage events. Cancelling the subscription (its Cancel button / panel close) aborts
     * the probe but leaves the container running so the user can retry or Start over.
     */
    waitLonger: publicProcedure.subscription(async function* ({ ctx }): AsyncGenerator<StageEvent, void, void> {
        const myCtx = ctx as BaseRouterContext;
        const abortController = new AbortController();
        const onCtxAbort = (): void => abortController.abort();
        if (myCtx.signal?.aborted) {
            abortController.abort();
        } else {
            myCtx.signal?.addEventListener('abort', onCtxAbort);
        }

        try {
            for await (const event of QuickStartService.resumeReadiness(abortController.signal)) {
                yield event;
            }
        } finally {
            myCtx.signal?.removeEventListener('abort', onCtxAbort);
            abortController.abort();
        }
    }),
});
