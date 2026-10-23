/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type PerformanceDiagnostic } from '../types/queryInsights';

/** High-signal positive badges; every neutral and negative badge is shown. */
const shownPositiveIds: readonly string[] = ['high_efficiency_ratio', 'fast_execution', 'index_used'];
const typeOrder: Record<PerformanceDiagnostic['type'], number> = { positive: 0, neutral: 1, negative: 2 };

/**
 * The static analysis badges shown next to the performance rating, in display order
 * (positive, neutral, negative).
 */
export function getVisibleDiagnostics(
    diagnostics: readonly PerformanceDiagnostic[] | undefined,
): PerformanceDiagnostic[] {
    return (diagnostics ?? [])
        .filter((d) => d.type !== 'positive' || shownPositiveIds.includes(d.diagnosticId))
        .sort((a, b) => (typeOrder[a.type] ?? 1) - (typeOrder[b.type] ?? 1));
}
