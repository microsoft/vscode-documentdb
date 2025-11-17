# Query Insights Router Implementation Plan

## Overview

This document outlines the plan for implementing three-stage query insights in the `collectionViewRouter.ts` file. The implementation will support progressive data loading for query performance analysis and AI-powered optimization recommendations.

> **📝 Document Update Note**: This document originally contained multiple versions of the performance rating algorithm that evolved during the design process. These have been consolidated into a single authoritative version in the **"Performance Rating Thresholds"** section. The final implementation uses **efficiency ratio** (returned/examined, where higher is better) rather than the inverse metric used in early iterations.

---

## Architecture Overview

### Design Document Reference

This implementation plan is based on the design document: **performance-advisor.md**

The Query Insights feature provides progressive performance analysis through three stages, aligned with the UI design:

1. **Stage 1: Initial Performance View** — Fast, immediate metrics using `explain("queryPlanner")`
2. **Stage 2: Detailed Execution Analysis** — Authoritative metrics via `explain("executionStats")`
3. **Stage 3: AI-Powered Recommendations** — Optimization suggestions from AI service

### Router Context

All calls to the router share this context (defined in `collectionViewRouter.ts`):

```typescript
export type RouterContext = BaseRouterContext & {
  sessionId: string; // Tied to the query and results set
  clusterId: string; // Identifies the DocumentDB cluster/connection
  databaseName: string; // Target database
  collectionName: string; // Target collection
};
```

**Key Insight**: The `sessionId` is tied to both the query and its results set. This means:

- Each query execution creates a new `sessionId`
- Stage 1, 2, and 3 calls for the same query share the same `sessionId`
- The backend can cache query metadata, execution stats, and results using `sessionId`
- No need to pass query parameters repeatedly if we leverage `sessionId` for lookup

### Data Flow

```
User runs query → Stage 1 (immediate) → Stage 2 (on-demand) → Stage 3 (AI analysis)
                       ↓                      ↓                       ↓
                  Basic metrics         Execution stats      Optimization recommendations
```

### Stage Responsibilities

- **Stage 1**: Initial view with cheap data + query planner (no re-execution)
- **Stage 2**: Detailed execution analysis with authoritative runtime metrics
- **Stage 3**: AI-powered advisor with actionable optimization recommendations

---

## DocumentDB Explain Plan Parsing with @mongodb-js/explain-plan-helper

### Overview

