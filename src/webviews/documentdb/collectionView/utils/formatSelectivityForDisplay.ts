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
export function formatSelectivityForDisplay(selectivity: number, belowThresholdLabel: string): string;
export function formatSelectivityForDisplay(selectivity: null, belowThresholdLabel: string): null;
export function formatSelectivityForDisplay(selectivity: undefined, belowThresholdLabel: string): undefined;
export function formatSelectivityForDisplay(
    selectivity: number | null | undefined,
    belowThresholdLabel: string,
): string | null | undefined;
export function formatSelectivityForDisplay(
    selectivity: number | null | undefined,
    belowThresholdLabel: string,
): string | null | undefined {
    if (selectivity === null || selectivity === undefined) {
        return selectivity;
    }

    if (selectivity > 0 && selectivity < 0.1) {
        return belowThresholdLabel;
    }

    return `${selectivity.toFixed(1)}%`;
}
