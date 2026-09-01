/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Specialized metric components
export { CountMetric, type CountMetricProps } from './CountMetric';
export { GenericMetric, type GenericMetricProps } from './GenericMetric';
export { RatioMetric, type RatioMetricProps } from './RatioMetric';
export { TimeMetric, type TimeMetricProps } from './TimeMetric';

// Shared props and the accessible-name composition every metric uses
export { composeMetricAriaLabel, type MetricProps } from './metricProps';

// Formatting utilities (for advanced use cases)
export { formatCount, formatRatio, formatTime } from './formatUtils';

// NOTE: the grid these sit in is `MetricGrid`, from
// `@microsoft/vscode-ext-webview-fluentui/components`. Import it directly.
