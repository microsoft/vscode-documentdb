/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface Disposable {
    dispose(): void;
}

export type Event<T> = (listener: (e: T) => unknown, thisArgs?: unknown, disposables?: Disposable[]) => Disposable;

export class Emitter<T> {
    private readonly listeners = new Set<(e: T) => unknown>();
    private readonly deliveryQueue: { data: T; listeners: ((e: T) => unknown)[] }[] = [];
    private delivering = false;

    public readonly event: Event<T> = (listener, thisArgs, disposables): Disposable => {
        const boundListener = (e: T): unknown => listener.call(thisArgs, e);
        this.listeners.add(boundListener);
        const disposable: Disposable = {
            dispose: (): void => {
                this.listeners.delete(boundListener);
            },
        };
        disposables?.push(disposable);
        return disposable;
    };

    public fire(data: T): void {
        this.deliveryQueue.push({ data, listeners: [...this.listeners] });
        // Like vscode.EventEmitter: an event fired from a listener waits until the current event has
        // reached every listener, so all listeners observe events in the order they were fired.
        if (this.delivering) {
            return;
        }

        this.delivering = true;
        try {
            for (let next = this.deliveryQueue.shift(); next; next = this.deliveryQueue.shift()) {
                for (const listener of next.listeners) {
                    if (!this.listeners.has(listener)) {
                        continue;
                    }
                    // Like vscode.EventEmitter: a failing listener must not stop the others or the caller.
                    try {
                        listener(next.data);
                    } catch (error) {
                        console.error(error);
                    }
                }
            }
        } finally {
            this.delivering = false;
        }
    }

    public dispose(): void {
        this.listeners.clear();
        this.deliveryQueue.length = 0;
    }
}
