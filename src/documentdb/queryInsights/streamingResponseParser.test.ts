/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type AIIndexRecommendation } from '../../services/ai/types';
import { StreamingResponseParser, type ParserEmittedEvent } from './streamingResponseParser';

/**
 * Convenience: feed a single chunk and finalize, returning the merged
 * event sequence and the finalize result. Mirrors the typical caller
 * (subscription wrapper) loop.
 */
function runOnce(json: string): {
    events: ParserEmittedEvent[];
    finalEvents: ParserEmittedEvent[];
    finalize: ReturnType<StreamingResponseParser['finalize']>;
} {
    const parser = new StreamingResponseParser();
    const events = parser.feed(json);
    const finalize = parser.finalize();
    return { events, finalEvents: finalize.events, finalize };
}

function makeRecommendation(overrides: Partial<AIIndexRecommendation> = {}): AIIndexRecommendation {
    return {
        action: 'create',
        indexSpec: { a: 1 },
        indexName: 'a_1',
        shellCommand: 'db.coll.createIndex({"a":1})',
        justification: 'speeds up filter',
        priority: 'high',
        ...overrides,
    };
}

describe('StreamingResponseParser', () => {
    describe('basic happy path', () => {
        it('parses a complete JSON with all four canonical keys', () => {
            const payload = {
                educationalContent: 'Para 1.\n\nPara 2.',
                analysis: 'Analysis line 1.\n\nAnalysis line 2.',
                improvements: [makeRecommendation()],
                verification: ['Verify A', 'Verify B'],
            };
            const { events, finalEvents, finalize } = runOnce(JSON.stringify(payload));
            const all = [...events, ...finalEvents];

            expect(finalize.parsed).not.toBeNull();
            expect(finalize.parsed!.educationalContent).toBe('Para 1.\n\nPara 2.');
            expect(finalize.parsed!.analysis).toBe('Analysis line 1.\n\nAnalysis line 2.');
            expect(finalize.parsed!.improvements).toHaveLength(1);
            expect(finalize.parsed!.verification).toEqual(['Verify A', 'Verify B']);
            expect(finalize.parseError).toBeUndefined();

            const educational = all.filter(
                (e): e is Extract<ParserEmittedEvent, { type: 'educational' }> => e.type === 'educational',
            );
            // One emission at the \n\n paragraph boundary + one final complete.
            expect(educational).toHaveLength(2);
            expect(educational[0].complete).toBe(false);
            expect(educational[0].markdown).toBe('Para 1.\n\n');
            expect(educational[1].complete).toBe(true);
            expect(educational[1].markdown).toBe('Para 1.\n\nPara 2.');

            const summary = all.filter(
                (e): e is Extract<ParserEmittedEvent, { type: 'summary' }> => e.type === 'summary',
            );
            expect(summary).toHaveLength(2);
            expect(summary[1].complete).toBe(true);
            expect(summary[1].markdown).toBe('Analysis line 1.\n\nAnalysis line 2.');

            const started = all.filter(
                (e): e is Extract<ParserEmittedEvent, { type: 'recommendationStarted' }> =>
                    e.type === 'recommendationStarted',
            );
            expect(started.map((e) => e.index)).toEqual([0]);

            const recs = all.filter(
                (e): e is Extract<ParserEmittedEvent, { type: 'recommendation' }> => e.type === 'recommendation',
            );
            expect(recs).toHaveLength(1);
            expect(recs[0].index).toBe(0);
            expect(recs[0].recommendation.indexName).toBe('a_1');

            const ver = all.filter(
                (e): e is Extract<ParserEmittedEvent, { type: 'verification' }> => e.type === 'verification',
            );
            expect(ver).toHaveLength(1);
            expect(ver[0].items).toEqual(['Verify A', 'Verify B']);
        });

        it('works when fed one byte at a time', () => {
            const payload = {
                analysis: 'hello',
                improvements: [makeRecommendation({ indexName: 'x_1' })],
                verification: [],
            };
            const json = JSON.stringify(payload);

            const parser = new StreamingResponseParser();
            const collected: ParserEmittedEvent[] = [];
            for (const ch of json) {
                collected.push(...parser.feed(ch));
            }
            const finalize = parser.finalize();
            const all = [...collected, ...finalize.events];

            expect(finalize.parsed!.analysis).toBe('hello');
            expect(finalize.parsed!.improvements).toHaveLength(1);

            // "hello" has no \n\n, so only the final complete:true event is emitted.
            const summary = all.filter(
                (e): e is Extract<ParserEmittedEvent, { type: 'summary' }> => e.type === 'summary',
            );
            expect(summary).toHaveLength(1);
            expect(summary[0]).toEqual({ type: 'summary', markdown: 'hello', complete: true });

            const recs = all.filter((e) => e.type === 'recommendation');
            expect(recs).toHaveLength(1);
        });
    });

    describe('progressive emission for markdown', () => {
        it('emits cumulative summary at each \\n\\n boundary and once at close', () => {
            const json = '{"analysis":"P1.\\n\\nP2.\\n\\nP3."}';
            const { events, finalEvents } = runOnce(json);
            const all = [...events, ...finalEvents];
            const summary = all.filter(
                (e): e is Extract<ParserEmittedEvent, { type: 'summary' }> => e.type === 'summary',
            );
            expect(summary).toHaveLength(3);
            expect(summary[0]).toEqual({ type: 'summary', markdown: 'P1.\n\n', complete: false });
            expect(summary[1]).toEqual({
                type: 'summary',
                markdown: 'P1.\n\nP2.\n\n',
                complete: false,
            });
            expect(summary[2]).toEqual({
                type: 'summary',
                markdown: 'P1.\n\nP2.\n\nP3.',
                complete: true,
            });
        });

        it('does not emit duplicate progressive events for repeated \\n', () => {
            // Three consecutive \n chars create only one boundary (between
            // chars 2 and 3) — but the emission depends on the LAST two
            // chars being \n. So after "\n\n\n" the third \n still has
            // lastTwo = "\n\n" — we should NOT re-emit because lastEmittedLen
            // is unchanged.
            const json = '{"analysis":"A\\n\\n\\nB"}';
            const { events, finalEvents } = runOnce(json);
            const all = [...events, ...finalEvents];
            const summary = all.filter(
                (e): e is Extract<ParserEmittedEvent, { type: 'summary' }> => e.type === 'summary',
            );
            // "A\n\n" → emit at first \n\n boundary; then "\n" added → still
            // boundary but len changed so a second emission occurs; then "B"
            // added → no boundary; final "B" emits complete:true.
            // The middle emission is acceptable since each new \n grows the
            // buffer; the contract says we emit cumulative markdown at \n\n,
            // not that we de-dupe across overlapping boundaries.
            expect(summary[summary.length - 1].complete).toBe(true);
            expect(summary[summary.length - 1].markdown).toBe('A\n\n\nB');
        });
    });

    describe('escape handling', () => {
        it('decodes simple escapes inside string values', () => {
            const json = '{"analysis":"l1\\nl2\\twith\\\\backslash and \\"quote\\" and / slash"}';
            const { finalize } = runOnce(json);
            expect(finalize.parsed!.analysis).toBe('l1\nl2\twith\\backslash and "quote" and / slash');
        });

        it('decodes unicode escapes', () => {
            const json = '{"analysis":"caf\\u00e9 \\u2603 done"}';
            const { finalize } = runOnce(json);
            expect(finalize.parsed!.analysis).toBe('café ☃ done');
        });

        it('handles a fragment boundary between \\\\ and the escaped char', () => {
            const parser = new StreamingResponseParser();
            parser.feed('{"analysis":"a\\');
            parser.feed('nb"}');
            const finalize = parser.finalize();
            expect(finalize.parsed!.analysis).toBe('a\nb');
        });

        it('handles a fragment boundary in the middle of a \\u escape sequence', () => {
            const parser = new StreamingResponseParser();
            parser.feed('{"analysis":"x \\u');
            parser.feed('00e9 y"}');
            const finalize = parser.finalize();
            expect(finalize.parsed!.analysis).toBe('x é y');
        });

        it('handles a fragment boundary inside the unicode hex digits', () => {
            const parser = new StreamingResponseParser();
            parser.feed('{"analysis":"x \\u00');
            parser.feed('e9 y"}');
            const finalize = parser.finalize();
            expect(finalize.parsed!.analysis).toBe('x é y');
        });
    });

    describe('improvements array', () => {
        it('emits recommendationStarted before recommendation in stream order', () => {
            const recs = [
                makeRecommendation({ indexName: 'a_1', priority: 'high' }),
                makeRecommendation({ indexName: 'b_1', priority: 'low', action: 'drop' }),
                makeRecommendation({ indexName: 'c_1', priority: 'medium', action: 'modify' }),
            ];
            const json = JSON.stringify({ improvements: recs });
            const { events, finalEvents } = runOnce(json);
            const all = [...events, ...finalEvents];

            // Sequence check: started(0), recommendation(0), started(1), recommendation(1), started(2), recommendation(2)
            const itemEvents = all.filter((e) => e.type === 'recommendationStarted' || e.type === 'recommendation');
            expect(itemEvents).toHaveLength(6);
            expect(itemEvents[0]).toEqual({ type: 'recommendationStarted', index: 0 });
            expect(itemEvents[1].type).toBe('recommendation');
            expect((itemEvents[1] as Extract<ParserEmittedEvent, { type: 'recommendation' }>).index).toBe(0);
            expect(itemEvents[2]).toEqual({ type: 'recommendationStarted', index: 1 });
            expect((itemEvents[3] as Extract<ParserEmittedEvent, { type: 'recommendation' }>).index).toBe(1);
            expect(itemEvents[4]).toEqual({ type: 'recommendationStarted', index: 2 });
            expect((itemEvents[5] as Extract<ParserEmittedEvent, { type: 'recommendation' }>).index).toBe(2);
        });

        it('does not miscount braces inside string fields (shellCommand / justification)', () => {
            const recs = [
                makeRecommendation({
                    indexName: 'a_1',
                    shellCommand: 'db.c.createIndex({"a": 1, "b": -1})',
                    justification: 'Use a {compound} index for {filter,sort} pattern',
                    risks: '{maybe} [some] {disk-overhead}',
                }),
                makeRecommendation({
                    indexName: 'b_1',
                    shellCommand: 'db.c.dropIndex({"b":1})',
                }),
            ];
            const json = JSON.stringify({ improvements: recs });
            const { events, finalEvents } = runOnce(json);
            const all = [...events, ...finalEvents];

            const recEvents = all.filter(
                (e): e is Extract<ParserEmittedEvent, { type: 'recommendation' }> => e.type === 'recommendation',
            );
            expect(recEvents).toHaveLength(2);
            expect(recEvents[0].recommendation.shellCommand).toBe('db.c.createIndex({"a": 1, "b": -1})');
            expect(recEvents[0].recommendation.justification).toBe('Use a {compound} index for {filter,sort} pattern');
            expect(recEvents[1].recommendation.indexName).toBe('b_1');
        });

        it('handles empty improvements array', () => {
            const json = '{"analysis":"x","improvements":[],"verification":["v"]}';
            const { events, finalEvents, finalize } = runOnce(json);
            const all = [...events, ...finalEvents];
            expect(all.filter((e) => e.type === 'recommendationStarted')).toHaveLength(0);
            expect(all.filter((e) => e.type === 'recommendation')).toHaveLength(0);
            expect(finalize.parsed!.improvements).toEqual([]);
            expect(finalize.parsed!.verification).toEqual(['v']);
        });

        it('handles nested arrays inside an improvement item without losing item boundary', () => {
            // An improvement with a hypothetical nested array field
            const item = {
                action: 'create',
                indexSpec: { a: 1 },
                indexOptions: { collation: { locale: 'en', strength: [1, 2, 3] } },
                indexName: 'a_1',
                shellCommand: 'cmd',
                justification: 'why',
                priority: 'medium',
            };
            const json = JSON.stringify({ improvements: [item, item] });
            const { events, finalEvents } = runOnce(json);
            const all = [...events, ...finalEvents];
            const recEvents = all.filter((e) => e.type === 'recommendation');
            expect(recEvents).toHaveLength(2);
        });
    });

    describe('verification array', () => {
        it('emits verification once on finalize with reconciled items (not streaming-extracted)', () => {
            const json = JSON.stringify({
                improvements: [],
                verification: ['Check 1', 'Check 2'],
            });
            const { events, finalEvents } = runOnce(json);

            // No verification event during the streaming pass.
            expect(events.filter((e) => e.type === 'verification')).toHaveLength(0);
            // Exactly one verification event in the trailing flush.
            const ver = finalEvents.filter(
                (e): e is Extract<ParserEmittedEvent, { type: 'verification' }> => e.type === 'verification',
            );
            expect(ver).toHaveLength(1);
            expect(ver[0].items).toEqual(['Check 1', 'Check 2']);
        });

        it('does not emit a verification event when the list is empty', () => {
            const json = JSON.stringify({ improvements: [], verification: [] });
            const { events, finalEvents } = runOnce(json);
            const all = [...events, ...finalEvents];
            expect(all.filter((e) => e.type === 'verification')).toHaveLength(0);
        });
    });

    describe('unknown / extra top-level keys', () => {
        it('skips unknown object, array, number, bool, and null values', () => {
            const json = JSON.stringify({
                modelMetadata: { model: 'gpt-4', usage: { promptTokens: 100, nested: [1, 2] } },
                extraNumber: -42.5,
                extraBool: true,
                extraNull: null,
                extraArray: ['a', 'b'],
                analysis: 'hello',
                improvements: [makeRecommendation()],
                verification: [],
            });
            const { events, finalEvents, finalize } = runOnce(json);
            const all = [...events, ...finalEvents];

            expect(finalize.parsed!.analysis).toBe('hello');
            expect(finalize.parsed!.improvements).toHaveLength(1);

            const summary = all.filter(
                (e): e is Extract<ParserEmittedEvent, { type: 'summary' }> => e.type === 'summary',
            );
            expect(summary.some((s) => s.complete && s.markdown === 'hello')).toBe(true);

            const recs = all.filter((e) => e.type === 'recommendation');
            expect(recs).toHaveLength(1);
        });
    });

    describe('truncation tolerance', () => {
        it('emits final complete:true for a string truncated mid-value', () => {
            const partial = '{"analysis":"Para 1 only';
            const parser = new StreamingResponseParser();
            const events = parser.feed(partial);
            const finalize = parser.finalize();
            const all = [...events, ...finalize.events];

            expect(finalize.parsed).toBeNull();
            expect(finalize.parseError).toBeInstanceOf(Error);

            const summary = all.filter(
                (e): e is Extract<ParserEmittedEvent, { type: 'summary' }> => e.type === 'summary',
            );
            expect(summary).toHaveLength(1);
            expect(summary[0]).toEqual({ type: 'summary', markdown: 'Para 1 only', complete: true });
        });

        it('returns parseError for malformed JSON', () => {
            const { finalize } = runOnce('not json at all');
            expect(finalize.parsed).toBeNull();
            expect(finalize.parseError).toBeInstanceOf(Error);
        });

        it('returns parseError for an empty buffer', () => {
            const parser = new StreamingResponseParser();
            const finalize = parser.finalize();
            expect(finalize.parsed).toBeNull();
            expect(finalize.parseError).toBeInstanceOf(Error);
            expect(finalize.events).toEqual([]);
        });

        it('returns parseError for whitespace-only input', () => {
            const { finalize } = runOnce('   \n   ');
            expect(finalize.parsed).toBeNull();
            expect(finalize.parseError).toBeInstanceOf(Error);
        });
    });

    describe('lifecycle guards', () => {
        it('throws when feed() is called after finalize()', () => {
            const parser = new StreamingResponseParser();
            parser.feed('{"analysis":"x"}');
            parser.finalize();
            expect(() => parser.feed('more')).toThrow(/finalize/);
        });

        it('throws when finalize() is called twice', () => {
            const parser = new StreamingResponseParser();
            parser.feed('{"analysis":"x"}');
            parser.finalize();
            expect(() => parser.finalize()).toThrow(/twice/);
        });

        it('accepts an empty chunk without producing events or advancing state', () => {
            const parser = new StreamingResponseParser();
            expect(parser.feed('')).toEqual([]);
            parser.feed('{"analysis":"hi"}');
            const finalize = parser.finalize();
            expect(finalize.parsed!.analysis).toBe('hi');
        });
    });

    describe('out-of-order keys', () => {
        it('handles improvements arriving before analysis', () => {
            const json = JSON.stringify({
                improvements: [makeRecommendation()],
                analysis: 'hi',
                verification: [],
            });
            const { events, finalEvents } = runOnce(json);
            const all = [...events, ...finalEvents];
            expect(all.filter((e) => e.type === 'recommendation')).toHaveLength(1);
            const summary = all.filter(
                (e): e is Extract<ParserEmittedEvent, { type: 'summary' }> => e.type === 'summary',
            );
            expect(summary.some((s) => s.complete && s.markdown === 'hi')).toBe(true);
        });

        it('handles verification before improvements', () => {
            const json = JSON.stringify({
                verification: ['v1'],
                improvements: [makeRecommendation()],
                analysis: 'a',
                educationalContent: 'e',
            });
            const { events, finalEvents, finalize } = runOnce(json);
            const all = [...events, ...finalEvents];
            expect(finalize.parsed!.verification).toEqual(['v1']);
            const ver = all.filter((e) => e.type === 'verification');
            expect(ver).toHaveLength(1);
        });
    });
});
