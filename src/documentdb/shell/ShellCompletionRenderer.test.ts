/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type CompletionCandidate } from './ShellCompletionProvider';
import { findCommonPrefix, renderCompletionList } from './ShellCompletionRenderer';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeCandidate(label: string): CompletionCandidate {
    return { label, insertText: label, kind: 'collection' };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('ShellCompletionRenderer', () => {
    describe('renderCompletionList', () => {
        it('should return empty string for no candidates', () => {
            expect(renderCompletionList([], 80)).toBe('');
        });

        it('should return empty string for single candidate', () => {
            expect(renderCompletionList([makeCandidate('users')], 80)).toBe('');
        });

        it('should render two candidates on one line', () => {
            const candidates = [makeCandidate('users'), makeCandidate('orders')];
            const output = renderCompletionList(candidates, 80);
            expect(output).toContain('users');
            expect(output).toContain('orders');
        });

        it('should use gray ANSI codes', () => {
            const candidates = [makeCandidate('a'), makeCandidate('b')];
            const output = renderCompletionList(candidates, 80);
            expect(output).toContain('\x1b[90m');
            expect(output).toContain('\x1b[0m');
        });

        it('should wrap to multiple rows when needed', () => {
            const candidates = Array.from({ length: 20 }, (_, i) => makeCandidate(`item${String(i)}`));
            const output = renderCompletionList(candidates, 40);
            // Should have multiple \r\n line breaks
            const lineBreaks = (output.match(/\r\n/g) ?? []).length;
            expect(lineBreaks).toBeGreaterThan(1);
        });

        it('should truncate long lists', () => {
            const candidates = Array.from({ length: 100 }, (_, i) => makeCandidate(`collection${String(i)}`));
            const output = renderCompletionList(candidates, 80);
            expect(output).toContain('\u2026and');
            expect(output).toContain('more');
        });

        it('should respect terminal width', () => {
            const candidates = [makeCandidate('shortname'), makeCandidate('anothername')];
            // With a very narrow terminal, should still render
            const output = renderCompletionList(candidates, 20);
            expect(output).toContain('shortname');
            expect(output).toContain('anothername');
        });
    });

    describe('findCommonPrefix', () => {
        it('should return empty for empty candidates', () => {
            expect(findCommonPrefix([], 'prefix')).toBe('');
        });

        it('should return remaining text for single candidate', () => {
            const candidates = [makeCandidate('restaurants')];
            expect(findCommonPrefix(candidates, 'res')).toBe('taurants');
        });

        it('should find common prefix among multiple candidates', () => {
            const candidates = [makeCandidate('updateOne'), makeCandidate('updateMany')];
            expect(findCommonPrefix(candidates, 'up')).toBe('date');
        });

        it('should return empty when prefix matches all common text', () => {
            const candidates = [makeCandidate('find'), makeCandidate('findOne')];
            expect(findCommonPrefix(candidates, 'find')).toBe('');
        });

        it('should handle case-insensitive matching', () => {
            const candidates = [makeCandidate('Users'), makeCandidate('uploads')];
            // Common prefix (case-insensitive) is 'U', so with empty typed prefix
            // we get the first char 'U' from the first candidate
            expect(findCommonPrefix(candidates, '')).toBe('U');
        });

        it('should return empty when no additional common prefix exists', () => {
            const candidates = [makeCandidate('alpha'), makeCandidate('beta')];
            expect(findCommonPrefix(candidates, '')).toBe('');
        });
    });
});
