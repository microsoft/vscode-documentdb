/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom
// Vitest consumer probe for the entry points that need a DOM, plus the webview transport and React
// entries again against jsdom's real `window`.
import { expect, it } from 'vitest';
import { checks, normalize } from './calls.mjs';

const alsoInDom = new Set(['@microsoft/vscode-ext-webview/webview', '@microsoft/vscode-ext-webview/react']);

for (const [name, check] of Object.entries(checks)) {
    const { dom, run } = normalize(check);
    if (!dom && !alsoInDom.has(name)) continue;
    it(name, async () => {
        const detail = await run((specifier) => import(/* @vite-ignore */ specifier));
        expect(typeof detail).toBe('string');
        console.log(`PROBE ${name}: ${detail}`);
    });
}
