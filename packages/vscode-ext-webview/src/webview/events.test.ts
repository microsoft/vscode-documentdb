/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type CallInfo, createEventChannel } from './events';

const queryInfo: CallInfo = { type: 'query', path: 'demo.find', id: 1 };

describe('createEventChannel', () => {
    it('routes each outcome only to its own handler kind (abort vs error vs success)', () => {
        const channel = createEventChannel();
        const onSuccess = jest.fn();
        const onError = jest.fn();
        const onAborted = jest.fn();

        channel.onSuccess(onSuccess);
        channel.onError(onError);
        channel.onAborted(onAborted);

        const error = new Error('boom');
        channel.emitSuccess(queryInfo, { value: 42 });
        channel.emitError(error, queryInfo);
        channel.emitAborted(queryInfo);

        expect(onSuccess).toHaveBeenCalledTimes(1);
        expect(onSuccess).toHaveBeenCalledWith(queryInfo, { value: 42 });

        expect(onError).toHaveBeenCalledTimes(1);
        expect(onError).toHaveBeenCalledWith(error, queryInfo);

        expect(onAborted).toHaveBeenCalledTimes(1);
        expect(onAborted).toHaveBeenCalledWith(queryInfo);
    });

    it('an aborted outcome never reaches the error handler and vice versa', () => {
        const channel = createEventChannel();
        const onError = jest.fn();
        const onAborted = jest.fn();

        channel.onError(onError);
        channel.onAborted(onAborted);

        channel.emitAborted(queryInfo);
        expect(onError).not.toHaveBeenCalled();
        expect(onAborted).toHaveBeenCalledTimes(1);

        channel.emitError(new Error('x'), queryInfo);
        expect(onAborted).toHaveBeenCalledTimes(1);
        expect(onError).toHaveBeenCalledTimes(1);
    });

    it('stops invoking a handler after it unsubscribes', () => {
        const channel = createEventChannel();
        const onError = jest.fn();
        const unsubscribe = channel.onError(onError);

        channel.emitError(new Error('first'), queryInfo);
        unsubscribe();
        channel.emitError(new Error('second'), queryInfo);

        expect(onError).toHaveBeenCalledTimes(1);
        expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'first' }), queryInfo);
    });

    it('is idempotent when the same unsubscribe runs twice', () => {
        const channel = createEventChannel();
        const a = jest.fn();
        const b = jest.fn();
        const unsubscribeA = channel.onSuccess(a);
        channel.onSuccess(b);

        unsubscribeA();
        unsubscribeA();

        channel.emitSuccess(queryInfo, null);
        expect(a).not.toHaveBeenCalled();
        expect(b).toHaveBeenCalledTimes(1);
    });

    it('snapshot-safe: a handler that removes another handler mid-dispatch does not skip the snapshot', () => {
        const channel = createEventChannel();
        const calls: string[] = [];

        // `first` unsubscribes `second` while the error is being dispatched.
        const second = jest.fn(() => calls.push('second'));
        const unsubscribeSecond = channel.onError(second);
        channel.onError(() => {
            calls.push('first');
            unsubscribeSecond();
        });

        channel.emitError(new Error('one'), queryInfo);
        // Both were in the snapshot taken before dispatch, so both ran.
        expect(calls).toEqual(['second', 'first']);

        // On the next dispatch, `second` is gone.
        calls.length = 0;
        channel.emitError(new Error('two'), queryInfo);
        expect(calls).toEqual(['first']);
    });

    it('snapshot-safe: a handler subscribed mid-dispatch is not called for the in-flight event', () => {
        const channel = createEventChannel();
        const late = jest.fn();

        channel.onAborted(() => {
            channel.onAborted(late);
        });

        channel.emitAborted(queryInfo);
        // `late` was added during dispatch, so it must not see the in-flight event.
        expect(late).not.toHaveBeenCalled();

        channel.emitAborted(queryInfo);
        expect(late).toHaveBeenCalledTimes(1);
    });
});
