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

        it('should write dim ANSI without assigning a color', () => {
            ghostText.show('hello', write);
            expect(written).toContain('\x1b[2mhello');
            expect(written).not.toContain('\x1b[90m');
            expect(written).toContain('hello');
            expect(written).toContain('\x1b[0m');
        });

        it('should omit decorative ANSI when color is disabled', () => {
            ghostText = new ShellGhostText(() => false);

            ghostText.show('hello', write);

            expect(written).toContain('hello');
            expect(written).not.toContain('\x1b[2m');
            expect(written).not.toContain('\x1b[0m');
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

    describe('width clipping', () => {
        /** Display width of the text between the dim-style prefix and the reset. */
        const renderedWidth = (data: string): number => {
            const match = /\x1b\[2m(.*?)\x1b\[0m/s.exec(data);
            return match ? [...match[1]].length : 0;
        };

        it('should render in full when the text fits', () => {
            ghostText.show('abcde', write, 10);
            expect(written).toContain('\x1b[2mabcde\x1b[0m');
            expect(written).toContain('\x1b[5D');
        });

        it('should clip to the available columns and mark the truncation', () => {
            ghostText.show('abcdefghij', write, 5);
            expect(written).toContain('\x1b[2mabcd…\x1b[0m');
            expect(written).toContain('\x1b[5D');
        });

        it('should never render wider than the available columns', () => {
            for (const available of [1, 2, 3, 7, 12, 40]) {
                written = '';
                ghostText.reset();
                ghostText.show('  🛈 Run db.vector_index_debug_cases.find() first', write, available);
                expect(renderedWidth(written)).toBeLessThanOrEqual(available);
            }
        });

        it('should move the cursor back exactly as far as it wrote', () => {
            ghostText.show('  🛈 Run db.vector_index_debug_cases.find() first', write, 12);
            const back = /\x1b\[(\d+)D/.exec(written);
            expect(back).not.toBeNull();
            expect(Number(back?.[1])).toBe(renderedWidth(written));
        });

        it('should not render at all when no columns are available', () => {
            ghostText.show('suggestion', write, 0);
            expect(ghostText.isVisible).toBe(false);
            expect(written).toBe('');
        });

        it('should not render at all when the row is already overflowing', () => {
            ghostText.show('suggestion', write, -3);
            expect(ghostText.isVisible).toBe(false);
            expect(written).toBe('');
        });

        it('should keep the full text available for acceptance when clipped', () => {
            ghostText.show('completion', write, 4);
            expect(ghostText.currentText).toBe('completion');
        });

        it('should re-render when the available width changes', () => {
            ghostText.show('completion', write, 4);
            written = '';
            ghostText.show('completion', write, 20);
            expect(written).toContain('\x1b[2mcompletion\x1b[0m');
        });

        it('should not split a surrogate pair when clipping', () => {
            // Clipping at 2 columns leaves room for 1 column + the ellipsis.
            ghostText.show('a🛈bcdef', write, 3);
            const match = /\x1b\[2m(.*?)\x1b\[0m/s.exec(written);
            expect(match?.[1]).toBe('a🛈…');
            expect(written).toContain('\x1b[3D');
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
