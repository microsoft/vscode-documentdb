/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Maximum number of per-row metric (`dbStats` / `collStats`) requests to run in
 * parallel when streaming metrics into the dashboard table. Bounded so a large
 * cluster does not fan out hundreds of simultaneous stats commands.
 */
export const METRICS_CONCURRENCY_LIMIT = 6;

/**
 * Fixed pixel widths for the dashboard table columns. Applied through Fluent's
 * column-sizing feature so the database and collection tables render with
 * identical column geometry instead of each column stretching to fill the
 * editor (which made the few-column collection table look disproportionately
 * wide). The name column flexes wide; the numeric metric columns stay compact.
 */
export const DASHBOARD_COLUMN_WIDTH = {
    /** Database / collection name column — wide, holds long identifiers. */
    name: 320,
    /** A numeric metric column (counts and human-readable sizes). */
    metric: 140,
} as const;

/** Minimum width for the name column so it never collapses past usability. */
export const DASHBOARD_NAME_MIN_WIDTH = 160;

/** Minimum width for a numeric metric column. */
export const DASHBOARD_METRIC_MIN_WIDTH = 90;
