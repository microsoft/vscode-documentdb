/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { z } from 'zod';
import { type WishingWellService } from '../../../services/wishingWell/WishingWellService';
import { type WishScope } from '../../../services/wishingWell/wishScope';
import { type BaseRouterContext } from '../../_integration/appRouter';
import { publicProcedureWithTelemetry, router, type WithTelemetry } from '../../_integration/trpc';
import { type WishingWellStatus, type WishOutcome } from './wishingWellTypes';

export type RouterContext = BaseRouterContext & {
    readonly scope: WishScope;
    /** Injected by the controller, so this router imports no command or client code. */
    readonly well: Pick<WishingWellService, 'isCopilotAvailable' | 'makeWish' | 'feelingLucky' | 'grant'>;
};

export const wishingWellRouter = router({
    status: publicProcedureWithTelemetry.query(async ({ ctx }): Promise<WishingWellStatus> => {
        const myCtx = ctx as WithTelemetry<RouterContext>;
        const copilotAvailable = await myCtx.well.isCopilotAvailable();
        myCtx.actionContext.telemetry.properties.copilotAvailable = String(copilotAvailable);
        return { copilotAvailable };
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
        .mutation(async ({ input, ctx }): Promise<{ granted: boolean }> => {
            const myCtx = ctx as WithTelemetry<RouterContext>;
            return { granted: await myCtx.well.grant(input.id, myCtx.actionContext, 'webview') };
        }),
});
