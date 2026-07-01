/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type BaseRouterContext } from '../../shared/BaseRouterContext';
import { initWebviewTrpc } from '../../shared/initWebviewTrpc';
import { loggingMiddlewareBody, type ProcedureLogEntry, type ProcedureLogger } from './loggingMiddleware';

function createCapturingLogger(): { logger: ProcedureLogger; entries: ProcedureLogEntry[] } {
    const entries: ProcedureLogEntry[] = [];
    return {
        entries,
        logger: {
            log(entry) {
                entries.push(entry);
            },
        },
    };
}

describe('loggingMiddlewareBody', () => {
    it('logs a successful query and returns its value', async () => {
        const { logger, entries } = createCapturingLogger();
        const { router, publicProcedure, createCallerFactory } = initWebviewTrpc<BaseRouterContext>();

        const logged = publicProcedure.use((opts) => loggingMiddlewareBody(opts, logger));
        const appRouter = router({
            greet: logged.query(() => 'hello'),
        });

        const caller = createCallerFactory(appRouter)({});
        await expect(caller.greet()).resolves.toBe('hello');

        expect(entries).toHaveLength(1);
        expect(entries[0]).toMatchObject({ type: 'query', path: 'greet', ok: true, aborted: false });
        expect(entries[0].durationMs).toBeGreaterThanOrEqual(0);
        expect(entries[0].error).toBeUndefined();
    });

    it('logs a failed procedure with the error and re-throws to the caller', async () => {
        const { logger, entries } = createCapturingLogger();
        const { router, publicProcedure, createCallerFactory } = initWebviewTrpc<BaseRouterContext>();

        const logged = publicProcedure.use((opts) => loggingMiddlewareBody(opts, logger));
        const appRouter = router({
            boom: logged.query(() => {
                throw new Error('kaboom');
            }),
        });

        const caller = createCallerFactory(appRouter)({});
        await expect(caller.boom()).rejects.toThrow('kaboom');

        expect(entries).toHaveLength(1);
        expect(entries[0].ok).toBe(false);
        expect(entries[0].error?.message).toBe('kaboom');
    });

    it('marks the entry aborted when the context signal has fired', async () => {
        const { logger, entries } = createCapturingLogger();
        const { router, publicProcedure, createCallerFactory } = initWebviewTrpc<BaseRouterContext>();

        const logged = publicProcedure.use((opts) => loggingMiddlewareBody(opts, logger));
        const appRouter = router({
            work: logged.query(() => 'done'),
        });

        const controller = new AbortController();
        controller.abort();
        const caller = createCallerFactory(appRouter)({ signal: controller.signal });
        await caller.work();

        expect(entries).toHaveLength(1);
        expect(entries[0].aborted).toBe(true);
    });
});
