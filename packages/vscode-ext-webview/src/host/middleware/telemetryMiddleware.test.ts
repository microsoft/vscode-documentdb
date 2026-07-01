/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type BaseRouterContext } from '../../shared/BaseRouterContext';
import { initWebviewTrpc } from '../../shared/initWebviewTrpc';
import { telemetryMiddlewareBody, type ProcedureTelemetry, type TelemetryRunner } from './telemetryMiddleware';

function createCapturingRunner(): {
    runner: TelemetryRunner;
    bags: ProcedureTelemetry[];
    invocations: Array<{ type: string; path: string }>;
} {
    const bags: ProcedureTelemetry[] = [];
    const invocations: Array<{ type: string; path: string }> = [];
    return {
        bags,
        invocations,
        runner: {
            run(invocation, execute) {
                invocations.push({ type: invocation.type, path: invocation.path });
                const telemetry: ProcedureTelemetry = { properties: {}, measurements: {} };
                bags.push(telemetry);
                return execute(telemetry);
            },
        },
    };
}

describe('telemetryMiddlewareBody', () => {
    it('runs through the runner, injects the telemetry bag into ctx, and records duration', async () => {
        const { runner, bags, invocations } = createCapturingRunner();
        const { router, publicProcedure, createCallerFactory } = initWebviewTrpc<BaseRouterContext>();

        const tracked = publicProcedure.use((opts) => telemetryMiddlewareBody(opts, runner));
        const appRouter = router({
            touch: tracked.query(({ ctx }) => {
                // The body injected the runner's bag as `ctx.telemetry`; the
                // procedure can read and write it with no cast.
                if (ctx.telemetry) {
                    ctx.telemetry.properties.touched = 'yes';
                }
                return 'ok';
            }),
        });

        const caller = createCallerFactory(appRouter)({});
        await expect(caller.touch()).resolves.toBe('ok');

        expect(invocations).toEqual([{ type: 'query', path: 'touch' }]);
        expect(bags).toHaveLength(1);
        expect(bags[0].properties.touched).toBe('yes');
        expect(bags[0].measurements.durationMs).toBeGreaterThanOrEqual(0);
        expect(bags[0].properties.result).toBeUndefined();
    });

    it('records a failure as Failed with the error name and message, then re-throws', async () => {
        const { runner, bags } = createCapturingRunner();
        const { router, publicProcedure, createCallerFactory } = initWebviewTrpc<BaseRouterContext>();

        const tracked = publicProcedure.use((opts) => telemetryMiddlewareBody(opts, runner));
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

    it('records an aborted invocation as Canceled and not Failed', async () => {
        const { runner, bags } = createCapturingRunner();
        const { router, publicProcedure, createCallerFactory } = initWebviewTrpc<BaseRouterContext>();

        const tracked = publicProcedure.use((opts) => telemetryMiddlewareBody(opts, runner));
        const appRouter = router({
            work: tracked.query(() => 'done'),
        });

        const controller = new AbortController();
        controller.abort();
        const caller = createCallerFactory(appRouter)({ signal: controller.signal });
        await caller.work();

        expect(bags[0].properties.aborted).toBe('true');
        expect(bags[0].properties.result).toBe('Canceled');
    });
});
