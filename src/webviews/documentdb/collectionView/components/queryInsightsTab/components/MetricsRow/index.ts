/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Container component
export { MetricsRow, type MetricsRowProps } from './MetricsRow';

// Specialized metric components
export { CountMetric, type CountMetricProps } from './CountMetric';
export { GenericMetric, type GenericMetricProps } from './GenericMetric';
export { RatioMetric, type RatioMetricProps } from './RatioMetric';
export { TimeMetric, type TimeMetricProps } from './TimeMetric';

// Formatting utilities (for advanced use cases)
export { formatCount, formatRatio, formatTime } from './formatUtils';

// NOTE: MetricBase is intentionally NOT exported
// Users should use the specialized metric components above
// or create their own following the pattern in GenericMetric.tsx
