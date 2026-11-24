/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { z } from 'zod';
import { wishExamples } from '../../../services/wishingWell/wishEngine';
import { type WishingWellService } from '../../../services/wishingWell/WishingWellService';
import { type WishScope } from '../../../services/wishingWell/wishScope';
import { type BaseRouterContext } from '../../_integration/appRouter';
import { publicProcedureWithTelemetry, router, type WithTelemetry } from '../../_integration/trpc';
import { type WishingWellStatus, type WishOutcome } from './wishingWellTypes';

export type RouterContext = BaseRouterContext & {
    readonly scope: WishScope;
    /** Injected by the controller, so this router imports no command or client code. */
    readonly well: Pick<
        WishingWellService,
        'isCopilotAvailable' | 'makeWish' | 'feelingLucky' | 'grant' | 'describeConnection'
    >;
};

/** Focus re-checks Copilot every time, but lists the collections behind the examples at most this often. */
const DESCRIBE_TTL_MS = 60_000;

// Keyed by the tab's scope: tRPC copies the context for every call, but the scope object inside it is shared.
const described = new WeakMap<WishScope, { readonly at: number; readonly names: Promise<string[] | undefined> }>();

/** Collection names let a database-scoped well suggest wishes about a real collection. */
function collectionNames(scope: WishScope, well: RouterContext['well']): Promise<string[] | undefined> {
    if (!scope.cluster || !scope.databaseName || scope.collectionName) {
        return Promise.resolve(undefined);
    }
    const cached = described.get(scope);
    if (cached && Date.now() - cached.at < DESCRIBE_TTL_MS) {
        return cached.names;
    }
    // Sorted, so a server that lists in a different order does not change the examples.
    const names = well.describeConnection(scope).then(
        ({ collections }) => collections?.slice().sort(),
        () => undefined,
    );
    described.set(scope, { at: Date.now(), names });
    return names;
}

export const wishingWellRouter = router({
    status: publicProcedureWithTelemetry.query(async ({ ctx }): Promise<WishingWellStatus> => {
        const myCtx = ctx as WithTelemetry<RouterContext>;
        const { scope, well } = myCtx;
        const copilotAvailable = await well.isCopilotAvailable();
        myCtx.actionContext.telemetry.properties.copilotAvailable = String(copilotAvailable);
        const examples = wishExamples(
            {
                connected: scope.cluster !== undefined,
                databaseName: scope.databaseName,
                collectionName: scope.collectionName,
                collectionNames: await collectionNames(scope, well),
            },
            copilotAvailable,
        );
        return { copilotAvailable, examples };
    }),

    makeWish: publicProcedureWithTelemetry
        .input(z.object({ wish: z.string().trim().min(1).max(2000) }))
        .mutation(async ({ input, ctx }): Promise<WishOutcome> => {
            const myCtx = ctx as WithTelemetry<RouterContext>;
            return myCtx.well.makeWish(input.wish, myCtx.scope, myCtx.actionContext, 'webview', myCtx.signal);
        }),

    feelingLucky: publicProcedureWithTelemetry.mutation(async ({ ctx }): Promise<WishOutcome> => {
        const myCtx = ctx as WithTelemetry<RouterContext>;
        return myCtx.well.feelingLucky(myCtx.scope, myCtx.actionContext, 'webview');
    }),

    grant: publicProcedureWithTelemetry
        .input(z.object({ id: z.string().min(1) }))
        .mutation(async ({ input, ctx }): Promise<{ granted: boolean; waiting: boolean; declined: boolean }> => {
            const myCtx = ctx as WithTelemetry<RouterContext>;
            const result = await myCtx.well.grant(input.id, myCtx.actionContext, 'webview');
            return { granted: result === 'granted', waiting: result === 'waiting', declined: result === 'declined' };
        }),
});
