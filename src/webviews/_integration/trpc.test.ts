/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { UserCancelledError, type IActionContext } from '@microsoft/vscode-azext-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createCallerFactory, publicProcedureWithTelemetry, router } from './trpc';

const recordedContexts = vi.hoisted((): IActionContext[] => []);

vi.mock('vscode', async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    // `parseError` needs `CancellationError`, which the shared mock does not provide.
    class CancellationError extends Error {}
    return { ...actual, CancellationError, default: { ...(actual.default as object), CancellationError } };
});

vi.mock('@microsoft/vscode-azext-utils', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    callWithTelemetryAndErrorHandling: async <T>(
        _eventId: string,
        callback: (context: IActionContext) => Promise<T>,
    ): Promise<T> => {
        const context: IActionContext = {
            telemetry: { properties: { result: 'Succeeded' }, measurements: {} },
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

const testRouter = router({
    dismissed: publicProcedureWithTelemetry.mutation((): never => {
        throw new UserCancelledError();
    }),
    broken: publicProcedureWithTelemetry.mutation((): never => {
        throw new Error('broken');
    }),
});

const createCaller = createCallerFactory(testRouter);

function caller(): ReturnType<typeof createCaller> {
    return createCaller({});
}

describe('publicProcedureWithTelemetry', (): void => {
    it('records a procedure that throws UserCancelledError as Canceled, without error fields', async (): Promise<void> => {
        await expect(caller().dismissed()).rejects.toMatchObject({ cause: expect.any(UserCancelledError) });
        expect(recordedContexts).toHaveLength(1);
        expect(recordedContexts[0].telemetry.properties.result).toBe('Canceled');
        expect(recordedContexts[0].telemetry.properties.error).toBeUndefined();
        expect(recordedContexts[0].telemetry.properties.errorMessage).toBeUndefined();
    });

    it('still records other thrown errors as Failed', async (): Promise<void> => {
        await expect(caller().broken()).rejects.toBeDefined();
        expect(recordedContexts[0].telemetry.properties.result).toBe('Failed');
        expect(recordedContexts[0].telemetry.properties.errorMessage).toBe('broken');
    });
});
