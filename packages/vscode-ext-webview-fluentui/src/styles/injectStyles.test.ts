/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, describe, expect, test } from '@jest/globals';
import { injectStyles, STYLE_ELEMENT_ID } from './injectStyles';

describe('injectStyles', () => {
    afterEach(() => {
        document.getElementById(STYLE_ELEMENT_ID)?.remove();
    });

    test('puts the overrides on the page', () => {
        injectStyles();

        const element = document.getElementById(STYLE_ELEMENT_ID);
        expect(element).not.toBeNull();
        expect(element?.textContent).toContain('.fui-ProgressBar');
    });

    test('is idempotent, so duplicate copies of the package add one sheet', () => {
        injectStyles();
        injectStyles();
        injectStyles();

        expect(document.querySelectorAll(`#${STYLE_ELEMENT_ID}`)).toHaveLength(1);
    });

    test('is a no-op without a DOM, so a node-environment test can import the entry', () => {
        const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
        delete (globalThis as { document?: Document }).document;

        try {
            expect(() => injectStyles()).not.toThrow();
        } finally {
            if (documentDescriptor) {
                Object.defineProperty(globalThis, 'document', documentDescriptor);
            }
        }
    });
});
