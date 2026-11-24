/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it, vi } from 'vitest';

import { Task, TaskState, type TaskTelemetryContext } from '@microsoft/vscode-ext-tasks';
import { extensionTaskTelemetryRunner } from './extensionTaskOptions';

interface RecordedCall {
    eventName: string;
    suppressDisplay: boolean;
    error?: unknown;
}

const { recordedCalls } = vi.hoisted(() => ({ recordedCalls: [] as RecordedCall[] }));

// Mirrors callWithTelemetryAndErrorHandling: records the failure, then resolves with undefined.
vi.mock('@microsoft/vscode-azext-utils', () => ({
    callWithTelemetryAndErrorHandling: vi.fn(
        async (
            eventName: string,
            callback: (
                context: TaskTelemetryContext & { errorHandling: { suppressDisplay: boolean } },
            ) => Promise<unknown>,
        ): Promise<unknown> => {
            const context = {
                telemetry: { properties: {}, measurements: {} },
                errorHandling: { suppressDisplay: false },
            };
            const call: RecordedCall = { eventName, suppressDisplay: false };
            recordedCalls.push(call);
            try {
                return await callback(context);
            } catch (error) {
                call.error = error;
                return undefined;
            } finally {
                call.suppressDisplay = context.errorHandling.suppressDisplay;
            }
        },
    ),
}));

vi.mock('../../../extensionVariables', () => ({ ext: {} }));
vi.mock('vscode', () => ({ l10n: { t: (key: string): string => key } }));

describe('extensionTaskTelemetryRunner', () => {
    it('suppresses the azext display for an initialization failure that still reaches telemetry', async () => {
        const error = new Error('Source collection not found');
        const work = vi.fn(async (): Promise<void> => {});
        class FailingInitTask extends Task {
            public readonly type = 'test';
            public readonly name = 'Test Task';

            constructor() {
                super({ telemetry: extensionTaskTelemetryRunner });
            }

            protected onInitialize(): Promise<void> {
                return Promise.reject(error);
            }

            protected doWork(): Promise<void> {
                return work();
            }
        }
        const task = new FailingInitTask();

        await task.start();

        expect(recordedCalls).toEqual([{ eventName: 'taskService.taskInitialization', suppressDisplay: true, error }]);
        expect(task.getStatus()).toMatchObject({ state: TaskState.Failed, error });
        expect(work).not.toHaveBeenCalled();
    });
});
