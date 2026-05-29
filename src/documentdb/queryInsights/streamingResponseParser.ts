/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Tolerant incremental JSON parser for the Stage 3 AI optimization
 * response. Consumes fragments of the response as they arrive from the
 * language model and emits structured `QueryInsightsStreamEvent`s without
 * waiting for the response to complete.
 *
 * Design (per plan §3 / WI-7):
 *  - The parser is **pure** (no `vscode` / Node API surface) so it can
 *    run in either webview or host contexts and is trivially testable.
 *  - It does **not** replace `JSON.parse`: on stream end ({@link
 *    StreamingResponseParser.finalize}) the parser runs a full
 *    `JSON.parse` of the accumulated buffer and returns the canonical
 *    result alongside any trailing structured events. The streaming
 *    events are a best-effort progressive view; the reconciled
 *    `parsed` object is the source of truth (so callers cannot regress
 *    vs. the buffered path).
 *  - Field-level string values for the two markdown keys (`analysis`,
 *    `educationalContent`) are decoded incrementally and emitted as
 *    cumulative markdown at paragraph boundaries (`\n\n`), with
 *    `complete: false` until the value's closing `"` is observed (then
 *    one final `complete: true` event).
 *  - The `improvements[]` array is scanned by tracking brace depth with
 *    a string-aware tokenizer; each item open emits
 *    `recommendationStarted`, and each item close emits a fully-parsed
 *    `recommendation` event (the item's substring is re-parsed via
 *    `JSON.parse`; if that fails, the item is silently skipped and the
 *    reconciled `parsed.improvements` will still contain it).
 *  - The `verification` items are **not** extracted streaming-side;
 *    they are emitted once on `finalize()` from the reconciled
 *    `JSON.parse`. This avoids any risk of partial-string truncation
 *    mid-stream and keeps the parser's scanner-state-machine focused.
 *  - Top-level keys not in our known set (e.g. unexpected model
 *    metadata) are skip-consumed without emitting events.
 *
 * Expected input shape — the LLM produces a single JSON object with
 * (typically) the keys in this order: `educationalContent`, `analysis`,
 * `improvements`, `verification`. The parser does not require any
 * particular key order; it works for any permutation.
 */

import { type AIIndexRecommendation, type AIOptimizationResponse } from '../../services/ai/types';
import { type QueryInsightsStreamEvent } from '../../webviews/documentdb/collectionView/types/queryInsightsStream';

/**
 * Subset of {@link QueryInsightsStreamEvent}s that
 * {@link StreamingResponseParser} ever emits. The parser owns the JSON
 * structure; the surrounding subscription wrapper owns `status`,
 * `complete`, and the WI-5 transitional `result` event.
 */
export type ParserEmittedEvent = Extract<
    QueryInsightsStreamEvent,
    { type: 'summary' | 'educational' | 'recommendationStarted' | 'recommendation' | 'verification' }
>;

/** Result of {@link StreamingResponseParser.finalize}. */
export interface ParserFinalizeResult {
    /**
     * Trailing structured events not yet flushed by {@link
     * StreamingResponseParser.feed}. Always includes a `verification`
     * event when `parsed` is non-null and `parsed.verification` is
     * non-empty. May include a final `summary` / `educational` with
     * `complete: true` if the corresponding string value was still open
     * when the stream ended (truncation tolerance).
     */
    events: ParserEmittedEvent[];
    /**
     * Canonical view of the response, obtained via `JSON.parse` on the
     * accumulated buffer. `null` iff `JSON.parse` failed (typically due
     * to a truncated / malformed stream); see {@link parseError}.
     */
    parsed: AIOptimizationResponse | null;
    /** Set iff {@link parsed} is `null`. */
    parseError?: Error;
}

const TOP_LEVEL_STRING_KEYS = new Set(['analysis', 'educationalContent']);

/**
 * Incremental JSON parser for the Stage 3 AI optimization response.
 *
 * Usage:
 * ```ts
 * const parser = new StreamingResponseParser();
 * for await (const fragment of stream) {
 *   for (const event of parser.feed(fragment)) {
 *     yield event;
 *   }
 * }
 * const final = parser.finalize();
 * for (const event of final.events) yield event;
 * if (final.parsed) { /* reconciled view *\/ }
 * ```
 */
