/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * What every metric component in this folder accepts on top of its own value shape.
 *
 * Layout, loading and unavailable states and the tooltip all belong to `MetricCard` in
 * `@microsoft/vscode-ext-webview-fluentui`. What stays here is formatting, which is
 * locale-specific, and the accessible name, which the package deliberately leaves to its consumer.
 */
export interface MetricProps {
    /** The label displayed at the top of the metric card. */
    label: string;

    /** What to display while data is loading (when the value is undefined). */
    loadingPlaceholder?: 'skeleton' | 'empty';

    /** What to display when the value is explicitly null (data unavailable). */
    nullValuePlaceholder?: string;

    /** Optional explanation shown in a tooltip and marked with an info glyph beside the label. */
    tooltipExplanation?: string;
}

/**
 * Composes the card's complete accessible name.
 *
 * `MetricCard` hides its visible label and value from assistive technology whenever it is given a
 * name, so this string has to carry both. The tooltip is appended as well, which is why a card with
 * one currently announces its explanation twice: once here and once through the `aria-describedby`
 * that Fluent's `Tooltip` sets. That is a known defect, captured with measurements in increment 3's
 * item 0 baseline and owned by increment 4; it is preserved verbatim here so the extraction changes
 * nothing about what a screen reader says.
 */
export function composeMetricAriaLabel(label: string, value: unknown, tooltipExplanation?: string): string {
    const valueText = typeof value === 'string' || typeof value === 'number' ? String(value) : '';

    return `${label}${valueText ? `: ${valueText}` : ''}${tooltipExplanation ? `. ${tooltipExplanation}` : ''}`;
}
