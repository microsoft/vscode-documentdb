/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type WebviewApi } from 'vscode-webview';
import {
    type VsCodeLinkRequestMessage,
    type VsCodeLinkResponseMessage,
} from '../../../../packages/vscode-ext-webview/src/shared/wireProtocol';
import { type FixturePaths, type RpcFixtures } from './fixtures';

export interface HarnessCall {
    readonly path: string;
    readonly type: VsCodeLinkRequestMessage['op']['type'];
    readonly input: unknown;
}

declare global {
    interface Window {
        __harnessCalls: HarnessCall[];
        __releaseScenarioReply?: (tag: string) => boolean;
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
    const held = new Map<string, { id: string; reply: () => void }[]>();
    let acquired = false;

    window.__releaseScenarioReply = (tag: string): boolean => {
        const replies = held.get(tag);
        if (!replies?.length) {
            errors.push(`No held scenario reply: ${tag}`);
            return false;
        }
        held.delete(tag);
        for (const { reply } of replies) reply();
        return true;
    };

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
            for (const [tag, replies] of held) {
                const remaining = replies.filter((reply): boolean => reply.id !== id);
                if (remaining.length) held.set(tag, remaining);
                else held.delete(tag);
            }
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
        const selected = response.cases?.find(
            (item): boolean => JSON.stringify(item.input) === JSON.stringify(op.input),
        );
        const reply = (): void => {
            if (response.keepOpen && !subscriptions.has(id)) {
                return;
            }
            for (const result of selected?.results ?? response.results) {
                send({ id, result });
            }
            if (response.undefinedResult) {
                send({ id, result: undefined });
            }
            if (!response.keepOpen) {
                send({ id, complete: true });
            }
        };
        const tag = selected ? selected.hold : response.hold;
        if (tag !== undefined) {
            const replies = held.get(tag) ?? [];
            replies.push({ id, reply });
            held.set(tag, replies);
        } else {
            queueMicrotask(reply);
        }
    }

    return <StateType = unknown>(): WebviewApi<StateType> => {
        if (acquired) {
            throw new Error('acquireVsCodeApi called more than once');
        }
        acquired = true;
        let state: StateType | undefined;
        return {
            postMessage: receive,
            getState: (): StateType | undefined => state,
            setState: <T extends StateType | undefined>(next: T): T => {
                state = next;
                return next;
            },
        };
    };
}
