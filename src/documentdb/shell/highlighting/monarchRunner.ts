/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Lightweight Monarch state-machine executor.
 *
 * Runs the tokenizer rules from {@link MonarchLanguageRules} against a plain string
 * and returns an array of token spans. No Monaco or DOM dependency.
 */

import { type MonarchLanguageRules, type MonarchRule } from './monarchRules';

// ─── Public types ────────────────────────────────────────────────────────────

/** A span of text with its token type. */
export interface TokenSpan {
    /** Start offset (inclusive). */
    start: number;
    /** End offset (exclusive). */
    end: number;
    /** The Monarch token type, e.g. "keyword", "string", "bson.constructor". */
    type: string;
}

// ─── Cached previous result ──────────────────────────────────────────────────

let cachedInput: string | undefined;
let cachedResult: TokenSpan[] | undefined;
let cachedRules: MonarchLanguageRules | undefined;

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Tokenize an input string using the Monarch state machine.
 *
 * @param input - The string to tokenize (typically one line of shell input).
 * @param rules - The Monarch language rules to apply.
 * @returns An array of token spans covering the entire input.
 */
export function tokenize(input: string, rules: MonarchLanguageRules): TokenSpan[] {
    if (input.length === 0) {
        return [];
    }

    // Memoize: return cached result if input and rules haven't changed (cursor-only movements)
    if (input === cachedInput && rules === cachedRules && cachedResult !== undefined) {
        return cachedResult;
    }

    const result = runTokenizer(input, rules);
    cachedInput = input;
    cachedRules = rules;
    cachedResult = result;
    return result;
}

// ─── State machine ───────────────────────────────────────────────────────────

const MAX_STACK_DEPTH = 32;

function runTokenizer(input: string, rules: MonarchLanguageRules): TokenSpan[] {
    const tokens: TokenSpan[] = [];
    const stateStack: string[] = ['root'];
    let pos = 0;

    while (pos < input.length) {
        const currentState = stateStack[stateStack.length - 1];
        const stateRules = rules.tokenizer[currentState];

        if (!stateRules) {
            // Unknown state — consume one character as invalid
            tokens.push({ start: pos, end: pos + 1, type: 'invalid' });
            pos++;
            continue;
        }

        const matched = tryMatchRules(input, pos, stateRules, stateStack, rules, tokens);

        if (!matched) {
            // No rule matched — consume one character as invalid to prevent infinite loops
            tokens.push({ start: pos, end: pos + 1, type: 'invalid' });
            pos++;
        } else {
            pos = matched;
        }
    }

    return mergeAdjacentTokens(tokens);
}

/**
 * Try each rule in the given state's rule list. If a rule matches, emit tokens
 * and return the new position. If no rule matches, return 0.
 */
