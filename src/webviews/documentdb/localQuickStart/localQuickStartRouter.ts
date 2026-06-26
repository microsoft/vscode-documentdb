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
 * - `closePanel` (mutation): success auto-close hand-off to the tree.
 *
 * Per the circular-import rule, tRPC primitives are imported from
 * `../../_integration/trpc`, never from `appRouter.ts`.
 */

import * as vscode from 'vscode';
import {
    ContainerRuntime,
    getQuickStartOutputChannel,
    startDockerDesktop,
} from '../../../services/localQuickStart/ContainerRuntime';
import { QuickStartService } from '../../../services/localQuickStart/QuickStartService';
import {
    type DockerStatusResult,
    type QuickStartStatus,
    type StageEvent,
} from '../../../services/localQuickStart/quickStartTypes';
import { type BaseRouterContext } from '../../_integration/appRouter';
import { publicProcedure, publicProcedureWithTelemetry, router, type WithTelemetry } from '../../_integration/trpc';

export type RouterContext = BaseRouterContext & {
    /** Disposes the webview panel (success auto-close). Wired by the controller. */
    closePanel: () => void;
};

export const localQuickStartRouter = router({
    /** Readiness pre-check + current managed-instance status (powers the review cards). */
    getDockerStatus: publicProcedureWithTelemetry.query(async ({ ctx }): Promise<DockerStatusResult> => {
        const readiness = await ContainerRuntime.isDockerReady();
        const tctx = ctx as WithTelemetry<BaseRouterContext>;
        // Design §14 quickstart.docker_readiness — never includes names/ports/creds.
        tctx.telemetry.properties.dockerReadiness = !readiness.cliInstalled
            ? 'cliMissing'
            : !readiness.daemonReachable
              ? 'daemonStopped'
              : 'ok';
        tctx.telemetry.properties.platformSupported = String(readiness.platformSupported !== false);
        return { readiness, status: QuickStartService.getStatus(), busy: QuickStartService.isBusy };
    }),

    /** Lightweight status poll (no docker call). */
    getStatus: publicProcedure.query((): QuickStartStatus => QuickStartService.getStatus()),

    /** Disposes the panel (success auto-close → tree takes over). */
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
     */
    startQuickStart: publicProcedureWithTelemetry.subscription(async function* ({
        ctx,
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
            for await (const event of QuickStartService.provision(abortController.signal)) {
                yield event;
            }
        } finally {
            myCtx.signal?.removeEventListener('abort', onCtxAbort);
            // Guarantee provisioning is cancelled if the consumer stopped iterating.
            abortController.abort();
        }
    }),
});
