/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ShellGhostText } from './ShellGhostText';

describe('ShellGhostText', () => {
    let ghostText: ShellGhostText;
    let written: string;
    const write = (data: string): void => {
        written += data;
    };

    beforeEach(() => {
        ghostText = new ShellGhostText();
        written = '';
    });

    describe('initial state', () => {
        it('should not be visible initially', () => {
            expect(ghostText.isVisible).toBe(false);
        });

        it('should have empty current text initially', () => {
            expect(ghostText.currentText).toBe('');
        });
    });

    describe('show', () => {
        it('should display ghost text and become visible', () => {
            ghostText.show('aurants', write);
            expect(ghostText.isVisible).toBe(true);
            expect(ghostText.currentText).toBe('aurants');
        });

        it('should write dim gray ANSI codes', () => {
            ghostText.show('hello', write);
            expect(written).toContain('\x1b[2m\x1b[90m');
            expect(written).toContain('hello');
            expect(written).toContain('\x1b[0m');
        });

        it('should move cursor back after ghost text', () => {
            ghostText.show('abc', write);
            // Should contain cursor-left sequence for 3 characters
            expect(written).toContain('\x1b[3D');
        });

        it('should move cursor back by display width, not string length, for surrogate pairs', () => {
            // 🛈 (U+1F6C8) is a surrogate pair: string length = 2, display width = 1
            const hint = '  🛈 hint';
            ghostText.show(hint, write);
            // "  🛈 hint" = 2 spaces + 1 emoji + 1 space + 4 chars = 8 display columns
            expect(written).toContain('\x1b[8D');
            // Must NOT contain the incorrect string-length-based value
            expect(written).not.toContain(`\x1b[9D`);
        });

        it('should clear existing ghost before showing new one', () => {
            ghostText.show('old', write);
            written = '';
            ghostText.show('new', write);
            // Should contain erase-to-end-of-line before new ghost
            expect(written).toContain('\x1b[K');
            expect(written).toContain('new');
        });

        it('should not re-render if same ghost text is already showing', () => {
            ghostText.show('same', write);
            written = '';
            ghostText.show('same', write);
            expect(written).toBe('');
        });

        it('should clear ghost when called with empty text', () => {
            ghostText.show('test', write);
            written = '';
            ghostText.show('', write);
            expect(ghostText.isVisible).toBe(false);
        });
    });

    describe('clear', () => {
        it('should erase ghost text and become not visible', () => {
            ghostText.show('text', write);
            written = '';
            ghostText.clear(write);
            expect(ghostText.isVisible).toBe(false);
            expect(ghostText.currentText).toBe('');
            expect(written).toContain('\x1b[K');
        });

        it('should be no-op if not visible', () => {
            ghostText.clear(write);
            expect(written).toBe('');
        });
    });

    describe('accept', () => {
        it('should return the ghost text', () => {
            ghostText.show('aurants', write);
            written = '';
            const accepted = ghostText.accept(write);
            expect(accepted).toBe('aurants');
        });

        it('should become not visible after accept', () => {
            ghostText.show('text', write);
            ghostText.accept(write);
            expect(ghostText.isVisible).toBe(false);
        });

        it('should write the accepted text in normal color', () => {
            ghostText.show('rest', write);
            written = '';
            ghostText.accept(write);
            // Should erase dim text and write normal
            expect(written).toContain('\x1b[K');
            expect(written).toContain('rest');
        });

        it('should return empty string if not visible', () => {
            const accepted = ghostText.accept(write);
            expect(accepted).toBe('');
        });
    });

    describe('reset', () => {
        it('should clear state without writing to terminal', () => {
            ghostText.show('text', write);
            written = '';
            ghostText.reset();
            expect(ghostText.isVisible).toBe(false);
            expect(ghostText.currentText).toBe('');
            expect(written).toBe('');
        });
    });
});
