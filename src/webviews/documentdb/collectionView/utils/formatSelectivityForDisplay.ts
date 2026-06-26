/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Formats selectivity for UI display.
 *
 * For very low non-zero percentages (< 0.1%), we show a threshold label
 * instead of a rounded numeric value.
 */
export function formatSelectivityForDisplay(
    selectivity: string | null | undefined,
    belowThresholdLabel: string,
): string | null | undefined {
    if (!selectivity) {
        return selectivity;
    }

    const selectivityPercent = Number.parseFloat(selectivity);
    if (Number.isNaN(selectivityPercent)) {
        return selectivity;
    }

    if (selectivityPercent > 0 && selectivityPercent < 0.1) {
        return belowThresholdLabel;
    }

    return selectivity;
}
