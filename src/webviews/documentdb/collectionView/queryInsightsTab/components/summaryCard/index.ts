/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Export main components
export { SummaryCard } from './SummaryCard';
export type { SummaryCardProps } from './SummaryCard';

// Export cell components
export { GenericCell } from './GenericCell';
export type { GenericCellProps } from './GenericCell';

// Export custom cells
export { PerformanceRatingCell } from './custom/PerformanceRatingCell';
export type { PerformanceRating, PerformanceRatingCellProps } from './custom/PerformanceRatingCell';

// Note: a cell is `MetricCard` from `@microsoft/vscode-ext-webview-fluentui/components`, at
// appearance="subtle" size="small". Build a custom cell from that, not from `GenericCell`.
