/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Minimal runtime stub of the `vscode` module for the package's Jest tests.
 *
 * The package's production code imports `vscode` only in the host facade
 * ({@link WebviewController} / {@link openWebview}); every other module keeps
 * `vscode` as a type-only import. Tests resolve `vscode` to this file via the
 * `moduleNameMapper` entry in `jest.config.js`. Type-checking still uses the
 * real `@types/vscode`; this only supplies the runtime values the facade reads.
 */

type Listener<T> = (e: T) => void;

interface MockDisposable {
    dispose(): void;
}

/** Stub of `vscode.EventEmitter`. */
export class EventEmitter<T> {
    private readonly listeners = new Set<Listener<T>>();

    public readonly event = (listener: Listener<T>): MockDisposable => {
        this.listeners.add(listener);
        return {
            dispose: (): void => {
                this.listeners.delete(listener);
            },
        };
    };

    public fire(data: T): void {
        for (const listener of [...this.listeners]) {
            listener(data);
        }
    }

    public dispose(): void {
        this.listeners.clear();
    }
}

/** Stub of `vscode.Webview`. */
class MockWebview {
    public html = '';
    public readonly cspSource = 'vscode-webview://mock';
    /** Everything posted back to the webview, for test assertions. */
    public readonly posted: unknown[] = [];
    private readonly messages = new EventEmitter<unknown>();

    public readonly onDidReceiveMessage = (listener: Listener<unknown>): MockDisposable =>
        this.messages.event(listener);

    public asWebviewUri(uri: { toString(): string }): { toString(skipEncoding?: boolean): string } {
        const value = `mock-webview:${uri.toString()}`;
        return { toString: (): string => value };
    }

    public postMessage(message: unknown): Promise<boolean> {
        this.posted.push(message);
        return Promise.resolve(true);
    }

    /** Test helper: simulate an inbound message from the webview. */
    public receive(message: unknown): void {
        this.messages.fire(message);
    }
}

/** Stub of `vscode.WebviewPanel`. */
export class MockWebviewPanel {
    public readonly webview = new MockWebview();
    public iconPath: unknown;
    public revealCount = 0;
    private readonly didDispose = new EventEmitter<void>();

    public readonly onDidDispose = (listener: Listener<void>): MockDisposable => this.didDispose.event(listener);

    public reveal(_viewColumn?: number, _preserveFocus?: boolean): void {
        this.revealCount += 1;
    }

    public dispose(): void {
        this.didDispose.fire();
    }
}

/** The most recently created panel, so tests can introspect it. */
export let lastCreatedPanel: MockWebviewPanel | undefined;

/** Stub of the `vscode.window` namespace. */
export const window = {
    createWebviewPanel(_viewType: string, _title: string, _viewColumn: unknown, _options: unknown): MockWebviewPanel {
        lastCreatedPanel = new MockWebviewPanel();
        return lastCreatedPanel;
    },
};

/** Stub of the `vscode.Uri` namespace. */
export const Uri = {
    file(fsPath: string): { fsPath: string; toString(): string } {
        return { fsPath, toString: (): string => fsPath };
    },
};

/** Stub of `vscode.ViewColumn`. */
export const ViewColumn = {
    Active: -1,
    Beside: -2,
    One: 1,
    Two: 2,
    Three: 3,
} as const;

/** Stub of `vscode.ExtensionMode`. */
export const ExtensionMode = {
    Production: 1,
    Development: 2,
    Test: 3,
} as const;

/** Stub of the `vscode.l10n` namespace. */
export const l10n: { bundle: Record<string, unknown> | undefined } = {
    bundle: undefined,
};
