/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createCallerFactory, publicProcedureWithTelemetry, router } from './trpc';

const recordedContexts: IActionContext[] = [];

vi.mock('@microsoft/vscode-azext-utils', () => ({
    parseError: (error: unknown) => ({
        errorType: error instanceof Error ? error.name : 'NonError',
        message: error instanceof Error ? error.message : String(error),
    }),
    callWithTelemetryAndErrorHandling: async (
        _eventId: string,
        callback: (context: IActionContext) => Promise<unknown>,
    ): Promise<unknown> => {
        const context: IActionContext = {
            telemetry: { properties: {}, measurements: {} },
            errorHandling: { issueProperties: {} },
            valuesToMask: [],
            ui: {} as IActionContext['ui'],
        };
        recordedContexts.push(context);
        return callback(context);
    },
}));

beforeEach(() => {
    recordedContexts.length = 0;
});

describe('destination RPC attribution', () => {
    const testRouter = router({
        load: publicProcedureWithTelemetry.query(() => 'loaded'),
        fail: publicProcedureWithTelemetry.query(() => {
            throw new Error('load failed');
        }),
    });

    it('carries the originating URL source and attempt through actual RPC middleware', async (): Promise<void> => {
        const caller = createCallerFactory(testRouter)({
            deepLinkCorrelationId: 'url-attempt',
            deepLinkSource: 'docs',
        });
        expect(await caller.load()).toBe('loaded');
        await expect(caller.fail()).rejects.toThrow('load failed');
        expect(recordedContexts).toHaveLength(2);
        for (const context of recordedContexts) {
            expect(context.telemetry.properties).toMatchObject({
                deepLinkCorrelationId: 'url-attempt',
                deepLinkSource: 'docs',
                activationSource: 'deepLink',
            });
        }
        expect(recordedContexts[1].telemetry.properties.result).toBe('Failed');
    });

    it('does not attribute ordinary webviews to URL handling', async (): Promise<void> => {
        await createCallerFactory(testRouter)({}).load();
        expect(recordedContexts[0].telemetry.properties.activationSource).toBeUndefined();
        expect(recordedContexts[0].telemetry.properties.deepLinkCorrelationId).toBeUndefined();
    });
});
