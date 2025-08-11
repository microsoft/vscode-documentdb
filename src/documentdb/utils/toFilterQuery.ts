/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EJSON } from 'bson';
import { UUID, type Document, type Filter } from 'mongodb';

export function toFilterQueryObj(queryString: string): Filter<Document> {
    try {
        // Convert pseudo-JavaScript style BSON constructor calls into Extended JSON that EJSON can parse.
        // Example:  { "id": UUID("...") }  ->  { "id": {"$uuid":"..."} }
        const extendedJsonQuery = convertToExtendedJson(queryString);
        // EJSON.parse will turn Extended JSON into native BSON/JS types (UUID, Date, etc.).
        return EJSON.parse(extendedJsonQuery) as Filter<Document>;
    } catch (error) {
        // Swallow parsing issues and fall back to empty filter (safe default for callers).
        console.error('Error parsing filter query', error);
        return {};
    }
}

/**
 * Walks the raw query text and rewrites BSON-like constructor calls (UUID, MinKey, MaxKey, Date)
 * into MongoDB Extended JSON fragments while deliberately skipping anything that appears inside
 * string literals (so user text containing e.g. "UUID(" is not transformed).
 *
 * This is intentionally lightweight and avoids a full JS / JSON parser to keep latency low inside
 * the query input UX. Future improvements may replace this with a tokenizer / parser for richer
 * validation and diagnostics.
 */
function convertToExtendedJson(query: string): string {
    // Phase 1: Precompute which character positions are inside a (single or double quoted) string.
    // This lets the replacement pass stay simple and branchless for non‑string regions.
    const isInString = markStringLiterals(query);

    // Phase 2: Scan + rewrite BSON-like calls only when not inside a string literal.
    let result = '';
    let i = 0;
    while (i < query.length) {
        if (isInString[i]) {
            // Inside a user string literal – copy verbatim.
            result += query[i];
            i += 1;
            continue;
        }

        const remaining = query.slice(i);

        // UUID(...)
        const uuidMatch = matchUUID(remaining);
        if (uuidMatch) {
            const { raw, uuidString } = uuidMatch;
            try {
                // Validate early so we fail fast instead of producing malformed Extended JSON.
                // (Instantiation is enough to validate format.)
                new UUID(uuidString);
            } catch {
                throw new Error(`Invalid UUID: ${uuidString}`);
            }
            result += `{"$uuid":"${uuidString}"}`;
            i += raw.length;
            continue;
        }

        // MinKey()
        const minKeyMatch = matchMinKey(remaining);
        if (minKeyMatch) {
            result += '{"$minKey":1}';
            i += minKeyMatch.raw.length;
            continue;
        }

        // MaxKey()
        const maxKeyMatch = matchMaxKey(remaining);
        if (maxKeyMatch) {
            result += '{"$maxKey":1}';
            i += maxKeyMatch.raw.length;
            continue;
        }

        // Date("...")
        const dateMatch = matchDate(remaining);
        if (dateMatch) {
            const { raw, dateString } = dateMatch;
            const date = new Date(dateString);
            if (Number.isNaN(date.getTime())) {
                throw new Error(`Invalid date: ${dateString}`);
            }
            result += `{"$date":"${dateString}"}`;
            i += raw.length;
            continue;
        }

        // Fallback: copy one character.
        result += query[i];
        i += 1;
    }

    return result;
}

/**
 * markStringLiterals
 *
 * Lightweight pass to flag which character indices are inside a quoted string.
 *
 * Supported:
 *   - Single quotes '...'
 *   - Double quotes "..."
 *   - Escapes inside those strings via backslash (\" or \')
 *
 * Not a full JSON validator:
 *   - Does not detect malformed / unclosed strings (those will just mark to end)
 *   - Does not handle template literals (not valid JSON anyway)
 *
 * Rationale:
 *   This is intentionally simple and fast. It exists to prevent accidental rewriting of text
 *   inside user-provided string values (e.g. "note: call UUID('x') later") while we still accept
 *   a relaxed JSON-ish syntax for convenience. If the query authoring experience is expanded
 *   (linting, richer autocomplete, tolerant recovery) we can replace this with a proper tokenizer.
 */
function markStringLiterals(input: string): boolean[] {
    const isInString: boolean[] = new Array(input.length).fill(false) as boolean[];
    let inString = false;
    let currentQuote: '"' | "'" | null = null;
    let escapeNext = false;

    for (let i = 0; i < input.length; i++) {
        const ch = input[i];

        if (escapeNext) {
            // Current char is escaped; treat it as plain content inside the string.
            isInString[i] = inString;
            escapeNext = false;
            continue;
        }

        if (inString) {
            // Inside a string: mark and handle escapes / termination.
            isInString[i] = true;
            if (ch === '\\') {
                escapeNext = true;
            } else if (ch === currentQuote) {
                inString = false;
                currentQuote = null;
            }
            continue;
        }

        // Not currently in a string – only a quote can start one.
        if (ch === '"' || ch === "'") {
            inString = true;
            currentQuote = ch as '"' | "'";
            isInString[i] = true;
            continue;
        }

        // Outside of strings.
        isInString[i] = false;
    }

    return isInString;
}

// --- Pattern match helpers (anchored at start of provided substring) ---
const UUID_REGEX = /^(?:new\s+)?uuid\s*\(\s*["']([^"']+)["']\s*\)/i;
const MIN_KEY_REGEX = /^(?:new\s+)?minkey\s*\(\s*\)/i;
const MAX_KEY_REGEX = /^(?:new\s+)?maxkey\s*\(\s*\)/i;
const DATE_REGEX = /^(?:new\s+)?date\s*\(\s*["']([^"']+)["']\s*\)/i;

function matchUUID(src: string): { raw: string; uuidString: string } | undefined {
    const m = UUID_REGEX.exec(src);
    return m ? { raw: m[0], uuidString: m[1] } : undefined;
}
function matchMinKey(src: string): { raw: string } | undefined {
    const m = MIN_KEY_REGEX.exec(src);
    return m ? { raw: m[0] } : undefined;
}
function matchMaxKey(src: string): { raw: string } | undefined {
    const m = MAX_KEY_REGEX.exec(src);
    return m ? { raw: m[0] } : undefined;
}
function matchDate(src: string): { raw: string; dateString: string } | undefined {
    const m = DATE_REGEX.exec(src);
    return m ? { raw: m[0], dateString: m[1] } : undefined;
}
