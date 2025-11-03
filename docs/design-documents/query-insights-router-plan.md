# Query Insights Router Implementation Plan

## Overview

This document outlines the plan for implementing three-stage query insights in the `collectionViewRouter.ts` file. The implementation will support progressive data loading for query performance analysis and AI-powered optimization recommendations.

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
  clusterId: string; // Identifies the MongoDB cluster/connection
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
 * Calculates the examined-to-returned ratio (efficiency indicator)
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
 * Rates query performance based on efficiency metrics
 */
export function calculatePerformanceRating(metrics: {
  examinedToReturnedRatio: number;
  hadCollectionScan: boolean;
  hadInMemorySort: boolean;
  indexUsed: boolean;
}): {
  score: 'excellent' | 'good' | 'fair' | 'poor';
  concerns: string[];
} {
  const concerns: string[] = [];
  let score: 'excellent' | 'good' | 'fair' | 'poor' = 'excellent';

  // Check examined/returned ratio
  if (metrics.examinedToReturnedRatio > 100) {
    concerns.push('High examined-to-returned ratio indicates inefficient query');
    score = 'poor';
  } else if (metrics.examinedToReturnedRatio > 10) {
    concerns.push('Moderate examined-to-returned ratio');
    score = score === 'excellent' ? 'fair' : score;
  }

  // Check for collection scan
  if (metrics.hadCollectionScan) {
    concerns.push('Full collection scan performed');
    score = 'poor';
  }

  // Check for in-memory sort
  if (metrics.hadInMemorySort) {
    concerns.push('In-memory sort required (consider adding index)');
    if (score === 'excellent') score = 'fair';
  }

  // Check index usage
  if (!metrics.indexUsed && !metrics.hadCollectionScan) {
    concerns.push('No index used for filtering');
    if (score === 'excellent') score = 'good';
  }

  return { score, concerns };
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
  executionTime: number;           // Milliseconds (client-side measurement)
  documentsReturned: number;       // Count of documents in result set
  queryPlannerInfo: {
    winningPlan: {
      stage: string;                // e.g., "FETCH", "IXSCAN", "COLLSCAN"
      inputStage?: {
        stage: string;
        indexName?: string;
      };
    };
    rejectedPlans: Array<unknown>;  // Plans considered but not used
    namespace: string;               // database.collection
    indexFilterSet: boolean;         // Whether index filters are applied
    parsedQuery: Record<string, unknown>; // Query shape
    plannerVersion: number;
  };
  stages: Array<{                   // Flattened stage hierarchy
    stage: string;                   // "IXSCAN" | "FETCH" | "PROJECTION" | "SORT" | "COLLSCAN"
    indexName?: string;              // For IXSCAN stages
    indexBounds?: string;            // Stringified bounds
  }>;
}
```

### Implementation Notes

**Design Document Alignment**:

1. **Metrics Row** (design doc 2.1): Display individual metric cards
   - Execution Time: Client-side measurement
   - Documents Returned: From result set
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

1. **New Query Detection**: The existing `resetCachesIfQueryChanged()` method detects when the query text changes

2. **Automatic explain("queryPlanner") Call**: On the first Stage 1 request after a new query:
   - Extract the base query (filter, projection, sort) from the current query
   - **Remove `skip` and `limit` modifiers** to analyze the full query scope (not just one page)
   - Execute `explain("queryPlanner")` with the clean query
   - Persist results in `_currentQueryPlannerInfo`

3. **Caching**: Subsequent Stage 1 requests return cached `_currentQueryPlannerInfo` until query changes

4. **Cache Invalidation**: When `resetCachesIfQueryChanged()` detects a query change, `_currentQueryPlannerInfo` is cleared

This approach ensures:

- ✅ Query insights reflect the full query performance (not just one page)
- ✅ Only one `explain("queryPlanner")` call per unique query
- ✅ Automatic cache management tied to query lifecycle
- ✅ Existing `skip`/`limit` paging for Results view remains unchanged

**Technical Details**:

1. **Execution Time**: Measured client-side by the webview before/after query execution
2. **Documents Returned**: Retrieved from cached results in ClusterSession
3. **QueryPlanner Info**: Obtained via dedicated method in ClusterSession (strips skip/limit, calls explain)
4. **Stages List**: Recursively traverse `winningPlan` to extract all stages for UI cards

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

Add to `ClusterSession` class:

```typescript
import { QueryInsightsApis } from './QueryInsightsApis';

