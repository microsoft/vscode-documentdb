/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type VsCodeLinkRequestMessage, type VsCodeLinkResponseMessage } from '../../../../packages/vscode-ext-webview/src/shared/wireProtocol';
import { type WebviewApi } from 'vscode-webview';
import { type FixturePaths, type RpcFixtures } from './fixtures';

export interface HarnessCall {
    readonly path: string;
    readonly type: VsCodeLinkRequestMessage['op']['type'];
    readonly input: unknown;
}

declare global {
    interface Window {
        __harnessCalls: HarnessCall[];
    }
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function request(value: unknown): value is VsCodeLinkRequestMessage {
    return isObject(value) && typeof value.id === 'string' && isObject(value.op) && typeof value.op.type === 'string';
}

function hasFixture(rpc: RpcFixtures, path: string): path is FixturePaths {
    return Object.hasOwn(rpc, path);
}

export function fakeVsCodeApi(rpc: RpcFixtures, errors: string[]): typeof window.acquireVsCodeApi {
    const calls: HarnessCall[] = [];
    window.__harnessCalls = calls;
    const subscriptions = new Set<string>();
    let acquired = false;

    function send(message: VsCodeLinkResponseMessage): void {
        window.postMessage(message, window.location.origin);
    }

    function receive(value: unknown): void {
        if (!request(value)) {
            errors.push('Invalid tRPC request');
            throw new Error('Invalid tRPC request');
        }
        const { id, op } = value;
        if (op.type === 'subscription.stop' || op.type === 'abort') {
            subscriptions.delete(id);
            return;
        }
        calls.push({ path: op.path, type: op.type, input: op.input });
        const response = hasFixture(rpc, op.path) ? rpc[op.path] : undefined;
        if (!response || response.type !== op.type) {
            const message = `No ${op.type} fixture for ${op.path}`;
            errors.push(message);
            send({ id, error: { name: 'FixtureError', message }, complete: true });
            throw new Error(message);
        }
        if (response.keepOpen) {
            subscriptions.add(id);
        }
        queueMicrotask((): void => {
            if (response.keepOpen && !subscriptions.has(id)) {
                return;
            }
            for (const result of response.results) {
                send({ id, result });
            }
            if (response.undefinedResult) {
                send({ id, result: undefined });
            }
            if (!response.keepOpen) {
                send({ id, complete: true });
            }
        });
    }

    return <StateType = unknown>(): WebviewApi<StateType> => {
        if (acquired) {
            throw new Error('acquireVsCodeApi called more than once');
        }
        acquired = true;
        let state: StateType | undefined;
        return {
            postMessage: receive, getState: (): StateType | undefined => state,
            setState: <T extends StateType | undefined>(next: T): T => { state = next; return next; },
        };
    };
}
