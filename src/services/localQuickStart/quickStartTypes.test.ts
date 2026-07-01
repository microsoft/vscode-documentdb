/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { QUICK_START_IMAGE, QUICK_START_IMAGE_REPOSITORY, resolveQuickStartImage } from './quickStartTypes';

describe('resolveQuickStartImage (Advanced image-tag override, P1-4)', () => {
    it('falls back to the default image when no tag is given', () => {
        expect(resolveQuickStartImage()).toBe(QUICK_START_IMAGE);
        expect(resolveQuickStartImage('')).toBe(QUICK_START_IMAGE);
        expect(resolveQuickStartImage('   ')).toBe(QUICK_START_IMAGE);
    });

    it('swaps only the tag on the canonical repository', () => {
        expect(resolveQuickStartImage('1.2.0')).toBe(`${QUICK_START_IMAGE_REPOSITORY}:1.2.0`);
        expect(resolveQuickStartImage('latest')).toBe(`${QUICK_START_IMAGE_REPOSITORY}:latest`);
    });

    it('trims surrounding whitespace from the tag', () => {
        expect(resolveQuickStartImage('  1.2.0  ')).toBe(`${QUICK_START_IMAGE_REPOSITORY}:1.2.0`);
    });

    it('always keeps the fixed repository (a tag can never redirect the image)', () => {
        // Even an odd tag string can only ever be appended after the fixed repository + ':'.
        // (Structural validation of the tag itself happens at the router/zod boundary.)
        const ref = resolveQuickStartImage('weird-tag');
        expect(ref.startsWith(`${QUICK_START_IMAGE_REPOSITORY}:`)).toBe(true);
    });
});
