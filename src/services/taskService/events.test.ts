/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it, vi } from 'vitest';
import { Emitter, type Disposable } from './events';

describe('Emitter', () => {
    it('fires subscribed listeners with the provided data', () => {
        const emitter = new Emitter<string>();
        const first = vi.fn();
        const second = vi.fn();
        emitter.event(first);
        emitter.event(second);

        emitter.fire('update');

        expect(first).toHaveBeenCalledExactlyOnceWith('update');
        expect(second).toHaveBeenCalledExactlyOnceWith('update');
    });

    it('disposes subscriptions independently, including duplicate listeners', () => {
        const emitter = new Emitter<number>();
        const listener = vi.fn();
        const subscription = emitter.event(listener);
        emitter.event(listener);

        subscription.dispose();
        subscription.dispose();
        emitter.fire(1);

        expect(listener).toHaveBeenCalledExactlyOnceWith(1);
    });

    it('clears all listeners when disposed', () => {
        const emitter = new Emitter<number>();
        const listener = vi.fn();
        emitter.event(listener);

        emitter.dispose();
        emitter.fire(1);

        expect(listener).not.toHaveBeenCalled();
    });

    it('invokes listeners with thisArgs', () => {
        const emitter = new Emitter<number>();
        const receiver = { value: 0 };
        emitter.event(function (this: typeof receiver, value: number): void {
            this.value = value;
        }, receiver);

        emitter.fire(42);

        expect(receiver.value).toBe(42);
    });

    it('adds the returned subscription to the disposables array', () => {
        const emitter = new Emitter<number>();
        const listener = vi.fn();
        const disposables: Disposable[] = [];
        const subscription = emitter.event(listener, undefined, disposables);

        expect(disposables).toEqual([subscription]);
        disposables[0].dispose();
        emitter.fire(1);

        expect(listener).not.toHaveBeenCalled();
    });

    it('keeps notifying other listeners when one throws', () => {
        const emitter = new Emitter<number>();
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        const after = vi.fn();
        emitter.event(() => {
            throw new Error('listener failed');
        });
        emitter.event(after);

        expect(() => emitter.fire(1)).not.toThrow();
        expect(after).toHaveBeenCalledExactlyOnceWith(1);
        expect(consoleError).toHaveBeenCalledOnce();
        consoleError.mockRestore();
    });

    it('delivers an event fired from a listener only after the current event reached every listener', () => {
        const emitter = new Emitter<string>();
        const received: string[] = [];
        emitter.event((value) => {
            received.push(`first:${value}`);
            if (value === 'running') {
                emitter.fire('stopping');
            }
        });
        emitter.event((value) => received.push(`second:${value}`));

        emitter.fire('running');

        expect(received).toEqual(['first:running', 'second:running', 'first:stopping', 'second:stopping']);
    });

    it('does not deliver a queued event to a listener disposed before its turn', () => {
        const emitter = new Emitter<string>();
        const second = vi.fn();
        emitter.event((value) => {
            if (value === 'running') {
                emitter.fire('stopping');
                secondSubscription.dispose();
            }
        });
        const secondSubscription = emitter.event(second);

        emitter.fire('running');

        expect(second).not.toHaveBeenCalled();
    });

    it('keeps delivering queued events after a listener throws', () => {
        const emitter = new Emitter<string>();
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        const after = vi.fn();
        emitter.event((value) => {
            if (value === 'running') {
                emitter.fire('stopping');
                throw new Error('listener failed');
            }
        });
        emitter.event(after);

        emitter.fire('running');

        expect(after.mock.calls).toEqual([['running'], ['stopping']]);
        consoleError.mockRestore();
    });
});
