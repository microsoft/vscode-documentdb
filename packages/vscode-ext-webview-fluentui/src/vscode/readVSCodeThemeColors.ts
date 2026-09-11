/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { vscodeColorIdToCSSVariable } from './cssVariable.js';
import { toHexColor } from './toHexColor.js';

/** A resolved snapshot of the active VS Code theme: color id to hex. */
export type VSCodeThemeColors = Record<string, string>;

/**
 * Reads the given VS Code theme colors off the document, as hex.
 *
 * Ids the active theme does not publish, and ids whose value is not a hex or `rgb()` color, are
 * **omitted** rather than included empty or passed through (see {@link toHexColor}). Callers
 * therefore get a map they can hand to a renderer without it having to re-validate.
 *
 * One `getComputedStyle` call serves the whole list; the per-id cost is a `getPropertyValue`
 * lookup. Call it once per theme change, not once per consumer.
 */
export function readVSCodeThemeColors(colorIds: readonly string[]): VSCodeThemeColors {
    const style = getComputedStyle(document.documentElement);
    const colors: VSCodeThemeColors = {};

    for (const colorId of colorIds) {
        const hex = toHexColor(style.getPropertyValue(vscodeColorIdToCSSVariable(colorId)));

        if (hex !== undefined) {
            colors[colorId] = hex;
        }
    }

    return colors;
}
