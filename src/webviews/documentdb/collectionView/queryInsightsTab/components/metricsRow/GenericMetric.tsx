/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { MetricCard } from '@microsoft/vscode-ext-webview-fluentui/components';
import * as l10n from '@vscode/l10n';
import { type JSX } from 'react';
import { composeMetricAriaLabel, type MetricProps } from './metricProps';

/**
 * Generic metric component for displaying string or number values without special formatting.
 *
 * Use this when you need to display:
 * - Simple string values
 * - Pre-formatted numbers
 * - Custom static content
 *
 * For specialized formatting, use:
 * - TimeMetric - for time values (auto-converts ms to s, minutes, etc.)
 * - CountMetric - for integers (with grouping and compact mode)
 * - RatioMetric - for percentages/ratios (with visual bar chart)
 *
 * @example
 * <GenericMetric
 *     label={l10n.t('Status')}
 *     value="Active"
 *     tooltip={l10n.t('Current query status')}
 * />
 *
 * @example
 * <GenericMetric
 *     label={l10n.t('Database')}
 *     value={databaseName}
 *     placeholder="empty"
 * />
 */
export interface GenericMetricProps extends MetricProps {
    /** The value to display (string or number) */
    value: string | number | null | undefined;
}

export const GenericMetric = ({
    label,
    value,
    loadingPlaceholder = 'skeleton',
    nullValuePlaceholder = l10n.t('N/A'),
    tooltipExplanation,
}: GenericMetricProps): JSX.Element => (
    <MetricCard
        label={label}
        value={value}
        description={tooltipExplanation}
        loadingPlaceholder={loadingPlaceholder}
        nullValuePlaceholder={nullValuePlaceholder}
        tooltipRepeatsValue
        ariaLabel={composeMetricAriaLabel(label, value, tooltipExplanation)}
    />
);

/**
 * ADDING A NEW METRIC TYPE
 * =======================
 *
 * A metric component here is a formatter with a card attached. Everything that is not formatting —
 * layout, the loading and unavailable states, the tooltip and the focus behaviour — belongs to
 * `MetricCard` in `@microsoft/vscode-ext-webview-fluentui`.
 *
 * 1. Create a file, e.g. `SizeMetric.tsx`.
 * 2. Extend `MetricProps` with your own value shape.
 * 3. Format the value, preserving `null` and `undefined` unchanged: they select the card's two
 *    placeholder states, and collapsing them makes "loading" and "unavailable" the same picture.
 * 4. Render `MetricCard`, and pass `ariaLabel={composeMetricAriaLabel(...)}`.
 * 5. Export it from `index.ts`.
 *
 * ```typescript
 * export interface SizeMetricProps extends MetricProps {
 *     valueBytes: number | null | undefined;
 * }
 *
 * export const SizeMetric = ({ label, valueBytes, tooltipExplanation }: SizeMetricProps): JSX.Element => {
 *     const value = valueBytes === null ? null : valueBytes === undefined ? undefined : formatBytes(valueBytes);
 *
 *     return (
 *         <MetricCard
 *             label={label}
 *             value={value}
 *             description={tooltipExplanation}
 *             ariaLabel={composeMetricAriaLabel(label, value, tooltipExplanation)}
 *         />
 *     );
 * };
 * ```
 *
 * `value` also takes a node, for a figure the type scale cannot express on its own. See
 * `RatioMetric.tsx`, which puts a bar under the number.
 */
