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
        for (const listener of [...this.listeners]) {
            // Like vscode.EventEmitter: a failing listener must not stop the others or the caller.
            try {
                listener(data);
            } catch (error) {
                console.error(error);
            }
        }
    }

    public dispose(): void {
        this.listeners.clear();
    }
}
