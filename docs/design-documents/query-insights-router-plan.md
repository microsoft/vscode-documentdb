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

## Stage 1: Initial Performance View (Cheap Data + Query Plan)

### Purpose

**Design Goal** (from performance-advisor.md): Populated as soon as the query finishes, using fast signals plus `explain("queryPlanner")`. No full re-execution.

Provides immediate, low-cost metrics and query plan visualization without re-executing the query.

### Data Sources

- Query execution timer (client-side)
- Result set from the query
- Basic queryPlanner output (obtained via `explain("queryPlanner")` without executionStats)

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

1. **Execution Time**: Measured client-side by the webview before/after query execution
2. **Documents Returned**: Retrieved from cached results in ClusterSession
3. **QueryPlanner Info**: Obtained via `explain("queryPlanner")` - no actual query execution needed
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
function extractStage0Data(explainOutput: unknown): Stage0QueryPlannerExtraction {
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
export class ClusterSession {
  // Existing properties...
  private _currentQueryPlannerInfo?: unknown;
  private _currentExecutionTime?: number;
  private _currentDocumentsReturned?: number;

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
  public async getQueryPlannerInfo(databaseName: string, collectionName: string): Promise<unknown> {
    if (this._currentQueryPlannerInfo) {
      return this._currentQueryPlannerInfo;
    }

    // Run explain("queryPlanner") - no execution, just planning
    this._currentQueryPlannerInfo = await this._client.explainQuery(
      databaseName,
      collectionName,
      this._currentQueryText, // or use parsed query params
      'queryPlanner',
    );

    return this._currentQueryPlannerInfo;
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

Add to `ClustersClient` class:

```typescript
export class ClustersClient {
  // NEW: Execute explain command
  public async explainQuery(
    databaseName: string,
    collectionName: string,
    queryOrParams: string | FindQueryParams,
    verbosity: 'queryPlanner' | 'executionStats' | 'allPlansExecution',
  ): Promise<unknown> {
    const db = this._mongoClient.db(databaseName);
    const collection = db.collection(collectionName);

    // Build explain command based on input type
    let explainResult;

    if (typeof queryOrParams === 'string') {
      // Legacy string query (deprecated path)
      const filter = JSON.parse(queryOrParams);
      explainResult = await collection.find(filter).explain(verbosity);
    } else {
      // Modern FindQueryParams approach
      const cursor = collection.find(JSON.parse(queryOrParams.filter || '{}'));

      if (queryOrParams.project) {
        cursor.project(JSON.parse(queryOrParams.project));
      }
      if (queryOrParams.sort) {
        cursor.sort(JSON.parse(queryOrParams.sort));
      }
      if (queryOrParams.skip) {
        cursor.skip(queryOrParams.skip);
      }
      if (queryOrParams.limit) {
        cursor.limit(queryOrParams.limit);
      }

      explainResult = await cursor.explain(verbosity);
    }

    return explainResult;
  }
}
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

### ClusterSession Extensions for Stage 1

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

    // Run explain("executionStats") - actually executes the query
    this._currentExecutionStats = await this._client.explainQuery(
      databaseName,
      collectionName,
      this._currentQueryText, // or use parsed query params
      'executionStats',
    );

    return this._currentExecutionStats;
  }
}
```

**Note**: The `ClustersClient.explainQuery()` method added in Stage 1 is reused here with different verbosity level (`executionStats` instead of `queryPlanner`).

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

- `sessionId`: Used to retrieve query details, execution stats, and collection info
- `clusterId`: DocumentDB connection for fetching collection/index stats
- `databaseName` & `collectionName`: Target collection for stats retrieval

**Implementation Flow**:

1. Retrieve query details from session cache using `sessionId`
2. Retrieve execution stats (either from Stage 2 cache or re-run if not available)
3. Fetch collection stats: `db.collection.stats()`
4. Fetch index stats: `db.collection.getIndexes()`
5. Call AI backend with complete payload (may take 10-20 seconds per design doc)
6. Transform AI response for UI (formatted as animated suggestion cards)
7. Cache AI recommendations in session

**Backend AI Request Payload**:

```typescript
{
  sessionId: string;                            // For traceability
  query: {                                       // Retrieved from session cache
    filter: string;
    project?: string;
    sort?: string;
    skip?: number;
    limit?: number;
  };
  collectionName: string;
  collectionStats: Record<string, unknown>;     // From db.collection.stats()
  indexStats: Array<Record<string, unknown>>;   // From db.collection.getIndexes()
  executionStats: Record<string, unknown>;      // From Stage 1 or cached
  derived: {
    totalKeysExamined: number | null;
    totalDocsExamined: number | null;
    keysToDocsRatio: number | null;
    usedIndex: string | null;
  }
}
```

**Backend AI Response** (from your interface):

```typescript
interface OptimizationRecommendations {
  metadata: {
    collectionName: string;
    collectionStats: Record<string, unknown>;
    indexStats: Array<Record<string, unknown>>;
    executionStats: Record<string, unknown>;
    derived: {
      totalKeysExamined: number | null;
      totalDocsExamined: number | null;
      keysToDocsRatio: number | null;
      usedIndex: string | null;
    };
  };
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

**Router Output Schema** (Transformed for UI):

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

    // Action buttons
    primaryButton: {
      label: string; // e.g., "Create Index"
      actionId: string; // e.g., "createIndex"
      payload: {
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

  // Original metadata for debugging
  metadata: {
    collectionName: string;
    collectionStats: Record<string, unknown>;
    indexStats: Array<Record<string, unknown>>;
    executionStats: Record<string, unknown>;
    derived: {
      totalKeysExamined: number | null;
      totalDocsExamined: number | null;
      keysToDocsRatio: number | null;
      usedIndex: string | null;
    }
  }
}
```

### Transformation Logic

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

### ClustersClient Extensions for Stage 3

Add to `ClustersClient` class:

```typescript
export class ClustersClient {
  // NEW: Get collection statistics
  public async getCollectionStats(databaseName: string, collectionName: string): Promise<Record<string, unknown>> {
    const db = this._mongoClient.db(databaseName);
    const stats = await db.command({ collStats: collectionName });
    return stats;
  }

  // NEW: Get index statistics
  public async getIndexStats(databaseName: string, collectionName: string): Promise<Array<Record<string, unknown>>> {
    const db = this._mongoClient.db(databaseName);
    const collection = db.collection(collectionName);
    const indexes = await collection.indexes();
    return indexes;
  }
}
```

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

- **Stage 1**: Adds `getQueryPlannerInfo()`, `setQueryMetadata()`, `getQueryMetadata()`
- **Stage 2**: Adds `getExecutionStats()`
- **Stage 3**: Adds `cacheAIRecommendations()`, `getCachedAIRecommendations()`

All methods leverage the existing cache invalidation mechanism via `resetCachesIfQueryChanged()`.

**ClustersClient Extensions Summary**:

The extensions to `ClustersClient` are documented in stage sections:

- **Stage 1**: Adds `explainQuery()` method
- **Stage 3**: Adds `getCollectionStats()`, `getIndexStats()`

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

// When user requests insights
async function loadStage0Insights() {
  // sessionId is automatically available in RouterContext
  // ClusterSession already has the query and results cached
  const insights = await trpc.getQueryInsightsStage0.query({});
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
export interface QueryInsightsStage0Response {
  executionTime: number;
  documentsReturned: number;
  queryPlannerInfo: {
    winningPlan: WinningPlan;
    rejectedPlans: unknown[];
    namespace: string;
    indexFilterSet: boolean;
    parsedQuery: Record<string, unknown>;
    plannerVersion: number;
  };
  stages: StageInfo[];
}

export interface QueryInsightsStage1Response {
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
  performanceRating: PerformanceRating;
  stages: DetailedStageInfo[];
  rawExecutionStats: Record<string, unknown>;
}

export interface QueryInsightsStage2Response {
  analysisCard: AnalysisCard;
  improvementCards: ImprovementCard[];
  verificationSteps: string;
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
   - Implement `getQueryPlannerInfo()`, `getExecutionStats()` methods
   - Implement `setQueryMetadata()`, `getQueryMetadata()` methods
   - Implement `cacheAIRecommendations()`, `getCachedAIRecommendations()` methods
   - Update `resetCachesIfQueryChanged()` to clear new caches
3. Extend `ClustersClient` class:
   - Add `explainQuery()` method to execute explain commands
   - Add `getCollectionStats()` and `getIndexStats()` methods (if not present)
4. Create TypeScript types file (`src/webviews/documentdb/collectionView/types/queryInsights.ts`)
5. Implement router endpoints in `collectionViewRouter.ts`:
   - `getQueryInsightsStage0` (uses ClusterSession)
   - `getQueryInsightsStage1` (uses ClusterSession)
   - `getQueryInsightsStage2` (uses ClusterSession)
   - `storeQueryMetadata` mutation (stores in ClusterSession)
6. Update query execution logic in webview:
   - Measure execution time around query execution
   - Call `storeQueryMetadata` after each query with timing data
7. Update frontend to consume new endpoints (empty input schemas)
8. Test with UI components
9. Iterate on data structures based on UI feedback
10. Implement real DocumentDB integration (explain commands)
11. Connect AI backend
12. Implement action handlers
13. Add telemetry and monitoring
