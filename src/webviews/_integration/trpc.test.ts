/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { UserCancelledError, type IActionContext } from '@microsoft/vscode-azext-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createCallerFactory, publicProcedureWithTelemetry, router } from './trpc';

const contexts = vi.hoisted((): IActionContext[] => []);

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
        const context = {
            telemetry: { properties: { result: 'Succeeded' }, measurements: {} },
            errorHandling: {},
            valuesToMask: [],
        } as unknown as IActionContext;
        contexts.push(context);
        return callback(context);
    },
}));

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
    beforeEach((): void => {
        contexts.length = 0;
    });

    it('records a procedure that throws UserCancelledError as Canceled, without error fields', async (): Promise<void> => {
        await expect(caller().dismissed()).rejects.toMatchObject({ cause: expect.any(UserCancelledError) });
        expect(contexts).toHaveLength(1);
        expect(contexts[0].telemetry.properties.result).toBe('Canceled');
        expect(contexts[0].telemetry.properties.error).toBeUndefined();
        expect(contexts[0].telemetry.properties.errorMessage).toBeUndefined();
    });

    it('still records other thrown errors as Failed', async (): Promise<void> => {
        await expect(caller().broken()).rejects.toBeDefined();
        expect(contexts[0].telemetry.properties.result).toBe('Failed');
        expect(contexts[0].telemetry.properties.errorMessage).toBe('broken');
    });
});
