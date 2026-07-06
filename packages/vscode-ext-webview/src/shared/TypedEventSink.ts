/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Typed async-iterable event sink for bridging push-style domain events into
 * tRPC subscriptions.
 *
 * tRPC subscriptions are modeled as `async function*` generators on the
 * server side. That shape is convenient when events come from a pull-based
 * loop (cursors, polling), but inconvenient when events come from push-based
 * producers (VS Code event emitters, driver callbacks, completion notifiers).
 *
 * `TypedEventSink<T>` is the bridge: producers call `emit(event)` whenever
 * something happens; the subscription procedure consumes the sink with
 * `for await (const event of sink)` and yields each event to the webview.
 *
 * `T` must extend `DiscriminatedEvent` (any type with a `type` string field)
 * so the second `emit(type, payload)` overload can narrow the payload shape
 * to the matching union member.
 *
 * @example
 * ```ts
 * type MyEvent =
 *   | { type: 'progress'; percent: number }
 *   | { type: 'completed'; durationMs: number };
 *
 * const sink = new TypedEventSink<MyEvent>();
 *
 * // Producer side (anywhere in extension-host code):
 * sink.emit({ type: 'progress', percent: 25 });
 * sink.emit('completed', { durationMs: 1500 });
 *
 * // Consumer side (a tRPC subscription procedure):
 * .subscription(async function* ({ ctx }) {
 *   for await (const event of sink) {
 *     if (ctx.signal?.aborted) return;
 *     yield event;
 *   }
 * });
 * ```
 */

/**
 * Constraint for any event union used with {@link TypedEventSink}: each
 * member of the union must carry a string `type` discriminator. The second
 * {@link TypedEventSink.emit} overload uses this field to narrow the
 * payload shape.
 */
export type DiscriminatedEvent = { type: string };

/**
 * Given a discriminated event union `T` and one of its `type` tags `K`,
 * extracts the matching member of the union.
 */
export type EventOfType<T extends DiscriminatedEvent, K extends T['type']> = Extract<T, { type: K }>;

/**
 * Write-only view of a {@link TypedEventSink}. Useful when a producer (e.g.
 * a session class) needs to emit a subset of events but should not be able
 * to consume the sink or close it.
 */
export interface UntypedEventEmitter {
    emit(event: { type: string; [key: string]: unknown }): void;
}

/**
 * Typed async-iterable event sink. Single-consumer by design: throws if a
 * second async iterator is requested.
 */
export class TypedEventSink<T extends DiscriminatedEvent> implements AsyncIterable<T> {
    private queue: T[] = [];
    private resolve: ((value: IteratorResult<T>) => void) | null = null;
    private done = false;
    private iterating = false;

    /**
     * Push a typed event into the sink. If a consumer is waiting, it receives
     * the event immediately. Otherwise the event is buffered.
     *
     * Two overloads:
     * 1. `emit(event)` - pass a fully-constructed union member.
     * 2. `emit(type, payload)` - pass the discriminator and the rest of the
     *    payload separately. TypeScript narrows `payload` to the matching
     *    union member based on `type`, which improves autocompletion at the
     *    call site.
     *
     * Events emitted after `close()` are silently dropped.
     */
    emit(event: T): void;
    emit<K extends T['type']>(type: K, payload: Omit<EventOfType<T, K>, 'type'>): void;
    emit<K extends T['type']>(eventOrType: T | K, payload?: Omit<EventOfType<T, K>, 'type'>): void {
        if (this.done) {
            return;
        }

        const event: T =
            typeof eventOrType === 'string' ? ({ type: eventOrType, ...payload } as unknown as T) : eventOrType;

        if (this.resolve) {
            const res = this.resolve;
            this.resolve = null;
            res({ value: event, done: false });
        } else {
            this.queue.push(event);
        }
    }

    /**
     * Close the sink. The async iterator completes after all buffered events
     * have been consumed. Further calls to `emit` are silently dropped.
     */
    close(): void {
        if (this.done) {
            return;
        }
        this.done = true;

        if (this.resolve) {
            const res = this.resolve;
            this.resolve = null;
            res({ value: undefined as unknown as T, done: true });
        }
    }

    /**
     * Whether the sink has been closed. After this becomes `true`, the
     * iterator will complete once any buffered events have been drained.
     */
    get isClosed(): boolean {
        return this.done;
    }

    [Symbol.asyncIterator](): AsyncIterator<T> {
        if (this.iterating) {
            throw new Error('TypedEventSink supports only a single consumer');
        }
        this.iterating = true;

        return {
            next: (): Promise<IteratorResult<T>> => {
                // Drain buffered events first
                if (this.queue.length > 0) {
                    return Promise.resolve({ value: this.queue.shift()!, done: false });
                }

                // If closed and buffer is empty, signal completion
                if (this.done) {
                    return Promise.resolve({ value: undefined as unknown as T, done: true });
                }

                // Wait for the next emit() or close()
                return new Promise<IteratorResult<T>>((resolve) => {
                    this.resolve = resolve;
                });
            },

            /**
             * Implements the optional `return()` half of the async-iterator
             * protocol so that callers can release a parked consumer without
             * having to wait for the next `emit` or `close`.
             *
             * This is invoked automatically by `for await (...) { break; }`,
             * `for await (...) { throw ...; }`, and explicit
             * `iterator.return()` calls. The framework's
             * `WebviewController` also calls it on `subscription.stop` and on
             * panel disposal to close out the unsubscribe-while-panel-alive
             * window that abort signals alone cannot reach.
             *
             * After `return()` the sink reports `isClosed === true`,
             * subsequent `emit()` calls are dropped, and a new consumer can
             * iterate again (it will see `{ done: true }` immediately).
             */
            return: (): Promise<IteratorResult<T>> => {
                // Mark the sink closed so any race between `return()` and a
                // late `emit()` from the producer is dropped on the floor.
                this.done = true;
                this.queue.length = 0;

                // If we were parked on a pending `next()`, settle it with
                // `done: true` so the caller's `for await` loop terminates
                // cleanly instead of staying pending forever.
                if (this.resolve) {
                    const res = this.resolve;
                    this.resolve = null;
                    res({ value: undefined as unknown as T, done: true });
                }

                // Release the single-consumer guard. A second `for await`
                // over the same sink is now allowed; it will see `done: true`
                // on the first `next()` because `this.done` is `true`.
                this.iterating = false;

                return Promise.resolve({ value: undefined as unknown as T, done: true });
            },
        };
    }
}
