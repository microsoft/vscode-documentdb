/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, test } from '@jest/globals';
import { STYLE_ELEMENT_ID } from './styles/injectStyles.js';

describe('the ./monaco entry stands alone', () => {
    test('importing ./monaco injects no stylesheet', async () => {
        const monaco = await import('./monaco.js');

        expect(monaco.createVSCodeMonacoTheme).toBeDefined();
        expect(document.getElementById(STYLE_ELEMENT_ID)).toBeNull();
    });
});
