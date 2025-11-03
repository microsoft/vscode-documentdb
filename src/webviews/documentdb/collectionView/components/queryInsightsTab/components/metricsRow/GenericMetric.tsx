/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { MetricBase, type MetricBaseProps } from './MetricBase';

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
export interface GenericMetricProps extends Omit<MetricBaseProps, 'value'> {
    /** The value to display (string or number) */
    value: string | number | null | undefined;
}

export const GenericMetric: React.FC<GenericMetricProps> = ({ label, value, placeholder = 'skeleton', tooltip }) => {
    return <MetricBase label={label} value={value} placeholder={placeholder} tooltip={tooltip} />;
};

/**
 * CREATING NEW SPECIALIZED METRIC COMPONENTS
 * ===========================================
 *
 * To create a new metric type, follow this pattern:
 *
 * 1. Create a new file (e.g., YourMetric.tsx)
 * 2. Import MetricBase and its props
 * 3. Define your specific props (extending Omit<MetricBaseProps, 'value'>)
 * 4. Add your formatting logic
 * 5. Return <MetricBase> with formatted value
 *
 * Example - SizeMetric for bytes:
 *
 * ```typescript
 * import * as React from 'react';
 * import { MetricBase, type MetricBaseProps } from './MetricBase';
 *
 * function formatBytes(bytes: number): string {
 *     if (bytes < 1024) return `${bytes} B`;
 *     if (bytes < 1048576) return `${(bytes / 1024).toFixed(2)} KB`;
 *     return `${(bytes / 1048576).toFixed(2)} MB`;
 * }
 *
 * export interface SizeMetricProps extends Omit<MetricBaseProps, 'value'> {
 *     valueBytes: number | null | undefined;
 * }
 *
 * export const SizeMetric: React.FC<SizeMetricProps> = ({
 *     label,
 *     valueBytes,
 *     placeholder = 'skeleton',
 *     tooltip
 * }) => {
 *     const formattedValue = valueBytes !== null && valueBytes !== undefined
 *         ? formatBytes(valueBytes)
 *         : undefined;
 *
 *     return (
 *         <MetricBase
 *             label={label}
 *             value={formattedValue}
 *             placeholder={placeholder}
 *             tooltip={tooltip}
 *         />
 *     );
 * };
 * ```
 *
 * Then export it in index.ts:
 * ```typescript
 * export { SizeMetric, type SizeMetricProps } from './SizeMetric';
 * ```
 *
 * CUSTOM VALUE RENDERING
 * ======================
 *
 * You can also pass a React node to MetricBase for custom rendering:
 *
 * ```typescript
 * const customValue = (
 *     <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
 *         <Icon />
 *         <span>Custom Content</span>
 *     </div>
 * );
 *
 * return (
 *     <MetricBase
 *         label={label}
 *         value={customValue}
 *         placeholder={placeholder}
 *         tooltip={tooltip}
 *     />
 * );
 * ```
 *
 * See RatioMetric.tsx for an example with a progress bar.
 */
