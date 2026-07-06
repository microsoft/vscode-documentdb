/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext, UserCancelledError } from '@microsoft/vscode-azext-utils';

// Mock vscode-azext-utils — the real `callWithTelemetryAndErrorHandling`
// returns `undefined` for unhandled errors; we simulate the success path and
// re-throw on errors so the streaming code's reject path is exercised.
jest.mock('@microsoft/vscode-azext-utils', () => {
    class MockUserCancelledError extends Error {
        constructor(message?: string) {
            super(message ?? 'User cancelled');
            this.name = 'UserCancelledError';
        }
    }
    return {
        UserCancelledError: MockUserCancelledError,
        callWithTelemetryAndErrorHandling: jest.fn(
            async (_callbackId: string, callback: (context: IActionContext) => Promise<unknown>): Promise<unknown> => {
                const context = {
                    telemetry: { properties: {}, measurements: {} },
                    errorHandling: { issueProperties: {} },
                    ui: {} as unknown,
                    valuesToMask: [],
                } as unknown as IActionContext;
                try {
                    return await callback(context);
                } catch (error) {
                    if ((error as { name?: string }).name === 'UserCancelledError') {
                        return undefined;
                    }
                    throw error;
                }
            },
        ),
    };
});

// Mock the extension variables module so the trace calls inside the service
// do not require a real extension host.
jest.mock('../extensionVariables', () => ({
    ext: {
        outputChannel: {
            appendLog: jest.fn(),
            trace: jest.fn(),
            debug: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
        },
    },
}));

// Override the global `__mocks__/vscode.js` for this suite so we can wire up
// the `lm.selectChatModels` entry point the service relies on (jest-mock-vscode
// does not provide a `lm` namespace today).
const selectChatModelsMock = jest.fn();
jest.mock('vscode', () => {
    class CancellationTokenSource {
        token = { isCancellationRequested: false, onCancellationRequested: jest.fn() };
        cancel(): void {
            this.token.isCancellationRequested = true;
        }
        dispose(): void {
            /* no-op */
        }
    }
    return {
        l10n: {
            t: jest.fn((message: string, ...args: unknown[]) => {
                let result = message;
                args.forEach((arg, index) => {
                    result = result.replace(`{${index}}`, String(arg));
                });
                return result;
            }),
        },
        CancellationTokenSource,
        lm: { selectChatModels: selectChatModelsMock },
    };
});

// Now import the SUT (after mocks are wired).
// eslint-disable-next-line import/first
import { CopilotService } from './copilotService';

/**
 * Synthesise a chat message at runtime — `jest-mock-vscode` does not
 * implement `LanguageModelChatMessage.User`, so we hand-build the object
 * with just the fields the service touches (`role`, `content`).
 */
function makeUserMessage(content: string): { role: number; content: string } {
    return { role: 1 /* User */, content };
}

/**
 * Builds a synthetic `LanguageModelChat` whose `sendRequest` returns a
 * response whose `.text` is an async iterable of the supplied fragments.
 * `countTokens` is wired to a tiny deterministic estimate so the
 * usage-on-completion assertion has stable expected values.
 */
function makeFakeModel(fragments: string[]): unknown {
    const sendRequest = jest.fn(async () => {
        const text = (async function* () {
            for (const fragment of fragments) {
                // Yield on a microtask so consumers can interleave aborts.
                await Promise.resolve();
                yield fragment;
            }
        })();
        return { text };
    });
    return {
        id: 'fake-model-id',
        family: 'fake-family',
        name: 'Fake Model',
        vendor: 'copilot',
        version: '1.0',
        maxInputTokens: 1000,
        sendRequest,
        countTokens: jest.fn(async (input: unknown) => {
            const text = typeof input === 'string' ? input : JSON.stringify(input);
            return text.length;
        }),
    };
}

describe('CopilotService.streamMessage', () => {
    beforeEach(() => {
        selectChatModelsMock.mockReset();
    });

    it('yields fragments in order and resolves completion with the full text + usage', async () => {
        const fragments = ['Hello, ', 'world', '!'];
        selectChatModelsMock.mockResolvedValueOnce([makeFakeModel(fragments)]);

        const handle = CopilotService.streamMessage([makeUserMessage('Say hi') as never], {
            featureSource: 'queryInsights',
        });

        const received: string[] = [];
        for await (const fragment of handle.fragments) {
            received.push(fragment);
        }

        expect(received).toEqual(fragments);

        const response = await handle.completion;
        expect(response.text).toBe(fragments.join(''));
        expect(response.modelId).toBe('fake-model-id');
        expect(response.modelFamily).toBe('fake-family');
        expect(response.modelDisplayName).toBe('Fake Model');
        expect(typeof response.durationMs).toBe('number');
        expect(response.usage?.responseTokens).toBe(response.text.length);
    });

    it('ends iteration and rejects completion when the signal is aborted mid-stream', async () => {
        // Use a model that yields fragments slowly so the test can abort in the middle.
        const fragments = ['part-1 ', 'part-2 ', 'part-3 ', 'part-4'];
        selectChatModelsMock.mockResolvedValueOnce([makeFakeModel(fragments)]);

        const controller = new AbortController();
        const handle = CopilotService.streamMessage([makeUserMessage('Stream') as never], {
            featureSource: 'queryInsights',
            signal: controller.signal,
        });

        const received: string[] = [];
        await expect(
            (async () => {
                for await (const fragment of handle.fragments) {
                    received.push(fragment);
                    if (received.length === 1) {
                        controller.abort();
                    }
                }
            })(),
        ).rejects.toBeInstanceOf(UserCancelledError);

        // We received at least one fragment but stopped before the model
        // would have produced all of them.
        expect(received.length).toBeGreaterThanOrEqual(1);
        expect(received.length).toBeLessThan(fragments.length);

        // The completion promise should also reject with a UserCancelledError.
        await expect(handle.completion).rejects.toBeInstanceOf(UserCancelledError);
    });

    it('rejects completion when no suitable language model is available', async () => {
        selectChatModelsMock.mockResolvedValueOnce([]);

        const handle = CopilotService.streamMessage([makeUserMessage('Hi') as never], {
            featureSource: 'queryInsights',
        });

        const received: string[] = [];
        await expect(
            (async () => {
                for await (const fragment of handle.fragments) {
                    received.push(fragment);
                }
            })(),
        ).rejects.toThrow(/no suitable language model/i);

        expect(received).toEqual([]);
        await expect(handle.completion).rejects.toThrow(/no suitable language model/i);
    });
});
