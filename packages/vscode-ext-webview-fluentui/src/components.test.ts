/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, test } from '@jest/globals';
import { STYLE_ELEMENT_ID } from './styles/injectStyles.js';

describe('invariant I1 — components do not require the package theming', () => {
    test('importing ./components injects no stylesheet', async () => {
        const components = await import('./components.js');

        expect(components.WizardBreadcrumb).toBeDefined();
        expect(document.getElementById(STYLE_ELEMENT_ID)).toBeNull();
    });
});
