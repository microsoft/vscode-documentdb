/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Execution plan metrics utilities (metrics only). Designed for reuse across find, aggregate and count.
 */

export interface PlanMetrics {
    executionTimeMillis?: number;
    totalDocsExamined?: number;
    totalKeysExamined?: number;
    nReturned?: number;
    indexEfficiency?: number | null; // totalKeysExamined / totalDocsExamined
    docsExaminedPerReturn?: number | null; // totalDocsExamined / nReturned
}

export interface PlanShapeInfo {
    stages: string[];
    indexNames: string[];
    usedIndex: boolean;
    fullCollectionScan: boolean;
    filterPushedDown: boolean | null;
    isCoveredQuery: boolean;
    // coveredReason: string;
    rawPath?: string;
}

export interface PlanAnalysis {
    metrics: PlanMetrics;
    shape: PlanShapeInfo;
}

/** Narrow shape of a MongoDB find explain executionStats that we rely on */
interface ExecutionStatsLike {
    executionTimeMillis?: number;
    totalDocsExamined?: number;
    totalKeysExamined?: number;
    nReturned?: number;
    executionStages?: any;
}

/**
 * Recursively walk a plan subtree collecting stage names and index info.
 */
function walkStages(
    node: any,
    acc: {
        stages: string[];
        indexNames: Set<string>;
        collectionScans: number;
        filterPushed: boolean;
        path: string[];
    },
    path: string[] = [],
): void {
    if (!node || typeof node !== 'object') return;
    const stage = node.stage as string | undefined;
    if (stage) {
        acc.stages.push(stage);
        acc.path = path.concat(stage);
        if (stage === 'COLLSCAN') acc.collectionScans += 1;
    }
    // indexName can appear in IXSCAN or FETCH (for covered queries) etc
    if (node.indexName) {
        acc.indexNames.add(String(node.indexName));
    }
    // Filter pushdown heuristics
    if (stage === 'IXSCAN' && node.filter) {
        acc.filterPushed = true;
    }
    if (stage === 'FETCH' && node.filter && !acc.filterPushed) {
        // Filter applied after index scan
        acc.filterPushed = false;
    }
    // Explore common child container fields
    const childKeys = [
        'inputStage',
        'inputStages',
        'executionStages',
        'shards',
        'winningPlan',
        'innerStage',
        'outerStage',
    ];
    for (const key of childKeys) {
        const child = (node as any)[key];
        if (!child) continue;
        if (Array.isArray(child)) {
            child.forEach((c, i) => walkStages(c, acc, path.concat(`${stage ?? 'ROOT'}[${i}]`)));
        } else {
            walkStages(child, acc, path.concat(stage ?? 'ROOT'));
        }
    }
    // Generic children enumeration (fallback) - avoid infinite recursion by skipping primitives & already handled fields
    for (const [k, v] of Object.entries(node)) {
        if (childKeys.includes(k)) continue;
        if (!v || typeof v !== 'object') continue;
        // Recognize pipeline array inside SUBPLANs or similar wrappers
        if (Array.isArray(v)) {
            v.forEach((c, i) => walkStages(c, acc, path.concat(`${stage ?? 'ROOT'}:${k}[${i}]`)));
        } else if ((v as any).stage) {
            walkStages(v, acc, path.concat(`${stage ?? 'ROOT'}:${k}`));
        }
    }
}

function computeCoverage(explain: any): { isCoveredQuery: boolean; reason: string } {
    // Covered query heuristic: presence of IXSCAN with no FETCH stage OR a FETCH with need for document fetch
    // We simplify: if plan has IXSCAN and no FETCH, treat as covered.
    const stages: string[] = [];
    const acc = {
        stages,
        indexNames: new Set<string>(),
        collectionScans: 0,
        filterPushed: false,
        path: [] as string[],
    };
    const winning = explain?.queryPlanner?.winningPlan || explain?.executionStats?.executionStages;
    walkStages(winning, acc);
    const hasIx = stages.includes('IXSCAN');
    const hasFetch = stages.includes('FETCH');
    if (hasIx && !hasFetch) {
        return {
            isCoveredQuery: true,
            reason: 'Winning plan uses only index scan stages (no FETCH).',
        };
    }
    if (!hasIx) {
        return { isCoveredQuery: false, reason: 'No index scan stages detected.' };
    }
    return {
        isCoveredQuery: false,
        reason: 'Index used but FETCH present (requires document fetch).',
    };
}

function extractCoreMetrics(explain: any): PlanMetrics {
    const exec: ExecutionStatsLike | undefined = explain?.executionStats;
    const metrics: PlanMetrics = {
        executionTimeMillis: exec?.executionTimeMillis,
        totalDocsExamined: exec?.totalDocsExamined,
        totalKeysExamined: exec?.totalKeysExamined,
        nReturned: exec?.nReturned,
    };
    if (metrics.totalDocsExamined && metrics.totalKeysExamined && metrics.totalDocsExamined > 0) {
        metrics.indexEfficiency = metrics.totalKeysExamined / metrics.totalDocsExamined;
    } else {
        metrics.indexEfficiency = null;
    }
    if (metrics.nReturned && metrics.totalDocsExamined && metrics.nReturned > 0) {
        metrics.docsExaminedPerReturn = metrics.totalDocsExamined / metrics.nReturned;
    } else {
        metrics.docsExaminedPerReturn = null;
    }
    return metrics;
}

function deriveShape(explain: any): PlanShapeInfo {
    const exec: ExecutionStatsLike | undefined = explain?.executionStats;
    const winning = explain?.queryPlanner?.winningPlan || exec?.executionStages;
    const stages: string[] = [];
    const acc = {
        stages,
        indexNames: new Set<string>(),
        collectionScans: 0,
        filterPushed: false,
        path: [] as string[],
    };
    walkStages(winning, acc);
    const coverage = computeCoverage(explain);
    const usedIndex = acc.indexNames.size > 0 || stages.includes('IXSCAN');
    const fullCollectionScan = stages.includes('COLLSCAN');
    const filterPushedDown = acc.filterPushed ? true : acc.filterPushed === false ? false : null;
    return {
        stages,
        indexNames: Array.from(acc.indexNames),
        usedIndex,
        fullCollectionScan,
        filterPushedDown,
        isCoveredQuery: coverage.isCoveredQuery,
        // coveredReason: coverage.reason,
        rawPath: acc.path.join(' > '),
    };
}

export function analyzeFindExplain(explain: any): PlanAnalysis {
    return { metrics: extractCoreMetrics(explain), shape: deriveShape(explain) };
}

export function analyzeAggregateExplain(explain: any): PlanAnalysis {
    // Aggregate explain still presents executionStats with similar structure when using executionStats mode.
    return { metrics: extractCoreMetrics(explain), shape: deriveShape(explain) };
}

export function analyzeCountExplain(explain: any): PlanAnalysis {
    // countDocuments / aggregate-based count explain surfaces similar fields.
    return { metrics: extractCoreMetrics(explain), shape: deriveShape(explain) };
}
