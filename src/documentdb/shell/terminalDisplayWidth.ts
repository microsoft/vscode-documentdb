/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Compute the display-column width of a string for the terminal.
 *
 * JavaScript's `String.length` counts UTF-16 code units, but ANSI cursor
 * movement operates on display columns. Surrogate pairs (emoji, symbols
 * above U+FFFF) are 2 code units but typically 1–2 terminal columns.
 *
 * This uses `Intl.Segmenter` (available in Node 16+) to iterate grapheme
 * clusters and counts each one as 1 column unless it is a known
 * full-width/wide character (CJK Unified Ideographs, etc.).
 */
const GRAPHEME_SEGMENTER = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const EMOJI_PRESENTATION_PATTERN = /\p{Emoji_Presentation}/u;

export function terminalDisplayWidth(text: string): number {
    // Fast path: ASCII-only strings (common case)
    if (/^[\x20-\x7e]*$/.test(text)) {
        return text.length;
    }

    let width = 0;
    for (const { segment } of GRAPHEME_SEGMENTER.segment(text)) {
        width += graphemeDisplayWidth(segment);
    }

    return width;
}

/**
 * Truncate `text` so it occupies at most `maxWidth` display columns.
 *
 * Clipping happens on grapheme-cluster boundaries, so surrogate pairs and
 * combining sequences are never split. A wide character that would straddle
 * the limit is dropped entirely rather than half-rendered.
 */
export function clipToDisplayWidth(text: string, maxWidth: number): string {
    if (maxWidth <= 0) {
        return '';
    }

    // Fast path: ASCII-only strings (common case)
    if (/^[\x20-\x7e]*$/.test(text)) {
        return text.length <= maxWidth ? text : text.slice(0, maxWidth);
    }

    let width = 0;
    let result = '';
    for (const { segment } of GRAPHEME_SEGMENTER.segment(text)) {
        const segmentWidth = graphemeDisplayWidth(segment);
        if (width + segmentWidth > maxWidth) {
            break;
        }
        width += segmentWidth;
        result += segment;
    }

    return result;
}

function graphemeDisplayWidth(segment: string): number {
    const codePoint = segment.codePointAt(0) ?? 0;
    const hasEmojiPresentation = EMOJI_PRESENTATION_PATTERN.test(segment) || segment.includes('\ufe0f');
    return isWideCharacter(codePoint) || hasEmojiPresentation ? 2 : 1;
}

/**
 * Returns true for code points that occupy 2 terminal columns.
 * Covers CJK Unified Ideographs and common full-width ranges.
 */
function isWideCharacter(cp: number): boolean {
    return (
        (cp >= 0x1100 && cp <= 0x115f) || // Hangul Jamo
        (cp >= 0x2e80 && cp <= 0x303e) || // CJK Radicals, Kangxi, CJK Symbols
        (cp >= 0x3040 && cp <= 0x33bf) || // Hiragana, Katakana, Bopomofo, etc.
        (cp >= 0x3400 && cp <= 0x4dbf) || // CJK Unified Ideographs Extension A
        (cp >= 0x4e00 && cp <= 0xa4cf) || // CJK Unified Ideographs + Yi
        (cp >= 0xa960 && cp <= 0xa97c) || // Hangul Jamo Extended-A
        (cp >= 0xac00 && cp <= 0xd7a3) || // Hangul Syllables
        (cp >= 0xf900 && cp <= 0xfaff) || // CJK Compatibility Ideographs
        (cp >= 0xfe30 && cp <= 0xfe6f) || // CJK Compatibility Forms
        (cp >= 0xff01 && cp <= 0xff60) || // Fullwidth Forms
        (cp >= 0xffe0 && cp <= 0xffe6) || // Fullwidth Signs
        (cp >= 0x20000 && cp <= 0x2fffd) || // CJK Unified Ideographs Extension B+
        (cp >= 0x30000 && cp <= 0x3fffd) // CJK Unified Ideographs Extension G+
    );
}
