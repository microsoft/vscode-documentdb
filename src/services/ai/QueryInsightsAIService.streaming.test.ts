/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';

// Mock the telemetry wrapper so the SUT's callWithTelemetryAndErrorHandling
// callback runs directly. We re-throw on errors so the caller's error path is
// exercised normally.
jest.mock('@microsoft/vscode-azext-utils', () => ({
    callWithTelemetryAndErrorHandling: jest.fn(
        async (_callbackId: string, callback: (context: IActionContext) => Promise<unknown>): Promise<unknown> => {
            const context = {
                telemetry: { properties: {}, measurements: {} },
                errorHandling: { issueProperties: {} },
                ui: {} as unknown,
                valuesToMask: [],
            } as unknown as IActionContext;
            return callback(context);
        },
    ),
    UserCancelledError: class UserCancelledError extends Error {
        constructor(message?: string) {
            super(message ?? 'User cancelled');
            this.name = 'UserCancelledError';
        }
    },
}));

jest.mock('../../extensionVariables', () => ({
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

// Replace the heavy `optimizeQueryStreaming` (which talks to CopilotService,
// ClusterSession, etc.) with a thin stub that emits the fragments and
// completion the test wants. We only re-export the symbols the SUT references.
const optimizeQueryStreamingMock = jest.fn();
jest.mock('../../commands/llmEnhancedCommands/indexAdvisorCommands', () => ({
    CommandType: { Find: 'find', Aggregate: 'aggregate', Count: 'count' },
    optimizeQuery: jest.fn(),
    optimizeQueryStreaming: optimizeQueryStreamingMock,
}));

// eslint-disable-next-line import/first
import { QueryInsightsAIService } from './QueryInsightsAIService';

describe('QueryInsightsAIService.getOptimizationRecommendationsStreaming (WI-3)', () => {
    const service = new QueryInsightsAIService();

    const completeJsonResponse = JSON.stringify({
        analysis: 'Sample analysis text.',
        improvements: [
            {
                action: 'create',
                indexSpec: { status: 1, date: -1 },
                indexName: 'idx_status_date',
                shellCommand: 'db.coll.createIndex({status: 1, date: -1})',
                justification: 'Speeds up status+date queries.',
                priority: 'high',
            },
        ],
        educationalContent: '# Education\nUseful info.',
    });

    beforeEach(() => {
        optimizeQueryStreamingMock.mockReset();
    });

    /**
     * Builds a stub stream handle that yields the supplied fragments in
     * order, then resolves completion with an OptimizationResult whose
     * `recommendations` field is the concatenated JSON text.
     */
    function makeStubHandle(fragments: string[]): {
        fragments: AsyncIterable<string>;
        completion: Promise<unknown>;
    } {
        const fullText = fragments.join('');
        return {
            fragments: (async function* () {
                for (const fragment of fragments) {
                    await Promise.resolve();
                    yield fragment;
                }
            })(),
            completion: Promise.resolve({
                recommendations: fullText,
                modelId: 'fake-id',
                modelFamily: 'fake-family',
                modelDisplayName: 'Fake Display',
                usage: { promptTokens: 10, responseTokens: 20, totalTokens: 30 },
            }),
        };
    }

    it('threads fragments end-to-end and resolves completion with the parsed response', async () => {
        const fragments = ['{"ana', 'lysis":"Sample analysis text.","improvements":[]}'];
        // Use the full canonical JSON for completion-time parse but feed it as fragments.
        // The fragments are intentionally split awkwardly to prove fragment ordering
        // is preserved on the consumer side.
        const truncatedFragments = [completeJsonResponse.slice(0, 32), completeJsonResponse.slice(32)];
        // sanity check that our split is valid
        expect(truncatedFragments.join('')).toBe(completeJsonResponse);
        // not used — just keeping the local lints happy:
        expect(fragments.length).toBeGreaterThan(0);

        optimizeQueryStreamingMock.mockResolvedValueOnce(makeStubHandle(truncatedFragments));

        const handle = await service.getOptimizationRecommendationsStreaming(
            'session-1',
            { filter: { status: 'active' } },
            'db1',
            'coll1',
        );

        // Consumer can iterate fragments end-to-end in order.
        const received: string[] = [];
        for await (const fragment of handle.fragments) {
            received.push(fragment);
        }
        expect(received).toEqual(truncatedFragments);

        // Completion resolves with the parsed AIOptimizationResponse,
        // carrying both the parsed payload and model identity from the
        // underlying OptimizationResult.
        const parsed = await handle.completion;
        expect(parsed.analysis).toBe('Sample analysis text.');
        expect(parsed.improvements).toHaveLength(1);
        expect(parsed.improvements[0].indexName).toBe('idx_status_date');
        expect(parsed.modelDisplayName).toBe('Fake Display');
        expect(parsed.modelFamily).toBe('fake-family');
        expect(parsed.usage?.totalTokens).toBe(30);
    });

    it('rejects completion when the buffered JSON is malformed', async () => {
        const broken = '{ this is not valid JSON';
        optimizeQueryStreamingMock.mockResolvedValueOnce(makeStubHandle([broken]));

        const handle = await service.getOptimizationRecommendationsStreaming(
            'session-2',
            { filter: {} },
            'db1',
            'coll1',
        );

        // Drain the fragments first — that should succeed.
        const received: string[] = [];
        for await (const fragment of handle.fragments) {
            received.push(fragment);
        }
        expect(received).toEqual([broken]);

        // The final parse must surface as a rejected completion so callers
        // can render a clean error state.
        await expect(handle.completion).rejects.toThrow(/Failed to parse AI optimization response/);
    });
});