export class ClusterSession {
  // Existing properties...
  private _currentQueryPlannerInfo?: unknown;
  private _currentExecutionTime?: number;
  private _currentDocumentsReturned?: number;

  // NEW: Query Insights API instance
  private _queryInsightsApis: QueryInsightsApis;

  constructor(/* existing parameters */) {
    // Existing initialization...

    // Initialize Query Insights APIs (follows LlmEnhancedFeatureApis pattern)
    this._queryInsightsApis = new QueryInsightsApis(this._client._mongoClient);
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
    // Using QueryInsightsApis (follows LlmEnhancedFeatureApis pattern)
    this._currentQueryPlannerInfo = await this._queryInsightsApis.explainFind(
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

**Architecture Pattern**: Follow the `LlmEnhancedFeatureApis.ts` approach

Instead of adding methods directly to `ClustersClient`, we should create explain-related functionality following the pattern established in `src/documentdb/LlmEnhancedFeatureApis.ts`. This class demonstrates the proper way to extend cluster functionality:

1. Create a dedicated class that accepts `MongoClient` in the constructor
2. Define TypeScript interfaces for all input options and output types
3. Implement methods with proper error handling and type safety
4. Use MongoDB driver's native APIs consistently

**Implementation Location**: `src/documentdb/QueryInsightsApis.ts` (new file)

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
// Example mock response
{
  executionTime: 23.433235,  // ms
  documentsReturned: 2,
  queryPlannerInfo: {
    winningPlan: {
      stage: "FETCH",
      inputStage: {
        stage: "IXSCAN",
        indexName: "user_id_1"
      }
    },
    rejectedPlans: [],
    namespace: "mydb.users",
    indexFilterSet: false,
    parsedQuery: { user_id: { $eq: 1234 } },
    plannerVersion: 1
  },
  stages: [
    { stage: "IXSCAN", indexName: "user_id_1", indexBounds: "user_id: [1234, 1234]" },
    { stage: "FETCH" },
    { stage: "PROJECTION" }
  ]
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

2. **Performance Rating Algorithm** (from design doc 3.2):

   ```typescript
   function calculatePerformanceRating(stats) {
     const concerns = [];
     let score = 'excellent';

     // Check examined/returned ratio
     if (stats.examinedToReturnedRatio > 100) {
       concerns.push('High examined-to-returned ratio indicates inefficient query');
       score = 'poor';
     } else if (stats.examinedToReturnedRatio > 10) {
       concerns.push('Moderate examined-to-returned ratio');
       score = downgradeTo('fair');
     }

     // Check for collection scan
     if (stats.hadCollectionScan) {
       concerns.push('Full collection scan performed');
       score = downgradeTo('poor');
     }

     // Check for in-memory sort
     if (stats.hadInMemorySort) {
       concerns.push('In-memory sort required (consider adding index)');
       score = downgradeTo('fair');
     }

     // Check index usage
     if (!stats.indexUsed && !stats.hadCollectionScan) {
       concerns.push('No index used for filtering');
       score = downgradeTo('good');
     }

     return { score, concerns, reasons: [] };
   }
   ```

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
  rawExecutionStats: { /* full MongoDB explain output */ }
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
  query: string; // The MongoDB query
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

Add to `ClusterSession` class:

```typescript
export class ClusterSession {
  // Existing properties...
  private _currentAIRecommendations?: unknown;

  // Update resetCachesIfQueryChanged to clear AI recommendations
  private resetCachesIfQueryChanged(query: string) {
    if (this._currentQueryText.localeCompare(query.trim(), undefined, { sensitivity: 'base' }) === 0) {
      return;
    }

    // Clear all caches including AI recommendations
    this._currentJsonSchema = {};
    this._currentRawDocuments = [];
    this._currentQueryPlannerInfo = undefined;
    this._currentExecutionStats = undefined;
    this._currentAIRecommendations = undefined;
    this._currentExecutionTime = undefined;
    this._currentDocumentsReturned = undefined;

    this._currentQueryText = query.trim();
  }

  // NEW: Cache AI recommendations
  public cacheAIRecommendations(recommendations: unknown): void {
    this._currentAIRecommendations = recommendations;
  }

  // NEW: Get cached AI recommendations
  public getCachedAIRecommendations(): unknown | undefined {
    return this._currentAIRecommendations;
  }
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

**QueryInsightsApis Class** (new file: `src/documentdb/QueryInsightsApis.ts`):

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
- ✅ **Access to MongoDB client** - Direct access via `getClient()`
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

```typescript
const PERFORMANCE_THRESHOLDS = {
  EXCELLENT: {
    maxExaminedToReturnedRatio: 2,
    requiresIndex: true,
    allowsInMemorySort: false,
    allowsCollectionScan: false,
  },
  GOOD: {
    maxExaminedToReturnedRatio: 10,
    requiresIndex: true,
    allowsInMemorySort: true,
    allowsCollectionScan: false,
  },
  FAIR: {
    maxExaminedToReturnedRatio: 100,
    requiresIndex: false,
    allowsInMemorySort: true,
    allowsCollectionScan: false,
  },
  POOR: {
    maxExaminedToReturnedRatio: Infinity,
    requiresIndex: false,
    allowsInMemorySort: true,
    allowsCollectionScan: true,
  },
};
```

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
2. **Integration Tests**: Test each stage endpoint with real MongoDB connection
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

## Next Steps

1. ✅ Review and approve this plan
2. Extend `ClusterSession` class (`src/documentdb/ClusterSession.ts`):
   - Add private properties for explain plans and AI recommendations caching
   - Implement `getQueryPlannerInfo()` with skip/limit stripping (Stage 1)
   - Implement `extractBaseQuery()` helper to remove paging modifiers
   - Implement `getExecutionStats()` (Stage 2)
   - Implement `setQueryMetadata()`, `getQueryMetadata()` methods
   - Implement `cacheAIRecommendations()`, `getCachedAIRecommendations()` (Stage 3)
   - Update `resetCachesIfQueryChanged()` to clear new caches
3. Extend `ClustersClient` class:
   - Add `explainQuery()` method to execute explain commands (Stage 1)
   - Add `getCollectionStats()` and `getIndexStats()` methods (Stage 3)
4. Create TypeScript types file (`src/webviews/documentdb/collectionView/types/queryInsights.ts`)
5. Implement router endpoints in `collectionViewRouter.ts`:
   - `getQueryInsightsStage1` (Initial Performance View - uses ClusterSession)
   - `getQueryInsightsStage2` (Detailed Execution Analysis - uses ClusterSession)
   - `getQueryInsightsStage3` (AI Recommendations - uses ClusterSession)
   - `storeQueryMetadata` mutation (stores in ClusterSession)
6. Update query execution logic in webview:
   - Measure execution time around query execution
   - Call `storeQueryMetadata` after each query with timing data
7. Update frontend to consume new endpoints (empty input schemas, sessionId in context)
8. Test with UI components using mock data
9. Iterate on data structures based on UI feedback and design doc alignment
10. Implement real DocumentDB integration:
    - Stage 1: `explain("queryPlanner")` with skip/limit stripped
    - Stage 2: `explain("executionStats")`
    - Performance rating algorithm (design doc 3.2 thresholds)
11. Connect AI backend (Stage 3)
12. Implement action handlers (createIndex, dropIndex, copy, learnMore)
13. Add telemetry and monitoring for all three stages
