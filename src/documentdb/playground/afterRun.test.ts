/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { resolveAfterRunOutcome } from './afterRun';

describe('resolveAfterRunOutcome', () => {
    it.each([
        ['auto', false, 'stay'],
        ['auto', true, 'focusResult'],
        ['stay', false, 'stay'],
        ['stay', true, 'stay'],
        ['focusResult', false, 'focusResult'],
        ['focusResult', true, 'focusResult'],
        ['notify', false, 'notify'],
        ['notify', true, 'notify'],
    ] as const)('resolves %s with screenReaderMode=%s to %s', (setting, screenReaderMode, expected) => {
        expect(resolveAfterRunOutcome(setting, screenReaderMode)).toBe(expected);
    });

    it.each([undefined, null, 'invalid', false, 42, {}])('uses auto for an unset or unknown value %j', (setting) => {
        expect(resolveAfterRunOutcome(setting, false)).toBe('stay');
        expect(resolveAfterRunOutcome(setting, true)).toBe('focusResult');
    });
});
