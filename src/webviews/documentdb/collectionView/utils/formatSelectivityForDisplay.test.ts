/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { formatSelectivityForDisplay } from './formatSelectivityForDisplay';

describe('formatSelectivityForDisplay', () => {
    const belowThresholdText = 'below 0.1%';

    it('returns threshold text for non-zero selectivity below 0.1%', () => {
        expect(formatSelectivityForDisplay('0.02%', belowThresholdText)).toBe(belowThresholdText);
        expect(formatSelectivityForDisplay('0.008%', belowThresholdText)).toBe(belowThresholdText);
    });

    it('preserves values at or above 0.1%', () => {
        expect(formatSelectivityForDisplay('0.1%', belowThresholdText)).toBe('0.1%');
        expect(formatSelectivityForDisplay('5.0%', belowThresholdText)).toBe('5.0%');
    });

    it('preserves zero and unavailable values', () => {
        expect(formatSelectivityForDisplay('0.0%', belowThresholdText)).toBe('0.0%');
        expect(formatSelectivityForDisplay(null, belowThresholdText)).toBeNull();
        expect(formatSelectivityForDisplay(undefined, belowThresholdText)).toBeUndefined();
    });
});