export class StreamingResponseParser {
    private buffer = '';
    private pos = 0;
    private finalized = false;

    // ------------------------------------------------------------------
    // Top-level scanner state machine
    // ------------------------------------------------------------------
    //
    //   'init'           — before the root '{'; skipping whitespace.
    //   'objectBetween'  — at root level, between members or right after '{'.
    //   'inKey'          — reading the chars of a top-level key string.
    //   'afterKey'       — key closed, expecting ':'.
    //   'beforeValue'    — ':' consumed, expecting the value's first char.
    //   'inStringValue'  — reading a top-level string value (analysis /
    //                       educationalContent, or an unknown string).
    //   'inArrayValue'   — reading a top-level array value (improvements /
    //                       verification, or an unknown array).
    //   'inSkipValue'    — consuming a top-level value we don't care about
    //                       (primitive / nested object / unknown array).
    //   'done'           — root '}' consumed.
    private state:
        | 'init'
        | 'objectBetween'
        | 'inKey'
        | 'afterKey'
        | 'beforeValue'
        | 'inStringValue'
        | 'inArrayValue'
        | 'inSkipValue'
        | 'done' = 'init';

    // Key being read / just finished.
    private keyBuf = '';
    private keyEscape: 'none' | 'pending' | 'unicode' = 'none';
    private keyUnicodeBuf = '';
    private currentKey: string | null = null;

    // Top-level string value being decoded.
    private valueBuf = '';
    private valueEscape: 'none' | 'pending' | 'unicode' = 'none';
    private valueUnicodeBuf = '';
    /**
     * Length of `valueBuf` at the time of the most recent progressive
     * emission. Used to suppress empty / duplicate paragraph emissions.
     */
    private lastEmittedLen = 0;
    /**
     * Tracks whether the current top-level string value is one we report
     * progressively. Set when we enter `inStringValue` based on
     * `currentKey`; we still consume unknown string values but emit no
     * events for them.
     */
    private valueIsReported = false;

    // Top-level array value tokenizer state.
    private arrayInString = false;
    private arrayEscape = false;
    /**
     * Brace depth WITHIN the array (counts `{` and `}` only, not `[`
     * and `]`, because for `improvements` we treat each item as a
     * top-level object inside the array). When `arrayItemDepth > 0` we
     * are inside a (potentially nested) object; the item ends when
     * `arrayItemDepth` returns to 0.
     */
    private arrayItemDepth = 0;
    /**
     * Position in `this.buffer` of the `{` that opened the current
     * improvement item (so we can JSON.parse the slice on close).
     */
    private currentImprovementStart = -1;
    private nextImprovementIndex = 0;
    /**
     * True while reading an array value whose key is `improvements` —
     * the only array we extract per-item events for.
     */
    private arrayIsImprovements = false;

    // 'inSkipValue' tokenizer state (depth + string-aware).
    private skipDepth = 0;
    private skipInString = false;
    private skipEscape = false;

    /**
     * Feed the next fragment of the response to the parser. Returns any
     * structured events triggered by chars in this fragment, in order.
     */
    public feed(chunk: string): ParserEmittedEvent[] {
        if (this.finalized) {
            throw new Error('StreamingResponseParser: feed() called after finalize()');
        }
        if (chunk.length === 0) {
            return [];
        }
        this.buffer += chunk;
        const events: ParserEmittedEvent[] = [];
        while (this.pos < this.buffer.length && this.state !== 'done') {
            this.processChar(this.buffer.charAt(this.pos), events);
            this.pos++;
        }
        return events;
    }

