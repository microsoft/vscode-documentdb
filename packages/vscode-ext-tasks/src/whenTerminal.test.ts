/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it, vi } from 'vitest';
import { Task, TaskState, whenTerminal } from './taskService.js';

class TestTask extends Task {
    public readonly type = 'test';
    public readonly name = 'Test';

    public constructor() {
        super();
    }

    protected async doWork(): Promise<void> {}
}

describe('whenTerminal', () => {
    it('waits for a terminal state and disposes its subscription', async () => {
        const task = new TestTask();
        const event = task.onDidChangeState;
        const dispose = vi.fn();
        vi.spyOn(task, 'onDidChangeState').mockImplementation((listener, thisArgs, disposables) => {
            const subscription = event(listener, thisArgs, disposables);
            return {
                dispose: (): void => {
                    dispose();
                    subscription.dispose();
                },
            };
        });

        const terminal = whenTerminal(task);
        await task.start();
        await terminal;

        expect(task.getStatus().state).toBe(TaskState.Completed);
        expect(dispose).toHaveBeenCalledOnce();
    });

    it('resolves without subscribing if the task is already terminal', async () => {
        const task = new TestTask();
        const firstWait = whenTerminal(task);
        await task.start();
        await firstWait;
        const subscribe = vi.spyOn(task, 'onDidChangeState');

        await expect(whenTerminal(task)).resolves.toBeUndefined();
        expect(subscribe).not.toHaveBeenCalled();
    });
});
