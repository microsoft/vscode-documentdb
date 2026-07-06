/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type AIIndexRecommendation } from '../../../services/ai/types';
import { type QueryInsightsState } from './collectionViewContext';
import { applyStage3Event, startStage3Load } from './queryInsightsReducer';
import { type QueryInsightsStage1Response, type QueryInsightsStage2Response } from './types/queryInsights';
import { type QueryInsightsStreamEvent } from './types/queryInsightsStream';

// ============================================================================
// Stage 3 progress-phase behaviour (review item L1)
// ============================================================================
//
// These tests pin the monotonic `connecting → submitted → receiving` phase
// that drives the slim analyzer card's label. The product decisions they
// encode:
//   - `connecting → submitted` advances on a `submitted` status (the request
//     has been dispatched to the model; the card starts its elapsed-time
//     counter while awaiting the first token).
//   - `submitted → receiving` advances on the FIRST CHARACTER received —
//     either a `receiving` status with `charsReceived > 0` or the first
//     structured content event, whichever lands first.
// The phase only ever advances; the throttled `receiving` status events that
// interleave with structured content must never bounce the label backwards.

/** Minimal Stage 1 payload — the phase logic carries it opaquely. */
const STAGE1: QueryInsightsStage1Response = {
    executionTime: 1,
    stages: [],
    efficiencyAnalysis: { executionStrategy: 'COLLSCAN', indexUsed: null, hasInMemorySort: false },
};

/** Minimal Stage 2 payload — only its presence matters to these tests. */
const STAGE2 = { executionTimeMs: 1, concerns: [] } as unknown as QueryInsightsStage2Response;

/** Build an `s3Loading` state with a fresh empty streaming buffer. */
function loadingState(requestKey = 'rk-1'): QueryInsightsState {
    const idle: QueryInsightsState = { kind: 's3Idle', stage1: STAGE1, stage2: STAGE2 };
    return startStage3Load(idle, requestKey);
}

function makeRecommendation(): AIIndexRecommendation {
    return {
        action: 'create',
        indexSpec: { a: 1 },
        indexName: 'a_1',
        shellCommand: 'db.coll.createIndex({"a":1})',
        justification: 'speeds up filter',
        priority: 'high',
    };
}

/** Narrow to the streaming buffer, asserting the state is still `s3Loading`. */
function streamingOf(state: QueryInsightsState) {
    if (state.kind !== 's3Loading') {
        throw new Error(`expected s3Loading, got ${state.kind}`);
    }
    return state.streaming;
}