    /**
     * Signal that no more chunks will arrive. Runs the canonical
     * `JSON.parse` on the buffer and returns any trailing structured
     * events (final `summary` / `educational` flushes for truncated
     * values, plus a `verification` event from the reconciled items).
     */
    public finalize(): ParserFinalizeResult {
        if (this.finalized) {
            throw new Error('StreamingResponseParser: finalize() called twice');
        }
        this.finalized = true;

        const trailing: ParserEmittedEvent[] = [];

        // If the stream ended mid-string-value, emit a final `complete: true`
        // event with whatever decoded content we have, so the UI doesn't sit
        // forever on a shimmering placeholder.
        if (this.state === 'inStringValue' && this.valueIsReported && this.currentKey !== null) {
            this.flushStringValueComplete(trailing);
        }

        // Canonical reconciliation.
        let parsed: AIOptimizationResponse | null = null;
        let parseError: Error | undefined;
        const raw = this.buffer.trim();
        if (raw.length === 0) {
            parseError = new Error('StreamingResponseParser: empty buffer');
        } else {
            try {
                const obj = JSON.parse(raw) as Partial<AIOptimizationResponse> & {
                    improvements?: AIIndexRecommendation[];
                    verification?: string[];
                };
                parsed = {
                    analysis: obj.analysis ?? 'No analysis provided.',
                    improvements: obj.improvements ?? [],
                    verification: obj.verification ?? [],
                    educationalContent: obj.educationalContent,
                };
            } catch (error) {
                parseError = error instanceof Error ? error : new Error(String(error));
            }
        }

        // Emit `verification` from the reconciled object (never from the
        // streaming scan — see the class-level doc comment).
        if (parsed && parsed.verification.length > 0) {
            trailing.push({ type: 'verification', items: parsed.verification });
        }

        return { events: trailing, parsed, parseError };
    }

    // ------------------------------------------------------------------
    // Internal: per-char dispatch
    // ------------------------------------------------------------------

    private processChar(ch: string, events: ParserEmittedEvent[]): void {
        switch (this.state) {
            case 'init':
                this.handleInit(ch);
                return;
            case 'objectBetween':
                this.handleObjectBetween(ch);
                return;
            case 'inKey':
                this.handleKeyChar(ch);
                return;
            case 'afterKey':
                this.handleAfterKey(ch);
                return;
            case 'beforeValue':
                this.handleBeforeValue(ch);
                return;
            case 'inStringValue':
                this.handleStringValueChar(ch, events);
                return;
            case 'inArrayValue':
                this.handleArrayValueChar(ch, events);
                return;
            case 'inSkipValue':
                this.handleSkipValueChar(ch);
                return;
            case 'done':
                return;
        }
    }

    private handleInit(ch: string): void {
        if (isWhitespace(ch)) return;
        if (ch === '{') {
            this.state = 'objectBetween';
            return;
        }
        // Malformed prefix — keep skipping until we see '{' or the buffer
        // ends. finalize()'s JSON.parse will surface the real error.
    }

    private handleObjectBetween(ch: string): void {
        if (isWhitespace(ch) || ch === ',') return;
        if (ch === '"') {
            this.state = 'inKey';
            this.keyBuf = '';
            this.keyEscape = 'none';
            this.keyUnicodeBuf = '';
            return;
        }
        if (ch === '}') {
            this.state = 'done';
            return;
        }
        // Anything else here is malformed — ignore; finalize() will fail.
    }

    private handleKeyChar(ch: string): void {
        if (this.keyEscape === 'pending') {
            if (ch === 'u') {
                this.keyEscape = 'unicode';
                this.keyUnicodeBuf = '';
                return;
            }
            this.keyBuf += decodeSimpleEscape(ch);
            this.keyEscape = 'none';
            return;
        }
        if (this.keyEscape === 'unicode') {
            this.keyUnicodeBuf += ch;
            if (this.keyUnicodeBuf.length === 4) {
                this.keyBuf += decodeUnicodeEscape(this.keyUnicodeBuf);
                this.keyUnicodeBuf = '';
                this.keyEscape = 'none';
            }
            return;
        }
        if (ch === '\\') {
            this.keyEscape = 'pending';
            return;
        }
        if (ch === '"') {
            this.currentKey = this.keyBuf;
            this.state = 'afterKey';
            return;
        }
        this.keyBuf += ch;
    }

    private handleAfterKey(ch: string): void {
        if (isWhitespace(ch)) return;
        if (ch === ':') {
            this.state = 'beforeValue';
        }
    }

