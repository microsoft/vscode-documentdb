/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type BaseRouterContext } from './BaseRouterContext';
import { initWebviewTrpc } from './initWebviewTrpc';

type TestContext = BaseRouterContext & {
    workspaceRoot: string;
    requestCount: number;
};

describe('initWebviewTrpc', () => {
    it('infers the consumer context type inside procedures with no cast', async () => {
        const { router, publicProcedure, createCallerFactory } = initWebviewTrpc<TestContext>();

        const appRouter = router({
            // `ctx.workspaceRoot` and `ctx.requestCount` are read directly off
            // `ctx` with NO `ctx as TestContext` cast. If `initWebviewTrpc` did
            // not bind the context type, these lines would not type-check and
            // ts-jest would fail to compile this test.
            cwd: publicProcedure.query(({ ctx }) => ctx.workspaceRoot),
            count: publicProcedure.query(({ ctx }) => ctx.requestCount + 1),
        });

        const caller = createCallerFactory(appRouter)({
            workspaceRoot: '/repo',
            requestCount: 41,
        });

        await expect(caller.cwd()).resolves.toBe('/repo');
        await expect(caller.count()).resolves.toBe(42);
    });

    it('passes the AbortSignal from BaseRouterContext through to procedures', async () => {
        const { router, publicProcedure, createCallerFactory } = initWebviewTrpc<TestContext>();

        const appRouter = router({
            aborted: publicProcedure.query(({ ctx }) => ctx.signal?.aborted ?? false),
        });

        const controller = new AbortController();
        controller.abort();

        const caller = createCallerFactory(appRouter)({
            workspaceRoot: '/repo',
            requestCount: 0,
            signal: controller.signal,
        });

        await expect(caller.aborted()).resolves.toBe(true);
    });

    it('returns independent instances on each call', () => {
        const a = initWebviewTrpc<TestContext>();
        const b = initWebviewTrpc<TestContext>();

        expect(a.router).not.toBe(b.router);
        expect(a.publicProcedure).not.toBe(b.publicProcedure);
    });
});