describe('queryInsightsReducer — Stage 3 progress phase (L1)', () => {
    const RK = 'rk-1';

    it('starts a fresh load in the "connecting" phase', () => {
        expect(streamingOf(loadingState(RK)).phase).toBe('connecting');
    });

    describe('submitted — request dispatched, awaiting first token', () => {
        it('advances connecting → submitted on a submitted status', () => {
            const event: QueryInsightsStreamEvent = {
                type: 'status',
                phase: 'submitted',
                elapsedMs: 60,
                charsReceived: 0,
            };
            const next = applyStage3Event(loadingState(RK), RK, event);
            expect(streamingOf(next).phase).toBe('submitted');
        });
    });

    describe('receiving — first character received', () => {
        it('advances submitted → receiving on a receiving status with charsReceived > 0', () => {
            const submitted: QueryInsightsStreamEvent = {
                type: 'status',
                phase: 'submitted',
                elapsedMs: 60,
                charsReceived: 0,
            };
            const submittedState = applyStage3Event(loadingState(RK), RK, submitted);
            const event: QueryInsightsStreamEvent = {
                type: 'status',
                phase: 'receiving',
                elapsedMs: 300,
                charsReceived: 42,
            };
            const next = applyStage3Event(submittedState, RK, event);
            expect(streamingOf(next).phase).toBe('receiving');
        });

        it('advances connecting → receiving on a receiving status with charsReceived > 0', () => {
            const event: QueryInsightsStreamEvent = {
                type: 'status',
                phase: 'receiving',
                elapsedMs: 300,
                charsReceived: 42,
            };
            const next = applyStage3Event(loadingState(RK), RK, event);
            expect(streamingOf(next).phase).toBe('receiving');
        });

        it('does NOT advance on a receiving status with zero charsReceived', () => {
            const event: QueryInsightsStreamEvent = {
                type: 'status',
                phase: 'receiving',
                elapsedMs: 300,
                charsReceived: 0,
            };
            const next = applyStage3Event(loadingState(RK), RK, event);
            expect(streamingOf(next).phase).toBe('connecting');
        });

        it('does NOT advance on connecting/parsing status phases', () => {
            const connecting: QueryInsightsStreamEvent = { type: 'status', phase: 'connecting', elapsedMs: 10 };
            const parsing: QueryInsightsStreamEvent = {
                type: 'status',
                phase: 'parsing',
                elapsedMs: 999,
                charsReceived: 100,
            };
            expect(streamingOf(applyStage3Event(loadingState(RK), RK, connecting)).phase).toBe('connecting');
            expect(streamingOf(applyStage3Event(loadingState(RK), RK, parsing)).phase).toBe('connecting');
        });

        it('returns the SAME state reference when a status event does not change the phase', () => {
            const prev = loadingState(RK);
            const event: QueryInsightsStreamEvent = { type: 'status', phase: 'connecting', elapsedMs: 5 };
            expect(applyStage3Event(prev, RK, event)).toBe(prev);
        });

        it('advances to receiving on the first structured content event (educational)', () => {
            const event: QueryInsightsStreamEvent = { type: 'educational', markdown: '### Overview', complete: false };
            const next = applyStage3Event(loadingState(RK), RK, event);
            expect(streamingOf(next).phase).toBe('receiving');
        });

        it('advances to receiving on the first summary event', () => {
            const event: QueryInsightsStreamEvent = { type: 'summary', markdown: '### Performance', complete: false };
            const next = applyStage3Event(loadingState(RK), RK, event);
            expect(streamingOf(next).phase).toBe('receiving');
        });

        it('advances to receiving on recommendationStarted and recommendation events', () => {
            const started: QueryInsightsStreamEvent = { type: 'recommendationStarted', index: 0 };
            expect(streamingOf(applyStage3Event(loadingState(RK), RK, started)).phase).toBe('receiving');

            const rec: QueryInsightsStreamEvent = {
                type: 'recommendation',
                index: 0,
                recommendation: makeRecommendation(),
            };
            expect(streamingOf(applyStage3Event(loadingState(RK), RK, rec)).phase).toBe('receiving');
        });
    });

    describe('monotonicity — the label never regresses', () => {
        it('keeps receiving when a second receiving status arrives', () => {
            const first: QueryInsightsStreamEvent = {
                type: 'status',
                phase: 'receiving',
                elapsedMs: 300,
                charsReceived: 10,
            };
            const receiving = applyStage3Event(loadingState(RK), RK, first);
            const second: QueryInsightsStreamEvent = {
                type: 'status',
                phase: 'receiving',
                elapsedMs: 600,
                charsReceived: 20,
            };
            expect(streamingOf(applyStage3Event(receiving, RK, second)).phase).toBe('receiving');
        });

        it('does NOT regress receiving → submitted when a late submitted status arrives', () => {
            const receivingEvent: QueryInsightsStreamEvent = {
                type: 'status',
                phase: 'receiving',
                elapsedMs: 300,
                charsReceived: 10,
            };
            const receiving = applyStage3Event(loadingState(RK), RK, receivingEvent);
            const lateSubmitted: QueryInsightsStreamEvent = {
                type: 'status',
                phase: 'submitted',
                elapsedMs: 350,
                charsReceived: 0,
            };
            expect(streamingOf(applyStage3Event(receiving, RK, lateSubmitted)).phase).toBe('receiving');
        });
    });

    describe('terminal complete carries the last phase across to s3Success', () => {
        it('preserves the phase value on the success variant', () => {
            const educational: QueryInsightsStreamEvent = { type: 'educational', markdown: 'x', complete: false };
            const receiving = applyStage3Event(loadingState(RK), RK, educational);

            const complete: QueryInsightsStreamEvent = {
                type: 'complete',
                modelDisplayName: 'GPT',
                modelId: 'gpt',
                modelFamily: 'gpt',
            };
            const done = applyStage3Event(receiving, RK, complete);

            expect(done.kind).toBe('s3Success');
            if (done.kind !== 's3Success') {
                throw new Error('unreachable');
            }
            expect(done.streaming.phase).toBe('receiving');
        });
    });

    describe('staleness guard still applies to phase updates', () => {
        it('ignores events whose requestKey does not match the in-flight load', () => {
            const prev = loadingState(RK);
            const event: QueryInsightsStreamEvent = { type: 'educational', markdown: 'x', complete: false };
            const next = applyStage3Event(prev, 'stale-key', event);
            expect(next).toBe(prev);
            expect(streamingOf(next).phase).toBe('connecting');
        });
    });
});
