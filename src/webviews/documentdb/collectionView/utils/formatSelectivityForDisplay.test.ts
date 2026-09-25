/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { formatSelectivityForDisplay } from './formatSelectivityForDisplay';

describe('formatSelectivityForDisplay', () => {
    const belowThresholdText = 'below 0.1%';
    // Helper that mirrors the function's own formatting so expectations stay
    // locale-agnostic when tests run under non-en-US system locales.
    const fmt = (n: number): string =>
        `${n.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;

    it('returns threshold text for non-zero selectivity below 0.1%', () => {
        expect(formatSelectivityForDisplay(0.02, belowThresholdText)).toBe(belowThresholdText);
        expect(formatSelectivityForDisplay(0.008, belowThresholdText)).toBe(belowThresholdText);
    });

    it('preserves values at or above 0.1%', () => {
        expect(formatSelectivityForDisplay(0.1, belowThresholdText)).toBe(fmt(0.1));
        expect(formatSelectivityForDisplay(5, belowThresholdText)).toBe(fmt(5));
    });

    it('preserves zero and unavailable values', () => {
        expect(formatSelectivityForDisplay(0, belowThresholdText)).toBe(fmt(0));
        expect(formatSelectivityForDisplay(null, belowThresholdText)).toBeNull();
        expect(formatSelectivityForDisplay(undefined, belowThresholdText)).toBeUndefined();
    });
});