    private handleBeforeValue(ch: string): void {
        if (isWhitespace(ch)) return;
        if (ch === '"') {
            this.state = 'inStringValue';
            this.valueBuf = '';
            this.valueEscape = 'none';
            this.valueUnicodeBuf = '';
            this.lastEmittedLen = 0;
            this.valueIsReported = this.currentKey !== null && TOP_LEVEL_STRING_KEYS.has(this.currentKey);
            return;
        }
        if (ch === '[') {
            this.state = 'inArrayValue';
            this.arrayInString = false;
            this.arrayEscape = false;
            this.arrayItemDepth = 0;
            this.currentImprovementStart = -1;
            this.arrayIsImprovements = this.currentKey === 'improvements';
            // Note: TOP_LEVEL_ARRAY_KEYS includes 'verification' too; for that
            // we still scan the array (so we know when it closes) but emit
            // nothing — verification items are sourced from finalize().
            return;
        }
        if (ch === '{') {
            // Nested object value — not part of our schema; skip-consume.
            this.state = 'inSkipValue';
            this.skipDepth = 1;
            this.skipInString = false;
            this.skipEscape = false;
            return;
        }
        // Primitive (number / true / false / null) — consume until value boundary.
        this.state = 'inSkipValue';
        this.skipDepth = 0;
        this.skipInString = false;
        this.skipEscape = false;
        // The first char of the primitive doesn't need any per-char action;
        // boundary detection (',', '}', whitespace at depth 0) is in
        // handleSkipValueChar.
    }

    private handleStringValueChar(ch: string, events: ParserEmittedEvent[]): void {
        if (this.valueEscape === 'pending') {
            if (ch === 'u') {
                this.valueEscape = 'unicode';
                this.valueUnicodeBuf = '';
                return;
            }
            this.valueBuf += decodeSimpleEscape(ch);
            this.valueEscape = 'none';
            this.maybeEmitProgressive(events);
            return;
        }
        if (this.valueEscape === 'unicode') {
            this.valueUnicodeBuf += ch;
            if (this.valueUnicodeBuf.length === 4) {
                this.valueBuf += decodeUnicodeEscape(this.valueUnicodeBuf);
                this.valueUnicodeBuf = '';
                this.valueEscape = 'none';
                this.maybeEmitProgressive(events);
            }
            return;
        }
        if (ch === '\\') {
            this.valueEscape = 'pending';
            return;
        }
        if (ch === '"') {
            // String value closed — emit final `complete: true`.
            this.flushStringValueComplete(events);
            this.currentKey = null;
            this.state = 'objectBetween';
            return;
        }
        this.valueBuf += ch;
        this.maybeEmitProgressive(events);
    }

    private maybeEmitProgressive(events: ParserEmittedEvent[]): void {
        if (!this.valueIsReported) return;
        // Emit at line boundaries when there's new content to publish.
        // The trigger is "the most recent decoded char is a `\n`", which
        // fires once per newline in the cumulative markdown value (so
        // each list item / heading / blank-line break shows up as its
        // own progressive event). The previous `\n\n` (paragraph-only)
        // trigger emitted at most once per several hundred chars
        // because the LLM's chunking spans many lines per fragment;
        // the per-`\n` trigger raises the granularity by roughly 5×
        // for our observed Stage 3 output without changing the
        // markdown shape (cumulative + complete:false until the
        // value's closing `"`).
        const len = this.valueBuf.length;
        if (len < 1) return;
        if (this.valueBuf.charAt(len - 1) !== '\n') {
            return;
        }
        if (len === this.lastEmittedLen) return;
        this.lastEmittedLen = len;
        this.emitProgressiveString(this.valueBuf, false, events);
    }

    private flushStringValueComplete(events: ParserEmittedEvent[]): void {
        if (!this.valueIsReported) return;
        this.emitProgressiveString(this.valueBuf, true, events);
    }

    private emitProgressiveString(markdown: string, complete: boolean, events: ParserEmittedEvent[]): void {
        if (this.currentKey === 'analysis') {
            events.push({ type: 'summary', markdown, complete });
        } else if (this.currentKey === 'educationalContent') {
            events.push({ type: 'educational', markdown, complete });
        }
    }

