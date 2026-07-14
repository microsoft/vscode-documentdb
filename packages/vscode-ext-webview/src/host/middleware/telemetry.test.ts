/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type BaseRouterContext } from '../../shared/BaseRouterContext';
import { initWebviewTrpc } from '../../shared/initWebviewTrpc';
import { telemetryMiddlewareBody, type ProcedureTelemetry, type TelemetryRunner } from './telemetry';
import { getInvocationSignal } from './types';

/**
 * Enrichment shape used by these tests. The runner contributes a plain
 * telemetry bag under `ctx.telemetry`; a richer integration would contribute
 * its own shape (for example `{ actionContext }`).
 */
interface TestEnrichment {
    telemetry: ProcedureTelemetry;
}

/**
 * A capturing runner that mirrors what a real consumer runner does: it opens a
 * bag per call, injects it into `ctx` via `invoke`, and classifies the outcome
 * (Canceled vs Failed) from the returned result and the invocation signal.
 */
function createCapturingRunner(): {
    runner: TelemetryRunner<TestEnrichment>;
    bags: ProcedureTelemetry[];
    eventIds: string[];
} {
    const bags: ProcedureTelemetry[] = [];
    const eventIds: string[] = [];
    return {
        bags,
        eventIds,
        runner: {
            async run(eventId, invocation, invoke) {
                eventIds.push(eventId);
                const telemetry: ProcedureTelemetry = { properties: {}, measurements: {} };
                bags.push(telemetry);

                const result = await invoke({ telemetry });

                const aborted = getInvocationSignal(invocation.ctx)?.aborted ?? false;
                if (aborted) {
                    telemetry.properties.aborted = 'true';
                    telemetry.properties.result = 'Canceled';
                } else if (!result.ok) {
                    telemetry.properties.result = 'Failed';
                    if (result.error?.name) {
                        telemetry.properties.error = result.error.name;
                    }
                    if (result.error?.message) {
                        telemetry.properties.errorMessage = result.error.message;
                    }
                }

                return result;
            },
        },
    };
}

describe('telemetryMiddlewareBody', () => {
    it('resolves the event id via buildEventId, injects the enrichment into ctx, and returns the result', async () => {
        const { runner, bags, eventIds } = createCapturingRunner();
        const { router, publicProcedure, createCallerFactory } = initWebviewTrpc<BaseRouterContext>();

        const tracked = publicProcedure.use(
            telemetryMiddlewareBody(runner, { buildEventId: ({ type, path }) => `ext.rpc.${type}.${path}` }),
        );
        const appRouter = router({
            touch: tracked.query(({ ctx }) => {
                // The body merged the runner's enrichment into ctx; the procedure
                // reads `ctx.telemetry` with no cast.
                if (ctx.telemetry) {
                    ctx.telemetry.properties.touched = 'yes';
                }
                return 'ok';
            }),
        });

        const caller = createCallerFactory(appRouter)({});
        await expect(caller.touch()).resolves.toBe('ok');

        expect(eventIds).toEqual(['ext.rpc.query.touch']);
        expect(bags).toHaveLength(1);
        expect(bags[0].properties.touched).toBe('yes');
        // The thin body does not stamp duration or a result — that is the
        // runner's job, and this runner leaves them unset on success.
        expect(bags[0].measurements.durationMs).toBeUndefined();
        expect(bags[0].properties.result).toBeUndefined();
    });

    it('defaults the event id to `${type}.${path}` when buildEventId is omitted', async () => {
        const { runner, eventIds } = createCapturingRunner();
        const { router, publicProcedure, createCallerFactory } = initWebviewTrpc<BaseRouterContext>();

        const tracked = publicProcedure.use(telemetryMiddlewareBody(runner));
        const appRouter = router({
            ping: tracked.mutation(() => 'pong'),
        });

        const caller = createCallerFactory(appRouter)({});
        await expect(caller.ping()).resolves.toBe('pong');

        expect(eventIds).toEqual(['mutation.ping']);
    });

    it('surfaces a failed result to the runner so it records Failed with the error name and message, then re-throws', async () => {
        const { runner, bags } = createCapturingRunner();
        const { router, publicProcedure, createCallerFactory } = initWebviewTrpc<BaseRouterContext>();

        const tracked = publicProcedure.use(telemetryMiddlewareBody(runner));
        const appRouter = router({
            boom: tracked.mutation(() => {
                throw new Error('kaboom');
            }),
        });

        const caller = createCallerFactory(appRouter)({});
        await expect(caller.boom()).rejects.toThrow('kaboom');

        expect(bags[0].properties.result).toBe('Failed');
        expect(bags[0].properties.error).toBeDefined();
        expect(bags[0].properties.errorMessage).toBe('kaboom');
    });

    it('gives the runner the signal to classify an aborted invocation as Canceled and not Failed [R766-C01]', async () => {
        const { runner, bags } = createCapturingRunner();
        const { router, publicProcedure, createCallerFactory } = initWebviewTrpc<BaseRouterContext>();

        const tracked = publicProcedure.use(telemetryMiddlewareBody(runner));
        const appRouter = router({
            work: tracked.mutation(() => {
                throw new Error('work cancelled');
            }),
        });

        const controller = new AbortController();
        controller.abort();
        const caller = createCallerFactory(appRouter)({ signal: controller.signal });
        await expect(caller.work()).rejects.toThrow('work cancelled');

        // An aborted call is recorded only as Canceled — no error* fields, so a
        // cancellation is never mistaken for a failure on the error dimension.
        expect(bags[0].properties.aborted).toBe('true');
        expect(bags[0].properties.result).toBe('Canceled');
        expect(bags[0].properties.error).toBeUndefined();
        expect(bags[0].properties.errorMessage).toBeUndefined();
    });
});