function tryMatchRules(
    input: string,
    pos: number,
    stateRules: MonarchRule[],
    stateStack: string[],
    rules: MonarchLanguageRules,
    tokens: TokenSpan[],
): number {
    for (const rule of stateRules) {
        // Handle include directives
        if ('include' in rule) {
            const includedStateName = rule.include.startsWith('@') ? rule.include.slice(1) : rule.include;
            const includedRules = rules.tokenizer[includedStateName];
            if (includedRules) {
                const result = tryMatchRules(input, pos, includedRules, stateStack, rules, tokens);
                if (result > 0) {
                    return result;
                }
            }
            continue;
        }

        // Try to match the rule's regex at the current position
        const regex = anchorRegex(rule.regex);
        regex.lastIndex = pos;
        const match = regex.exec(input);

        if (!match || match.index !== pos) {
            continue;
        }

        const matchedText = match[0];

        // Zero-length match — skip to prevent infinite loops
        if (matchedText.length === 0) {
            continue;
        }

        // Determine token type(s) and state transition
        if ('actionByGroup' in rule) {
            // Group-based action: one token type per capture group
            emitGroupTokens(match, pos, rule.actionByGroup, tokens);
            if (rule.next) {
                applyStateTransition(rule.next, stateStack);
            }
        } else if ('actionCases' in rule) {
            // Case-based action: look up matched text in named arrays
            const tokenType = resolveCases(matchedText, rule.actionCases, rules);
            if (tokenType.length > 0) {
                tokens.push({ start: pos, end: pos + matchedText.length, type: tokenType });
            }
            if (rule.next) {
                applyStateTransition(rule.next, stateStack);
            }
        } else {
            // Simple action: emit a single token
            const tokenType = resolveAction(rule.action);
            if (tokenType.length > 0) {
                tokens.push({ start: pos, end: pos + matchedText.length, type: tokenType });
            }
            if ('next' in rule && rule.next) {
                applyStateTransition(rule.next, stateStack);
            }
        }

        return pos + matchedText.length;
    }

    return 0;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Resolve the `@` prefix in action strings.
 * `@brackets` → `delimiter.bracket`, other `@` prefixes → strip the `@`.
 */
function resolveAction(action: string): string {
    if (action === '@brackets') {
        return 'delimiter.bracket';
    }
    if (action.startsWith('@')) {
        return action.slice(1);
    }
    return action;
}

/**
 * Resolve a `cases` lookup: check if the matched text is in a named array.
 */
function resolveCases(matchedText: string, cases: Record<string, string>, rules: MonarchLanguageRules): string {
    for (const [key, tokenType] of Object.entries(cases)) {
        if (key === '@default') {
            continue;
        }

        // Look up the named array in the rules object
        const arrayName = key.startsWith('@') ? key.slice(1) : key;
        const array = rules[arrayName as keyof MonarchLanguageRules];

        if (Array.isArray(array) && (array as string[]).includes(matchedText)) {
            return resolveAction(tokenType);
        }
    }

    // Fall through to @default
    const defaultType = cases['@default'];
    if (defaultType !== undefined) {
        return resolveAction(defaultType);
    }

    return '';
}

/**
 * Emit one token per capture group from a grouped action rule.
 * Groups are matched positionally: group 1 → actionByGroup[0], etc.
 * If a capture group is empty, no token is emitted for it.
 */
function emitGroupTokens(match: RegExpExecArray, basePos: number, actions: string[], tokens: TokenSpan[]): void {
    let offset = basePos;
    for (let i = 0; i < actions.length; i++) {
        const groupText = match[i + 1]; // capture groups are 1-indexed
        if (groupText === undefined || groupText.length === 0) {
            continue;
        }

        // Find the actual position of this group's text within the match
        const groupStart = inputIndexOf(match[0], groupText, offset - basePos) + basePos;
        const tokenType = resolveAction(actions[i]);
        if (tokenType.length > 0) {
            tokens.push({ start: groupStart, end: groupStart + groupText.length, type: tokenType });
        }
        offset = groupStart + groupText.length;
    }
}

/**
 * Find the index of `needle` in `haystack` starting from `fromIndex`.
 * Used instead of String.indexOf to handle the case where the needle
 * appears multiple times in the full match.
 */
function inputIndexOf(haystack: string, needle: string, fromIndex: number): number {
    const idx = haystack.indexOf(needle, fromIndex);
    return idx >= 0 ? idx : fromIndex;
}

/**
 * Apply a state transition.
 */
function applyStateTransition(next: string, stateStack: string[]): void {
    const stateName = next.startsWith('@') ? next.slice(1) : next;

    if (stateName === 'pop') {
        if (stateStack.length > 1) {
            stateStack.pop();
        }
    } else {
        if (stateStack.length < MAX_STACK_DEPTH) {
            stateStack.push(stateName);
        }
    }
}

// ─── Regex anchoring cache ───────────────────────────────────────────────────

const anchoredRegexCache = new WeakMap<RegExp, RegExp>();

/**
 * Return a sticky (`y`-flag) version of the regex so it only matches
 * at the current `lastIndex` position.
 */
function anchorRegex(regex: RegExp): RegExp {
    let anchored = anchoredRegexCache.get(regex);
    if (!anchored) {
        const flags = regex.flags.includes('y') ? regex.flags : regex.flags + 'y';
        anchored = new RegExp(regex.source, flags);
        anchoredRegexCache.set(regex, anchored);
    }
    return anchored;
}

// ─── Token merging ───────────────────────────────────────────────────────────

/**
 * Merge adjacent tokens of the same type to produce cleaner output.
 * For example, consecutive "comment" tokens from multi-character comment rules
 * become a single span.
 */
function mergeAdjacentTokens(tokens: TokenSpan[]): TokenSpan[] {
    if (tokens.length <= 1) {
        return tokens;
    }

    const merged: TokenSpan[] = [tokens[0]];

    for (let i = 1; i < tokens.length; i++) {
        const prev = merged[merged.length - 1];
        const curr = tokens[i];

        if (curr.type === prev.type && curr.start === prev.end) {
            prev.end = curr.end;
        } else {
            merged.push(curr);
        }
    }

    return merged;
}
