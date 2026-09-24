/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { MONACO_COLOR_IDS } from './core/colorIds';
import { createVSCodeMonacoTheme, DEFAULT_MONACO_THEME_NAME } from './core/createVSCodeMonacoTheme';
import { MONACO_COLOR_FALLBACKS, MONACO_FALLBACK_SOURCES } from './core/fallbackChains';

const setColor = (colorId: string, value: string): void =>
    document.documentElement.style.setProperty(`--vscode-${colorId.replace(/\./g, '-')}`, value);

describe('createVSCodeMonacoTheme', () => {
    afterEach(() => {
        document.documentElement.removeAttribute('style');
        document.body.removeAttribute('data-vscode-theme-kind');
    });

    describe('base theme', () => {
        it.each([
            ['vscode-light', 'vs'],
            ['vscode-dark', 'vs-dark'],
            ['vscode-high-contrast', 'hc-black'],
            ['vscode-high-contrast-light', 'hc-light'],
        ])('%s maps to %s', (themeKind, base) => {
            expect(createVSCodeMonacoTheme({ themeKind }).data.base).toBe(base);
        });

        it('falls back to the light base for an unrecognised kind', () => {
            expect(createVSCodeMonacoTheme({ themeKind: 'vscode-something-new' }).data.base).toBe('vs');
        });

        it('reads the kind off the body when none is given', () => {
            document.body.setAttribute('data-vscode-theme-kind', 'vscode-dark');

            expect(createVSCodeMonacoTheme().data.base).toBe('vs-dark');
        });
    });

    describe('colours', () => {
        it('inherits, so ids it omits keep Monaco defaults', () => {
            expect(createVSCodeMonacoTheme().data.inherit).toBe(true);
        });

        it('reads published ids as hex', () => {
            setColor('editor.background', 'rgb(30, 30, 30)');

            expect(createVSCodeMonacoTheme().data.colors['editor.background']).toBe('#1e1e1e');
        });

        it('omits ids the theme does not publish', () => {
            expect(createVSCodeMonacoTheme().data.colors).not.toHaveProperty(['editor.background']);
        });

        // Passing an unreadable value through would paint that surface red, via Monaco's
        // `parseHex(value) || Color.red`.
        it('omits an id whose value it cannot parse', () => {
            setColor('editorCursor.foreground', 'color-mix(in srgb, red, blue)');

            expect(createVSCodeMonacoTheme().data.colors).not.toHaveProperty(['editorCursor.foreground']);
        });

        // The 421 workbench ids Monaco does not register are inert inside it.
        it('reads only ids Monaco registers', () => {
            setColor('editor.background', '#1e1e1e');
            setColor('activityBar.background', '#333333');
            setColor('titleBar.activeBackground', '#3c3c3c');

            const { colors } = createVSCodeMonacoTheme().data;

            expect(colors).toHaveProperty(['editor.background']);
            expect(colors).not.toHaveProperty(['activityBar.background']);
            expect(colors).not.toHaveProperty(['titleBar.activeBackground']);
        });

        it('does not leak the fallback-only sources into the theme', () => {
            setColor('panel.border', '#454545');

            expect(createVSCodeMonacoTheme().data.colors).not.toHaveProperty(['panel.border']);
        });
    });

    // The unification defect: Fluent maps colorNeutralBackground1Hover through
    // list.hoverBackground -> editorWidget.background -> editor.background, so on a theme that
    // publishes none of the first two a Fluent popover lands on the editor background while a
    // Monaco widget beside it fell back to Monaco's own built-in constant.
    describe('fallback chains', () => {
        it('falls back to the editor background for an unpublished widget surface', () => {
            setColor('editor.background', '#1e1e1e');

            const { colors } = createVSCodeMonacoTheme().data;

            expect(colors['editorWidget.background']).toBe('#1e1e1e');
            expect(colors['editorHoverWidget.background']).toBe('#1e1e1e');
            expect(colors['menu.background']).toBe('#1e1e1e');
        });

        it('prefers the published value over the chain', () => {
            setColor('editor.background', '#1e1e1e');
            setColor('editorWidget.background', '#252526');

            expect(createVSCodeMonacoTheme().data.colors['editorWidget.background']).toBe('#252526');
        });

        it('takes the first published link in the chain', () => {
            setColor('editor.background', '#1e1e1e');
            setColor('editorWidget.background', '#252526');

            expect(createVSCodeMonacoTheme().data.colors['editorHoverWidget.background']).toBe('#252526');
        });

        it('leaves the id to Monaco when the whole chain is unpublished', () => {
            expect(createVSCodeMonacoTheme().data.colors).not.toHaveProperty(['editorWidget.background']);
        });

        it('only chains ids Monaco reads, from sources it can resolve', () => {
            const known = new Set([...MONACO_COLOR_IDS, ...MONACO_FALLBACK_SOURCES]);

            for (const [colorId, chain] of Object.entries(MONACO_COLOR_FALLBACKS)) {
                expect(MONACO_COLOR_IDS).toContain(colorId);
                chain.forEach((source) => expect(known.has(source)).toBe(true));
            }
        });
    });

    describe('options', () => {
        it('names the theme vscode-adaptive by default', () => {
            expect(createVSCodeMonacoTheme().themeName).toBe(DEFAULT_MONACO_THEME_NAME);
        });

        it('takes a caller-supplied name', () => {
            expect(createVSCodeMonacoTheme({ themeName: 'my-theme' }).themeName).toBe('my-theme');
        });

        it('merges caller colours over the derived ones', () => {
            setColor('editor.background', '#1e1e1e');

            const { colors } = createVSCodeMonacoTheme({ colors: { 'editor.background': '#000000' } }).data;

            expect(colors['editor.background']).toBe('#000000');
        });

        it('ships no token rules unless the caller supplies them', () => {
            expect(createVSCodeMonacoTheme().data.rules).toEqual([]);
            expect(createVSCodeMonacoTheme({ rules: [{ token: 'comment', foreground: '6a9955' }] }).data.rules).toEqual(
                [{ token: 'comment', foreground: '6a9955' }],
            );
        });
    });
});
