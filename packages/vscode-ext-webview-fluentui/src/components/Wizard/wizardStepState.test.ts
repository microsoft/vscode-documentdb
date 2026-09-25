/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, test } from '@jest/globals';
import { defaultCompleted, defaultNavigable } from './wizardStepState.js';

/**
 * These two functions exist because both wizard surfaces in this repository derived the same rules
 * independently. The tests below are that claim, written down: they replay each consumer's own
 * expression and assert the extracted default agrees with it.
 */
describe('wizard step defaults', () => {
    const localSteps = ['introduction', 'configure', 'setup', 'done'] as const;
    /** `LocalQuickStart.tsx`, before the extraction. */
    const localCompleted = (id: string, index: number, current: number): boolean =>
        id === 'introduction' || index < current || (id === 'done' && index === current);

    const atlasSteps = ['choose', 'form', 'checking', 'success'] as const;
    /** `AtlasCredentialsView.tsx`, before the extraction, in its default (non-edit) mode. */
    const atlasCompleted = (id: string, index: number, current: number): boolean =>
        id === 'choose' || index < current || (id === 'success' && index === current);

    test('defaultCompleted reproduces the DocumentDB Local breadcrumb at every step', () => {
        for (let current = 0; current < localSteps.length; current++) {
            const derived = localSteps.map((_id, index) => defaultCompleted(index, current, localSteps.length));
            const original = localSteps.map((id, index) => localCompleted(id, index, current));
            expect(derived).toEqual(original);
        }
    });

    test('defaultCompleted reproduces the Atlas credentials breadcrumb at every step', () => {
        for (let current = 0; current < atlasSteps.length; current++) {
            const derived = atlasSteps.map((_id, index) => defaultCompleted(index, current, atlasSteps.length));
            const original = atlasSteps.map((id, index) => atlasCompleted(id, index, current));
            expect(derived).toEqual(original);
        }
    });

    test('Atlas edit mode drops the pre-satisfied first step, which is what the per-step override is for', () => {
        // Edit mode opens on the form, so "Choose method" is not in the list at all, and the step
        // that takes index 0 is NOT pre-satisfied. The default cannot know that; the consumer says so.
        const editSteps = ['form', 'checking', 'success'] as const;
        expect(defaultCompleted(0, 0, editSteps.length)).toBe(true);
        expect(atlasCompleted('form', 0, 0)).toBe(false);
    });

    test('defaultNavigable allows only earlier steps, and nothing while locked', () => {
        expect(defaultNavigable(0, 2, false)).toBe(true);
        expect(defaultNavigable(1, 2, false)).toBe(true);
        expect(defaultNavigable(2, 2, false)).toBe(false);
        expect(defaultNavigable(3, 2, false)).toBe(false);
        expect(defaultNavigable(0, 2, true)).toBe(false);
    });

    test('a single-step wizard shows its only step as completed', () => {
        expect(defaultCompleted(0, 0, 1)).toBe(true);
    });
});