    private handleArrayValueChar(ch: string, events: ParserEmittedEvent[]): void {
        if (this.arrayInString) {
            if (this.arrayEscape) {
                this.arrayEscape = false;
                return;
            }
            if (ch === '\\') {
                this.arrayEscape = true;
                return;
            }
            if (ch === '"') {
                this.arrayInString = false;
            }
            return;
        }
        if (ch === '"') {
            this.arrayInString = true;
            this.arrayEscape = false;
            return;
        }
        if (ch === '{') {
            if (this.arrayItemDepth === 0 && this.arrayIsImprovements) {
                this.currentImprovementStart = this.pos;
                events.push({ type: 'recommendationStarted', index: this.nextImprovementIndex });
            }
            this.arrayItemDepth++;
            return;
        }
        if (ch === '}') {
            this.arrayItemDepth--;
            if (this.arrayItemDepth === 0 && this.arrayIsImprovements) {
                this.tryEmitRecommendation(events);
                this.nextImprovementIndex++;
                this.currentImprovementStart = -1;
            }
            return;
        }
        if (ch === ']' && this.arrayItemDepth === 0) {
            // Array closed — back to top level.
            this.arrayIsImprovements = false;
            this.currentImprovementStart = -1;
            this.currentKey = null;
            this.state = 'objectBetween';
            return;
        }
        // Other chars (commas, whitespace, primitive contents inside the
        // array, '[' / ']' for nested arrays) — ignore. Brace depth above
        // is all we need to detect item boundaries for the improvements
        // case; nested `[` / `]` inside an item are harmless since they
        // don't affect arrayItemDepth.
    }

    private tryEmitRecommendation(events: ParserEmittedEvent[]): void {
        if (this.currentImprovementStart < 0) return;
        const slice = this.buffer.slice(this.currentImprovementStart, this.pos + 1);
        try {
            const item = JSON.parse(slice) as AIIndexRecommendation;
            events.push({
                type: 'recommendation',
                index: this.nextImprovementIndex,
                recommendation: item,
            });
        } catch {
            // Best-effort: swallow the parse error. finalize()'s full
            // JSON.parse over the buffer is the canonical source; the
            // item will appear there if the response is well-formed
            // overall. Emitting nothing here means the UI shell stays
            // empty (or gets filled from the reconciled result in WI-8).
        }
    }

    private handleSkipValueChar(ch: string): void {
        if (this.skipInString) {
            if (this.skipEscape) {
                this.skipEscape = false;
                return;
            }
            if (ch === '\\') {
                this.skipEscape = true;
                return;
            }
            if (ch === '"') {
                this.skipInString = false;
            }
            return;
        }
        if (ch === '"') {
            this.skipInString = true;
            this.skipEscape = false;
            return;
        }
        if (ch === '{' || ch === '[') {
            this.skipDepth++;
            return;
        }
        if (ch === '}' || ch === ']') {
            if (this.skipDepth === 0) {
                // We were consuming a primitive at depth 0 and just hit
                // the enclosing object's '}' — that means the primitive
                // value boundary was reached AND the root object closed.
                this.state = 'done';
                return;
            }
            this.skipDepth--;
            if (this.skipDepth === 0) {
                // Nested object / array fully consumed — back to top.
                this.currentKey = null;
                this.state = 'objectBetween';
            }
            return;
        }
        if ((ch === ',' || isWhitespace(ch)) && this.skipDepth === 0) {
            // Primitive value boundary — back to top.
            this.currentKey = null;
            this.state = 'objectBetween';
            // ',' itself is consumed; whitespace too. objectBetween will
            // re-handle subsequent chars.
            return;
        }
        // Any other char inside a primitive / nested struct — ignore.
    }
}

// ----------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------

function isWhitespace(ch: string): boolean {
    return ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t';
}

function decodeSimpleEscape(ch: string): string {
    switch (ch) {
        case '"':
            return '"';
        case '\\':
            return '\\';
        case '/':
            return '/';
        case 'b':
            return '\b';
        case 'f':
            return '\f';
        case 'n':
            return '\n';
        case 'r':
            return '\r';
        case 't':
            return '\t';
        default:
            // Tolerant: surface the raw char rather than throwing.
            // finalize()'s JSON.parse would reject this anyway.
            return ch;
    }
}

function decodeUnicodeEscape(hex4: string): string {
    const code = parseInt(hex4, 16);
    if (Number.isNaN(code)) {
        return '\uFFFD';
    }
    return String.fromCharCode(code);
}