For robust parsing of DocumentDB explain plans, we use the [`@mongodb-js/explain-plan-helper`](https://www.npmjs.com/package/@mongodb-js/explain-plan-helper) package. This battle-tested library is maintained by MongoDB and used in MongoDB Compass, providing reliable parsing across different MongoDB versions and platforms including DocumentDB.

### Why Use This Library?

1. **Handles MongoDB Version Differences**: The explain format has evolved across MongoDB versions. This library normalizes these differences automatically.
2. **Comprehensive Edge Case Coverage**:
   - Sharded queries with per-shard execution stats
   - Multiple input stages (e.g., `$or` queries)
   - Nested and recursive stage structures
   - Different verbosity levels (`queryPlanner`, `executionStats`, `allPlansExecution`)
3. **Type Safety**: Provides TypeScript definitions for all explain structures
4. **Battle-Tested**: Used in production by MongoDB Compass
5. **Convenience Methods**: Pre-built helpers for common checks:
   - `isCollectionScan` - Detects full collection scans
   - `isIndexScan` - Detects index usage
   - `isCovered` - Detects covered queries (index-only, no FETCH)
   - `inMemorySort` - Detects in-memory sorting

### Installation

```bash
npm install @mongodb-js/explain-plan-helper
```

### Core API

The package exports two main classes:

#### 1. ExplainPlan Class

The main entry point for parsing explain output:

```typescript
import { ExplainPlan } from '@mongodb-js/explain-plan-helper';

// Parse explain output
const explainPlan = new ExplainPlan(explainResult);

// High-level metrics (available with executionStats verbosity)
const executionTimeMillis = explainPlan.executionTimeMillis; // Server execution time
const nReturned = explainPlan.nReturned; // Documents returned
const totalKeysExamined = explainPlan.totalKeysExamined; // Keys scanned
const totalDocsExamined = explainPlan.totalDocsExamined; // Documents examined

// Query characteristics (boolean flags)
const isCollectionScan = explainPlan.isCollectionScan; // Full collection scan?
const isIndexScan = explainPlan.isIndexScan; // Uses index?
const isCoveredQuery = explainPlan.isCovered; // Index-only (no FETCH)?
const inMemorySort = explainPlan.inMemorySort; // In-memory sort?

// Metadata
const namespace = explainPlan.namespace; // "database.collection"

// Execution stage tree (detailed stage-by-stage breakdown)
const executionStages = explainPlan.executionStages; // Stage object (tree root)
```

#### 2. Stage Interface

Represents individual execution stages in a tree structure:

```typescript
interface Stage {
  // Stage identification
  stage: string; // Stage type (IXSCAN, FETCH, SORT, COLLSCAN, etc.)
  name: string; // Human-readable name

  // Execution metrics
  nReturned: number; // Documents returned by this stage
  executionTimeMillis?: number; // Time spent in this stage
  executionTimeMillisEstimate?: number; // Estimated time

  // Stage-specific properties
  indexName?: string; // For IXSCAN stages
  indexBounds?: any; // Index bounds used
  keysExamined?: number; // Keys examined (IXSCAN)
  docsExamined?: number; // Documents examined (FETCH, COLLSCAN)

  // Child stages (tree structure)
  inputStage?: Stage; // Single input stage
  inputStages?: Stage[]; // Multiple input stages (e.g., for $or queries)
  shards?: Stage[]; // For sharded queries

  // Shard information
  shardName?: string; // Shard identifier
  isShard: boolean; // Whether this represents a shard
}
```

### Usage Examples

#### Basic Usage (Stage 1 - queryPlanner)

```typescript
import { ExplainPlan } from '@mongodb-js/explain-plan-helper';

const explainPlan = new ExplainPlan(queryPlannerResult);

// Check query characteristics
const usesIndex = explainPlan.isIndexScan;
const hasInMemorySort = explainPlan.inMemorySort;
const namespace = explainPlan.namespace;
```

#### Detailed Analysis (Stage 2 - executionStats)

```typescript
const explainPlan = new ExplainPlan(executionStatsResult);

// Get execution metrics
const metrics = {
  executionTimeMs: explainPlan.executionTimeMillis,
  totalKeysExamined: explainPlan.totalKeysExamined,
  totalDocsExamined: explainPlan.totalDocsExamined,
  documentsReturned: explainPlan.nReturned,

  // Efficiency calculation
  efficiency: explainPlan.totalDocsExamined / explainPlan.nReturned,

  // Query characteristics
  hadCollectionScan: explainPlan.isCollectionScan,
  hadInMemorySort: explainPlan.inMemorySort,
  isCoveredQuery: explainPlan.isCovered,
};
```

#### Traversing Stage Trees

```typescript
function extractStageInfo(explainResult: unknown): StageInfo[] {
  const explainPlan = new ExplainPlan(explainResult);
  const stages: StageInfo[] = [];

  function traverseStage(stage: Stage | undefined): void {
    if (!stage) return;

    stages.push({
      stage: stage.stage,
      name: stage.name,
      nReturned: stage.nReturned,
      executionTimeMs: stage.executionTimeMillis ?? stage.executionTimeMillisEstimate,
      indexName: stage.indexName,
      keysExamined: stage.keysExamined,
      docsExamined: stage.docsExamined,
    });

    // Traverse child stages recursively
    if (stage.inputStage) {
      traverseStage(stage.inputStage);
    }

    if (stage.inputStages) {
      stage.inputStages.forEach(traverseStage);
    }

    if (stage.shards) {
      stage.shards.forEach(traverseStage);
    }
  }

  traverseStage(explainPlan.executionStages);
  return stages;
}
```

#### Handling Sharded Queries

```typescript
const explainPlan = new ExplainPlan(shardedExplainResult);

// Check if query is sharded
const isSharded = explainPlan.executionStages?.shards !== undefined;

if (isSharded) {
  const shards = explainPlan.executionStages.shards;

  shards.forEach((shard) => {
    console.log(`Shard: ${shard.shardName}`);
    console.log(`  Keys examined: ${shard.totalKeysExamined}`);
    console.log(`  Docs examined: ${shard.totalDocsExamined}`);
    console.log(`  Docs returned: ${shard.nReturned}`);
  });
}
```

### Platform Compatibility

The library works with any MongoDB-compatible explain output, including:

- MongoDB (all versions)
- DocumentDB (uses `explainVersion: 2`)
- Azure Cosmos DB for MongoDB

**DocumentDB Detection** (optional):

```typescript
function isDocumentDB(explainOutput: any): boolean {
  return explainOutput.explainVersion === 2;
}
```

---

## Infrastructure: Explain Plan Utilities

### Purpose

Before implementing the router endpoints (Stages 1, 2, 3), we need a set of reusable utility functions for extracting data from explain plans. These utilities will:

1. **Enable Independent Testing**: Test data extraction with various explain plans without instantiating the full extension environment
2. **Provide Consistent Parsing**: Centralize explain plan parsing logic using `@mongodb-js/explain-plan-helper`
3. **Support Incremental Development**: Start with basic extraction for Stage 1, expand as we implement Stages 2 and 3
4. **Handle Edge Cases**: Manage sharded queries, missing fields, and platform differences in one place

### Implementation Location

**File**: `src/documentdb/utils/explainPlanUtils.ts` (new file)

This utility module will be expanded as we progress through stage implementations.

### Initial Utility Functions

#### 1. Basic Explain Plan Parser

```typescript
import { ExplainPlan, type Stage } from '@mongodb-js/explain-plan-helper';

/**
 * Parses explain output and provides convenient access to explain data
 */
export class ExplainPlanParser {
  private readonly explainPlan: ExplainPlan;

  constructor(explainOutput: unknown) {
    this.explainPlan = new ExplainPlan(explainOutput);
  }

  // High-level metrics
  getExecutionTimeMs(): number | undefined {
    return this.explainPlan.executionTimeMillis;
  }

  getDocumentsReturned(): number {
    return this.explainPlan.nReturned;
  }

  getTotalKeysExamined(): number {
    return this.explainPlan.totalKeysExamined;
  }

  getTotalDocsExamined(): number {
    return this.explainPlan.totalDocsExamined;
  }

  getNamespace(): string {
    return this.explainPlan.namespace;
  }

  // Query characteristics
  isCollectionScan(): boolean {
    return this.explainPlan.isCollectionScan;
  }

  isIndexScan(): boolean {
    return this.explainPlan.isIndexScan;
  }

  isCoveredQuery(): boolean {
    return this.explainPlan.isCovered;
  }

  hasInMemorySort(): boolean {
    return this.explainPlan.inMemorySort;
  }

  // Stage tree access
  getExecutionStages(): Stage | undefined {
    return this.explainPlan.executionStages;
  }

  // Platform detection
  isSharded(): boolean {
    return this.explainPlan.executionStages?.shards !== undefined;
  }
}
```

#### 2. Stage Tree Traversal Utilities

```typescript
/**
 * Flattens the stage tree into a linear array for UI display
 */
export function flattenStageTree(rootStage: Stage | undefined): StageInfo[] {
  if (!rootStage) return [];

  const stages: StageInfo[] = [];

  function traverse(stage: Stage): void {
    stages.push({
      stage: stage.stage,
      name: stage.name,
      nReturned: stage.nReturned,
      executionTimeMs: stage.executionTimeMillis ?? stage.executionTimeMillisEstimate,
      indexName: stage.indexName,
      keysExamined: stage.keysExamined,
      docsExamined: stage.docsExamined,
    });

    // Traverse children
    if (stage.inputStage) {
      traverse(stage.inputStage);
    }

    if (stage.inputStages) {
      stage.inputStages.forEach(traverse);
    }

    if (stage.shards) {
      stage.shards.forEach(traverse);
    }
  }

  traverse(rootStage);
  return stages;
}

/**
 * Information extracted from a single stage
 */
export interface StageInfo {
  stage: string;
  name: string;
  nReturned: number;
  executionTimeMs?: number;
  indexName?: string;
  keysExamined?: number;
  docsExamined?: number;
}
```

#### 3. Index Detection Utilities

```typescript
/**
 * Finds all indexes used in the query plan
 */
export function findUsedIndexes(rootStage: Stage | undefined): string[] {
  if (!rootStage) return [];

  const indexes = new Set<string>();

  function traverse(stage: Stage): void {
    if (stage.stage === 'IXSCAN' && stage.indexName) {
      indexes.add(stage.indexName);
    }

    if (stage.inputStage) traverse(stage.inputStage);
    if (stage.inputStages) stage.inputStages.forEach(traverse);
    if (stage.shards) stage.shards.forEach(traverse);
  }

  traverse(rootStage);
  return Array.from(indexes);
}

/**
 * Checks if the query uses a specific index
 */
export function usesIndex(rootStage: Stage | undefined, indexName: string): boolean {
  return findUsedIndexes(rootStage).includes(indexName);
}
```

#### 4. Efficiency Calculation Utilities

```typescript
/**
 * Calculates the examined-to-returned ratio (inverse of efficiency ratio)
 * Higher values indicate inefficiency - the query examines many documents to return few
 *
 * Note: The performance rating algorithm uses efficiencyRatio (returned/examined) instead,
 * which is more intuitive (higher = better). This function is kept for backwards compatibility
 * and specific use cases where the inverse ratio is more meaningful.
 *
 * @param docsExamined - Number of documents examined
 * @param docsReturned - Number of documents returned
 * @returns Examined-to-returned ratio (where lower is better)
 */
export function calculateExaminedToReturnedRatio(docsExamined: number, docsReturned: number): number {
  if (docsReturned === 0) return docsExamined > 0 ? Infinity : 0;
  return docsExamined / docsReturned;
}

/**
 * Calculates index selectivity (keys examined / docs examined)
 */
export function calculateIndexSelectivity(keysExamined: number, docsExamined: number): number | null {
  if (docsExamined === 0) return null;
  return keysExamined / docsExamined;
}

/**
 * Calculates performance rating based on execution metrics
 *
 * This is the authoritative implementation used in ExplainPlanAnalyzer.ts.
 * See src/documentdb/queryInsights/ExplainPlanAnalyzer.ts for the actual code.
 *
 * Rating criteria:
 * - Excellent: High efficiency (>=50%), indexed, no in-memory sort, fast (<100ms)
 * - Good: Moderate efficiency (>=10%), indexed or fast (<500ms)
 * - Fair: Low efficiency (>=1%)
 * - Poor: Very low efficiency (<1%) or collection scan with low efficiency
 *
 * @param executionTimeMs - Execution time in milliseconds
 * @param efficiencyRatio - Ratio of documents returned to documents examined (0.0 to 1.0+)
 * @param hasInMemorySort - Whether query performs in-memory sorting
 * @param isIndexScan - Whether query uses index scan
 * @param isCollectionScan - Whether query performs collection scan
 * @returns Performance rating
 */
export function calculatePerformanceRating(
  executionTimeMs: number,
  efficiencyRatio: number,
  hasInMemorySort: boolean,
  isIndexScan: boolean,
  isCollectionScan: boolean,
): 'excellent' | 'good' | 'fair' | 'poor' {
  // Poor: Collection scan with very low efficiency
  if (isCollectionScan && efficiencyRatio < 0.01) {
    return 'poor';
  }

  // Excellent: High efficiency, uses index, no blocking sort, fast execution
  if (efficiencyRatio >= 0.5 && isIndexScan && !hasInMemorySort && executionTimeMs < 100) {
    return 'excellent';
  }

  // Good: Moderate efficiency with index usage or fast execution
  if (efficiencyRatio >= 0.1 && (isIndexScan || executionTimeMs < 500)) {
    return 'good';
  }

  // Fair: Low efficiency but acceptable
  if (efficiencyRatio >= 0.01) {
    return 'fair';
  }

  return 'poor';
}

/**
 * Calculates the efficiency ratio (documents returned / documents examined)
 * A ratio close to 1.0 indicates high efficiency - the query examines only the documents it returns
 *
 * @param returned - Number of documents returned
 * @param examined - Number of documents examined
 * @returns Efficiency ratio (0.0 to 1.0+, where higher is better)
 */
export function calculateEfficiencyRatio(returned: number, examined: number): number {
  if (examined === 0) {
    return returned === 0 ? 1.0 : 0.0;
  }
  return returned / examined;
}
```

#### 5. Sharded Query Utilities

```typescript
/**
 * Aggregates metrics across shards
 */
export function aggregateShardMetrics(rootStage: Stage | undefined): {
  totalKeysExamined: number;
  totalDocsExamined: number;
  totalReturned: number;
  shardCount: number;
} {
  if (!rootStage?.shards) {
    return {
      totalKeysExamined: 0,
      totalDocsExamined: 0,
      totalReturned: 0,
      shardCount: 0,
    };
  }

  return rootStage.shards.reduce(
    (acc, shard) => ({
      totalKeysExamined: acc.totalKeysExamined + (shard.keysExamined ?? 0),
      totalDocsExamined: acc.totalDocsExamined + (shard.docsExamined ?? 0),
      totalReturned: acc.totalReturned + shard.nReturned,
      shardCount: acc.shardCount + 1,
    }),
    { totalKeysExamined: 0, totalDocsExamined: 0, totalReturned: 0, shardCount: 0 },
  );
}
```

### Testing Strategy

These utilities can be tested independently with mock explain outputs:

```typescript
// Example test structure
describe('ExplainPlanUtils', () => {
  describe('ExplainPlanParser', () => {
    it('should parse queryPlanner output', () => {
      const mockExplain = {
        queryPlanner: {
          /* ... */
        },
        // No executionStats
      };

      const parser = new ExplainPlanParser(mockExplain);
      expect(parser.getNamespace()).toBe('testdb.testcoll');
    });

    it('should parse executionStats output', () => {
      const mockExplain = {
        queryPlanner: {
          /* ... */
        },
        executionStats: {
          /* ... */
        },
      };

      const parser = new ExplainPlanParser(mockExplain);
      expect(parser.getExecutionTimeMs()).toBe(120);
      expect(parser.getTotalDocsExamined()).toBe(1000);
    });
  });

  describe('Stage Tree Utilities', () => {
    it('should flatten nested stage tree', () => {
      const mockStage: Stage = {
        stage: 'FETCH',
        inputStage: {
          stage: 'IXSCAN',
          indexName: 'user_id_1',
        },
      };

      const flattened = flattenStageTree(mockStage);
      expect(flattened).toHaveLength(2);
      expect(flattened[0].stage).toBe('FETCH');
      expect(flattened[1].stage).toBe('IXSCAN');
    });
  });

  describe('Efficiency Calculations', () => {
    it('should calculate examined-to-returned ratio', () => {
      const ratio = calculateExaminedToReturnedRatio(1000, 10);
      expect(ratio).toBe(100);
    });

    it('should rate performance as poor for high ratio', () => {
      const rating = calculatePerformanceRating({
        examinedToReturnedRatio: 500,
        hadCollectionScan: true,
        hadInMemorySort: false,
        indexUsed: false,
      });

      expect(rating.score).toBe('poor');
      expect(rating.concerns).toContain('Full collection scan performed');
    });
  });
});
```

### Expansion Plan

As we implement each stage, we'll add more utilities to this module:

- **Stage 1**: Basic parsing, index detection, stage tree flattening
- **Stage 2**: Performance rating, efficiency calculations, execution strategy determination
- **Stage 3**: Query shape extraction for AI, collection stats integration

This modular approach allows us to:

1. Test utilities in isolation with various explain plan formats
2. Reuse utilities across different parts of the codebase
3. Maintain a single source of truth for explain plan parsing logic
4. Easily add support for new explain plan features

---

## Stage 1: Initial Performance View (Cheap Data + Query Plan)

### Purpose

**Design Goal** (from performance-advisor.md): Populated as soon as the query finishes, using fast signals plus `explain("queryPlanner")`. No full re-execution.

Provides immediate, low-cost metrics and query plan visualization.

### Paging Limitation and Query Insights

**Current Paging Implementation**:
The extension currently uses `skip` and `limit` for result paging, which is sufficient for data exploration but problematic for query insights. The `explain` plan with `skip` and `limit` only analyzes the performance of fetching a single page, not the overall query performance.

**Impact on Query Insights**:
For meaningful performance analysis, insights should reflect the "full query" scope without paging modifiers. However, rebuilding the entire paging system to use cursors is out of scope for the upcoming release.

**Stage 1 Solution**:
We'll implement a dedicated data collection function in `ClusterSession` that:

1. Detects when a new query is executed (via existing `resetCachesIfQueryChanged` logic)
2. On first call with a new query, automatically runs `explain("queryPlanner")` **without** `skip` and `limit`
3. Caches the planner output in `_currentQueryPlannerInfo` for subsequent Stage 1 requests
4. Returns cached data on subsequent calls until the query changes

This approach:

- ✅ Provides accurate query insights for the full query scope
- ✅ Runs only once per unique query (cached until query changes)
- ✅ Doesn't require rebuilding the paging system
- ✅ Keeps existing `skip`/`limit` paging for the Results view unchanged

**Note**: Optimizing the paging implementation (e.g., cursor-based paging) is planned for a future release but not in scope for query insights MVP.

### Data Sources

- Query execution timer (client-side)
- Result set from the query
- Query planner output from `explain("queryPlanner")` **without skip/limit modifiers**

### Router Endpoint

**Name**: `getQueryInsightsStage1`

**Type**: `query` (read operation)

**Input Schema**:

```typescript
z.object({
  // Empty - relies entirely on RouterContext.sessionId
  // The sessionId in context identifies the query and results set
});
```

**Context Requirements**:

- `sessionId`: Used to retrieve cached query planner info and execution time
- `databaseName` & `collectionName`: Used for display and validation

**Output Schema**:

```typescript
{
  executionTime: number; // Milliseconds (client-side measurement)
  documentsReturned: number; // Count of documents in result set
  // Note: keysExamined and docsExamined not available until Stage 2
  stages: Array<{
    // Flattened stage hierarchy for UI display
    stage: string; // "IXSCAN" | "FETCH" | "PROJECTION" | "SORT" | "COLLSCAN"
    name: string; // Human-readable stage name
    nReturned: number; // Documents returned by this stage
    indexName?: string; // For IXSCAN stages
    indexBounds?: string; // Stringified bounds for IXSCAN
    keysExamined?: number; // Keys examined (if available)
    docsExamined?: number; // Docs examined (if available)
  }>;
  efficiencyAnalysis: {
    executionStrategy: string; // e.g., "Index Scan", "Collection Scan"
    indexUsed: string | null; // Index name or null
    hasInMemorySort: boolean; // Whether SORT stage detected
    // performanceRating not available in Stage 1 (requires execution metrics)
  }
}
```

**Design Rationale**:

The `stages` array provides all necessary information for UI visualization without including the raw `queryPlannerInfo.winningPlan` structure. This approach:

- ✅ **Reduces payload size**: Eliminates ~5-10KB of raw MongoDB metadata not used by UI
- ✅ **Simplifies frontend**: UI consumes flat array instead of nested tree
- ✅ **Maintains flexibility**: Can add fields to `stages` array as needed
- ✅ **Performance**: Smaller JSON payloads improve network performance

If advanced users need the raw plan, they can access it in Stage 2's `rawExecutionStats` which includes the complete explain output.

### Implementation Notes

**Design Document Alignment**:

1. **Metrics Row** (design doc 2.1): Display individual metric cards
   - Execution Time: Tracked by ClusterSession during query execution
   - Documents Returned: Show "n/a" (not available until Stage 2 with executionStats)
   - Keys Examined: Show "n/a" (not available until Stage 2)
   - Docs Examined: Show "n/a" (not available until Stage 2)

2. **Query Plan Summary** (design doc 2.2): Fast planner-only view
   - Extract full logical plan tree from `explain("queryPlanner")`
   - Include rejected plans count
   - No runtime stats (Stage 2 provides those)

3. **Query Efficiency Analysis Card** (design doc 2.3): Partial data
   - Execution Strategy: From top-level stage
   - Index Used: From IXSCAN stage if present
   - In-Memory Sort: Detect SORT stage
   - Performance Rating: Not available (requires execution stats from Stage 2)

**Data Collection in ClusterSession**:

When Stage 1 is requested, the `ClusterSession` class handles data collection:

1. **Execution Time Tracking**: ClusterSession automatically tracks query execution time during `runFindQueryWithCache()`:
   - Measures time before/after calling `_client.runFindQuery()`
   - Stores in `_lastExecutionTimeMs` private property
   - Available via `getLastExecutionTimeMs()` method
   - Reset when query changes (in `resetCachesIfQueryChanged()`)

2. **New Query Detection**: The existing `resetCachesIfQueryChanged()` method detects when the query text changes

3. **Automatic explain("queryPlanner") Call**: On the first Stage 1 request after a new query:
   - Extract the base query (filter, projection, sort) from the request parameters
   - **Remove `skip` and `limit` modifiers** to analyze the full query scope (not just one page)
   - Execute `explain("queryPlanner")` with the clean query
   - Persist results in `_queryPlannerCache`

4. **Caching**: Subsequent Stage 1 requests return cached `_queryPlannerCache` until query changes

5. **Cache Invalidation**: When `resetCachesIfQueryChanged()` detects a query change, all caches are cleared

This approach ensures:

- ✅ Query insights reflect the full query performance (not just one page)
- ✅ Only one `explain("queryPlanner")` call per unique query
- ✅ Automatic cache management tied to query lifecycle
- ✅ Execution time tracked server-side (consistent, not affected by network latency)
- ✅ Existing `skip`/`limit` paging for Results view remains unchanged

**Technical Details**:

1. **Execution Time**: Measured server-side by ClusterSession during `runFindQueryWithCache()` execution
2. **Documents Returned**: **NOT AVAILABLE in Stage 1** - `explain("queryPlanner")` does not execute the query, so document count is unknown. This metric shows as 0 in Stage 1 and becomes available in Stage 2 with `explain("executionStats")`.
3. **QueryPlanner Info**: Obtained via ClusterSession's `getQueryPlannerInfo()` method (strips skip/limit, calls explain)
4. **Stages List**: Recursively traverse `winningPlan` to extract all stages for UI cards

**Why Documents Returned is Not Available in Stage 1**:

The `explain("queryPlanner")` command analyzes the query plan but **does not execute the query**. Therefore:

- ✅ Stage 1 is fast (no query execution)
- ❌ No document count available (would require query execution)
- ✅ Shows 0 as placeholder in Stage 1 UI
- ✅ Stage 2 provides actual count via `explain("executionStats")` which executes the winning plan

### Extracting Data from queryPlanner Output

The `explain("queryPlanner")` output structure is consistent across DocumentDB platforms. This implementation will focus on the fields that are reliably available.

#### Common Fields in DocumentDB

**Available in DocumentDB (using MongoDB API):**

1. **`queryPlanner.namespace`** (string)
   - Format: `"database.collection"`
   - Example: `"StoreData.stores"`, `"demoDatabase.movies"`, `"sample_airbnb.listingsAndReviews"`

2. **`queryPlanner.winningPlan.stage`** (string)
   - Top-level stage type: `"COLLSCAN"`, `"FETCH"`, `"SORT"`, `"IXSCAN"`, etc.
   - Present in all explain outputs

3. **`queryPlanner.winningPlan.inputStage`** (object, when present)
   - Nested stage information
   - Contains: `stage`, and potentially `indexName`, `runtimeFilterSet`, etc.
   - Can be nested multiple levels deep

4. **`estimatedTotalKeysExamined`** (number)
   - Available at stage level
   - Indicates estimated number of keys/documents to examine
   - Example: `41505`, `20752`, `2`

5. **`runtimeFilterSet`** (array, when present)
   - Shows filter predicates applied during scan
   - Example: `[{ "$gt": { "year": 1900 } }]`, `[{ "$eq": { "storeFeatures": 38 } }]`

6. **`sortKeysCount`** (number, for SORT stages)
   - Indicates number of sort fields
   - Example: `1`

#### Fields Used in This Implementation

For this iteration, we will extract and use the following fields that are consistently available in DocumentDB:

1. **`queryPlanner.namespace`** - Database and collection name
2. **`queryPlanner.winningPlan.stage`** - Top-level execution stage
3. **`queryPlanner.winningPlan.inputStage`** - Nested stage information (when present)
4. **`estimatedTotalKeysExamined`** - Estimated keys/documents to examine
5. **`runtimeFilterSet`** - Runtime filter predicates
6. **`sortKeysCount`** - Sort field count (for SORT stages)

These fields provide sufficient information for Stage 1 insights.

#### Extraction Strategy for Stage 1

```typescript
interface Stage1QueryPlannerExtraction {
  // Common fields
  namespace: string; // Always available
  topLevelStage: string; // winningPlan.stage

  // Estimated metrics
  estimatedTotalKeysExamined?: number; // At stage level

  // Runtime filters
  hasRuntimeFilters: boolean; // Check for runtimeFilterSet
  runtimeFilterCount?: number; // Number of runtime filters

  // Index usage indicators (detected from stage tree)
  usesIndex: boolean; // True if IXSCAN stage found
  indexName?: string; // From IXSCAN stage (if available)

  // Sort indicators
  hasSortStage: boolean; // True if SORT stage found
  sortKeysCount?: number; // Number of sort fields

  // Full stage tree (for UI display)
  stageTree: StageNode[]; // Flattened hierarchy
}

interface StageNode {
  stage: string; // Stage type
  indexName?: string; // For IXSCAN (if available)
  estimatedKeys?: number; // estimatedTotalKeysExamined
  sortKeysCount?: number; // For SORT stages
  runtimeFilters?: string; // Stringified filter predicates
}

// Extraction function
function extractStage1Data(explainOutput: unknown): Stage1QueryPlannerExtraction {
  const qp = explainOutput.queryPlanner;

  return {
    namespace: qp.namespace,
    topLevelStage: qp.winningPlan.stage,

    // Estimated metrics
    estimatedTotalKeysExamined: qp.winningPlan.estimatedTotalKeysExamined,

    // Runtime filters
    hasRuntimeFilters: !!qp.winningPlan.runtimeFilterSet,
    runtimeFilterCount: qp.winningPlan.runtimeFilterSet?.length,

    // Index detection
    usesIndex: hasIndexScan(qp.winningPlan),
    indexName: findIndexName(qp.winningPlan),

    // Sort detection
    hasSortStage: qp.winningPlan.stage === 'SORT',
    sortKeysCount: qp.winningPlan.sortKeysCount,

    // Build stage tree
    stageTree: flattenStageTree(qp.winningPlan),
  };
}

// Helper: recursively check for IXSCAN stage
function hasIndexScan(stage: any): boolean {
  if (stage.stage === 'IXSCAN') return true;
  if (stage.inputStage) return hasIndexScan(stage.inputStage);
  return false;
}

// Helper: find index name in stage tree
function findIndexName(stage: any): string | undefined {
  if (stage.stage === 'IXSCAN') return stage.indexName;
  if (stage.inputStage) return findIndexName(stage.inputStage);
  return undefined;
}

// Helper: flatten stage tree for UI display
function flattenStageTree(stage: any, depth = 0): StageNode[] {
  const nodes: StageNode[] = [];

  const node: StageNode = {
    stage: stage.stage,
  };

  // Add stage-specific fields (common across platforms)
  if (stage.indexName) node.indexName = stage.indexName;
  if (stage.estimatedTotalKeysExamined) node.estimatedKeys = stage.estimatedTotalKeysExamined;
  if (stage.sortKeysCount) node.sortKeysCount = stage.sortKeysCount;
  if (stage.runtimeFilterSet) node.runtimeFilters = JSON.stringify(stage.runtimeFilterSet);

  nodes.push(node);

  // Recurse into inputStage
  if (stage.inputStage) {
    nodes.push(...flattenStageTree(stage.inputStage, depth + 1));
  }

  return nodes;
}
```

**Note**: The above extraction functions are simplified examples. In the actual implementation, we use the utilities from `src/documentdb/utils/explainPlanUtils.ts` which leverage `@mongodb-js/explain-plan-helper` for robust parsing (see Infrastructure section above).

#### Platform Detection Strategy

DocumentDB explain output uses `explainVersion: 2`:

```typescript
function detectDocumentDBPlatform(explainOutput: any): 'documentdb' | 'unknown' {
  // DocumentDB uses explainVersion: 2
  if (explainOutput.explainVersion === 2) {
    return 'documentdb';
  }

  return 'unknown';
}
```

### ClusterSession Extensions for Stage 1

**Important**: ClusterSession uses QueryInsightsApis but doesn't instantiate it. The QueryInsightsApis instance is provided by ClustersClient (see "ClustersClient Extensions" section below).

Add to `ClusterSession` class:

```typescript
export class ClusterSession {
  // Existing properties...
  private _currentQueryPlannerInfo?: unknown;
  private _currentExecutionTime?: number;
  private _currentDocumentsReturned?: number;

  // Query Insights APIs are accessed via this._client.queryInsightsApis
  // (instantiated in ClustersClient, not here)

  constructor(/* existing parameters */) {
    // Existing initialization...
    // No QueryInsightsApis instantiation here - that's ClustersClient's responsibility
  }

  // Update resetCachesIfQueryChanged to clear explain caches
  private resetCachesIfQueryChanged(query: string) {
    if (this._currentQueryText.localeCompare(query.trim(), undefined, { sensitivity: 'base' }) === 0) {
      return;
    }

    // Clear all caches
    this._currentJsonSchema = {};
    this._currentRawDocuments = [];
    this._currentQueryPlannerInfo = undefined;
    this._currentExecutionTime = undefined;
    this._currentDocumentsReturned = undefined;

    this._currentQueryText = query.trim();
  }

  // NEW: Get query planner info (Stage 1)
  // This method handles the "clean query" execution for insights (without skip/limit)
  public async getQueryPlannerInfo(databaseName: string, collectionName: string): Promise<unknown> {
    if (this._currentQueryPlannerInfo) {
      return this._currentQueryPlannerInfo;
    }

    // Extract base query components from current query
    // Note: This assumes the query is stored in a parseable format in ClusterSession
    const baseQuery = this.extractBaseQuery(); // Returns { filter, projection, sort } without skip/limit

    // Run explain("queryPlanner") with clean query (no skip/limit)
    // This provides insights for the full query scope, not just one page
    // Access QueryInsightsApis through ClustersClient
    this._currentQueryPlannerInfo = await this._client.queryInsightsApis.explainFind(
      databaseName,
      collectionName,
      baseQuery.filter,
      {
        verbosity: 'queryPlanner',
        sort: baseQuery.sort,
        projection: baseQuery.projection,
        // Intentionally omit skip and limit for full query insights
      },
    );

    return this._currentQueryPlannerInfo;
  }

  // NEW: Extract base query without paging modifiers
  private extractBaseQuery(): { filter?: unknown; projection?: unknown; sort?: unknown } {
    // Implementation extracts filter, projection, sort from current query
    // Strips skip and limit for accurate full-query analysis
    // Details depend on how query is stored in ClusterSession
    return {
      filter: this._currentFilter,
      projection: this._currentProjection,
      sort: this._currentSort,
      // skip and limit intentionally omitted
    };
  }

  // NEW: Store query metadata
  public setQueryMetadata(executionTime: number, documentsReturned: number): void {
    this._currentExecutionTime = executionTime;
    this._currentDocumentsReturned = documentsReturned;
  }

  // NEW: Get query metadata
  public getQueryMetadata(): { executionTime?: number; documentsReturned?: number } {
    return {
      executionTime: this._currentExecutionTime,
      documentsReturned: this._currentDocumentsReturned,
    };
  }
}
```

### ClustersClient Extensions for Stage 1

**Architecture Pattern**: Follow the `LlmEnhancedFeatureApis.ts` pattern

QueryInsightsApis is instantiated in `ClustersClient`, similar to how `llmEnhancedFeatureApis` is instantiated. This follows the established pattern:

1. ClustersClient owns the MongoClient instance
2. Feature-specific API classes (like QueryInsightsApis) are instantiated in ClustersClient
3. These APIs are exposed as public properties for use by ClusterSession and other consumers

**Implementation in ClustersClient**:

```typescript
import { QueryInsightsApis } from './QueryInsightsApis';

export class ClustersClient {
  private readonly _mongoClient: MongoClient;

  // Existing feature APIs
  public readonly llmEnhancedFeatureApis: ReturnType<typeof llmEnhancedFeatureApis>;

  // NEW: Query Insights APIs
  public readonly queryInsightsApis: QueryInsightsApis;

  constructor(/* existing parameters */) {
    // Existing initialization...
    this._mongoClient = new MongoClient(/* ... */);

    // Initialize feature APIs
    this.llmEnhancedFeatureApis = llmEnhancedFeatureApis(this._mongoClient);

    // NEW: Initialize Query Insights APIs
    this.queryInsightsApis = new QueryInsightsApis(this._mongoClient);
  }

  // ... rest of the class
}
```

**QueryInsightsApis Implementation**: `src/documentdb/QueryInsightsApis.ts` (already exists, no changes needed)

The QueryInsightsApis class already follows the correct pattern:

```typescript
import { type Document, type Filter, type MongoClient, type Sort } from 'mongodb';

/**
 * Options for explain operations on find queries
 */
export interface ExplainFindOptions {
  // Query filter
  filter?: Filter<Document>;
  // Sort specification
  sort?: Sort;
  // Projection specification
  projection?: Document;
  // Number of documents to skip (omit for Stage 1 insights)
  skip?: number;
  // Maximum number of documents to return (omit for Stage 1 insights)
  limit?: number;
}

/**
 * Explain verbosity levels
 */
export type ExplainVerbosity = 'queryPlanner' | 'executionStats' | 'allPlansExecution';

/**
 * Explain result from MongoDB/DocumentDB
 */
export interface ExplainResult {
  // Query planner information
  queryPlanner: {
    // MongoDB/DocumentDB version
    mongodbVersion?: string;
    // Namespace (database.collection)
    namespace: string;
    // Whether index filter was set
    indexFilterSet: boolean;
    // Parsed query
    parsedQuery?: Document;
    // Winning plan
    winningPlan: Document;
    // Rejected plans
    rejectedPlans?: Document[];
  };
  // Execution statistics (only with executionStats or allPlansExecution)
  executionStats?: {
    // Execution success status
    executionSuccess: boolean;
    // Number of documents returned
    nReturned: number;
    // Execution time in milliseconds
    executionTimeMillis: number;
    // Total number of keys examined
    totalKeysExamined: number;
    // Total number of documents examined
    totalDocsExamined: number;
    // Detailed execution stages
    executionStages: Document;
  };
  // Server information
  serverInfo?: {
    host: string;
    port: number;
    version: string;
  };
  // DocumentDB platform indicator
  explainVersion?: number;
  // Operation status
  ok: number;
}

/**
 * Query Insights APIs for explain operations
 * Follows the architecture pattern established in LlmEnhancedFeatureApis.ts
 */
export class QueryInsightsApis {
  constructor(private readonly mongoClient: MongoClient) {}

  /**
   * Explain a find query with specified verbosity
   * @param databaseName - Name of the database
   * @param collectionName - Name of the collection
   * @param options - Query options including filter, sort, projection, skip, and limit
   * @param verbosity - Explain verbosity level (queryPlanner, executionStats, or allPlansExecution)
   * @returns Detailed explain result
   */
  async explainFind(
    databaseName: string,
    collectionName: string,
    options: ExplainFindOptions = {},
    verbosity: ExplainVerbosity = 'queryPlanner',
  ): Promise<ExplainResult> {
    const db = this.mongoClient.db(databaseName);

    const { filter = {}, sort, projection, skip, limit } = options;

    const findCmd: Document = {
      find: collectionName,
      filter,
    };

    // Add optional fields if they are defined
    if (sort !== undefined) {
      findCmd.sort = sort;
    }

    if (projection !== undefined) {
      findCmd.projection = projection;
    }

    if (skip !== undefined && skip >= 0) {
      findCmd.skip = skip;
    }

    if (limit !== undefined && limit >= 0) {
      findCmd.limit = limit;
    }

    const command: Document = {
      explain: findCmd,
      verbosity,
    };

    const explainResult = await db.command(command);

    return explainResult as ExplainResult;
  }
}
```

**Usage in ClusterSession**:

```typescript
// In ClusterSession constructor or initialization
this._queryInsightsApis = new QueryInsightsApis(this._client._mongoClient);

// When calling explain for Stage 1 (without skip/limit)
const explainResult = await this._queryInsightsApis.explainFind(
  databaseName,
  collectionName,
  {
    filter: baseQuery.filter,
    sort: baseQuery.sort,
    projection: baseQuery.projection,
    // Intentionally omit skip and limit for full query insights
  },
  'queryPlanner',
);
```

### Mock Data Structure

```typescript
// Example mock response (Stage 1)
{
  executionTime: 23.433235,  // ms (client-side measurement)
  documentsReturned: 2,
  stages: [
    {
      stage: "IXSCAN",
      name: "Index Scan",
      nReturned: 2,
      indexName: "user_id_1",
      indexBounds: "user_id: [1234, 1234]"
    },
    {
      stage: "FETCH",
      name: "Fetch",
      nReturned: 2
    },
    {
      stage: "PROJECTION",
      name: "Projection",
      nReturned: 2
    }
  ],
  efficiencyAnalysis: {
    executionStrategy: "Index Scan + Fetch",
    indexUsed: "user_id_1",
    hasInMemorySort: false
  }
}
```

---

## Stage 2: Detailed Execution Analysis (executionStats)

### Purpose

**Design Goal** (from performance-advisor.md): Run `explain("executionStats")` to gather authoritative counts and timing. Execute the winning plan to completion and return authoritative runtime metrics.

Provides comprehensive execution metrics by re-running the query with `executionStats` mode. This reveals actual performance characteristics and enables accurate performance rating.

### Data Sources

- MongoDB API `explain("executionStats")` command
- Execution statistics from all stages
- Index usage metrics

### Router Endpoint

**Name**: `getQueryInsightsStage1`

**Type**: `query` (read operation)

**Input Schema**:

```typescript
z.object({
  // Empty - relies on RouterContext.sessionId to retrieve query details
  // The query parameters are already cached from the initial query execution
});
```

**Context Requirements**:

- `sessionId`: Used to retrieve cached query details and re-run with executionStats
- `clusterId`: Identifies the DocumentDB cluster/connection to use
- `databaseName` & `collectionName`: Target collection for explain command

**Implementation Flow**:

1. Retrieve query details from session cache using `sessionId`
2. Re-run query with `explain("executionStats")`
3. Cache execution stats in session for potential Stage 2 use
4. Transform and return detailed metrics

**Output Schema**:

```typescript
{
  // Execution-level metrics
  executionTimeMs: number;           // Server-reported execution time
  totalKeysExamined: number;         // Total index keys scanned
  totalDocsExamined: number;         // Total documents examined
  documentsReturned: number;         // Final result count

  // Derived efficiency metrics
  examinedToReturnedRatio: number;   // docsExamined / docsReturned (efficiency indicator)
  keysToDocsRatio: number | null;    // keysExamined / docsExamined (index selectivity)

  // Execution strategy analysis
  executionStrategy: string;         // e.g., "Index Scan + Fetch", "Collection Scan", "Covered Query"
  indexUsed: boolean;                // Whether any index was used
  usedIndexNames: string[];          // List of index names utilized
  hadInMemorySort: boolean;          // Whether sorting happened in memory (expensive)
  hadCollectionScan: boolean;        // Whether full collection scan occurred

  // Performance rating
  performanceRating: {
    score: 'excellent' | 'good' | 'fair' | 'poor';
    reasons: string[];               // Array of reasons for the rating
    concerns: string[];              // Performance concerns identified
  };

  // Detailed stage breakdown
  stages: Array<{
    stage: string;
    indexName?: string;
    keysExamined?: number;
    docsExamined?: number;
    nReturned?: number;
    executionTimeMs?: number;
    indexBounds?: string;
    sortPattern?: Record<string, number>;
    isBlocking?: boolean;            // For SORT stages
  }>;

  // Raw executionStats (for debugging/advanced users)
  rawExecutionStats: Record<string, unknown>;
}
```

### Implementation Notes

**Design Document Alignment**:

1. **Metrics Row Update** (design doc 3.1): Replace "n/a" with authoritative values
   - Execution Time: Server-reported `executionTimeMillis` (prefer over client timing)
   - Documents Returned: From `nReturned`
   - Keys Examined: From `totalKeysExamined`
   - Docs Examined: From `totalDocsExamined`

2. **Query Efficiency Analysis Card** (design doc 3.2): Now fully populated
   - Execution Strategy: Extracted from top-level stage
   - Index Used: From IXSCAN stage's `indexName`
   - Examined/Returned Ratio: Calculated and formatted
   - In-Memory Sort: Detected from SORT stage
   - Performance Rating: Calculated based on ratio thresholds

3. **Execution Details** (design doc 3.3): Extract comprehensive metrics
   - Per-stage counters (keysExamined, docsExamined, nReturned)
   - Sort & memory indicators
   - Covering query detection (no FETCH in executed path)
   - Sharded attribution (when applicable)

4. **Quick Actions** (design doc 3.6): Enable after Stage 2 completes
   - Export capabilities
   - View raw explain output

**Technical Implementation**:

1. **Execution Strategy Determination**:
   - "Covered Query": IXSCAN with no FETCH stage (index-only)
   - "Index Scan + Fetch": IXSCAN followed by FETCH
   - "Collection Scan": COLLSCAN stage present
   - "In-Memory Sort": SORT stage with `isBlocking: true`

2. **Performance Rating Algorithm**:

   The performance rating uses the **efficiency ratio** (returned/examined) where higher values indicate better performance. This is the authoritative algorithm implemented in `src/documentdb/queryInsights/ExplainPlanAnalyzer.ts`.

   ```typescript
   /**
    * Rating criteria:
    * - Excellent: High efficiency (>=50%), indexed, no in-memory sort, fast (<100ms)
    * - Good: Moderate efficiency (>=10%), indexed or fast (<500ms)
    * - Fair: Low efficiency (>=1%)
    * - Poor: Very low efficiency (<1%) or collection scan with low efficiency
    */
   function calculatePerformanceRating(
     executionTimeMs: number,
     efficiencyRatio: number,
     hasInMemorySort: boolean,
     isIndexScan: boolean,
     isCollectionScan: boolean,
   ): 'excellent' | 'good' | 'fair' | 'poor' {
     // Poor: Collection scan with very low efficiency
     if (isCollectionScan && efficiencyRatio < 0.01) {
       return 'poor';
     }

     // Excellent: High efficiency, uses index, no blocking sort, fast execution
     if (efficiencyRatio >= 0.5 && isIndexScan && !hasInMemorySort && executionTimeMs < 100) {
       return 'excellent';
     }

     // Good: Moderate efficiency with index usage or fast execution
     if (efficiencyRatio >= 0.1 && (isIndexScan || executionTimeMs < 500)) {
       return 'good';
     }

     // Fair: Low efficiency but acceptable
     if (efficiencyRatio >= 0.01) {
       return 'fair';
     }

     return 'poor';
   }

   function calculateEfficiencyRatio(returned: number, examined: number): number {
     if (examined === 0) return returned === 0 ? 1.0 : 0.0;
     return returned / examined;
   }
   ```

   **Key Metrics**:
   - **Efficiency Ratio**: `returned / examined` (range: 0.0 to 1.0+, higher is better)
   - **Execution Time**: Server-reported milliseconds
   - **Index Usage**: Whether any index was used (IXSCAN stage)
   - **Collection Scan**: Whether full collection scan occurred (COLLSCAN stage)
   - **In-Memory Sort**: Whether blocking sort happened (SORT stage)

   **Thresholds**:
   - `efficiencyRatio >= 0.5` (50%+) → Excellent potential
   - `efficiencyRatio >= 0.1` (10%+) → Good potential
   - `efficiencyRatio >= 0.01` (1%+) → Fair potential
   - `efficiencyRatio < 0.01` (<1%) → Poor

3. **Stages Extraction**: Recursively traverse `executionStats.executionStages` tree

4. **Using @mongodb-js/explain-plan-helper for Stage 2**:

   ```typescript
   import { ExplainPlan } from '@mongodb-js/explain-plan-helper';

   function analyzeExecutionStats(explainResult: unknown) {
     const plan = new ExplainPlan(explainResult);

     // Get high-level metrics directly
     const metrics = {
       executionTimeMs: plan.executionTimeMillis,
       totalKeysExamined: plan.totalKeysExamined,
       totalDocsExamined: plan.totalDocsExamined,
       documentsReturned: plan.nReturned,

       // Derived metrics
       examinedToReturnedRatio: plan.totalDocsExamined / plan.nReturned,

       // Query characteristics
       hadCollectionScan: plan.isCollectionScan,
       hadInMemorySort: plan.inMemorySort,
       indexUsed: plan.isIndexScan,
       isCoveredQuery: plan.isCovered,
     };

     // Calculate performance rating using the metrics
     const performanceRating = calculatePerformanceRating(metrics);

     return { ...metrics, performanceRating };
   }
   ```

   This approach leverages the library's pre-built analysis rather than manually parsing the execution tree.

5. **Extended Stage Information Extraction** (for Query Plan Overview):

   We can extract stage-specific details for UI display:

   ```typescript
   import type { Stage } from '@mongodb-js/explain-plan-helper';

   /**
    * Extended information for a single stage (for UI display)
    */
   export interface ExtendedStageInfo {
     stageId: string;
     stageName: string;
     properties: Record<string, string | number | boolean | undefined>;
   }

   /**
    * Extracts extended stage information for query plan overview visualization
    *
    * @param stage - Stage from ExplainPlan.executionStages
    * @param stageId - Unique identifier for the stage
    * @returns Extended information with properties for UI display
    */
   function extractExtendedStageInfo(stage: Stage, stageId: string): ExtendedStageInfo {
     const stageName = stage.stage || stage.shardName || 'UNKNOWN';
     const properties = extractStageProperties(stageName, stage);

     return {
       stageId,
       stageName,
       properties,
     };
   }

   /**
    * Extracts properties for a specific stage type
    * Maps stage type to relevant properties for UI display
    *
    * Stage-specific properties:
    * - IXSCAN/EXPRESS_IXSCAN: Index name, multi-key indicator, bounds, keys examined
    * - PROJECTION: Transform specification
    * - COLLSCAN: Documents examined, scan direction
    * - FETCH: Documents examined
    * - SORT: Sort pattern, memory usage, disk spill indicator
    * - LIMIT/SKIP: Limit/skip amounts
    * - TEXT stages: Search string, parsed query
    * - GEO_NEAR: Key pattern, index info
    * - COUNT/DISTINCT: Index usage, keys examined
    * - IDHACK: Keys/docs examined
    * - SHARDING_FILTER: Chunks skipped
    * - SHARD_MERGE/SINGLE_SHARD: Shard count
    * - DELETE/UPDATE: Documents modified
    */
   function extractStageProperties(
     stageName: string,
     stage: Stage,
   ): Record<string, string | number | boolean | undefined> {
     switch (stageName) {
       case 'IXSCAN':
       case 'EXPRESS_IXSCAN':
         return {
           'Index Name': stage.indexName,
           'Multi Key Index': stage.isMultiKey,
           'Index Bounds': stage.indexBounds ? JSON.stringify(stage.indexBounds) : undefined,
           'Keys Examined': stage.keysExamined,
         };

       case 'PROJECTION':
       case 'PROJECTION_SIMPLE':
       case 'PROJECTION_DEFAULT':
       case 'PROJECTION_COVERED':
         return {
           'Transform by': stage.transformBy ? JSON.stringify(stage.transformBy) : undefined,
         };

       case 'COLLSCAN':
         return {
           'Documents Examined': stage.docsExamined,
           Direction: stage.direction, // forward or backward
         };

       case 'FETCH':
         return {
           'Documents Examined': stage.docsExamined,
         };

       case 'SORT':
       case 'SORT_KEY_GENERATOR':
         return {
           'Sort Pattern': stage.sortPattern ? JSON.stringify(stage.sortPattern) : undefined,
           'Memory Limit': stage.memLimit,
           'Memory Usage': stage.memUsage,
           'Spilled to Disk': stage.usedDisk,
         };

       case 'LIMIT':
         return {
           'Limit Amount': stage.limitAmount,
         };

       case 'SKIP':
         return {
           'Skip Amount': stage.skipAmount,
         };

       case 'TEXT':
       case 'TEXT_MATCH':
       case 'TEXT_OR':
         return {
           'Search String': stage.searchString,
           'Parsed Text Query': stage.parsedTextQuery ? JSON.stringify(stage.parsedTextQuery) : undefined,
         };

       case 'GEO_NEAR_2D':
       case 'GEO_NEAR_2DSPHERE':
         return {
           'Key Pattern': stage.keyPattern ? JSON.stringify(stage.keyPattern) : undefined,
           'Index Name': stage.indexName,
           'Index Version': stage.indexVersion,
         };

       case 'COUNT':
       case 'COUNT_SCAN':
         return {
           'Index Name': stage.indexName,
           'Keys Examined': stage.keysExamined,
         };

       case 'DISTINCT_SCAN':
         return {
           'Index Name': stage.indexName,
           'Index Bounds': stage.indexBounds ? JSON.stringify(stage.indexBounds) : undefined,
           'Keys Examined': stage.keysExamined,
         };

       case 'IDHACK':
         return {
           'Keys Examined': stage.keysExamined,
           'Documents Examined': stage.docsExamined,
         };

       case 'SHARDING_FILTER':
         return {
           'Chunks Skipped': stage.chunkSkips,
         };

       case 'CACHED_PLAN':
         return {
           Cached: true,
         };

       case 'SUBPLAN':
         return {
           'Subplan Type': stage.subplanType,
         };

       case 'SHARD_MERGE':
       case 'SINGLE_SHARD':
         return {
           'Shard Count': stage.shards?.length,
         };

       case 'BATCHED_DELETE':
         return {
           'Batch Size': stage.batchSize,
           'Documents Deleted': stage.nWouldDelete,
         };

       case 'DELETE':
       case 'UPDATE':
         return {
           'Documents Modified': stage.nWouldModify || stage.nWouldDelete,
         };

       default:
         // Unknown stage type - return empty properties
         return {};
     }
   }

   /**
    * Recursively extracts extended stage info from the execution stage tree
    * This creates a flat list of all stages with their properties for UI display
    *
    * @param executionStages - Root stage from ExplainPlan
    * @returns Array of ExtendedStageInfo for all stages in the tree
    */
   function extractAllExtendedStageInfo(executionStages: Stage | undefined): ExtendedStageInfo[] {
     if (!executionStages) return [];

     const allStageInfo: ExtendedStageInfo[] = [];
     let stageIdCounter = 0;

     function traverse(stage: Stage): void {
       const stageId = `stage-${stageIdCounter++}`;
       allStageInfo.push(extractExtendedStageInfo(stage, stageId));

       // Traverse child stages (single input)
       if (stage.inputStage) {
         traverse(stage.inputStage);
       }

       // Traverse child stages (multiple inputs, e.g., $or queries)
       if (stage.inputStages) {
         stage.inputStages.forEach(traverse);
       }

       // Traverse shard stages (sharded queries)
       if (stage.shards) {
         stage.shards.forEach(traverse);
       }
     }

     traverse(executionStages);
     return allStageInfo;
   }

   /**
    * Example usage in Stage 2 analysis:
    */
   function analyzeExecutionStatsWithExtendedInfo(explainResult: unknown) {
     const plan = new ExplainPlan(explainResult);

     // ... existing metrics extraction ...

     // Extract extended stage information for query plan overview
     const extendedStageInfo = extractAllExtendedStageInfo(plan.executionStages);

     return {
       // ... existing metrics ...
       extendedStageInfo, // Add to Stage 2 output for query plan visualization
     };
   }
   ```

   **Purpose**: The `extendedStageInfo` provides rich, stage-specific metadata for the Query Plan Overview UI component. Each stage type has relevant properties extracted (e.g., index names for IXSCAN, document counts for COLLSCAN, memory usage for SORT).

   **UI Usage**: In the Query Plan Overview, each stage can display its properties as key-value pairs, making it easy for users to understand what each stage is doing without inspecting raw JSON.

### ClusterSession Extensions for Stage 2 (previously labeled as Stage 1)

Add to `ClusterSession` class:

```typescript
export class ClusterSession {
  // Existing properties...
  private _currentExecutionStats?: unknown;

  // Update resetCachesIfQueryChanged to clear execution stats
  private resetCachesIfQueryChanged(query: string) {
    if (this._currentQueryText.localeCompare(query.trim(), undefined, { sensitivity: 'base' }) === 0) {
      return;
    }

    // Clear all caches including execution stats
    this._currentJsonSchema = {};
    this._currentRawDocuments = [];
    this._currentQueryPlannerInfo = undefined;
    this._currentExecutionStats = undefined;
    this._currentExecutionTime = undefined;
    this._currentDocumentsReturned = undefined;

    this._currentQueryText = query.trim();
  }

  // NEW: Get execution stats (Stage 2)
  public async getExecutionStats(databaseName: string, collectionName: string): Promise<unknown> {
    if (this._currentExecutionStats) {
      return this._currentExecutionStats;
    }

    // Extract base query without paging modifiers
    const baseQuery = this.extractBaseQuery();

    // Run explain("executionStats") - actually executes the query
    // Using QueryInsightsApis (follows LlmEnhancedFeatureApis pattern)
    this._currentExecutionStats = await this._queryInsightsApis.explainFind(
      databaseName,
      collectionName,
      {
        filter: baseQuery.filter,
        sort: baseQuery.sort,
        projection: baseQuery.projection,
        // Intentionally omit skip and limit for full query insights
      },
      'executionStats',
    );

    return this._currentExecutionStats;
  }
}
```

**Note**: The `QueryInsightsApis.explainFind()` method added in Stage 1 is reused here with different verbosity level (`executionStats` instead of `queryPlanner`).

### Mock Data Structure

```typescript
// Example mock response
{
  executionTimeMs: 2.333,
  totalKeysExamined: 2,
  totalDocsExamined: 10000,
  documentsReturned: 2,
  examinedToReturnedRatio: 5000,  // 10000 / 2
  keysToDocsRatio: 0.0002,        // 2 / 10000
  executionStrategy: "Index Scan + Full Collection Scan",
  indexUsed: true,
  usedIndexNames: ["user_id_1"],
  hadInMemorySort: false,
  hadCollectionScan: true,
  performanceRating: {
    score: 'poor',
    reasons: [],
    concerns: [
      'High examined-to-returned ratio (5000:1) indicates inefficient query',
      'Full collection scan performed after index lookup',
      'Only 0.02% of examined documents were returned'
    ]
  },
  stages: [
    {
      stage: "IXSCAN",
      indexName: "user_id_1",
      keysExamined: 2,
      nReturned: 2,
      indexBounds: "user_id: [1234, 1234]"
    },
    {
      stage: "FETCH",
      docsExamined: 10000,
      nReturned: 2
    },
    {
      stage: "PROJECTION",
      nReturned: 2
    }
  ],
  rawExecutionStats: { /* full DocumentDB explain output */ }
}
```

---

## Stage 3: AI-Powered Recommendations

### Purpose

**Design Goal** (from performance-advisor.md): Send collected statistics (query shape + execution metrics) to an AI service for actionable optimization recommendations. This is an opt-in stage triggered by user action.

Analyzes query performance using AI and provides actionable optimization recommendations, including index suggestions and educational content.

### Data Sources

- AI backend service (external)
- Collection statistics
- Index statistics
- Stage 1 execution stats

### Router Endpoint

**Name**: `getQueryInsightsStage3`

**Type**: `query` (read operation, but triggers AI analysis)

**Input Schema**:

```typescript
z.object({
  // Empty - relies on RouterContext.sessionId
  // Query details and execution stats are retrieved from session cache
});
```

**Context Requirements**:

- `sessionId`: Used to retrieve query details from session cache
- `clusterId`: DocumentDB connection identifier
- `databaseName` & `collectionName`: Target collection

**Implementation Flow**:

1. Retrieve query details from session cache using `sessionId`
2. Call AI backend with minimal payload (query, database, collection)
3. AI backend collects additional data (collection stats, index stats, execution stats) independently
4. Transform AI response for UI (formatted as animated suggestion cards)
5. Cache AI recommendations in session

**Note**: The AI backend is responsible for collecting collection statistics, index information, and execution metrics. In future releases, the extension may provide this data directly to reduce backend workload, but this is not in scope for the upcoming release.

**Backend AI Request Payload**:

```typescript
{
  query: string; // The DocumentDB query
  databaseName: string; // Database name
  collectionName: string; // Collection name
}
```

**Backend AI Response**:

The AI backend returns optimization recommendations. The response schema is defined in the tRPC router and automatically validated.

```typescript
interface OptimizationRecommendations {
  analysis: string;
  improvements: Array<{
    action: 'create' | 'drop' | 'none' | 'modify';
    indexSpec: Record<string, number>;
    indexOptions?: Record<string, unknown>;
    mongoShell: string;
    justification: string;
    priority: 'high' | 'medium' | 'low';
    risks?: string;
  }>;
  verification: string;
}
```

**Router Output** (Transformed for UI):

The router transforms the AI response into UI-friendly format with action buttons. Button payloads include all necessary context for performing actions (e.g., `clusterId`, `databaseName`, `collectionName`, plus action-specific data).

Example transformation:

```typescript
{
  analysisCard: {
    type: 'analysis';
    content: string; // The overall analysis from AI
  }

  improvementCards: Array<{
    type: 'improvement';
    cardId: string; // Unique identifier

    // Card header
    title: string; // e.g., "Recommendation: Create Index"
    priority: 'high' | 'medium' | 'low';

    // Main content
    description: string; // Justification field
    recommendedIndex: string; // Stringified indexSpec, e.g., "{ user_id: 1 }"
    recommendedIndexDetails: string; // Additional explanation about the index

    // Additional info
    details: string; // Risks or additional considerations
    mongoShellCommand: string; // The mongoShell command to execute

    // Action buttons with complete context for execution
    primaryButton: {
      label: string; // e.g., "Create Index"
      actionId: string; // e.g., "createIndex"
      payload: {
        // All context needed to perform the action
        clusterId: string;
        databaseName: string;
        collectionName: string;
        action: 'create' | 'drop' | 'modify';
        indexSpec: Record<string, number>;
        indexOptions?: Record<string, unknown>;
        mongoShell: string;
      };
    };

    secondaryButton?: {
      label: string; // e.g., "Learn More"
      actionId: string; // e.g., "learnMore"
      payload: {
        topic: string; // e.g., "compound-indexes"
      };
    };
  }>;

  verificationSteps: string; // How to verify improvements
}
```

### Transformation Logic

```typescript
function transformAIResponseForUI(aiResponse: OptimizationRecommendations, context: RouterContext) {
  const analysisCard = {
    type: 'analysis',
    content: aiResponse.analysis,
  };

  const improvementCards = aiResponse.improvements.map((improvement, index) => {
    const actionVerb = {
      create: 'Create',
      drop: 'Drop',
      modify: 'Modify',
      none: 'No Action',
    }[improvement.action];

    const indexSpecStr = JSON.stringify(improvement.indexSpec, null, 2);

    return {
      type: 'improvement',
      cardId: `improvement-${index}`,
      title: `Recommendation: ${actionVerb} Index`,
      priority: improvement.priority,
      description: improvement.justification,
      recommendedIndex: indexSpecStr,
      recommendedIndexDetails: generateIndexExplanation(improvement),
      details: improvement.risks || 'Additional write and storage overhead for maintaining a new index.',
      mongoShellCommand: improvement.mongoShell,
      primaryButton: {
        label: `${actionVerb} Index`,
        actionId:
          improvement.action === 'create' ? 'createIndex' : improvement.action === 'drop' ? 'dropIndex' : 'modifyIndex',
        payload: {
          // Include all context needed to execute the action
          clusterId: context.clusterId,
          databaseName: context.databaseName,
          collectionName: context.collectionName,
          action: improvement.action,
          indexSpec: improvement.indexSpec,
          indexOptions: improvement.indexOptions,
          mongoShell: improvement.mongoShell,
        },
      },
      secondaryButton: {
        label: 'Learn More',
        actionId: 'learnMore',
        payload: {
          topic: 'index-optimization',
        },
      },
    };
  });

  return {
    analysisCard,
    improvementCards,
    verificationSteps: aiResponse.verification,
  };
}

function generateIndexExplanation(improvement) {
  const fields = Object.keys(improvement.indexSpec).join(', ');

  switch (improvement.action) {
    case 'create':
      return `An index on ${fields} would allow direct lookup of matching documents and eliminate full collection scans.`;
    case 'drop':
      return `This index on ${fields} is not being used and adds unnecessary overhead to write operations.`;
    case 'modify':
      return `Optimizing the index on ${fields} can improve query performance by better matching the query pattern.`;
    default:
      return 'No index changes needed at this time.';
  }
}
```

### Mock Data Structure

```typescript
// Example mock response (transformed)
{
  analysisCard: {
    type: 'analysis',
    content: 'Your query performs a full collection scan after the index lookup, examining 10,000 documents to return only 2. This indicates the index is not selective enough or additional filtering is happening after the index stage.'
  },

  improvementCards: [
    {
      type: 'improvement',
      cardId: 'improvement-0',
      title: 'Recommendation: Create Index',
      priority: 'high',
      description: 'COLLSCAN examined 10000 docs vs 2 returned (totalKeysExamined: 2). A compound index on { user_id: 1, status: 1 } will eliminate the full scan by supporting both the equality filter and the additional filtering condition.',
      recommendedIndex: '{\n  "user_id": 1,\n  "status": 1\n}',
      recommendedIndexDetails: 'An index on user_id, status would allow direct lookup of matching documents and eliminate full collection scans.',
      details: 'Additional write and storage overhead for maintaining a new index. Index size estimated at ~50MB for current collection size.',
      mongoShellCommand: 'db.users.createIndex({ user_id: 1, status: 1 })',
      primaryButton: {
        label: 'Create Index',
        actionId: 'createIndex',
        payload: {
          action: 'create',
          indexSpec: { user_id: 1, status: 1 },
          indexOptions: {},
          mongoShell: 'db.users.createIndex({ user_id: 1, status: 1 })'
        }
      },
      secondaryButton: {
        label: 'Learn More',
        actionId: 'learnMore',
        payload: {
          topic: 'compound-indexes'
        }
      }
    }
  ],

  verificationSteps: 'After creating the index, run the same query and verify that: 1) docsExamined equals documentsReturned, 2) the execution plan shows IXSCAN using the new index, 3) no COLLSCAN stage appears in the plan.',

  metadata: {
    collectionName: 'users',
    collectionStats: { count: 50000, size: 10485760 },
    indexStats: [
      { name: '_id_', key: { _id: 1 } },
      { name: 'user_id_1', key: { user_id: 1 } }
    ],
    executionStats: { /* ... */ },
    derived: {
      totalKeysExamined: 2,
      totalDocsExamined: 10000,
      keysToDocsRatio: 0.0002,
      usedIndex: 'user_id_1'
    }
  }
}
```

### ClusterSession Extensions for Stage 3

**Architecture Decision: Option 3 - Service-Specific Cache Methods**

After evaluating multiple caching architecture options, we've chosen to follow the **existing pattern** established by `getQueryPlannerInfo()` and `getExecutionStats()`:

**Rejected Options:**

- ❌ **Option 1**: Self-contained service with internal caching - breaks session lifecycle, can't leverage query-based invalidation
- ❌ **Option 2**: Generic key/value store - loses type safety, unclear domain semantics

**Selected Option 3: Follow Established Pattern**

ClusterSession exposes typed, domain-specific cache methods that:

- ✅ Are type-safe (no `unknown` in public API)
- ✅ Integrate with existing `resetCachesIfQueryChanged()` invalidation
- ✅ Keep services stateless (ClustersClient owns service instances)
- ✅ Match the architecture of QueryPlanner and ExecutionStats caching
- ✅ Are easy to test and understand

**Cache Structure with Timestamps:**

All Query Insights caches include timestamps for potential future features:

```typescript
private _queryPlannerCache?: { result: Document; timestamp: number };
private _executionStatsCache?: { result: Document; timestamp: number };
private _aiRecommendationsCache?: { result: unknown; timestamp: number };
```

**Why timestamps?**

- **Current use**: None - cache invalidation is purely query-based via `resetCachesIfQueryChanged()`
- **Future use cases**:
  - Time-based expiration (e.g., "re-run explain if > 5 minutes old")
  - Performance monitoring (track how long cached data has been reused)
  - Diagnostics (show users when explain was last collected)
  - Staleness warnings for production monitoring scenarios
- **Cost**: Negligible (just a number per cache entry)
- **Benefit**: Enables future features without breaking changes to cache structure

**Implementation:**

Add to `ClusterSession` class:

```typescript
export class ClusterSession {
  // Existing properties...
  /**
   * Query Insights caching
   * Note: QueryInsightsApis instance is accessed via this._client.queryInsightsApis
   *
   * Timestamps are included for potential future features:
   * - Time-based cache invalidation (e.g., expire after N seconds)
   * - Diagnostics (show when explain was collected)
   * - Performance monitoring
   *
   * Currently, cache invalidation is purely query-based via resetCachesIfQueryChanged()
   */
  private _queryPlannerCache?: { result: Document; timestamp: number };
  private _executionStatsCache?: { result: Document; timestamp: number };
  private _aiRecommendationsCache?: { result: unknown; timestamp: number };

  /**
   * Gets AI-powered query optimization recommendations
   * Caches the result until the query changes
   *
   * This method follows the same pattern as getQueryPlannerInfo() and getExecutionStats():
   * - Check cache first
   * - If not cached, call the AI service via ClustersClient
   * - Cache the result with timestamp
   * - Return typed recommendations
   *
   * @param databaseName - Database name
   * @param collectionName - Collection name
   * @param filter - Query filter
   * @param executionStats - Execution statistics from Stage 2
   * @returns AI recommendations for query optimization
   *
   * @remarks
   * This method will be implemented in Phase 3. The AI service is accessed via
   * this._client.queryInsightsAIService (similar to queryInsightsApis pattern).
   */
  public async getAIRecommendations(
    databaseName: string,
    collectionName: string,
    filter: Document,
    executionStats: Document,
  ): Promise<AIRecommendation[]> {
    // Check cache
    if (this._aiRecommendationsCache) {
      return this._aiRecommendationsCache.result as AIRecommendation[];
    }

    // Call AI service via ClustersClient (following QueryInsightsApis pattern)
    const recommendations = await this._client.queryInsightsAIService.generateRecommendations(
      databaseName,
      collectionName,
      filter,
      executionStats,
    );

    // Cache result with timestamp
    this._aiRecommendationsCache = {
      result: recommendations,
      timestamp: Date.now(),
    };

    return recommendations;
  }

  // Update clearQueryInsightsCaches to include AI recommendations
  private clearQueryInsightsCaches(): void {
    this._queryPlannerCache = undefined;
    this._executionStatsCache = undefined;
    this._aiRecommendationsCache = undefined;
  }
}
```

**Type Definitions:**

```typescript
interface AIRecommendation {
  type: 'index' | 'query' | 'schema';
  priority: 'high' | 'medium' | 'low';
  title: string;
  description: string;
  impact: string;
  implementation?: string;
  verification?: string;
}
```

### Using LlmEnhancedFeatureApis for Stage 3 Collection Stats

For Stage 3, we need collection and index statistics to send to the AI service. These methods already exist in `LlmEnhancedFeatureApis.ts`:

**Collection Statistics**: Use `llmEnhancedFeatureApis.getCollectionStats()`

```typescript
// In ClusterSession or router handler
const collectionStats = await this._llmEnhancedFeatureApis.getCollectionStats(databaseName, collectionName);

// Returns CollectionStats interface:
// {
//   ns: string;
//   count: number;
//   size: number;
//   avgObjSize: number;
//   storageSize: number;
//   nindexes: number;
//   totalIndexSize: number;
//   indexSizes: Record<string, number>;
// }
```

**Index Statistics**: Use `llmEnhancedFeatureApis.getIndexStats()`

```typescript
// In ClusterSession or router handler
const indexStats = await this._llmEnhancedFeatureApis.getIndexStats(databaseName, collectionName);

// Returns IndexStats[] interface:
// Array<{
//   name: string;
//   key: Record<string, number | string>;
//   host: string;
//   accesses: {
//     ops: number;
//     since: Date;
//   };
// }>
```

**Note**: No new methods need to be added to ClustersClient for Stage 3. The required functionality already exists in `LlmEnhancedFeatureApis.ts`.

### Transformation Logic for AI Response

```typescript
function transformAIResponseForUI(aiResponse: OptimizationRecommendations) {
  const analysisCard = {
    type: 'analysis',
    content: aiResponse.analysis,
  };

  const improvementCards = aiResponse.improvements.map((improvement, index) => {
    const actionVerb = {
      create: 'Create',
      drop: 'Drop',
      modify: 'Modify',
      none: 'No Action',
    }[improvement.action];

    const indexSpecStr = JSON.stringify(improvement.indexSpec, null, 2);

    return {
      type: 'improvement',
      cardId: `improvement-${index}`,
      title: `Recommendation: ${actionVerb} Index`,
      priority: improvement.priority,
      description: improvement.justification,
      recommendedIndex: indexSpecStr,
      recommendedIndexDetails: generateIndexExplanation(improvement),
      details: improvement.risks || 'Additional write and storage overhead for maintaining a new index.',
      mongoShellCommand: improvement.mongoShell,
      primaryButton: {
        label: `${actionVerb} Index`,
        actionId:
          improvement.action === 'create' ? 'createIndex' : improvement.action === 'drop' ? 'dropIndex' : 'modifyIndex',
        payload: {
          action: improvement.action,
          indexSpec: improvement.indexSpec,
          indexOptions: improvement.indexOptions,
          mongoShell: improvement.mongoShell,
        },
      },
      secondaryButton: {
        label: 'Learn More',
        actionId: 'learnMore',
        payload: {
          topic: 'index-optimization',
        },
      },
    };
  });

  return {
    analysisCard,
    improvementCards,
    verificationSteps: aiResponse.verification,
    metadata: aiResponse.metadata,
  };
}

function generateIndexExplanation(improvement) {
  const fields = Object.keys(improvement.indexSpec).join(', ');

  switch (improvement.action) {
    case 'create':
      return `An index on ${fields} would allow direct lookup of matching documents and eliminate full collection scans.`;
    case 'drop':
      return `This index on ${fields} is not being used and adds unnecessary overhead to write operations.`;
    case 'modify':
      return `Optimizing the index on ${fields} can improve query performance by better matching the query pattern.`;
    default:
      return 'No index changes needed at this time.';
  }
}
```

---

## Implementation Details

### ClusterSession Integration

The `ClusterSession` class (from `src/documentdb/ClusterSession.ts`) will be the primary source for gathering query insights data. Key points:

**Why ClusterSession?**

- Already encapsulates the DocumentDB client connection
- Contains cached query results (`_currentRawDocuments`)
- Tracks JSON schema for the current query (`_currentJsonSchema`)
- **Automatically resets caches when query changes** via `resetCachesIfQueryChanged()`
- Provides a natural place to store explain plan results alongside query data

**Cache Lifecycle Alignment**:

The existing `resetCachesIfQueryChanged()` method in ClusterSession already invalidates caches when the query text changes. We extend this to also clear query insights caches (explained in each stage section above).

**ClusterSession Extensions Summary**:

The extensions to `ClusterSession` are documented in each stage section:

- **Stage 1**: Adds `getQueryPlannerInfo()`, `setQueryMetadata()`, `getQueryMetadata()`, and initializes `QueryInsightsApis`
- **Stage 2**: Adds `getExecutionStats()`
- **Stage 3**: Adds `cacheAIRecommendations()`, `getCachedAIRecommendations()`

All methods leverage the existing cache invalidation mechanism via `resetCachesIfQueryChanged()`.

**QueryInsightsApis Class** (new file: `src/documentdb/client/QueryInsightsApis.ts`):

Following the `LlmEnhancedFeatureApis.ts` pattern, explain-related functionality is implemented in a dedicated class:

- Takes `MongoClient` in constructor
- Implements `explainFind()` with proper TypeScript interfaces
- Supports all explain verbosity levels: 'queryPlanner', 'executionStats', 'allPlansExecution'
- Handles filter, sort, projection, skip, and limit parameters
- Returns properly typed `ExplainResult` interface

**Benefits of This Architecture**:

1. ✅ **Consistent with existing patterns** (follows `LlmEnhancedFeatureApis.ts`)
2. ✅ **Type safety** with TypeScript interfaces for all inputs/outputs
3. ✅ **Separation of concerns** (explain logic separate from ClusterSession)
4. ✅ **Testability** (QueryInsightsApis can be unit tested independently)
5. ✅ **Reusability** across different contexts if needed

**Benefits of Using ClusterSession**:

1. ✅ **Automatic cache invalidation** when query changes (already implemented)
2. ✅ **Single source of truth** for query-related data
3. ✅ **Natural lifecycle management** tied to the session
4. ✅ **Access to DocumentDB client** for explain commands
5. ✅ **Schema tracking** already in place for enriched insights
6. ✅ **Consistent with existing architecture** (no new abstraction layers needed)

### Router File Structure

```typescript
// src/webviews/documentdb/collectionView/collectionViewRouter.ts

export const collectionsViewRouter = router({
  // ... existing endpoints ...

  /**
   * Stage 1: Initial Performance View
   *
   * Returns immediately available information after query execution.
   * Uses sessionId from context to retrieve ClusterSession and cached data.
   * Corresponds to design doc section 2: "Initial Performance View (Cheap Data + Query Plan)"
   *
   * Context required: sessionId, databaseName, collectionName
   */
  getQueryInsightsStage1: publicProcedure
    .use(trpcToTelemetry)
    .input(z.object({})) // Empty - uses RouterContext
    .query(async ({ ctx }) => {
      const { sessionId, databaseName, collectionName } = ctx;

      // Get ClusterSession (contains all cached query data)
      const clusterSession = ClusterSession.getSession(sessionId);

      // Get cached metadata (execution time, documents returned)
      const metadata = clusterSession.getQueryMetadata();

      // Get or fetch query planner info (cached after first call)
      const queryPlannerInfo = await clusterSession.getQueryPlannerInfo(databaseName, collectionName);

      // Transform and return Stage 1 data
      return transformStage1Data(metadata, queryPlannerInfo);
    }),

  /**
   * Stage 2: Detailed Execution Analysis
   *
   * Re-runs query with explain("executionStats") using ClusterSession.
   * Results are cached in ClusterSession and cleared when query changes.
   * Corresponds to design doc section 3: "Detailed Execution Analysis (executionStats)"
   *
   * Context required: sessionId, clusterId, databaseName, collectionName
   */
  getQueryInsightsStage1: publicProcedure
    .use(trpcToTelemetry)
    .input(z.object({})) // Empty - uses RouterContext
    .query(async ({ ctx }) => {
      const { sessionId, databaseName, collectionName } = ctx;

      // Get ClusterSession
      const clusterSession = ClusterSession.getSession(sessionId);

      // Get execution stats (cached if already fetched, otherwise runs explain)
      const executionStats = await clusterSession.getExecutionStats(databaseName, collectionName);

      // Transform and return Stage 2 data with performance analysis
      return transformStage2Data(executionStats);
    }),

  /**
   * Stage 3: AI-Powered Recommendations
   *
   * Analyzes query performance using AI backend.
   * Leverages ClusterSession for:
   * - Cached execution stats (from Stage 2)
   * - JSON schema information
   * - Query metadata
   * Corresponds to design doc section 4: "AI-Powered Recommendations"
   *
   * Context required: sessionId, clusterId, databaseName, collectionName
   */
  getQueryInsightsStage2: publicProcedure
    .use(trpcToTelemetry)
    .input(z.object({})) // Empty - uses RouterContext
    .query(async ({ ctx }) => {
      const { sessionId, databaseName, collectionName } = ctx;

      // Get ClusterSession
      const clusterSession = ClusterSession.getSession(sessionId);

      // Check for cached AI recommendations
      const cached = clusterSession.getCachedAIRecommendations();
      if (cached) {
        return cached;
      }

      // Get execution stats (from cache or fetch)
      const executionStats = await clusterSession.getExecutionStats(databaseName, collectionName);

      // Get collection stats from client
      const client = clusterSession.getClient();
      const collectionStats = await client.getCollectionStats(databaseName, collectionName);
      const indexStats = await client.getIndexStats(databaseName, collectionName);

      // Get current schema (already tracked by ClusterSession)
      const schema = clusterSession.getCurrentSchema();

      // Call AI backend
      const aiResponse = await callAIBackend({
        sessionId,
        databaseName,
        collectionName,
        collectionStats,
        indexStats,
        executionStats,
        schema,
        derived: calculateDerivedMetrics(executionStats),
      });

      // Transform response for UI
      const transformed = transformAIResponseForUI(aiResponse);

      // Cache in ClusterSession (cleared on query change)
      clusterSession.cacheAIRecommendations(transformed);

      return transformed;
    }),

  /**
   * Helper endpoint: Store Query Metadata
   *
   * Called after query execution to store metadata in ClusterSession.
   * ClusterSession handles cache invalidation when query changes.
   */
  storeQueryMetadata: publicProcedure
    .use(trpcToTelemetry)
    .input(
      z.object({
        executionTime: z.number(),
        documentsReturned: z.number(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { sessionId } = ctx;

      // Get ClusterSession
      const clusterSession = ClusterSession.getSession(sessionId);

      // Store metadata (will be cleared if query changes)
      clusterSession.setQueryMetadata(input.executionTime, input.documentsReturned);

      return { success: true };
    }),
});
```

### Mock Data Strategy

For initial implementation, create helper functions that return realistic mock data matching the design document examples:

```typescript
// Mock data helpers (temporary, for development)
function getMockStage1Data() {
  return {
    executionTime: 23.433235,
    documentsReturned: 2,
    queryPlannerInfo: {
      winningPlan: {
        stage: 'FETCH',
        inputStage: {
          stage: 'IXSCAN',
          indexName: 'user_id_1',
        },
      },
      rejectedPlans: [],
      namespace: 'mydb.users',
      indexFilterSet: false,
      parsedQuery: { user_id: { $eq: 1234 } },
      plannerVersion: 1,
    },
    stages: [
      { stage: 'IXSCAN', indexName: 'user_id_1', indexBounds: 'user_id: [1234, 1234]' },
      { stage: 'FETCH' },
      { stage: 'PROJECTION' },
    ],
  };
}

function getMockStage1Data() {
  return {
    executionTimeMs: 2.333,
    totalKeysExamined: 2,
    totalDocsExamined: 10000,
    documentsReturned: 2,
    examinedToReturnedRatio: 5000,
    keysToDocsRatio: 0.0002,
    executionStrategy: 'Index Scan + Full Collection Scan',
    indexUsed: true,
    usedIndexNames: ['user_id_1'],
    hadInMemorySort: false,
    hadCollectionScan: true,
    performanceRating: {
      score: 'poor',
      reasons: [],
      concerns: [
        'High examined-to-returned ratio (5000:1) indicates inefficient query',
        'Full collection scan performed after index lookup',
        'Only 0.02% of examined documents were returned',
      ],
    },
    stages: [
      {
        stage: 'IXSCAN',
        indexName: 'user_id_1',
        keysExamined: 2,
        nReturned: 2,
        indexBounds: 'user_id: [1234, 1234]',
      },
      {
        stage: 'FETCH',
        docsExamined: 10000,
        nReturned: 2,
      },
      {
        stage: 'PROJECTION',
        nReturned: 2,
      },
    ],
    rawExecutionStats: {},
  };
}

function getMockStage2Data() {
  return {
    analysisCard: {
      type: 'analysis',
      content:
        'Your query performs a full collection scan after the index lookup, examining 10,000 documents to return only 2. This indicates the index is not selective enough or additional filtering is happening after the index stage.',
    },
    improvementCards: [
      {
        type: 'improvement',
        cardId: 'improvement-0',
        title: 'Recommendation: Create Index',
        priority: 'high',
        description:
          'COLLSCAN examined 10000 docs vs 2 returned (totalKeysExamined: 2). A compound index on { user_id: 1, status: 1 } will eliminate the full scan.',
        recommendedIndex: '{\n  "user_id": 1,\n  "status": 1\n}',
        recommendedIndexDetails: 'An index on user_id, status would allow direct lookup of matching documents.',
        details: 'Additional write and storage overhead for maintaining a new index.',
        mongoShellCommand: 'db.users.createIndex({ user_id: 1, status: 1 })',
        primaryButton: {
          label: 'Create Index',
          actionId: 'createIndex',
          payload: {
            action: 'create',
            indexSpec: { user_id: 1, status: 1 },
            indexOptions: {},
            mongoShell: 'db.users.createIndex({ user_id: 1, status: 1 })',
          },
        },
        secondaryButton: {
          label: 'Learn More',
          actionId: 'learnMore',
          payload: { topic: 'compound-indexes' },
        },
      },
    ],
    verificationSteps: 'After creating the index, verify that docsExamined equals documentsReturned.',
    metadata: {
      collectionName: 'users',
      collectionStats: {},
      indexStats: [],
      executionStats: {},
      derived: {
        totalKeysExamined: 2,
        totalDocsExamined: 10000,
        keysToDocsRatio: 0.0002,
        usedIndex: 'user_id_1',
      },
    },
  };
}
```

---

## Query Execution Integration

### Session Initialization Flow

When a user executes a query in the collection view, the following sequence occurs:

```typescript
// In the webview (frontend)
async function executeQuery(queryParams) {
  // 1. Measure execution time
  const startTime = performance.now();
  const results = await trpc.executeQuery.query(queryParams);
  const executionTime = performance.now() - startTime;

  // 2. Store metadata in ClusterSession (for query insights)
  // Note: sessionId is already in RouterContext, no need to generate new one
  await trpc.storeQueryMetadata.mutate({
    executionTime,
    documentsReturned: results.length,
  });

  return results;
}

// When user requests insights (Stage 1 loads automatically)
async function loadStage1Insights() {
  // sessionId is automatically available in RouterContext
  // ClusterSession already has the query and results cached
  // On first call with new query, this triggers explain("queryPlanner") without skip/limit
  const insights = await trpc.getQueryInsightsStage1.query({});
  // Display metrics row with initial values
  // Show query plan summary
  return insights;
}
```

### ClusterSession Lifecycle

The ClusterSession is created when the collection view opens and persists until the view closes:

```typescript
// When collection view initializes (already implemented)
const sessionId = await ClusterSession.initNewSession(credentialId);

// This sessionId is then passed in RouterContext for all subsequent calls
// No need to create separate query sessions - ClusterSession handles everything
```

### RouterContext Population

The `RouterContext` is populated at the router middleware level:

```typescript
// In collectionViewRouter.ts
const withSessionContext = middleware(({ ctx, next }) => {
  // sessionId, clusterId, databaseName, collectionName
  // are already in the context from the webview's connection state
  return next({
    ctx: {
      ...ctx,
      // Validate required fields
      sessionId: nonNullValue(ctx.sessionId, 'ctx.sessionId', 'collectionViewRouter.ts'),
      clusterId: nonNullValue(ctx.clusterId, 'ctx.clusterId', 'collectionViewRouter.ts'),
      databaseName: nonNullValue(ctx.databaseName, 'ctx.databaseName', 'collectionViewRouter.ts'),
      collectionName: nonNullValue(ctx.collectionName, 'ctx.collectionName', 'collectionViewRouter.ts'),
    },
  });
});

// Apply to insights endpoints
export const collectionsViewRouter = router({
  getQueryInsightsStage1: publicProcedure.use(withSessionContext).query(...),
  getQueryInsightsStage2: publicProcedure.use(withSessionContext).query(...),
  getQueryInsightsStage3: publicProcedure.use(withSessionContext).query(...)
    .use(withSessionContext)
    .use(trpcToTelemetry)
    .input(z.object({}))
    .query(async ({ ctx }) => {
      // ctx now has typed sessionId, clusterId, etc.
      // Retrieve ClusterSession which contains all query data
      const clusterSession = ClusterSession.getSession(ctx.sessionId);
    }),
});
```

### Key Differences from Original Plan

**Original Plan**: Create separate query sessions with unique IDs for each query execution
**Updated Plan**: Reuse existing ClusterSession which already manages query lifecycle

**Benefits**:

- ✅ No need to generate new session IDs for each query
- ✅ No separate session cache to maintain
- ✅ Automatic cache invalidation already implemented
- ✅ Simpler architecture with fewer moving parts

---

## Additional Considerations

### Payload Strategy for Button Actions

The payload field in buttons allows the frontend to remain stateless:

**Pros**:

- Frontend doesn't need to reconstruct context
- Backend controls the exact command to execute
- Easy to implement "copy command" functionality
- Simple retry logic

**Cons**:

- Larger response size
- Potential security concern if payload is not validated

**Recommendation**: Use payload for now since this is a VS Code extension (trusted environment). Include validation when executing actions.

### Error Handling

Each stage should handle errors gracefully (aligned with design doc section 6):

- **Stage 1**: Fallback to basic metrics only if explain fails; still show client timing and docs returned
- **Stage 2**: Show user-friendly error, suggest retrying; metrics from Stage 1 remain visible
- **Stage 3**: Indicate AI service unavailable (may take 10-20 seconds per design doc), allow retry; Stage 2 data remains visible

### Session Management and Caching Strategy

**ClusterSession-Based Architecture**:

Instead of maintaining a separate `querySessionCache`, we leverage the existing `ClusterSession` infrastructure which already:

- Manages DocumentDB client connections
- Caches query results and documents
- Tracks JSON schema for the current query
- **Automatically invalidates caches when query changes** (via `resetCachesIfQueryChanged`)

**Session Lifecycle**:

1. **Session Creation**: Session already exists (created when collection view opens)
2. **Query Execution**: When a query runs, ClusterSession caches results and resets on query change
3. **Metadata Storage**: After query execution, call `storeQueryMetadata` to save execution time/doc count
4. **Stage 1 Caching**: `explain("queryPlanner")` results cached in ClusterSession
5. **Stage 2 Caching**: `explain("executionStats")` results cached in ClusterSession
6. **Stage 3 Caching**: AI recommendations cached until query changes
7. **Automatic Invalidation**: All caches cleared when `resetCachesIfQueryChanged` detects query modification

**Cache Invalidation Trigger**:
The existing `resetCachesIfQueryChanged` method in ClusterSession compares query text:

- If query unchanged: Return cached data (no re-execution needed)
- If query changed: Clear ALL caches (documents, schema, explain plans, AI recommendations)

**Benefits of ClusterSession-Based Approach**:

- ✅ **No duplicate session management** - Reuses existing ClusterSession infrastructure
- ✅ **Automatic cache invalidation** - Query change detection already implemented
- ✅ **Consistent lifecycle** - Tied to collection view session
- ✅ **Access to DocumentDB client** - Direct access via `getClient()`
- ✅ **Schema integration** - AI can leverage tracked schema data
- ✅ **Memory efficient** - Single session object per collection view
- ✅ **Prevents inconsistencies** - All stages use same query from ClusterSession

**No Need for Separate Query Session Cache** - The ClusterSession already provides:

- Session ID management (`sessionId` in RouterContext)
- Query result caching (`_currentRawDocuments`)
- Automatic cache invalidation (`resetCachesIfQueryChanged`)
- Client connection management (`_client`)

- ✅ Eliminates need to pass query parameters in Stage 1 & 2 requests
- ✅ Prevents inconsistencies (all stages use exact same query)
- ✅ Enables efficient caching without re-running expensive operations
- ✅ Provides traceability for debugging and telemetry
- ✅ Supports retry logic without client-side state management

### Performance Rating Thresholds

The performance rating algorithm uses **efficiency ratio** (documents returned ÷ documents examined) where higher values indicate better performance. This approach is more intuitive than the inverse ratio.

**Rating Criteria** (from `ExplainPlanAnalyzer.ts`):

```typescript
/**
 * Excellent: efficiencyRatio >= 0.5 (50%+)
 *   AND isIndexScan = true
 *   AND hasInMemorySort = false
 *   AND executionTimeMs < 100
 *
 * Good: efficiencyRatio >= 0.1 (10%+)
 *   AND (isIndexScan = true OR executionTimeMs < 500)
 *
 * Fair: efficiencyRatio >= 0.01 (1%+)
 *
 * Poor: efficiencyRatio < 0.01 (<1%)
 *   OR (isCollectionScan = true AND efficiencyRatio < 0.01)
 */
const PERFORMANCE_RATING_CRITERIA = {
  EXCELLENT: {
    minEfficiencyRatio: 0.5, // At least 50% of examined docs are returned
    requiresIndex: true, // Must use index
    allowsInMemorySort: false, // No blocking sorts
    maxExecutionTimeMs: 100, // Fast execution
  },
  GOOD: {
    minEfficiencyRatio: 0.1, // At least 10% of examined docs are returned
    requiresIndexOrFast: true, // Must use index OR execute quickly
    maxExecutionTimeMsIfNoIndex: 500,
  },
  FAIR: {
    minEfficiencyRatio: 0.01, // At least 1% of examined docs are returned
  },
  POOR: {
    // Everything below fair threshold
    // OR collection scan with very low efficiency
  },
};
```

**Why Efficiency Ratio (not Examined-to-Returned)?**

The efficiency ratio (returned ÷ examined) is preferred because:

- **Intuitive**: Higher values = better performance (like a percentage)
- **Bounded**: Ranges from 0.0 to 1.0 for most queries (can exceed 1.0 with projections)
- **Readable**: "50% efficiency" is clearer than "examined/returned ratio of 2"

The inverse metric (examined ÷ returned) was used in early design iterations but replaced for clarity.

#### Performance Diagnostics Structure

The `PerformanceRating` interface uses a **typed diagnostics array** instead of separate reasons/concerns arrays:

```typescript
interface PerformanceDiagnostic {
  type: 'positive' | 'negative' | 'neutral';
  message: string;
}

interface PerformanceRating {
  score: 'excellent' | 'good' | 'fair' | 'poor';
  diagnostics: PerformanceDiagnostic[];
}
```

**Key Characteristics:**

- **Consistent Assessments**: Every rating includes exactly 4 diagnostic messages:
  1. **Efficiency Ratio** - Percentage of examined documents returned
  2. **Execution Time** - Query runtime with appropriate units
  3. **Index Usage** - Whether indexes are used effectively
  4. **Sort Strategy** - Whether in-memory sorting is required

- **Typed Messages**: Each diagnostic has a semantic type:
  - `positive` - Good performance characteristics (fast execution, index usage)
  - `negative` - Performance concerns (slow execution, collection scans, memory sorts)
  - `neutral` - Informational metrics (moderate ratios, average performance)

- **UI-Friendly**: The type field enables clear visual representation:
  - ✓ (positive) - Green checkmark or success icon
  - ⚠ (negative) - Yellow/red warning icon
  - ● (neutral) - Gray/blue informational icon

**Example Output:**

```typescript
{
  score: 'good',
  diagnostics: [
    { type: 'neutral', message: 'Moderate efficiency ratio: 15.2% of examined documents returned' },
    { type: 'positive', message: 'Fast execution time: 85.3ms' },
    { type: 'positive', message: 'Query uses index' },
    { type: 'negative', message: 'In-memory sort required - consider adding index for sort fields' }
  ]
}
```

**Why Single Diagnostics Array?**

Originally the design included separate `reasons[]` (positive attributes) and `concerns[]` (negative attributes) arrays. These were consolidated into a single typed array because:

1. **Semantic Clarity**: The `type` field makes the intent explicit without relying on array names
2. **Consistent Ordering**: Always presents diagnostics in the same order (efficiency, time, index, sort)
3. **Type Safety**: TypeScript enforces that every diagnostic has a valid type
4. **Simpler Implementation**: Single array reduces duplication and simplifies transformation logic

---

## TypeScript Types to Add

Create a new types file: `src/webviews/documentdb/collectionView/types/queryInsights.ts`

```typescript
export interface QueryInsightsStage1Response {
  executionTime: number;
  documentsReturned: number;
  keysExamined: null; // Not available in Stage 1
  docsExamined: null; // Not available in Stage 1
  queryPlannerInfo: {
    winningPlan: WinningPlan;
    rejectedPlans: unknown[];
    namespace: string;
    indexFilterSet: boolean;
    parsedQuery: Record<string, unknown>;
    plannerVersion: number;
  };
  stages: StageInfo[];
  efficiencyAnalysis: {
    executionStrategy: string;
    indexUsed: string | null;
    hasInMemorySort: boolean;
    // Performance rating not available in Stage 1
  };
}

export interface QueryInsightsStage2Response {
  executionTimeMs: number;
  totalKeysExamined: number;
  totalDocsExamined: number;
  documentsReturned: number;
  examinedToReturnedRatio: number;
  keysToDocsRatio: number | null;
  executionStrategy: string;
  indexUsed: boolean;
  usedIndexNames: string[];
  hadInMemorySort: boolean;
  hadCollectionScan: boolean;
  isCoveringQuery: boolean;
  concerns: string[];
  efficiencyAnalysis: {
    executionStrategy: string;
    indexUsed: string | null;
    examinedReturnedRatio: string;
    hasInMemorySort: boolean;
    performanceRating: PerformanceRating;
  };
  stages: DetailedStageInfo[];
  rawExecutionStats: Record<string, unknown>;
}

export interface QueryInsightsStage3Response {
  analysisCard: AnalysisCard;
  improvementCards: ImprovementCard[];
  performanceTips?: {
    tips: Array<{
      title: string;
      description: string;
    }>;
    dismissible: boolean;
  };
  verificationSteps: string;
  animation: {
    staggerDelay: number;
    showTipsDuringLoading: boolean;
  };
  metadata: OptimizationMetadata;
}

export interface PerformanceRating {
  score: 'excellent' | 'good' | 'fair' | 'poor';
  reasons: string[];
  concerns: string[];
}

export interface ImprovementCard {
  type: 'improvement';
  cardId: string;
  title: string;
  priority: 'high' | 'medium' | 'low';
  description: string;
  recommendedIndex: string;
  recommendedIndexDetails: string;
  details: string;
  mongoShellCommand: string;
  primaryButton: ActionButton;
  secondaryButton?: ActionButton;
}

export interface ActionButton {
  label: string;
  actionId: string;
  payload: unknown;
}

// ... additional types
```

---

## Testing Strategy

1. **Unit Tests**: Test transformation logic for AI response
2. **Integration Tests**: Test each stage endpoint with real DocumentDB connection
3. **E2E Tests**: Test full flow from UI to backend and back
4. **Mock Tests**: Verify mock data matches expected schemas

---

## Migration Path

### Phase 1: Extend ClusterSession & Mock Implementation

- Extend `ClusterSession` class with query insights properties and methods:
  - Add private properties for caching explain plans and AI recommendations
  - Add methods for Stages 1, 2, and 3 (see each stage section for details)
  - Update `resetCachesIfQueryChanged()` to clear new caches
- Add three query insights endpoints (Stage 1, 2, 3) to `collectionViewRouter.ts`
- Add `storeQueryMetadata` mutation endpoint
- Return mock data initially (aligned with design doc examples)
- Update UI to call new endpoints

### Phase 2: Real Stage 1 Implementation

**Goal**: Implement Initial Performance View (design doc section 2)

- Implement actual DocumentDB `explain("queryPlanner")` in ClusterSession methods
- Add `explainQuery()` method to `ClustersClient` class
- Implement client-side timing capture in query execution flow
- Call `storeQueryMetadata` after each query execution
- Extract query plan tree and flatten for UI visualization
- Populate Metrics Row with initial values
- Display Query Plan Summary
- Test with real DocumentDB connections

### Phase 3: Real Stage 2 Implementation

**Goal**: Implement Detailed Execution Analysis (design doc section 3)

- Implement `explain("executionStats")` execution
- Update Metrics Row with authoritative values
- Calculate performance rating (design doc 3.2 thresholds)
- Populate Query Efficiency Analysis Card
- Extract per-stage counters
- Enable Quick Actions (design doc 3.6)
- Test performance rating algorithm

### Phase 4: AI Integration (Stage 3)

**Goal**: Implement AI-Powered Recommendations (design doc section 4)

- Connect to AI backend service
- Implement automatic Stage 2 execution if not cached (in Stage 3 endpoint)
- Implement response transformation (`transformAIResponseForUI`)
- Add error handling and fallbacks for AI service unavailability
- Cache AI recommendations in ClusterSession
- Add telemetry for AI requests

### Phase 4: Button Actions & Index Management

- Implement `createIndex` action handler in router
- Implement `dropIndex` action handler
- Implement `learnMore` navigation (documentation links)
- Test index creation/deletion workflows
- Add confirmation dialogs for destructive operations

### Phase 5: Production Hardening

- Add comprehensive error handling for all stages
- Implement telemetry for each stage (success/failure metrics)
- Add retry logic with exponential backoff for AI service
- Optimize ClusterSession cache memory usage
- Add security validation for action payloads (index creation/deletion)
- Performance testing with large result sets
- Add user feedback mechanisms (loading states, progress indicators)

---

## Implementation Plan

### File Structure

This section outlines where new code will be placed following the project's architectural patterns:

#### Backend Files (Extension Host)

```
src/
├── documentdb/
│   ├── client/                              # 📁 NEW FOLDER
│   │   ├── ClusterSession.ts               # ✏️ MODIFY: Add query insights caching
│   │   ├── ClustersClient.ts               # ✏️ MODIFY: No changes needed
│   │   └── QueryInsightsApis.ts                # 🆕 NEW: Explain query execution (follows LlmEnhancedFeatureApis pattern)
│   │
│   └── queryInsights/                       # 📁 NEW FOLDER
│       ├── ExplainPlanAnalyzer.ts          # 🆕 NEW: Explain plan parsing & analysis
│       ├── StagePropertyExtractor.ts       # 🆕 NEW: Extended stage info extraction
│       └── transformations.ts              # 🆕 NEW: Router response transformations
│
└── services/
    └── ai/                                  # 📁 NEW FOLDER
        └── QueryInsightsAIService.ts   # 🆕 NEW: AI service mock (8s delay)

webviews/
└── documentdb/
    └── collectionView/
        ├── collectionViewRouter.ts         # ✏️ MODIFY: Add 3 tRPC endpoints
        └── types/
            └── queryInsights.ts            # 🆕 NEW: Frontend-facing types
```

#### Architectural Guidelines

**Current Structure** (for upcoming release):

All files remain in `src/documentdb/` for minimal disruption:

- `ClustersClient.ts` - DocumentDB client wrapper with QueryInsightsApis instance
- `ClusterSession.ts` - Session state management, caching, uses client.queryInsightsApis
- `QueryInsightsApis.ts` - Explain command execution (follows LlmEnhancedFeatureApis pattern)

**QueryInsightsApis Integration Pattern**:

Following the `LlmEnhancedFeatureApis` pattern:

1. **Instantiation**: QueryInsightsApis is created in `ClustersClient` constructor
2. **Exposure**: Available as `client.queryInsightsApis` public property
3. **Usage**: ClusterSession accesses via `this._client.queryInsightsApis`
4. **Ownership**: ClustersClient owns MongoClient, QueryInsightsApis wraps it

```typescript
// In ClustersClient.ts
export class ClustersClient {
  private readonly _mongoClient: MongoClient;
  public readonly queryInsightsApis: QueryInsightsApis;

  constructor() {
    this._mongoClient = new MongoClient(/* ... */);
    this.queryInsightsApis = new QueryInsightsApis(this._mongoClient);
  }
}

// In ClusterSession.ts
export class ClusterSession {
  constructor(private readonly _client: ClustersClient) {}

  async getQueryPlannerInfo() {
    // Access via client property, not local instance
    return await this._client.queryInsightsApis.explainFind(/* ... */);
  }
}
```

**Future Structure** (post-release refactoring):

A `src/documentdb/client/` subfolder may be created to organize client-related code:

- `client/ClustersClient.ts` - Main client class
- `client/ClusterSession.ts` - Session management
- `client/QueryInsightsApis.ts` - Query insights APIs
- `client/CredentialCache.ts` - Credential management

This refactoring is deferred to avoid widespread import changes during the current release cycle.

**Other Folders** (unchanged):

**`src/documentdb/queryInsights/` folder:**

- Query analysis logic (explain plan parsing, metrics extraction)
- Transformation functions for router responses
- Backend types are generic - no webview-specific terminology

**`src/services/ai/` folder:**

- AI service integration
- Mock implementation with 8-second delay for realistic testing
- Returns mock data structure matching current webview expectations

**`src/webviews/.../types/` folder:**

- Frontend-facing TypeScript types
- Shared between router and React components
- tRPC infers types from router, so these are mainly for UI components

---

### Implementation Steps

#### Phase 1: Foundation & Types

**1.1. Create Type Definitions** ✅ Complete

**Status**: Types created and refined. Stage 1 and Stage 2 response types implemented in `src/webviews/documentdb/collectionView/types/queryInsights.ts`.

**Completed Updates**:

- ✅ Removed unnecessary null fields from Stage 1 response (`keysExamined`, `docsExamined`)
- ✅ Removed `queryPlannerInfo` from Stage 1 (data duplicated in `stages` array)
- ✅ Simplified response structure for better performance and clarity
- ✅ Added comprehensive JSDoc comments for all types
- ✅ Implemented `PerformanceDiagnostic` interface with typed diagnostics (positive/negative/neutral)
- ✅ Updated `PerformanceRating` to use `diagnostics[]` instead of separate `reasons[]`/`concerns[]` arrays

**Implementation**: See `src/webviews/documentdb/collectionView/types/queryInsights.ts`

---

#### Phase 2: Explain Plan Analysis (Stages 1 & 2)

**2.1. Install Dependencies** ✅ Complete

`@mongodb-js/explain-plan-helper` v1.x installed successfully.

```bash
npm install @mongodb-js/explain-plan-helper
```

**2.2. Create ExplainPlanAnalyzer** ✅ Complete

**📖 Before starting**: Review the entire design document, especially:

- "DocumentDB Explain Plan Parsing" section for ExplainPlan API usage
- Stage 1 and Stage 2 sections for expected output formats
- **Performance Rating Algorithm** section (consolidated, authoritative version)

The `ExplainPlanAnalyzer` class provides analysis for both `queryPlanner` and `executionStats` verbosity levels.

**Key Implementation Notes**:

1. **Performance Rating**: Uses the consolidated algorithm from the "Performance Rating Thresholds" section
   - Based on **efficiency ratio** (returned/examined, range 0.0-1.0+, higher is better)
   - Considers: execution time, index usage, collection scan, in-memory sort
   - See `src/documentdb/queryInsights/ExplainPlanAnalyzer.ts` for implementation

2. **Efficiency Calculation**:

   ```typescript
   efficiencyRatio = returned / examined; // Higher is better
   // vs the inverse:
   examinedToReturnedRatio = examined / returned; // Lower is better (deprecated approach)
   ```

3. **Library Integration**: Uses `@mongodb-js/explain-plan-helper` for robust parsing across MongoDB versions

**Implementation**: See `src/documentdb/queryInsights/ExplainPlanAnalyzer.ts`

**2.3. Create StagePropertyExtractor** ✅ Complete

**Status**: Implemented with support for 20+ MongoDB stage types.

**Implementation**: `src/documentdb/queryInsights/StagePropertyExtractor.ts`

**Key Features**:

- Recursive stage tree traversal
- Extracts stage-specific properties (index names, bounds, memory usage, etc.)
- Handles complex structures (inputStage, inputStages[], shards[])
- Returns flattened list of ExtendedStageInfo for UI display

**2.4. Create QueryInsightsApis and Integrate with ClustersClient** ✅ Complete

**Status**: Implemented following LlmEnhancedFeatureApis pattern and integrated into ClustersClient.

**Implementation**: `src/documentdb/client/QueryInsightsApis.ts`

**Architecture** (corrected from original plan):

- ✅ QueryInsightsApis instantiated in `ClustersClient` constructor
- ✅ Exposed as public property: `client.queryInsightsApis`
- ✅ ClusterSession accesses via `this._client.queryInsightsApis.explainFind()`
- ✅ Follows the same pattern as `llmEnhancedFeatureApis`

**Location Update**: Moved to `src/documentdb/client/` subfolder to begin the client code organization transition.

**2.5. Extend ClusterSession for Caching** ✅ Complete

**Status**: Caching methods implemented. Architecture updated to use ClustersClient's QueryInsightsApis instance.

**Implementation**: `src/documentdb/ClusterSession.ts`

**Methods Added**:

- `getQueryPlannerInfo()` - Gets/caches queryPlanner explain results
- `getExecutionStats()` - Gets/caches executionStats explain results
- `cacheAIRecommendations()` / `getCachedAIRecommendations()` - AI recommendation caching
- `clearQueryInsightsCaches()` - Cache invalidation (called by `resetCachesIfQueryChanged()`)

**Architecture Note**: Uses `this._client.queryInsightsApis` instead of local instance (corrected from initial plan).

```typescript
import type { Document } from 'mongodb';
import type { ExtendedStageInfo } from '../../webviews/documentdb/collectionView/types/queryInsights';

export class StagePropertyExtractor {
  /**
   * Extracts extended properties for all stages in execution plan
   */
  public static extractAllExtendedStageInfo(executionStages: Document): ExtendedStageInfo[] {
    const stageInfoList: ExtendedStageInfo[] = [];

    this.traverseStages(executionStages, stageInfoList);

    return stageInfoList;
  }

  /**
   * Recursively traverses execution stages and extracts properties
   */
  private static traverseStages(stage: Document, accumulator: ExtendedStageInfo[]): void {
    if (!stage || !stage.stage) return;

    const properties = this.extractStageProperties(stage);

    accumulator.push({
      stageName: stage.stage,
      properties,
    });

    // Recurse into child stages
    if (stage.inputStage) {
      this.traverseStages(stage.inputStage, accumulator);
    }
    if (stage.inputStages) {
      stage.inputStages.forEach((childStage: Document) => {
        this.traverseStages(childStage, accumulator);
      });
    }
  }

  /**
   * Extracts stage-specific properties based on stage type
   */
  private static extractStageProperties(stage: Document): Record<string, string | number> {
    const stageName = stage.stage;
    const properties: Record<string, string | number> = {};

    switch (stageName) {
      case 'IXSCAN':
        if (stage.keyPattern) properties['Key Pattern'] = JSON.stringify(stage.keyPattern);
        if (stage.indexName) properties['Index Name'] = stage.indexName;
        if (stage.isMultiKey !== undefined) properties['Multi Key'] = stage.isMultiKey ? 'Yes' : 'No';
        if (stage.direction) properties['Direction'] = stage.direction;
        if (stage.indexBounds) properties['Index Bounds'] = JSON.stringify(stage.indexBounds);
        break;

      case 'COLLSCAN':
        if (stage.direction) properties['Direction'] = stage.direction;
        if (stage.filter) properties['Filter'] = JSON.stringify(stage.filter);
        break;

      case 'FETCH':
        if (stage.filter) properties['Filter'] = JSON.stringify(stage.filter);
        break;

      case 'SORT':
        if (stage.sortPattern) properties['Sort Pattern'] = JSON.stringify(stage.sortPattern);
        if (stage.memLimit !== undefined) properties['Memory Limit'] = `${stage.memLimit} bytes`;
        if (stage.type) properties['Type'] = stage.type;
        break;

      // ... (add remaining 15+ stage types from design doc)
    }

    return properties;
  }
}
```

---

#### Phase 3: AI Service Integration

**3.1. Create AI Service Client** ✅ Complete

**📖 Before starting**: Review Stage 3 section for AI service payload structure and expected response format.

Create `src/services/ai/QueryInsightsAIService.ts`:

```typescript
/**
 * AI service for query insights and optimization recommendations
 * Currently a mock implementation with 8-second delay
 *
 * TODO: Replace with actual AI service integration later
 */
export class QueryInsightsAIService {
  /**
   * Gets optimization recommendations
   * Currently returns mock data with 8s delay to simulate real AI processing
   */
  public async getOptimizationRecommendations(
    clusterId: string,
    sessionId: string | undefined,
    query: string,
    databaseName: string,
    collectionName: string,
  ): Promise<unknown> {
    // Simulate 8-second AI processing time
    await new Promise((resolve) => setTimeout(resolve, 8000));

    // Return mock data matching current webview expectations
    return {
      analysis:
        'Your query performs a full collection scan after the index lookup, examining 10,000 documents to return only 2. This indicates the index is not selective enough or additional filtering is happening after the index stage.',
      improvements: [
        {
          action: 'create',
          indexSpec: { user_id: 1, status: 1 },
          reason:
            'A compound index on user_id and status would allow DocumentDB to use a single index scan instead of scanning documents after the index lookup.',
          impact: 'high',
        },
      ],
      verification: [
        'After creating the index, run the same query and verify that:',
        '1) docsExamined equals documentsReturned',
        "2) the execution plan shows IXSCAN using 'user_id_1_status_1'",
        '3) no COLLSCAN stage appears in the plan',
      ],
    };

    /* TODO: Actual implementation will call AI service via HTTP/gRPC
    // This will be implemented later when AI backend is ready:
    // Use clusterId to get client access
    // const client = ClustersClient.getClient(clusterId);
    //
    // Use sessionId to access cached query data if available
    // const session = sessionId ? ClusterSession.getSession(sessionId) : null;
    //
    // const response = await fetch(AI_SERVICE_URL, {
    //   method: 'POST',
    //   headers: { 'Content-Type': 'application/json' },
    //   body: JSON.stringify({
    //     query,
    //     databaseName,
    //     collectionName,
    //     clusterId,
    //     sessionId
    //   })
    // });
    //
    // return await response.json();
    */
  }
}
```

**3.2. Extend ClusterSession for AI Integration** ⬜ Not Started

**📖 Before starting**: Review Stage 3 and "ClusterSession Extensions for Stage 3" sections for AI integration patterns.

Modify `src/documentdb/client/ClusterSession.ts`:

```typescript
/**
 * Gets AI optimization recommendations
 */
public async getAIRecommendations(
  query: string,
  databaseName: string,
  collectionName: string,
): Promise<unknown> {
  // Check cache first (no sessionId needed - this instance IS the session)
  const cached = this.getCachedAIRecommendations();
  if (cached) {
    return cached;
  }

  // Call AI service with minimal payload
  // Note: AI backend will independently collect additional data
  const recommendations = await this.aiService.getOptimizationRecommendations(
    query,
    databaseName,
    collectionName,
  );

  // Cache recommendations
  this.cacheAIRecommendations(recommendations);

  return recommendations;
}
```

---

#### Phase 4: Router Implementation

**4.1. Implement tRPC Endpoints** ✅ Complete

**📖 Before starting**: Review entire design document, especially:

- Stage 1, 2, and 3 sections for endpoint behavior
- "Router Context" section for available context fields
- "Router File Structure" section for patterns
- Note: Frontend-facing endpoint names use "Stage1", "Stage2", "Stage3" terminology

Modify `webviews/documentdb/collectionView/collectionViewRouter.ts`:

````typescript
// Add to router:

/**
 * Query Insights Stage 1 - Initial Performance View
 * Returns fast metrics using explain("queryPlanner")
 */
getQueryInsightsStage1: protectedProcedure
  .input(z.object({})) // Empty - uses sessionId from context
  .query(async ({ ctx }) => {
    const { sessionId, clusterId, databaseName, collectionName } = ctx;

    const clusterSession = await getClusterSession(clusterId);

    // Get query planner data (cached or execute explain)
    // No sessionId parameter needed - ClusterSession instance IS the session
    const explainResult = await clusterSession.getQueryPlannerInfo(
      databaseName,
      collectionName,
    );

    // Analyze and transform
    const analyzed = ExplainPlanAnalyzer.analyzeQueryPlanner(explainResult);
    return transformStage1Response(analyzed);
  }),

/**
 * Query Insights Stage 2 - Detailed Execution Analysis
 * Returns authoritative metrics using explain("executionStats")
 */
getQueryInsightsStage2: protectedProcedure
  .input(z.object({})) // Empty - uses sessionId from context
  .query(async ({ ctx }) => {
    const { sessionId, clusterId, databaseName, collectionName } = ctx;

    const clusterSession = await getClusterSession(clusterId);

    // Get execution stats (cached or execute explain)
    // No sessionId parameter needed - ClusterSession instance IS the session
    const explainResult = await clusterSession.getExecutionStats(
      databaseName,
      collectionName,
    );

    // Analyze and transform
    const analyzed = ExplainPlanAnalyzer.analyzeExecutionStats(explainResult);

    // Extract extended stage info
    const executionStages = explainResult.executionStats?.executionStages;
    if (executionStages) {
      analyzed.extendedStageInfo = StagePropertyExtractor.extractAllExtendedStageInfo(executionStages);
    }

    return transformStage2Response(analyzed);
  }),

/**
 * Query Insights Stage 3 - AI-Powered Optimization Recommendations
 * Returns actionable suggestions from AI service (8s delay)
 */
getQueryInsightsStage3: protectedProcedure
  .input(z.object({})) // Empty - uses sessionId from context
  .query(async ({ ctx }) => {
    const { sessionId, clusterId, databaseName, collectionName } = ctx;

    const clusterSession = await getClusterSession(clusterId);

    // Get current query from session
    const query = clusterSession.getCurrentQuery();

    // Get AI recommendations (cached or call AI service with 8s delay)
    // No sessionId parameter needed - ClusterSession instance IS the session
    const aiRecommendations = await clusterSession.getAIRecommendations(
      JSON.stringify(query),
      databaseName,
      collectionName,
    );

    // Transform to UI format (with button payloads)
    return transformStage3Response(aiRecommendations, ctx);
  }),
```**4.2. Implement Transformation Functions** ✅ Complete

Create `src/documentdb/queryInsights/transformations.ts`:

```typescript
import type { RouterContext } from '../../../webviews/documentdb/collectionView/collectionViewRouter';

/**
 * Transforms query planner data to frontend response format
 */
export function transformQueryPlannerResponse(analyzed: unknown) {
  // Implementation based on design doc
  return analyzed;
}

/**
 * Transforms execution stats data to frontend response format
 */
export function transformExecutionStatsResponse(analyzed: unknown) {
  // Implementation based on design doc
  return analyzed;
}

/**
 * Transforms AI response to frontend format with button payloads
 */
export function transformAIResponse(aiResponse: any, ctx: RouterContext) {
  const { clusterId, databaseName, collectionName } = ctx;

  // Build improvement cards with complete button payloads
  const improvementCards = aiResponse.improvements.map((improvement: any) => {
    return {
      title: `${improvement.action} Index`,
      description: improvement.reason,
      impact: improvement.impact,
      primaryButton: {
        label: improvement.action === 'create' ? 'Create Index' : 'Drop Index',
        action: improvement.action === 'create' ? 'createIndex' : 'dropIndex',
        payload: {
          clusterId,
          databaseName,
          collectionName,
          indexSpec: improvement.indexSpec,
        },
      },
      secondaryButton: {
        label: 'Copy Command',
        action: 'copyCommand',
        payload: {
          command: generateIndexCommand(improvement, databaseName, collectionName),
        },
      },
    };
  });

  return {
    analysisCard: {
      title: 'Query Analysis',
      content: aiResponse.analysis,
    },
    improvementCards,
    verificationSteps: aiResponse.verification.map((step: string, index: number) => ({
      step: index + 1,
      description: step,
    })),
  };
}

/**
 * Generates MongoDB shell index command string
 */
function generateIndexCommand(improvement: any, databaseName: string, collectionName: string): string {
  const indexSpecStr = JSON.stringify(improvement.indexSpec);

  if (improvement.action === 'create') {
    return `db.getSiblingDB('${databaseName}').${collectionName}.createIndex(${indexSpecStr})`;
  } else {
    return `db.getSiblingDB('${databaseName}').${collectionName}.dropIndex(${indexSpecStr})`;
  }
}
````

---

#### Phase 5: Frontend Integration

**5.1. Update Query Execution Logic** 🔄 In Progress

**📖 Before starting**: Review "Query Execution Integration" section and Stage 1 implementation notes for server-side metadata tracking approach.

**Goal**: Orchestrate non-blocking Stage 1 data prefetch after query execution completes, and provide placeholder for query state indicator.

**Implementation Location**: `src/webviews/documentdb/collectionView/CollectionView.tsx`

**Architecture Overview**:

```
Query Execution → Results Return → Non-Blocking Stage 1 Prefetch → Cache Population
                       ↓                                                    ↓
                  Show Results                                    Ready for Query Insights Tab
                       ↓                                                    ↓
                  User switches to Query Insights Tab          ← Data already cached (fast)
```

**5.1.1. Non-Blocking Stage 1 Prefetch After Query Execution** ✅ Complete

**Implementation Steps**:

1. **Trigger Stage 1 Prefetch After Query Results Return**:

   ```typescript
   // In CollectionView.tsx (or query execution handler):
   const handleQueryExecution = async (query: string) => {
     // Execute query and show results
     const results = await trpcClient.mongoClusters.collectionView.runFindQuery.query({
       query,
       skip: currentPage * pageSize,
       limit: pageSize,
     });

     // Update results view
     setQueryResults(results);

     // Non-blocking Stage 1 prefetch to populate ClusterSession cache
     // DO NOT await - this runs in background
     void prefetchQueryInsights();

     return results; // Don't block on insights
   };

   const prefetchQueryInsights = () => {
     void trpcClient.mongoClusters.collectionView.getQueryInsightsStage1
       .query()
       .then((stage1Data) => {
         // Stage 1 data is now cached in ClusterSession
         // Update indicator that insights are ready
         setQueryInsightsReady(true);
       })
       .catch((error) => {
         // Silent fail - user can still request insights manually via tab
         console.warn('Stage 1 prefetch failed:', error);
         setQueryInsightsReady(false);
       });
   };
   ```

2. **Server-Side Execution Time Tracking**:

   No explicit mutation needed. The ClusterSession already tracks execution time during `runFindQueryWithCache()`:

   ```typescript
   // In ClusterSession.runFindQueryWithCache() (already implemented):
   const startTime = performance.now();
   const results = await this._client.runFindQuery(/* ... */);
   const endTime = performance.now();
   this._lastExecutionTimeMs = endTime - startTime; // Cached until query changes
   ```

**Behavior**:

- ✅ Query results display immediately (not blocked by insights prefetch)
- ✅ Stage 1 data fetched in background after results return
- ✅ ClusterSession cache populated before user navigates to Query Insights tab
- ✅ Silent failure if prefetch fails - user can still manually request insights
- ✅ Execution time tracked server-side automatically (not affected by network latency)

---

**5.1.2. Add Placeholder for Query State Indicator** ⬜ Not Started

**Goal**: Provide UI state management for showing when query insights are ready (future enhancement: asterisk/badge on tab).

**Implementation**:

```typescript
// In CollectionView.tsx:
const [queryInsightsReady, setQueryInsightsReady] = useState(false);

// Reset when query changes:
useEffect(() => {
  setQueryInsightsReady(false);
}, [currentQuery]);

// TODO: Use queryInsightsReady to add visual indicator on Query Insights tab
// Examples:
// - Asterisk badge: "Query Insights *"
// - Dot indicator: "Query Insights •"
// - Color change: Tab text color changes when ready
```

**Future Enhancement Placeholder**:

```typescript
// In Tab component (when implemented):
<Tab
  label={queryInsightsReady ? 'Query Insights *' : 'Query Insights'}
  active={activeTab === 'queryInsights'}
  onClick={() => setActiveTab('queryInsights')}
/>
```

**Behavior**:

- ✅ State management ready for visual indicators
- ✅ Automatically resets when query changes
- ✅ Can be enhanced later without changing architecture

---

**5.2. Implement Frontend Query Insights Panel** ✅ Complete

**📖 Before starting**: Review Stage 1, 2, and 3 sections for UI component requirements, data flow patterns, and caching behavior.

**Goal**: Implement progressive data loading in Query Insights tab with proper caching and tab-switching behavior.

**Implementation Location**: `src/webviews/documentdb/collectionView/QueryInsightsTab.tsx` (new file or section in CollectionView.tsx)

**Architecture Overview**:

```
User Activates Query Insights Tab
          ↓
    Fetch Stage 1 (cached from prefetch - fast)
          ↓
    Display Stage 1 Data (basic metrics + query plan)
          ↓
    Auto-start Stage 2 Fetch (executionStats - ~2s)
          ↓
    Update UI with Stage 2 Data (detailed metrics + performance rating)
          ↓
    User Clicks "Get Performance Insights" Button
          ↓
    Fetch Stage 3 (AI recommendations - ~8s)
          ↓
    Display AI Recommendations

    Tab Switches → Fetches Continue in Background → Return to Tab → Data Already Loaded
```

**5.2.1. Stage 1: Initial View on Tab Activation** ✅ Complete

**Goal**: Load and display Stage 1 data when user activates Query Insights tab.

**⚠️ Architecture Note**: Due to component unmounting on tab switch (see 5.2.3), state must be stored in parent CollectionView.tsx.

**Implementation** (see 5.2.3 for full parent state structure):

```typescript
// In QueryInsightsTab.tsx:
interface QueryInsightsMainProps {
  queryInsightsState: QueryInsightsState;
  setQueryInsightsState: React.Dispatch<React.SetStateAction<QueryInsightsState>>;
}

export const QueryInsightsMain = ({
  queryInsightsState,
  setQueryInsightsState,
}: QueryInsightsMainProps): JSX.Element => {
  const { trpcClient } = useTrpcClient();

  // Stage 1: Load on mount (only if not already loading/loaded)
  useEffect(() => {
    if (!queryInsightsState.stage1Data && !queryInsightsState.stage1Loading && !queryInsightsState.stage1Promise) {
      setQueryInsightsState((prev) => ({ ...prev, stage1Loading: true }));

      const promise = trpcClient.mongoClusters.collectionView.getQueryInsightsStage1
        .query()
        .then((data) => {
          setQueryInsightsState((prev) => ({
            ...prev,
            stage1Data: data,
            stage1Loading: false,
            stage1Promise: null,
          }));
          return data;
        })
        .catch((error) => {
          void trpcClient.common.displayErrorMessage.mutate({
            message: l10n.t('Failed to load query insights'),
            modal: false,
            cause: error instanceof Error ? error.message : String(error),
          });
          setQueryInsightsState((prev) => ({
            ...prev,
            stage1Error: error instanceof Error ? error.message : String(error),
            stage1Loading: false,
            stage1Promise: null,
          }));
          throw error;
        });

      setQueryInsightsState((prev) => ({ ...prev, stage1Promise: promise }));
    }
  }, []); // Empty deps - only run on mount

  // ... rest of component
};
```

**Behavior**:

- ✅ Loads Stage 1 data immediately when Query Insights tab is activated (component mounts)
- ✅ Data likely already cached from prefetch (fast response from ClusterSession cache)
- ✅ If promise already exists in parent state, doesn't start duplicate request
- ✅ Parent state preserves data/loading state when component unmounts (tab switch)
- ✅ Loading state shows skeleton UI while fetching

---

**5.2.2. Stage 2: Automatic Progression After Stage 1** ✅ Complete

**Goal**: Automatically start Stage 2 fetch after Stage 1 completes to populate detailed metrics.

**⚠️ Architecture Note**: State stored in parent, promise tracked to prevent duplicates.

**Implementation**:

```typescript
// In QueryInsightsTab.tsx (continuation):

// Stage 2: Auto-start after Stage 1 completes
useEffect(() => {
  if (
    queryInsightsState.stage1Data &&
    !queryInsightsState.stage2Data &&
    !queryInsightsState.stage2Loading &&
    !queryInsightsState.stage2Promise
  ) {
    setQueryInsightsState((prev) => ({ ...prev, stage2Loading: true }));

    const promise = trpcClient.mongoClusters.collectionView.getQueryInsightsStage2
      .query()
      .then((data) => {
        setQueryInsightsState((prev) => ({
          ...prev,
          stage2Data: data,
          stage2Loading: false,
          stage2Promise: null,
        }));
        return data;
      })
      .catch((error) => {
        void trpcClient.common.displayErrorMessage.mutate({
          message: l10n.t('Failed to load detailed execution analysis'),
          modal: false,
          cause: error instanceof Error ? error.message : String(error),
        });
        setQueryInsightsState((prev) => ({
          ...prev,
          stage2Error: error instanceof Error ? error.message : String(error),
          stage2Loading: false,
          stage2Promise: null,
        }));
        throw error;
      });

    setQueryInsightsState((prev) => ({ ...prev, stage2Promise: promise }));
  }
}, [queryInsightsState.stage1Data]);
```

**Behavior**:

- ✅ Automatically starts after Stage 1 completes
- ✅ Runs explain("executionStats") which executes the query
- ✅ Updates parent state with execution metrics (survives component unmount)
- ✅ Does NOT abort if user switches tabs (promise continues, stored in parent)
- ✅ Results available immediately when user returns to tab

---

**5.2.3. Tab Switching Behavior (No Abort)** ✅ Complete

**Goal**: Ensure ongoing fetches continue when user switches tabs, and data is preserved across tab switches.

**⚠️ Critical Architecture Decision: Component Unmounting**

Looking at the current `CollectionView.tsx` implementation:

```typescript
{selectedTab === 'tab_result' && (
    // Results tab content
)}
{selectedTab === 'tab_queryInsights' && <QueryInsightsMain />}
{selectedTab === 'tab_performance_mock' && <QueryInsightsMainMock />}
```

**This means components ARE UNMOUNTED when switching tabs.** All component-local state (useState) is lost.

**Solution: Lift State to Parent (CollectionView.tsx)**

To preserve query insights data across tab switches, we need to:

1. **Store query insights state in CollectionView.tsx** (parent component)
2. **Pass state down to QueryInsightsTab via props**
3. **Store in-flight promises in parent state to prevent abort**

**Implementation**:

```typescript
// In CollectionView.tsx (parent component):

// Query Insights State (lifted to parent to survive tab unmounting)
interface QueryInsightsState {
  stage1Data: QueryInsightsStage1Response | null;
  stage1Loading: boolean;
  stage1Error: string | null;
  stage1Promise: Promise<QueryInsightsStage1Response> | null; // Track in-flight request

  stage2Data: QueryInsightsStage2Response | null;
  stage2Loading: boolean;
  stage2Error: string | null;
  stage2Promise: Promise<QueryInsightsStage2Response> | null;

  stage3Data: QueryInsightsStage3Response | null;
  stage3Loading: boolean;
  stage3Error: string | null;
  stage3Promise: Promise<QueryInsightsStage3Response> | null;
}

const [queryInsightsState, setQueryInsightsState] = useState<QueryInsightsState>({
  stage1Data: null,
  stage1Loading: false,
  stage1Error: null,
  stage1Promise: null,

  stage2Data: null,
  stage2Loading: false,
  stage2Error: null,
  stage2Promise: null,

  stage3Data: null,
  stage3Loading: false,
  stage3Error: null,
  stage3Promise: null,
});

// Reset query insights when query execution starts
// Note: Query execution already triggers when currentContext.activeQuery changes
useEffect(() => {
  // Reset all query insights state - user is executing a new query
  setQueryInsightsState({
    stage1Data: null,
    stage1Loading: false,
    stage1Error: null,
    stage1Promise: null,

    stage2Data: null,
    stage2Loading: false,
    stage2Error: null,
    stage2Promise: null,

    stage3Data: null,
    stage3Loading: false,
    stage3Error: null,
    stage3Promise: null,
  });
}, [currentContext.activeQuery]); // Reset whenever query executes (even if same query text)

// Pass state and updater functions to QueryInsightsTab
{selectedTab === 'tab_performance_main' && (
  <QueryInsightsMain
    queryInsightsState={queryInsightsState}
    setQueryInsightsState={setQueryInsightsState}
  />
)}
```

**In QueryInsightsTab.tsx (child component):**

```typescript
interface QueryInsightsMainProps {
  queryInsightsState: QueryInsightsState;
  setQueryInsightsState: React.Dispatch<React.SetStateAction<QueryInsightsState>>;
}

export const QueryInsightsMain = ({
  queryInsightsState,
  setQueryInsightsState
}: QueryInsightsMainProps): JSX.Element => {
  const { trpcClient } = useTrpcClient();

  // Stage 1: Load when tab activates (only if not already loading/loaded)
  useEffect(() => {
    if (!queryInsightsState.stage1Data &&
        !queryInsightsState.stage1Loading &&
        !queryInsightsState.stage1Promise) {

      // Mark as loading
      setQueryInsightsState(prev => ({ ...prev, stage1Loading: true }));

      // Create promise and store it
      const promise = trpcClient.mongoClusters.collectionView.getQueryInsightsStage1
        .query()
        .then((data) => {
          setQueryInsightsState(prev => ({
            ...prev,
            stage1Data: data,
            stage1Loading: false,
            stage1Promise: null,
          }));
          return data;
        })
        .catch((error) => {
          void trpcClient.common.displayErrorMessage.mutate({
            message: l10n.t('Failed to load query insights'),
            modal: false,
            cause: error instanceof Error ? error.message : String(error),
          });
          setQueryInsightsState(prev => ({
            ...prev,
            stage1Error: error instanceof Error ? error.message : String(error),
            stage1Loading: false,
            stage1Promise: null,
          }));
          throw error;
        });

      // Store promise reference
      setQueryInsightsState(prev => ({ ...prev, stage1Promise: promise }));
    }
  }, []); // Empty deps - only run on mount

  // Stage 2: Auto-start after Stage 1 completes
  useEffect(() => {
    if (queryInsightsState.stage1Data &&
        !queryInsightsState.stage2Data &&
        !queryInsightsState.stage2Loading &&
        !queryInsightsState.stage2Promise) {

      setQueryInsightsState(prev => ({ ...prev, stage2Loading: true }));

      const promise = trpcClient.mongoClusters.collectionView.getQueryInsightsStage2
        .query()
        .then((data) => {
          setQueryInsightsState(prev => ({
            ...prev,
            stage2Data: data,
            stage2Loading: false,
            stage2Promise: null,
          }));
          return data;
        })
        .catch((error) => {
          void trpcClient.common.displayErrorMessage.mutate({
            message: l10n.t('Failed to load detailed execution analysis'),
            modal: false,
            cause: error instanceof Error ? error.message : String(error),
          });
          setQueryInsightsState(prev => ({
            ...prev,
            stage2Error: error instanceof Error ? error.message : String(error),
            stage2Loading: false,
            stage2Promise: null,
          }));
          throw error;
        });

      setQueryInsightsState(prev => ({ ...prev, stage2Promise: promise }));
    }
  }, [queryInsightsState.stage1Data]);

  // Render with queryInsightsState data
  return (
    <div className="queryInsightsPanel">
      {queryInsightsState.stage1Loading && <SkeletonUI />}
      {queryInsightsState.stage1Data && (
        <MetricsRow data={queryInsightsState.stage1Data} />
      )}
      {/* ... rest of UI */}
    </div>
  );
};
```

**Behavior with This Architecture**:

- ✅ **Tab Switch Away**: Component unmounts, but state persists in parent
- ✅ **In-Flight Requests**: Promise stored in parent state, continues executing
- ✅ **Tab Switch Back**: Component remounts, immediately has access to parent state
- ✅ **Request Completes While Away**: State update happens in parent, visible when returning
- ✅ **Query Change**: Parent detects change and resets all query insights state

**Key Architecture Points**:

- **Parent State Storage**: CollectionView.tsx owns query insights state
- **Promise Tracking**: Store promise references to prevent duplicate requests
- **Component Unmounting**: QueryInsightsTab can unmount without losing data
- **Automatic Recovery**: When remounting, component checks parent state before fetching---

**5.2.4. Stage 3: AI Recommendations (User-Initiated)** ✅ Complete

**Goal**: Allow user to request AI recommendations on demand with ~8s loading delay.

**Implementation**:

```typescript
const [stage3Data, setStage3Data] = useState<QueryInsightsStage3Response | null>(null);
const [stage3Loading, setStage3Loading] = useState(false);
const [stage3Error, setStage3Error] = useState<string | null>(null);

const handleGetAIRecommendations = () => {
  setStage3Loading(true);
  setStage3Error(null);

  void trpcClient.mongoClusters.collectionView.getQueryInsightsStage3
    .query()
    .then((data) => {
      setStage3Data(data);
      setStage3Loading(false);
    })
    .catch((error) => {
      void trpcClient.common.displayErrorMessage.mutate({
        message: l10n.t('Failed to get AI recommendations'),
        modal: false,
        cause: error instanceof Error ? error.message : String(error),
      });
      setStage3Error(error instanceof Error ? error.message : String(error));
      setStage3Loading(false);
    });
};
```

**UI Integration**:

```typescript
// In QueryInsightsTab.tsx:
{!stage3Data && !stage3Loading && (
  <VSCodeButton onClick={handleGetAIRecommendations}>
    {l10n.t('Get Performance Insights')}
  </VSCodeButton>
)}

{stage3Loading && (
  <div className="ai-loading-state">
    <VSCodeProgressRing />
    <span>{l10n.t('Analyzing query performance...')}</span>
  </div>
)}

{stage3Data && (
  <AIRecommendationsSection recommendations={stage3Data} />
)}
```

**Behavior**:

- ✅ User must click button to trigger AI analysis
- ✅ Shows loading state for ~8 seconds (AI service delay)
- ✅ Continues even if user switches tabs
- ✅ Results persist in component state
- ✅ Button hidden after recommendations loaded

---

**5.2.5. Two-Level Caching Strategy** ✅ Complete

**Goal**: Document and validate the two-level caching architecture with component unmounting considerations.

**Caching Levels**:

1. **Backend Cache (ClusterSession)**:

   ```typescript
   // In ClusterSession:
   private _queryPlannerCache?: { result: Document; timestamp: number };
   private _executionStatsCache?: { result: Document; timestamp: number };
   private _aiRecommendationsCache?: { result: unknown; timestamp: number };
   private _lastExecutionTimeMs?: number;

   // Cleared when query text changes in resetCachesIfQueryChanged()
   ```

2. **Frontend Cache (Parent Component State - CollectionView.tsx)**:

   ````typescript
   // ⚠️ CRITICAL: Must be in parent (CollectionView.tsx) not child (QueryInsightsTab.tsx)
   // Because QueryInsightsTab unmounts on tab switch

   interface QueryInsightsState {
     stage1Data: QueryInsightsStage1Response | null;
     stage1Loading: boolean;
     stage1Promise: Promise<QueryInsightsStage1Response> | null;

     stage2Data: QueryInsightsStage2Response | null;
     stage2Loading: boolean;
     stage2Promise: Promise<QueryInsightsStage2Response> | null;

     stage3Data: QueryInsightsStage3Response | null;
     stage3Loading: boolean;
     stage3Promise: Promise<QueryInsightsStage3Response> | null;
   }

   const [queryInsightsState, setQueryInsightsState] = useState<QueryInsightsState>({...});

   // Reset when query executes (even if same query text)
   useEffect(() => {
     setQueryInsightsState({ /* reset all fields */ });
   }, [currentContext.activeQuery]);
   ```**Cache Invalidation Flow**:
   ````

```typescript
// In CollectionView.tsx:
useEffect(() => {
  const currentQueryId = JSON.stringify({
    filter: currentContext.activeQuery.filter,
    project: currentContext.activeQuery.project,
    sort: currentContext.activeQuery.sort,
  });

  // Query changed - reset all query insights state
  if (queryInsightsState.queryIdentifier !== currentQueryId) {
    setQueryInsightsState({
      stage1Data: null,
      stage1Loading: false,
      stage1Promise: null,

      stage2Data: null,
      stage2Loading: false,
      stage2Promise: null,

      stage3Data: null,
      stage3Loading: false,
      stage3Promise: null,
    });
}, [currentContext.activeQuery]); // Reset whenever query executes (even if same query text)

// Backend cache automatically cleared by ClusterSession.resetCachesIfQueryChanged()
```

**Why Promise Tracking is Critical**:

```typescript
// Scenario: User switches tabs during Stage 1 fetch
// 1. User on Query Insights tab → Stage 1 request starts
// 2. User switches to Results tab → QueryInsightsTab unmounts
// 3. Stage 1 request completes while user on Results tab
// 4. State update happens in parent CollectionView.tsx
// 5. User returns to Query Insights tab → QueryInsightsTab remounts
// 6. Component checks parent state, sees stage1Data exists, doesn't re-fetch
// 7. If no stage1Data but stage1Promise exists → wait for existing promise

// Without promise tracking:
if (!stage1Data && !stage1Loading) {
  startStage1Fetch(); // ❌ Could start duplicate request if promise in flight
}

// With promise tracking:
if (!stage1Data && !stage1Loading && !stage1Promise) {
  startStage1Fetch(); // ✅ Only starts if no request in progress
}
```

**Key Behaviors**:

- ✅ **Tab Switch Away → Component Unmounts**: State persists in parent CollectionView.tsx
- ✅ **In-Flight Request**: Promise stored in parent, continues executing even when component unmounted
- ✅ **Tab Switch Back → Component Remounts**: Immediately accesses parent state, no re-fetch needed
- ✅ **Request Completes While Away**: State update happens in parent, visible when returning
- ✅ **Query Execution**: Parent resets all query insights state (even if same query text re-executed)
- ✅ **Duplicate Prevention**: Promise tracking prevents multiple simultaneous requests

**Testing Scenarios**:

1. **Basic Flow**: Run query → Switch to Query Insights → Verify Stage 1 shows cached data
2. **Tab Switch During Load**: Activate Query Insights → Immediately switch to Results → Wait 2s → Return → Verify Stage 1 data visible
3. **Complete Stage 2 → Switch**: Complete Stage 2 → Switch to Results → Return → Verify Stage 2 data still visible
4. **AI During Tab Switch**: Request Stage 3 → Switch tabs during 8s delay → Return → Verify AI results show
5. **Query Re-execution Reset**: Complete all stages → Re-execute same query → Switch to Query Insights → Verify all state reset, new data fetched
6. **Duplicate Prevention**: Partially load Stage 1 → Switch away → Return before completion → Verify no duplicate request

---

**5.2.6. UI Component Integration with Real Data** ✅ Complete

**Goal**: Connect existing UI components to real Stage 1/2/3 data instead of mock values.

**⚠️ Architecture Note**: Components receive data via props from parent CollectionView.tsx state.

**Implementation**:

```typescript
// In QueryInsightsTab.tsx:
const [stage1Data, setStage1Data] = useState<QueryInsightsStage1Response | null>(null);
const [stage1Loading, setStage1Loading] = useState(false);

useEffect(() => {
  // Fetch Stage 1 data when tab becomes active
  if (isQueryInsightsTabActive && !stage1Data) {
    setStage1Loading(true);

    void trpcClient.mongoClusters.collectionView.getQueryInsightsStage1
      .query()
      .then((data) => {
        setStage1Data(data);
        setStage1Loading(false);
      })
      .catch((error) => {
        // Show error to user
        void trpcClient.common.displayErrorMessage.mutate({
          message: l10n.t('Failed to load query insights'),
          modal: false,
          cause: error instanceof Error ? error.message : String(error),
        });
        setStage1Loading(false);
      });
  }
}, [isQueryInsightsTabActive]);
```

**Behavior**:

- ✅ Loads Stage 1 data immediately when Query Insights tab is activated
- ✅ Data likely already cached from prefetch (fast response)
- ✅ If not cached, ClusterSession fetches from cache or generates new explain
- ✅ Stage 1 data persists in component state (no re-fetch on tab switch)

**5.2.2. Stage 2: Automatic Progression After Stage 1**

```typescript
const [stage2Data, setStage2Data] = useState<QueryInsightsStage2Response | null>(null);
const [stage2Loading, setStage2Loading] = useState(false);

useEffect(() => {
  // Start Stage 2 fetch immediately after Stage 1 completes
  if (stage1Data && !stage2Data && !stage2Loading) {
    setStage2Loading(true);

    void trpcClient.mongoClusters.collectionView.getQueryInsightsStage2
      .query()
      .then((data) => {
        setStage2Data(data);
        setStage2Loading(false);
      })
      .catch((error) => {
        void trpcClient.common.displayErrorMessage.mutate({
          message: l10n.t('Failed to load detailed execution analysis'),
          modal: false,
          cause: error instanceof Error ? error.message : String(error),
        });
        setStage2Loading(false);
      });
  }
}, [stage1Data]);
```

**Behavior**:

- ✅ Automatically starts after Stage 1 completes
- ✅ Runs explain("executionStats") which executes the query
- ✅ Updates UI with execution metrics (keysExamined, docsExamined, performance rating)
- ✅ Does NOT abort if user switches tabs (fetch continues in background)

**5.2.3. Tab Switching Behavior**

```typescript
// In CollectionView.tsx (tab management):
const [activeTab, setActiveTab] = useState<'results' | 'queryInsights' | 'schema'>('results');

const handleTabChange = (newTab: string) => {
  setActiveTab(newTab);
  // DO NOT abort ongoing Stage 1/2/3 fetches
  // Fetches complete in background, results cached in component state
};

useEffect(() => {
  if (activeTab === 'queryInsights') {
    // Tab activated - trigger Stage 1 fetch if needed (see 5.2.1)
  }
  // When switching away, fetches continue in background
}, [activeTab]);
```

**Behavior**:

- ✅ Fetches continue even when user switches to Results or other tabs
- ✅ When user returns to Query Insights tab, data is already loaded
- ✅ No need to re-fetch - component state preserves all Stage 1/2/3 data
- ✅ ClusterSession cache ensures consistent data if fetch completes after tab switch

**5.2.4. Stage 3: AI Recommendations (User-Initiated)**

```typescript
const [stage3Data, setStage3Data] = useState<QueryInsightsStage3Response | null>(null);
const [stage3Loading, setStage3Loading] = useState(false);

const handleGetAIRecommendations = () => {
  setStage3Loading(true);

  void trpcClient.mongoClusters.collectionView.getQueryInsightsStage3
    .query()
    .then((data) => {
      setStage3Data(data);
      setStage3Loading(false);
    })
    .catch((error) => {
      void trpcClient.common.displayErrorMessage.mutate({
        message: l10n.t('Failed to get AI recommendations'),
        modal: false,
        cause: error instanceof Error ? error.message : String(error),
      });
      setStage3Loading(false);
    });
};
```

**Behavior**:

- ✅ User clicks "Get Performance Insights" button
- ✅ Shows loading state for ~8 seconds (AI service delay)
- ✅ Continues even if user switches tabs
- ✅ Results persist in component state

**5.2.5. Caching Strategy Summary**

The caching happens at **two levels**:

1. **Backend Cache (ClusterSession)**:
   - Query planner info cached in `_queryPlannerCache`
   - Execution stats cached in `_executionStatsCache`
   - Cleared when query text changes
   - Survives tab switches

2. **Frontend Cache (Component State)**:
   - `stage1Data`, `stage2Data`, `stage3Data` in React state
   - Survives tab switches within same session
   - Cleared when query changes (new execution → new sessionId → new data)

**Key Behavior**:

- ✅ If user switches tabs and returns, frontend state provides instant display
- ✅ If component unmounts and remounts (page navigation), backend cache prevents redundant explain calls
- ✅ If query changes, both caches reset automatically

**5.2.6. UI Component Integration**

Update existing mock components to use real data:

```typescript
// Replace mock values with stage1Data/stage2Data:
<TimeMetric
  label={l10n.t('Execution Time')}
  valueMs={stage1Data?.executionTime ?? null}
/>
<CountMetric
  label={l10n.t('Documents Returned')}
  value={stage1Data?.documentsReturned ?? null}
/>
<CountMetric
  label={l10n.t('Keys Examined')}
  value={stage2Data?.executionStats.totalKeysExamined ?? null}
/>
<CountMetric
  label={l10n.t('Docs Examined')}
  value={stage2Data?.executionStats.totalDocsExamined ?? null}
/>

// Query Efficiency Analysis:
<GenericCell
  label={l10n.t('Execution Strategy')}
  value={stage2Data?.efficiencyAnalysis.executionStrategy}
  placeholder="skeleton"
/>
<PerformanceRatingCell
  label={l10n.t('Performance Rating')}
  rating={stage2Data?.efficiencyAnalysis.performanceRating?.rating}
  description={stage2Data?.efficiencyAnalysis.performanceRating?.message}
  visible={!!stage2Data}
/>

// AI Recommendations:
{stage3Data?.improvementCards.map(card => (
  <ImprovementCard
    key={card.cardId}
    config={card}
    onPrimaryAction={handlePrimaryAction}
    onSecondaryAction={handleSecondaryAction}
  />
))}
```

```typescript
// In QueryInsightsTab.tsx - Replace mock values with real data:

// 1. Metrics Row (Stage 1 + Stage 2 data)
<TimeMetric
  label={l10n.t('Execution Time')}
  valueMs={stage1Data?.executionTime ?? null}
  loading={stage1Loading}
/>
<CountMetric
  label={l10n.t('Documents Returned')}
  value={stage1Data?.documentsReturned ?? null}
  loading={stage1Loading}
/>
<CountMetric
  label={l10n.t('Keys Examined')}
  value={stage2Data?.executionStats.totalKeysExamined ?? null}
  loading={stage2Loading}
  placeholder={!stage2Data ? 'n/a' : undefined}
/>
<CountMetric
  label={l10n.t('Docs Examined')}
  value={stage2Data?.executionStats.totalDocsExamined ?? null}
  loading={stage2Loading}
  placeholder={!stage2Data ? 'n/a' : undefined}
/>

// 2. Query Plan Overview (Stage 1 data)
<QueryPlanOverview
  stages={stage1Data?.queryPlan.stages ?? []}
  loading={stage1Loading}
/>

// 3. Query Efficiency Analysis (Stage 2 data)
<QueryEfficiencyAnalysis
  executionStrategy={stage2Data?.efficiencyAnalysis.executionStrategy}
  indexUsed={stage2Data?.efficiencyAnalysis.indexUsed}
  performanceRating={stage2Data?.efficiencyAnalysis.performanceRating?.rating}
  ratingMessage={stage2Data?.efficiencyAnalysis.performanceRating?.message}
  loading={stage2Loading}
  visible={!!stage2Data}
/>

// 4. AI Recommendations (Stage 3 data)
{stage3Data && (
  <AIRecommendationsSection>
    <AnalysisCard content={stage3Data.analysisCard} />

    {stage3Data.improvementCards.map((card) => (
      <ImprovementCard
        key={card.cardId}
        config={card}
        onPrimaryAction={handlePrimaryAction}
        onSecondaryAction={handleSecondaryAction}
      />
    ))}

    <VerificationSteps steps={stage3Data.verificationSteps} />
  </AIRecommendationsSection>
)}

// 5. Action Handlers
const handlePrimaryAction = (payload: ActionPayload) => {
  if (payload.action === 'createIndex') {
    void trpcClient.mongoClusters.collectionView.createIndex.mutate({
      indexSpec: payload.indexSpec,
    });
  } else if (payload.action === 'dropIndex') {
    void trpcClient.mongoClusters.collectionView.dropIndex.mutate({
      indexSpec: payload.indexSpec,
    });
  }
};

const handleSecondaryAction = (payload: ActionPayload) => {
  if (payload.action === 'copyCommand') {
    void navigator.clipboard.writeText(payload.command);
  } else if (payload.action === 'learnMore') {
    void vscode.env.openExternal(vscode.Uri.parse(payload.url));
  }
};
```

**Conditional Rendering Logic**:

```typescript
// Stage 1: Always visible when tab is active
{stage1Loading && <SkeletonMetricsRow />}
{stage1Data && <MetricsRow data={stage1Data} />}
{stage1Error && <ErrorMessage message={stage1Error} />}

// Stage 2: Shows "n/a" placeholders until loaded
{!stage2Data && !stage2Loading && <MetricsRow showPlaceholders />}
{stage2Loading && <SkeletonEfficiencyAnalysis />}
{stage2Data && <EfficiencyAnalysis data={stage2Data} />}

// Stage 3: Shows button until loaded
{!stage3Data && !stage3Loading && <GetInsightsButton onClick={handleGetAIRecommendations} />}
{stage3Loading && <AILoadingState />}
{stage3Data && <AIRecommendations data={stage3Data} />}
```

**Testing Checklist for UI Integration**:

- [ ] Metrics show skeleton/loading states correctly
- [ ] Stage 1 data populates immediately when available
- [ ] Stage 2 metrics show "n/a" until loaded, then update
- [ ] Performance rating appears only after Stage 2 completes
- [ ] Query plan stages display correctly from Stage 1 data
- [ ] AI recommendations button triggers Stage 3 fetch
- [ ] AI loading state shows for ~8 seconds
- [ ] Improvement cards render with correct button payloads
- [ ] Primary actions (create/drop index) execute correctly
- [ ] Secondary actions (copy command, learn more) work correctly
- [ ] Tab switches don't interrupt data display
- [ ] Error states show user-friendly messages

---

**Phase 5 Implementation Summary**:

```
5.1 Query Execution Logic:
  ├─ 5.1.1 Non-blocking Stage 1 prefetch after results return
  └─ 5.1.2 Placeholder for query state indicator (future: asterisk on tab)

5.2 Frontend Query Insights Panel:
  ├─ 5.2.1 Stage 1: Load on tab activation (cached from prefetch)
  ├─ 5.2.2 Stage 2: Auto-start after Stage 1, populate detailed metrics
  ├─ 5.2.3 Tab switching: No abort, preserve data in component state
  ├─ 5.2.4 Stage 3: User-initiated, ~8s AI loading delay
  ├─ 5.2.5 Two-level caching: ClusterSession + Component State
  └─ 5.2.6 UI components: Replace mocks with real data
```

**Key Implementation Principles**:

1. ✅ **Non-blocking**: Query results never wait for insights
2. ✅ **Progressive**: Stage 1 → Stage 2 → Stage 3 (each builds on previous)
3. ✅ **Cached**: Two-level caching prevents redundant fetches
4. ✅ **Resilient**: Fetches continue in background during tab switches
5. ✅ **User-Controlled**: Stage 3 AI analysis only on user request
6. ✅ **Automatic**: Stage 2 starts automatically after Stage 1

---

**Testing Checklist**:

- [ ] Stage 1 loads when Query Insights tab is activated
- [ ] Stage 2 starts automatically after Stage 1 completes
- [ ] Switching to Results tab doesn't abort ongoing fetches
- [ ] Returning to Query Insights tab shows cached data
- [ ] Changing query clears both frontend and backend caches
- [ ] Stage 3 AI recommendations show after ~8s delay
- [ ] All loading states display skeleton/spinner appropriately
- [ ] Error states show user-friendly messages

---

#### Phase 6: Testing & Validation

**6.1. Unit Tests** ⬜ Not Started

**📖 Before starting**: Review entire design document for edge cases and test scenarios mentioned in each stage section.

- Test `ExplainPlanAnalyzer` with various explain outputs
- Test `StagePropertyExtractor` with different stage types
- Test `QueryInsightsAIService` with mock responses
- Test router transformation functions

**6.2. Integration Tests** ⬜ Not Started

**📖 Before starting**: Review "Implementation Details", "ClusterSession Integration", and router sections for integration patterns.

- Test full Stage 1 flow (query → explain → transform → UI)
- Test full Stage 2 flow with execution stats
- Test full Stage 3 flow with AI service
- Test caching behavior in ClusterSession

**6.3. End-to-End Tests** ⬜ Not Started

**📖 Before starting**: Review all three stage sections for end-to-end behavior and performance expectations.

- Test with real DocumentDB/MongoDB instance
- Test performance rating algorithm accuracy
- Test AI service integration
- Test error handling and edge cases

---

#### Phase 7: Production Hardening

**7.1. Error Handling** ⬜ Not Started

**📖 Before starting**: Review "Additional Considerations" section for error handling strategies for each stage.

- Add try-catch blocks for all explain operations
- Handle AI service timeouts and errors
- Add user-friendly error messages
- Implement retry logic with exponential backoff

**7.2. Telemetry** ⬜ Not Started

**📖 Before starting**: Review entire design document for telemetry requirements and success/failure metrics.

- Add telemetry for Stage 1/2/3 success/failure
- Track AI service response times
- Monitor cache hit rates
- Track user interactions with recommendations

**7.3. Performance Optimization** ⬜ Not Started

**📖 Before starting**: Review "Session Management and Caching Strategy" and "Performance and Best Practices" sections.

- Optimize ClusterSession cache memory usage
- Add cache TTL and eviction policies
- Optimize explain plan parsing performance
- Add lazy loading for Stage 2/3 data

**7.4. Security** ⬜ Not Started

**📖 Before starting**: Review "Security Guidelines" and button payload sections for security requirements.

- Validate action payloads before execution
- Sanitize query strings sent to AI service
- Add rate limiting for AI service calls
- Validate index specifications before creation

---

### Status Tracking

#### Legend

- ⬜ Not Started
- 🔄 In Progress
- ✅ Complete
- ⚠️ Blocked

#### Progress Summary

| Phase                     | Status         | Progress |
| ------------------------- | -------------- | -------- |
| 1. Foundation & Types     | ✅ Complete    | 1/1      |
| 2. Explain Plan Analysis  | ✅ Complete    | 5/5      |
| 3. AI Service Integration | ✅ Complete    | 1/1      |
| 4. Router Implementation  | ✅ Complete    | 2/2      |
| 5. Frontend Integration   | 🔄 In Progress | 5/6      |
| 6. Testing & Validation   | ⬜ Not Started | 0/3      |
| 7. Production Hardening   | ⬜ Not Started | 0/4      |

#### Detailed Status

**Phase 1: Foundation & Types**

- 1.1 Create Type Definitions: ✅ Complete

**Phase 2: Explain Plan Analysis**

- 2.1 Install Dependencies: ✅ Complete
- 2.2 Create ExplainPlanAnalyzer: ✅ Complete
- 2.3 Create StagePropertyExtractor: ✅ Complete
- 2.4 Create QueryInsightsApis and Integrate with ClustersClient: ✅ Complete
- 2.5 Extend ClusterSession for Caching: ✅ Complete

**Phase 3: AI Service Integration**

- 3.1 Create AI Service Client (mock with 8s delay): ✅ Complete
- 3.2 Extend ClusterSession for AI Integration: ⬜ Not Started (Deferred - not needed for Stage 3 endpoint)

**Phase 4: Router Implementation**

- 4.1 Implement tRPC Endpoints: ✅ Complete
- 4.2 Implement Transformation Functions: ✅ Complete

**Phase 5: Frontend Integration**

- 5.1 Update Query Execution Logic: 🔄 In Progress
  - 5.1.1 Non-blocking Stage 1 Prefetch After Query Execution: ✅ Complete
  - 5.1.2 Add Placeholder for Query State Indicator: ⬜ Not Started
- 5.2 Implement Frontend Query Insights Panel: ✅ Complete
  - 5.2.1 Stage 1: Initial View on Tab Activation: ✅ Complete
  - 5.2.2 Stage 2: Automatic Progression After Stage 1: ✅ Complete
  - 5.2.3 Tab Switching Behavior (No Abort): ✅ Complete
  - 5.2.4 Stage 3: AI Recommendations (User-Initiated): ✅ Complete
  - 5.2.5 Two-Level Caching Strategy: ✅ Complete
  - 5.2.6 UI Component Integration with Real Data: ✅ Complete

**Phase 6: Testing & Validation**

- 6.1 Unit Tests: ⬜ Not Started
- 6.2 Integration Tests: ⬜ Not Started
- 6.3 End-to-End Tests: ⬜ Not Started

**Phase 7: Production Hardening**

- 7.1 Error Handling: ⬜ Not Started
- 7.2 Telemetry: ⬜ Not Started
- 7.3 Performance Optimization: ⬜ Not Started
- 7.4 Security: ⬜ Not Started

---

### Dependencies Between Steps

```
1.1 (Types) → 2.2, 2.3, 2.5, 3.1, 4.1, 4.2
2.1 (Dependencies) → 2.2, 2.3
2.2 (ExplainPlanAnalyzer) → 2.5, 4.1
2.3 (StagePropertyExtractor) → 4.1
2.4 (QueryInsightsApis) → 2.5
2.5 (ClusterSession) → 4.1
3.1 (AI Service Mock) → 3.2
3.2 (AI in ClusterSession) → 4.1
4.1 (Router Endpoints - Stage1/2/3) → 5.1, 5.2
4.2 (Transformations - Stage1/2/3) → 4.1
5.1 (Query Execution) → 5.2
5.2 (Frontend Panel - Stage1/2/3 UI) → 6.2, 6.3
```

**Note**: Frontend-facing functions use "Stage1", "Stage2", "Stage3" terminology for clarity.

---

### Recommended Parallel Work Streams

**Stream 1: Backend Foundation (Can work in parallel)**

- 1.1 Create Type Definitions (frontend types + AI service types)
- 2.1 Install Dependencies (@mongodb-js/explain-plan-helper)

**Stream 2: Explain Plan Analysis (After Stream 1 complete)**

- 2.2 Create ExplainPlanAnalyzer
- 2.3 Create StagePropertyExtractor
- 2.4 Create QueryInsightsApis (follows LlmEnhancedFeatureApis pattern - NOT in ClustersClient)

**Stream 3: Caching Layer (After Stream 2 complete)**

- 2.5 Extend ClusterSession for Caching (moved to client/ folder, uses QueryInsightsApis)

**Stream 4: AI Integration (Can start after 1.1, parallel to Stream 2)**

- 3.1 Create AI Service Mock (8-second delay, returns webview mock data)
- 3.2 Extend ClusterSession for AI Integration

**Stream 5: Transformations (Can work parallel to Streams 2-4)**

- 4.2 Implement Transformation Functions (transformStage1/2/3Response - separate file in queryInsights/)

**Stream 6: Router (After Streams 3, 4, and 5 complete)**

- 4.1 Implement tRPC Endpoints (getQueryInsightsStage1/Stage2/Stage3 - no storeQueryMetadata)

**Stream 7: Frontend (After Stream 6 complete)**

- 5.1 Update Query Execution Logic (server-side metadata tracking)
- 5.2 Implement Frontend Query Insights Panel (Stage 1/2/3 UI components)

**Stream 8: Quality Assurance (Can start incrementally)**

- 6.1 Unit Tests (as each component completes)
- 6.2 Integration Tests (after Stream 6)
- 6.3 End-to-End Tests (after Stream 7)

**Stream 9: Hardening (Final phase)**

- 7.1-7.4 All production hardening tasks

---

## Key Simplifications Summary

1. **File Organization**: Moved `ClusterSession` and `ClustersClient` to `src/documentdb/client/` folder for better organization and future extensibility
2. **QueryInsightsApis Pattern**: Created `QueryInsightsApis.ts` following `LlmEnhancedFeatureApis` pattern - explain functionality is NOT in ClustersClient
3. **No Backend Cache Types**: Use simple Map structures with inline types
4. **No Collection/Index Stats Methods**: Not needed for MVP - AI backend handles data collection
5. **No storeQueryMetadata Endpoint**: Query metadata tracked server-side automatically
6. **Transformation Functions**: Separate file (`transformations.ts`) with Stage1/2/3 terminology
7. **AI Service**: Mock implementation with 8s delay, actual integration commented out for future
8. **Frontend-Facing Terminology**: Router endpoints and transformation functions use "Stage1", "Stage2", "Stage3" naming
9. **Backend Generic Types**: Backend code avoids webview-specific terminology
10. **Review Reminders**: Each implementation step includes 📖 reminder to review relevant design document sections

---

**Important**: Before implementing any step, always review the entire design document. Each section contains critical implementation details, patterns, and architectural decisions that inform the implementation.
