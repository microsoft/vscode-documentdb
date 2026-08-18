/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';

import { generateAdaptiveDarkTheme, generateAdaptiveLightTheme, getBrandTokensFromPalette } from './themeGenerator';

/** Stands in for VS Code's `--vscode-button-background`, which jsdom does not define. */
function stubButtonBackground(value: string): void {
    globalThis.getComputedStyle = (() =>
        ({
            getPropertyValue: () => value,
        }) as unknown as CSSStyleDeclaration) as typeof getComputedStyle;
}

describe('adaptive neutral surface states', () => {
    let originalGetComputedStyle: typeof getComputedStyle;

    beforeEach(() => {
        originalGetComputedStyle = globalThis.getComputedStyle;
        stubButtonBackground('#0078d4');
    });

    afterEach(() => {
        globalThis.getComputedStyle = originalGetComputedStyle;
    });

    test.each([
        ['light', generateAdaptiveLightTheme],
        ['dark', generateAdaptiveDarkTheme],
    ])('%s theme uses action colors for pressed surfaces and matching selected foregrounds', (_, generateTheme) => {
        const theme = generateTheme();

        expect(theme.colorNeutralBackground1Pressed).toBe(
            'var(--vscode-toolbar-activeBackground, var(--vscode-list-hoverBackground, var(--vscode-editorWidget-background)))',
        );
        expect(theme.colorNeutralBackground2Pressed).toBe(
            'var(--vscode-toolbar-activeBackground, var(--vscode-list-hoverBackground, var(--vscode-sideBar-background)))',
        );
        expect(theme.colorNeutralForeground1Selected).toBe(
            'var(--vscode-list-inactiveSelectionForeground, var(--vscode-editor-foreground))',
        );
        expect(theme.colorNeutralForeground2Selected).toBe(
            'var(--vscode-list-inactiveSelectionForeground, var(--vscode-editor-foreground))',
        );
    });
});

describe('brand ramp key color', () => {
    let originalGetComputedStyle: typeof getComputedStyle;

    beforeEach(() => {
        originalGetComputedStyle = globalThis.getComputedStyle;
    });

    afterEach(() => {
        globalThis.getComputedStyle = originalGetComputedStyle;
    });

    // Outside a VS Code webview `--vscode-button-background` is absent and getPropertyValue
    // returns ''. The palette math has no guards of its own, so an unguarded generator produced
    // a NaN-poisoned ramp and then threw. See decision 0009.
    test.each([
        ['an empty value', ''],
        ['whitespace', '   '],
        ['a named color', 'rebeccapurple'],
        ['an unparseable rgb() value', 'rgb(not a color)'],
    ])('degrades to a usable ramp on %s', (_, keyColor) => {
        const brand = getBrandTokensFromPalette(keyColor);

        expect(Object.keys(brand)).toHaveLength(16);
        Object.values(brand).forEach((shade) => expect(shade).toMatch(/^#[0-9a-f]{6}$/i));
    });

    test('accepts an rgb() key color', () => {
        expect(getBrandTokensFromPalette('rgb(0, 120, 212)')).toEqual(getBrandTokensFromPalette('#0078d4'));
    });

    test('an absent theme variable still yields a complete theme', () => {
        stubButtonBackground('');

        expect(() => generateAdaptiveLightTheme()).not.toThrow();
        expect(() => generateAdaptiveDarkTheme()).not.toThrow();
    });
});
