/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { TypedEventSink } from './TypedEventSink';

type TestEvent =
    | { type: 'progress'; percent: number }
    | { type: 'completed'; durationMs: number }
    | { type: 'failed'; reason: string };

describe('TypedEventSink', () => {
    it('buffers events emitted before a consumer is attached', async () => {
        const sink = new TypedEventSink<TestEvent>();

        sink.emit({ type: 'progress', percent: 25 });
        sink.emit({ type: 'progress', percent: 50 });
        sink.close();

        const received: TestEvent[] = [];
        for await (const event of sink) {
            received.push(event);
        }

        expect(received).toEqual([
            { type: 'progress', percent: 25 },
            { type: 'progress', percent: 50 },
        ]);
    });

    it('delivers events to a parked consumer immediately', async () => {
        const sink = new TypedEventSink<TestEvent>();

        const consumed: TestEvent[] = [];
        const consumer = (async () => {
            for await (const event of sink) {
                consumed.push(event);
                if (event.type === 'completed') {
                    return;
                }
            }
        })();

        // Yield to let the consumer park on next().
        await Promise.resolve();

        sink.emit({ type: 'progress', percent: 10 });
        sink.emit('completed', { durationMs: 500 });

        await consumer;

        expect(consumed).toEqual([
            { type: 'progress', percent: 10 },
            { type: 'completed', durationMs: 500 },
        ]);
    });

    it('supports the (type, payload) emit overload with narrowed typing', async () => {
        const sink = new TypedEventSink<TestEvent>();

        sink.emit('failed', { reason: 'timeout' });
        sink.close();

        const received: TestEvent[] = [];
        for await (const event of sink) {
            received.push(event);
        }

        expect(received).toEqual([{ type: 'failed', reason: 'timeout' }]);
    });

    it('drops events emitted after close()', async () => {
        const sink = new TypedEventSink<TestEvent>();

        sink.emit({ type: 'progress', percent: 1 });
        sink.close();
        sink.emit({ type: 'progress', percent: 99 });

        const received: TestEvent[] = [];
        for await (const event of sink) {
            received.push(event);
        }

        expect(received).toEqual([{ type: 'progress', percent: 1 }]);
        expect(sink.isClosed).toBe(true);
    });

    it('resolves a parked consumer when close() is called', async () => {
        const sink = new TypedEventSink<TestEvent>();

        const consumed: TestEvent[] = [];
        const consumer = (async () => {
            for await (const event of sink) {
                consumed.push(event);
            }
        })();

        // Yield to let the consumer park.
        await Promise.resolve();

        sink.close();

        await consumer;

        expect(consumed).toEqual([]);
        expect(sink.isClosed).toBe(true);
    });

    it('throws when a second consumer attempts to iterate', () => {
        const sink = new TypedEventSink<TestEvent>();

        sink[Symbol.asyncIterator]();

        expect(() => sink[Symbol.asyncIterator]()).toThrow(/single consumer/);
    });

    it('reports isClosed correctly', () => {
        const sink = new TypedEventSink<TestEvent>();
        expect(sink.isClosed).toBe(false);

        sink.close();
        expect(sink.isClosed).toBe(true);

        // close() is idempotent.
        sink.close();
        expect(sink.isClosed).toBe(true);
    });

    describe('iterator.return()', () => {
        it('releases a consumer parked on next() with no buffered events', async () => {
            const sink = new TypedEventSink<TestEvent>();
            const iterator = sink[Symbol.asyncIterator]();

            // Park the consumer on next() — no events buffered, sink not closed.
            const pendingNext = iterator.next();

            // Drive return() externally (like WebviewController does on subscription.stop).
            const returnResult = await iterator.return!({ value: undefined as unknown as TestEvent, done: true });

            expect(returnResult.done).toBe(true);

            // The previously parked next() should now resolve with { done: true }.
            const settled = await pendingNext;
            expect(settled.done).toBe(true);
            expect(sink.isClosed).toBe(true);
        });

        it('completes a for-await loop that calls break early', async () => {
            const sink = new TypedEventSink<TestEvent>();

            sink.emit({ type: 'progress', percent: 10 });
            sink.emit({ type: 'progress', percent: 20 });

            const received: TestEvent[] = [];
            for await (const event of sink) {
                received.push(event);
                // `break` calls iterator.return() under the iterator protocol.
                break;
            }

            expect(received).toEqual([{ type: 'progress', percent: 10 }]);
            expect(sink.isClosed).toBe(true);

            // Subsequent emit() calls are dropped, exactly like after close().
            sink.emit({ type: 'progress', percent: 99 });
            expect(sink.isClosed).toBe(true);
        });

        it('drops buffered events on return() so they cannot leak to a later consumer', async () => {
            const sink = new TypedEventSink<TestEvent>();

            sink.emit({ type: 'progress', percent: 10 });
            sink.emit({ type: 'progress', percent: 20 });

            const iterator = sink[Symbol.asyncIterator]();
            await iterator.return!({ value: undefined as unknown as TestEvent, done: true });

            // A second consumer is allowed after return() — single-consumer guard is released.
            const second: TestEvent[] = [];
            for await (const event of sink) {
                second.push(event);
            }
            expect(second).toEqual([]);
        });

        it('is idempotent (return() after return())', async () => {
            const sink = new TypedEventSink<TestEvent>();
            const iterator = sink[Symbol.asyncIterator]();

            const r1 = await iterator.return!({ value: undefined as unknown as TestEvent, done: true });
            const r2 = await iterator.return!({ value: undefined as unknown as TestEvent, done: true });

            expect(r1.done).toBe(true);
            expect(r2.done).toBe(true);
            expect(sink.isClosed).toBe(true);
        });
    });
});
