/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * What every metric component in this folder accepts on top of its own value shape.
 *
 * Layout, loading and unavailable states and the tooltip all belong to `MetricCard` in
 * `@microsoft/vscode-ext-webview-fluentui`. What stays here is formatting, which is
 * locale-specific. The card names itself from the label and formatted value it receives.
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
