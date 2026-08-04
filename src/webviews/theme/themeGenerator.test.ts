/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';

import { generateAdaptiveDarkTheme, generateAdaptiveLightTheme } from './themeGenerator';

describe('adaptive neutral surface states', () => {
    let originalDocument: Document | undefined;
    let originalGetComputedStyle: typeof getComputedStyle;

    beforeEach(() => {
        originalDocument = globalThis.document;
        originalGetComputedStyle = globalThis.getComputedStyle;
        globalThis.document = { documentElement: {} } as unknown as Document;
        globalThis.getComputedStyle = (() =>
            ({
                getPropertyValue: () => '#0078d4',
            }) as unknown as CSSStyleDeclaration) as typeof getComputedStyle;
    });

    afterEach(() => {
        if (originalDocument) {
            globalThis.document = originalDocument;
        } else {
            delete (globalThis as { document?: Document }).document;
        }
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
