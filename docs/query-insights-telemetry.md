# Query Insights Telemetry Data Points

This document provides a comprehensive overview of all telemetry data points collected by the Query Insights feature.

## Overview

Query Insights telemetry tracks user interactions, performance metrics, AI feature usage, and error conditions across three stages of analysis:

- **Stage 1**: Initial query analysis using `explain("queryPlanner")`
- **Stage 2**: Detailed execution statistics using `explain("executionStats")`
- **Stage 3**: AI-powered optimization recommendations

### Key Telemetry Highlights

**14 Tracked Events** spanning:

- 7 backend events (RPC calls + nested service calls)
- 7 frontend user interaction events

**⚠️ Stage 1 & 2 Have NO Custom Telemetry**:

- Stage 1 and Stage 2 only track **automatic RPC duration** and **errors**
- NO custom properties or measurements are added
- Query performance metrics (execution time, docs examined, etc.) are NOT logged to telemetry

**Performance Measurements** (Stage 3 only):

- ✅ **Automatic RPC duration tracking** for all backend calls (Stage 1, 2, 3)
- ✅ **Detailed AI pipeline breakdown** (Stage 3): explain duration, stats retrieval, Copilot response time
- ✅ **Data size metrics** (Stage 3): prompt size and response size for AI calls

**Privacy by Design**:

- ❌ Query content, database names, index specs **NOT logged to telemetry**
- ❌ Query performance metrics (execution time, docs examined) **NOT logged to telemetry**
- ✅ Only AI service performance, user interactions, and error states tracked
- ✅ Sensitive data sent to AI service but not persisted in telemetry logs

## Automatic Backend Telemetry

### tRPC Middleware (`trpcToTelemetry`)

All backend tRPC procedures automatically collect telemetry via the `trpcToTelemetry` middleware.

**Event Name Pattern**: `documentDB.rpc.{type}.{path}`

**Automatic Duration Tracking**:

- ✅ **End-to-end RPC call duration is automatically tracked** by the Azure extension telemetry framework
- This gives approximate total duration for each stage (Stage 1, Stage 2, Stage 3 RPC calls)
- Detailed sub-operation durations are tracked separately (see individual events below)

**Telemetry Properties** (automatically added on failure):
| Property | Type | Description | Added to Telemetry |
|----------|------|-------------|-------------------|
| `result` | string | Set to 'Failed' on errors | ✅ `telemetry.properties.result` |
| `error` | string | Error name | ✅ `telemetry.properties.error` |
| `errorMessage` | string | Error message text | ✅ `telemetry.properties.errorMessage` |
| `errorStack` | string | Error stack trace | ✅ `telemetry.properties.errorStack` |
| `errorCause` | string | Serialized error cause (JSON) | ✅ `telemetry.properties.errorCause` |

---

## Query Insights Backend Events

### 1. Stage 1 - Query Planner Analysis

**Event**: `documentDB.rpc.query.mongoClusters.collectionView.getQueryInsightsStage1`

**Description**: Initial query analysis using MongoDB's query planner (no query re-execution).

**⚠️ NO EXPLICIT TELEMETRY PROPERTIES OR MEASUREMENTS**

This stage only tracks:

- ✅ **Automatic RPC call duration** (via trpcToTelemetry middleware)
- ✅ **Errors** (via trpcToTelemetry middleware)
- ❌ **No custom properties or measurements**

**Functions Called** (none have telemetry):
| Function | Location | Has Telemetry |
|----------|----------|---------------|
| `ClusterSession.getClient().getClusterMetadata()` | ClustersClient | ❌ No |
| `ClusterSession.getLastExecutionTimeMs()` | ClusterSession | ❌ No |
| `ClusterSession.getCurrentFindQueryParamsWithObjects()` | ClusterSession | ❌ No |
| `ClusterSession.getQueryPlannerInfo()` | ClusterSession | ❌ No |
| `LlmEnhancedFeatureApis.explainFind()` | LlmEnhancedFeatureApis | ❌ No (only output channel logs) |
| `ExplainPlanAnalyzer.analyzeQueryPlanner()` | ExplainPlanAnalyzer | ❌ No |
| `transformStage1Response()` | transformations.ts | ❌ No |

**Data Logged to Output Channel Only** (NOT in telemetry):
| Data Point | Description | Location |
|------------|-------------|----------|
| Query planner duration | Time to execute explain(queryPlanner) | Output channel only |
| Used indexes | Array of index names used | Output channel only |
| Collection scan status | Boolean indicating COLLSCAN | Output channel only |
| Database/collection names | For tracing context | Output channel only |

**Data Returned in Response** (NOT in telemetry):
| Data Point | Description |
|------------|-------------|
| Execution time | Client-side query execution time from previous run |
| Used indexes | List of indexes used by query planner |
| Collection scan | Boolean indicating if query uses COLLSCAN |
| Covered query | Boolean indicating if query is covered by index |
| In-memory sort | Boolean indicating if sort requires memory |
| Namespace | Database.collection name |

**Error Conditions** (tracked via middleware):

- `QUERY_INSIGHTS_PLATFORM_NOT_SUPPORTED_RU`: Azure Cosmos DB for MongoDB (RU) clusters
- Generic errors from MongoDB explain command failures
- All errors tracked via `trpcToTelemetry` middleware with error properties

---

### 2. Stage 2 - Execution Statistics

**Event**: `documentDB.rpc.query.mongoClusters.collectionView.getQueryInsightsStage2`

**Description**: Detailed execution analysis using MongoDB's executionStats verbosity.

**⚠️ NO EXPLICIT TELEMETRY PROPERTIES OR MEASUREMENTS**

This stage only tracks:

- ✅ **Automatic RPC call duration** (via trpcToTelemetry middleware)
- ✅ **Errors** (via trpcToTelemetry middleware)
- ❌ **No custom properties or measurements**

**Functions Called** (none have telemetry):
| Function | Location | Has Telemetry |
|----------|----------|---------------|
| `ClusterSession.getSession()` | ClusterSession | ❌ No |
| `ClusterSession.getCurrentFindQueryParamsWithObjects()` | ClusterSession | ❌ No |
| `ClusterSession.getExecutionStats()` | ClusterSession | ❌ No |
| `LlmEnhancedFeatureApis.explainFind()` | LlmEnhancedFeatureApis | ❌ No (only output channel logs) |
| `ExplainPlanAnalyzer.analyzeExecutionStats()` | ExplainPlanAnalyzer | ❌ No |
| `StagePropertyExtractor.extractAllExtendedStageInfo()` | StagePropertyExtractor | ❌ No |
| `createFailedQueryResponse()` | transformations.ts | ❌ No |
| `transformStage2Response()` | transformations.ts | ❌ No |

**Data Logged to Output Channel Only** (NOT in telemetry):
| Data Point | Description | Location |
|------------|-------------|----------|
| explain() duration | Time to execute explain(executionStats) | Output channel only |
| Execution time | Query execution time in milliseconds | Output channel only |
| Documents returned | Count of documents returned (nReturned) | Output channel only |
| Documents examined | Count of documents examined | Output channel only |
| Efficiency ratio | Returned/examined ratio | Output channel only |
| Database/collection names | For tracing context | Output channel only |

**Data Returned in Response** (NOT in telemetry):
| Data Point | Description |
|------------|-------------|
| Execution time | Milliseconds to execute query |
| Documents returned | Count returned (`nReturned`) |
| Documents examined | Total docs scanned (`totalDocsExamined`) |
| Keys examined | Total index keys examined (`totalKeysExamined`) |
| Efficiency ratio | Returned/examined ratio |
| Performance rating | excellent/good/fair/poor with diagnostics |
| Extended stage info | Stage-by-stage execution details |
| Used indexes | List of indexes used in execution |
| Query characteristics | Collection scan, covered query, in-memory sort flags |

**Error Conditions** (tracked via middleware):

- Query execution failures (e.g., $where operator errors)
- Query syntax errors
- Query timeout errors
- All errors tracked via `trpcToTelemetry` middleware with error properties

---

### 3. Stage 3 - AI Recommendations

**Event**: `documentDB.rpc.query.mongoClusters.collectionView.getQueryInsightsStage3`

**Description**: AI-powered optimization recommendations using index advisor.

**Input Parameters**:
| Parameter | Description | Added to Telemetry |
|-----------|-------------|-------------------|
| `requestKey` | Unique identifier for cancellation tracking | ❌ Used for request management only |

**Data Collected**:
| Data Point | Description | Added to Telemetry |
|------------|-------------|-------------------|
| AI service duration | Time for AI service to respond | ❌ Logged to output channel only |
| Improvement cards count | Number of recommendations generated | ❌ Logged to output channel only |
| Request key | UUID for tracking request lifecycle | ❌ Logged to output channel only |
| AI recommendations | Structured improvement suggestions | ❌ Returned in response, not telemetry |
| Analysis content | AI-generated analysis text | ❌ Returned in response, not telemetry |
| Educational content | Explanation of query execution | ❌ Returned in response, not telemetry |

**Success Path**:

- Structured AI recommendations with actionable improvements
- No explicit telemetry properties added (success tracked by absence of error)

**Error Conditions**:

- AI service failures, JSON parsing errors, network timeouts
- All errors tracked via `trpcToTelemetry` middleware

---

### 4. Query Insights Action Execution

**Event**: `vscode-documentdb.queryInsights.action`

**Description**: User-initiated actions from AI recommendation cards (create/drop/modify index).

**Telemetry Properties**:
| Property | Values | Description | Added to Telemetry |
|----------|--------|-------------|-------------------|
| `actionId` | `createIndex`, `dropIndex`, `modifyIndex`, `learnMore` | The specific action being executed | ✅ `context.telemetry.properties.actionId` |
| `actionError` | See error types below | Error type if action failed | ✅ `context.telemetry.properties.actionError` |

**Error Types** (actionError values):

- `unknownAction`: Unrecognized action ID
- `invalidPayload`: Malformed action payload
- `noSessionId`: Missing session identifier
- `createIndexFailed`: Index creation returned error
- `createIndexException`: Exception during index creation
- `dropIndexFailed`: Index deletion returned error
- `dropIndexException`: Exception during index deletion
- `modifyIndexFailed`: Index modification returned error (hide/unhide)
- `modifyIndexException`: Exception during index modification
- `invalidMongoShellFormat`: Malformed MongoDB shell command

**Data Not Added to Telemetry**:
| Data Point | Description | Added to Telemetry |
|------------|-------------|-------------------|
| Database name | Target database | ❌ Used for operation only |
| Collection name | Target collection | ❌ Used for operation only |
| Index specification | Index definition | ❌ Used for operation only |
| Index name | Name of index being created/dropped | ❌ Used for operation only |
| Operation result | Success/failure message | ❌ Returned to UI only |

---

### 5. AI Optimization Request (Index Advisor)

**Event**: `vscode-documentdb.queryInsights.getOptimizationRecommendations`

**Description**: Tracks the complete AI recommendation generation workflow via index advisor. This is called by Stage 3 and performs the actual AI analysis including data collection, prompt generation, and Copilot interaction.

**Telemetry Properties**:
| Property | Description | Added to Telemetry |
|----------|-------------|-------------------|
| `commandType` | Query type (`find`, `aggregate`, `count`) | ✅ `context.telemetry.properties.commandType` |
| `isAzure` | Whether cluster is Azure-based | ✅ `context.telemetry.properties.isAzure` |
| `azureApi` | Azure API type (`RU`, `vCore`, or `unknown`) | ✅ `context.telemetry.properties.azureApi` |
| `hasPreloadedData` | Whether execution plan was pre-loaded | ✅ `context.telemetry.properties.hasPreloadedData` |
| `explainError` | Set to `'true'` if explain command fails | ✅ `context.telemetry.properties.explainError` |
| `hasCollectionStats` | Whether collection stats were retrieved | ✅ `context.telemetry.properties.hasCollectionStats` |
| `statsError` | Set to `'true'` if stats retrieval fails | ✅ `context.telemetry.properties.statsError` |
| `usedFallbackIndexes` | Whether fallback index info was used | ✅ `context.telemetry.properties.usedFallbackIndexes` |
| `modelUsed` | Copilot model ID that generated response | ✅ `context.telemetry.properties.modelUsed` |

**Telemetry Measurements**:
| Measurement | Description | Added to Telemetry |
|-------------|-------------|-------------------|
| `explainDurationMs` | Time to execute explain command (ms) | ✅ `context.telemetry.measurements.explainDurationMs` |
| `collectionStatsDurationMs` | Time to get collection stats (ms) | ✅ `context.telemetry.measurements.collectionStatsDurationMs` |
| `listIndexesDurationMs` | Time to list indexes (ms) | ✅ `context.telemetry.measurements.listIndexesDurationMs` |
| `indexStatsDurationMs` | Time to get index stats (ms) | ✅ `context.telemetry.measurements.indexStatsDurationMs` |
| `indexCount` | Number of indexes on collection | ✅ `context.telemetry.measurements.indexCount` |
| `copilotDurationMs` | Time for Copilot to generate response (ms) | ✅ `context.telemetry.measurements.copilotDurationMs` |
| `promptSize` | Size of prompt sent to Copilot (characters) | ✅ `context.telemetry.measurements.promptSize` |
| `responseSize` | Size of Copilot response (characters) | ✅ `context.telemetry.measurements.responseSize` |

**Data NOT Added to Telemetry**:
| Data Point | Description | Added to Telemetry |
|------------|-------------|-------------------|
| Query filter | MongoDB filter document | ❌ Sent to AI, not logged in telemetry |
| Query sort/projection | Sort and projection specs | ❌ Sent to AI, not logged in telemetry |
| Query limit/skip | Pagination parameters | ❌ Sent to AI, not logged in telemetry |
| Database name | Target database | ❌ Used for context only (logged to output channel) |
| Collection name | Target collection | ❌ Used for context only (logged to output channel) |
| Execution plan | Raw explain output | ❌ Sent to AI, not logged in telemetry |
| Collection stats | Document count, size, etc. | ❌ Sent to AI, not logged in telemetry |
| Index specifications | Index key definitions | ❌ Sent to AI, not logged in telemetry |
| Prompt content | Full prompt text sent to AI | ❌ Only size tracked in telemetry |
| AI response text | Full AI-generated recommendations | ❌ Only size tracked in telemetry |

**Success Path**:

- Gathers cluster metadata (Azure type, API version)
- Executes explain command (or uses pre-loaded data)
- Retrieves collection stats and index information
- Sanitizes explain result (removes constants, preserves structure)
- Fills prompt template with context data
- Sends to Copilot with preferred model and fallbacks
- Tracks all durations and data sizes

**Error Conditions**:

- Query parameter parsing failures
- Explain command failures (tracked with `explainError`)
- Collection/index stats retrieval failures (non-critical, tracked with `statsError`)
- AI service unavailability
- Model selection failures
- All tracked automatically by `callWithTelemetryAndErrorHandling`

**Note**: This event provides deep performance insights into the AI recommendation pipeline, allowing analysis of bottlenecks (explain duration vs stats retrieval vs Copilot response time).

---

### 6. Copilot Service - Send Message

**Event**: `vscode-documentdb.copilot.sendMessage`

**Description**: Low-level Copilot interaction (called by optimizeQuery). Handles model selection and response streaming.

**Telemetry Properties**:
| Property | Description | Added to Telemetry |
|----------|-------------|-------------------|
| `modelUsed` | Final Copilot model ID that generated response | ✅ `context.telemetry.properties.modelUsed` |
| `llmError` | Set to `'llmGenerateResponseCallFailed'` if Copilot call fails | ✅ `context.telemetry.properties.llmError` |

**Data NOT Added to Telemetry**:
| Data Point | Description | Added to Telemetry |
|------------|-------------|-------------------|
| Message content | Chat messages sent to Copilot | ❌ Not logged in telemetry |
| Response text | Full Copilot response | ❌ Not logged in telemetry |
| Preferred model | Requested model name | ❌ Only final `modelUsed` tracked |
| Fallback models | List of fallback model names | ❌ Only final `modelUsed` tracked |
| Available models | Models available in VS Code | ❌ Not logged in telemetry |

**Note**: This event tracks which Copilot model was actually used (vs requested), helping understand model availability and fallback behavior.

---

### 7. View Raw Explain Output

**Event**: `documentDB.rpc.mutation.mongoClusters.collectionView.viewRawExplainOutput`

**Description**: User views the raw MongoDB explain plan JSON in a new VS Code document.

**Data Collected**:
| Data Point | Description | Added to Telemetry |
|------------|-------------|-------------------|
| Success/failure status | Whether document was opened | ✅ Automatic via `trpcToTelemetry` |
| Explain output content | Raw explain JSON | ❌ Used for display only |

---

## Frontend User Interaction Events

### 8. Feedback - Thumbs Up/Down (Immediate)

**Event**: `queryInsightsThumb`

**Description**: Captures immediate sentiment when user clicks thumb icons (before feedback dialog).

**Telemetry Properties**:
| Property | Values | Description | Added to Telemetry |
|----------|--------|-------------|-------------------|
| `sentiment` | `positive`, `negative` | User's immediate reaction | ✅ `properties.sentiment` |
| `source` | `feedbackThumb` | Always this value | ✅ `properties.source` |

**Timing**: Fired immediately on click via fire-and-forget pattern.

---

### 9. Feedback - Detailed Dialog (With Reasons)

**Event**: `queryInsightsFeedback`

**Description**: Captures detailed feedback with specific reasons when user submits feedback dialog.

**Telemetry Properties**:
| Property | Values | Description | Added to Telemetry |
|----------|--------|-------------|-------------------|
| `sentiment` | `positive`, `negative` | User's overall sentiment | ✅ `properties.sentiment` |
| `source` | `feedbackDialog` | Always this value | ✅ `properties.source` |
| `{reasonKey}` | `'true'` | Dynamic property for each selected reason | ✅ `properties.{reasonKey}` |

**Example Event**:

```javascript
{
  eventName: 'queryInsightsFeedback',
  properties: {
    sentiment: 'negative',
    source: 'feedbackDialog',
    inaccurate: 'true',        // ✅ Dynamic property
    notRelevant: 'true',       // ✅ Dynamic property
    tooSlow: 'true'            // ✅ Dynamic property
  }
}
```

**Note**: Each selected reason becomes a separate property with value `'true'`.

---

### 10. Performance Tips - Navigation

**Event**: `queryInsights.tipNavigated`

**Description**: Tracks user navigation through performance tips carousel.

**Telemetry Properties**:
| Property | Values | Description | Added to Telemetry |
|----------|--------|-------------|-------------------|
| `direction` | `next`, `previous` | Navigation direction | ✅ `properties.direction` |
| `fromIndex` | `'0'`, `'1'`, `'2'`, etc. | Starting tip index (string) | ✅ `properties.fromIndex` |
| `toIndex` | `'0'`, `'1'`, `'2'`, etc. | Destination tip index (string) | ✅ `properties.toIndex` |

---

### 11. Performance Tips - Dismissal

**Event**: `queryInsights.tipsDismissed`

**Description**: User dismisses the performance tips card.

**Telemetry Properties**:
| Property | Description | Added to Telemetry |
|----------|-------------|-------------------|
| None | Event itself indicates dismissal | ✅ Event tracked |

---

### 12. Query Plan Stage Details - Toggle

**Event**: `queryInsights.stageDetailsToggled`

**Description**: User expands or collapses query execution stage details in the query plan view.

**Telemetry Properties**:
| Property | Values | Description | Added to Telemetry |
|----------|--------|-------------|-------------------|
| `action` | `expanded`, `collapsed` | Whether user opened or closed details | ✅ `properties.action` |
| `isSharded` | `'true'`, `'false'` | Collection sharding status (string) | ✅ `properties.isSharded` |

---

### 13. Tab Switching

**Event**: `tabChanged`

**Description**: User switches between Results and Query Insights tabs.

**Telemetry Properties**:
| Property | Values | Description | Added to Telemetry |
|----------|--------|-------------|-------------------|
| `previousTab` | `tab_result`, `tab_queryInsights` | Tab user switched from | ✅ `properties.previousTab` |
| `newTab` | `tab_result`, `tab_queryInsights` | Tab user switched to | ✅ `properties.newTab` |

---

### 14. Query Execution

**Event**: `executeQuery`

**Description**: User executes a query from the Collection View.

**Telemetry Properties**:
| Property | Values | Description | Added to Telemetry |
|----------|--------|-------------|-------------------|
| `ui` | `shortcut` | How query was executed | ✅ `properties.ui` |

**Telemetry Measurements**:
| Measurement | Type | Description | Added to Telemetry |
|-------------|------|-------------|-------------------|
| `queryLenth` | number | Length of filter query string (characters) | ✅ `measurements.queryLenth` |

**Note**: Typo "queryLenth" exists in original code (should be "queryLength").

---

## Related Collection View Events

These events are tracked in the Collection View but impact Query Insights behavior:

### View Changed

**Event**: `viewChanged`

**Telemetry Properties**:
| Property | Values | Description | Added to Telemetry |
|----------|--------|-------------|-------------------|
| `view` | `TABLE`, `TREE`, `JSON` | Selected view mode | ✅ `properties.view` |

### Step In Navigation

**Event**: `stepIn`

**Telemetry Properties**:
| Property | Values | Description | Added to Telemetry |
|----------|--------|-------------|-------------------|
| `source` | `step-in-button` | Navigation source | ✅ `properties.source` |

**Telemetry Measurements**:
| Measurement | Type | Description | Added to Telemetry |
|-------------|------|-------------|-------------------|
| `depth` | number | Current navigation depth | ✅ `measurements.depth` |

---

## Error Tracking

### Platform Compatibility Errors

**Error Code**: `QUERY_INSIGHTS_PLATFORM_NOT_SUPPORTED_RU`

**When**: User tries Query Insights on Azure Cosmos DB for MongoDB (RU) cluster

**Telemetry Tracking**:
| Data Point | Description | Added to Telemetry |
|------------|-------------|-------------------|
| Error code | Added to Error.code property | ✅ Via `trpcToTelemetry` middleware |
| Error message | Localized user message | ✅ `telemetry.properties.errorMessage` |

**UI Behavior**: Shows friendly card instead of error dialog (no error toast for this specific error)

---

### Query Execution Errors

**Stage 2 Errors**:

- Query syntax errors
- Query execution failures
- Timeout errors

**Telemetry Tracking**:
| Data Point | Description | Added to Telemetry |
|------------|-------------|-------------------|
| Execution error | From MongoDB response | ✅ Via `trpcToTelemetry` middleware |
| Error concerns | Array of error messages | ❌ Returned in response for UI display |

**UI Behavior**: Shows error card with concerns array for user

---

### AI Service Errors

**Stage 3 Errors**:

- AI service unavailability
- Response parsing errors
- Network failures

**Telemetry Tracking**:
| Data Point | Description | Added to Telemetry |
|------------|-------------|-------------------|
| Service error | Exception details | ✅ Via `trpcToTelemetry` middleware |
| Error stack | Full stack trace | ✅ `telemetry.properties.errorStack` |

---

## Data Flow Summary with Telemetry Events

```
User Executes Query
    ↓
[✅] Event #14: executeQuery (UI interaction)
    ↓
Stage 1 Prefetch (background, non-blocking)
    ↓
[✅] Event #1: documentDB.rpc.query.mongoClusters.collectionView.getQueryInsightsStage1
    │            ├─ RPC call duration tracked automatically
    │            ├─ Execution time returned (not in telemetry)
    │            └─ Index usage logged to output channel
    ↓
User Switches to Query Insights Tab
    ↓
[✅] Event #13: tabChanged (previousTab=tab_result, newTab=tab_queryInsights)
    ↓
Stage 1 Display (if prefetch succeeded)
    ↓
Stage 2 Auto-Start (automatically triggered)
    ↓
[✅] Event #2: documentDB.rpc.query.mongoClusters.collectionView.getQueryInsightsStage2
    │            ├─ RPC call duration tracked automatically
    │            ├─ Performance metrics returned (not in telemetry)
    │            └─ explain() duration logged to output channel
    ↓
[User clicks stage details toggle]
    ↓
[✅] Event #12: queryInsights.stageDetailsToggled (action=expanded/collapsed)
    ↓
[User clicks Get AI Suggestions button]
    ↓
[✅] Event #3: documentDB.rpc.query.mongoClusters.collectionView.getQueryInsightsStage3
    │            └─ RPC call duration tracked automatically
    │            └─ Calls Event #5 internally ↓
    │
    ├──→ [✅] Event #5: vscode-documentdb.queryInsights.getOptimizationRecommendations
    │         ├─ Properties: commandType, isAzure, azureApi, hasPreloadedData
    │         ├─ Measurements: explainDurationMs, collectionStatsDurationMs,
    │         │                 listIndexesDurationMs, indexStatsDurationMs, indexCount
    │         └─ Calls Event #6 internally ↓
    │
    └──→ [✅] Event #6: vscode-documentdb.copilot.sendMessage
              ├─ Properties: modelUsed, llmError (if failed)
              ├─ Additional measurements from Event #5: copilotDurationMs,
              │                                           promptSize, responseSize
              └─ Returns to Event #3
    ↓
[Tips card shown, user navigates carousel]
    ↓
[✅] Event #10: queryInsights.tipNavigated (direction, fromIndex, toIndex)
[✅] Event #11: queryInsights.tipsDismissed (if user closes tips)
    ↓
[User clicks action button: Create Index]
    ↓
[✅] Event #4: vscode-documentdb.queryInsights.action
    │           ├─ Properties: actionId=createIndex
    │           └─ actionError (if failed)
    ↓
[User provides feedback]
    ↓
[✅] Event #8: queryInsightsThumb (sentiment=positive/negative, source=feedbackThumb)
    │           └─ Fired immediately on thumb click
    ↓
[Feedback dialog opens, user submits]
    ↓
[✅] Event #9: queryInsightsFeedback
              ├─ Properties: sentiment, source=feedbackDialog
              └─ Dynamic properties for each selected reason
```

**Key Insights from Data Flow**:

- **Automatic RPC duration tracking**: Events #1, #2, #3 include end-to-end timing
- **Nested telemetry**: Event #3 → Event #5 → Event #6 (Stage 3 calls Index Advisor calls Copilot)
- **Performance breakdown**: Event #5 provides detailed sub-operation timings (explain, stats, indexes, Copilot)
- **Non-blocking prefetch**: Stage 1 starts in background before user switches tabs

---

## Privacy and Data Protection

### Personal Data

- **✅ No PII collected**: No user names, email addresses, or personal identifiers
- **❌ Database/collection names**: Used for operations only, **not sent to telemetry**
- **❌ Query content**: Sent to AI service for analysis, **not logged in telemetry**
- **❌ Connection strings**: Never logged anywhere
- **❌ Credentials**: Never included in telemetry

### Sensitive Data

| Data Type             | Sent to AI Service | Logged to Telemetry     | Logged to Output Channel |
| --------------------- | ------------------ | ----------------------- | ------------------------ |
| Query filter          | ✅ Yes             | ❌ No                   | ❌ No                    |
| Query sort/projection | ✅ Yes             | ❌ No                   | ❌ No                    |
| Index specifications  | ✅ Yes             | ❌ No                   | ❌ No                    |
| Database names        | ✅ Yes             | ❌ No                   | ✅ Yes                   |
| Collection names      | ✅ Yes             | ❌ No                   | ✅ Yes                   |
| Execution metrics     | ❌ No              | ❌ No                   | ✅ Yes                   |
| User feedback         | ❌ No              | ✅ Yes (sentiment only) | ❌ No                    |

### Opt-Out

- All telemetry respects VS Code's global telemetry settings
- Users can disable via: Settings → Telemetry: Telemetry Level → off
- `callWithTelemetryAndErrorHandling` respects telemetry preferences
- Frontend events use fire-and-forget pattern (no user blocking)

---

## Metrics for Analysis

### Engagement Metrics (Available from Telemetry)

| Metric                       | Source Events                                   | Calculation                                 |
| ---------------------------- | ----------------------------------------------- | ------------------------------------------- |
| Query Insights adoption rate | `tabChanged` events                             | % of users who switch to Query Insights tab |
| AI suggestion usage          | `getQueryInsightsStage3` events                 | Count of Stage 3 requests                   |
| Action completion rate       | `queryInsights.action` events                   | Success vs failure rate by actionId         |
| Feedback completion          | `queryInsightsThumb` vs `queryInsightsFeedback` | Dialog submission rate                      |
| Tips interaction rate        | `tipNavigated` vs `tipsDismissed`               | Engagement vs dismissal ratio               |

### Performance Metrics (Available from Output Channel)

| Metric                | Source                       | Location         |
| --------------------- | ---------------------------- | ---------------- |
| Stage 1 duration      | Output channel logs          | Not in telemetry |
| Stage 2 duration      | Output channel logs          | Not in telemetry |
| Stage 3 (AI) duration | Output channel logs          | Not in telemetry |
| Error rates by stage  | `trpcToTelemetry` middleware | Telemetry        |

### Quality Metrics (Available from Telemetry)

| Metric                    | Source Events            | Properties                 |
| ------------------------- | ------------------------ | -------------------------- |
| Feedback sentiment        | `queryInsightsFeedback`  | `sentiment` property       |
| Specific feedback reasons | `queryInsightsFeedback`  | Dynamic reason properties  |
| Action success rates      | `queryInsights.action`   | `actionError` presence     |
| Platform errors           | `getQueryInsightsStage1` | Error codes via middleware |

### Feature Discovery (Available from Telemetry)

| Metric                   | Source Events                   | Analysis               |
| ------------------------ | ------------------------------- | ---------------------- |
| First-time usage         | `tabChanged` (first occurrence) | User onboarding funnel |
| Repeat usage             | `tabChanged` (subsequent)       | Retention metric       |
| Stage details usage      | `stageDetailsToggled`           | Feature engagement     |
| Tips carousel navigation | `tipNavigated`                  | Content effectiveness  |

---

## Summary: What Goes Into Telemetry

### ✅ Data Explicitly Added to Telemetry

**Properties (`context.telemetry.properties.*` or `properties.*`)**:

**User Interactions**:

- `actionId` (from queryInsights.action)
- `actionError` (from queryInsights.action)
- `sentiment` (from feedback events)
- `source` (from feedback events)
- Dynamic feedback reason keys (from queryInsightsFeedback)
- `direction`, `fromIndex`, `toIndex` (from tipNavigated)
- `action`, `isSharded` (from stageDetailsToggled)
- `previousTab`, `newTab` (from tabChanged)
- `ui` (from executeQuery)
- `view` (from viewChanged)

**AI Service (from getOptimizationRecommendations)**:

- `commandType` - Query type (find/aggregate/count)
- `isAzure` - Whether cluster is Azure-based
- `azureApi` - Azure API type (RU/vCore/unknown)
- `hasPreloadedData` - Whether execution plan was pre-loaded
- `explainError` - Set to 'true' if explain command fails
- `hasCollectionStats` - Whether collection stats were retrieved
- `statsError` - Set to 'true' if stats retrieval fails
- `usedFallbackIndexes` - Whether fallback index info was used
- `modelUsed` - Copilot model ID that generated response (from both optimizeQuery and copilot.sendMessage)

**Copilot Service (from copilot.sendMessage)**:

- `llmError` - Set to 'llmGenerateResponseCallFailed' if Copilot call fails

**Error Information (from trpcToTelemetry middleware)**:

- `result`, `error`, `errorMessage`, `errorStack`, `errorCause`

**Measurements (`context.telemetry.measurements.*` or `measurements.*`)**:

**User Interactions**:

- `queryLenth` [sic] - Length of filter query string (from executeQuery)
- `depth` - Navigation depth (from stepIn)

**AI Service Performance (from getOptimizationRecommendations)**:

- `explainDurationMs` - Time to execute explain command
- `collectionStatsDurationMs` - Time to get collection stats
- `listIndexesDurationMs` - Time to list indexes
- `indexStatsDurationMs` - Time to get index stats
- `indexCount` - Number of indexes on collection
- `copilotDurationMs` - Time for Copilot to generate response
- `promptSize` - Size of prompt sent to Copilot (characters)
- `responseSize` - Size of Copilot response (characters)

**Automatic Measurements** (from Azure telemetry framework):

- **RPC call duration** for all tRPC procedures (Events #1, #2, #3, #4, #7)

### ⚠️ Important: Stage 1 and Stage 2 Have NO Custom Telemetry

**Events #1 (Stage 1) and #2 (Stage 2) do NOT add any custom telemetry properties or measurements.**

They only track:

- ✅ **Automatic RPC call duration** (total time for the entire stage)
- ✅ **Errors** (if the stage fails)

All performance metrics (execution time, docs examined, etc.) are:

- ❌ **NOT sent to telemetry**
- ✅ **Only logged to output channel** (for debugging)
- ✅ **Returned in API response** (displayed in UI)

**Why?** Privacy and data minimization - query performance metrics are considered operational data that should remain local, not aggregated in telemetry.

### ❌ Data NOT Added to Telemetry

**Operational Data (used but not logged)**:

- Database names
- Collection names
- Query content (filter, sort, projection)
- Index specifications
- Index names
- Execution metrics (time, docs examined, docs returned)
- AI recommendation content
- MongoDB explain output

**Performance Data (logged to output channel only)**:

- Stage 1/2/3 execution durations
- explain() command durations
- Query planner/execution stats details

**Response Data (returned to UI only)**:

- Query insights analysis results
- AI-generated recommendations
- Improvement card configurations
- Educational content
- Success/failure messages for actions

---

## Performance Analysis Opportunities

The telemetry data provides rich insights into Query Insights performance and bottlenecks:

### Stage 3 AI Performance Breakdown

**Available Measurements** (from Event #5: `getOptimizationRecommendations`):

| Measurement                 | Typical Range    | Bottleneck Indicator                 |
| --------------------------- | ---------------- | ------------------------------------ |
| `explainDurationMs`         | 10-100ms         | >1000ms: Slow MongoDB explain        |
| `collectionStatsDurationMs` | 5-50ms           | >500ms: Large collection             |
| `listIndexesDurationMs`     | 5-30ms           | >500ms: Many indexes                 |
| `indexStatsDurationMs`      | 10-100ms         | >1000ms: Stat collection overhead    |
| `copilotDurationMs`         | 3000-15000ms     | >20000ms: Model latency issue        |
| `promptSize`                | 2000-10000 chars | >50000: Consider prompt optimization |
| `responseSize`              | 500-5000 chars   | >20000: Very verbose response        |

**Analysis Opportunities**:

1. **Identify bottlenecks**: Compare `copilotDurationMs` vs sum of data collection measurements
2. **Model performance**: Track `copilotDurationMs` by `modelUsed` to compare model response times
3. **Prompt optimization**: Correlate `promptSize` with `copilotDurationMs` to optimize prompt length
4. **Data collection overhead**: Sum of explain/stats/indexes durations vs total Stage 3 duration
5. **Fallback patterns**: Track `usedFallbackIndexes='true'` to understand when stats retrieval fails

### End-to-End Duration Analysis

**RPC Call Durations** (automatically tracked):

- **Stage 1** (`getQueryInsightsStage1`): Typically 50-500ms
- **Stage 2** (`getQueryInsightsStage2`): Typically 100-2000ms (includes query re-execution)
- **Stage 3** (`getQueryInsightsStage3`): Typically 3000-20000ms (dominated by Copilot)

**Breakdown for Stage 3**:

```
Total Stage 3 RPC Duration =
  getOptimizationRecommendations overhead +
  explainDurationMs +
  collectionStatsDurationMs +
  listIndexesDurationMs +
  indexStatsDurationMs +
  copilotDurationMs +
  JSON parsing/transformation overhead
```

### Platform-Specific Performance

**Properties for Segmentation**:

- `isAzure='true'` vs `'false'`: Compare Azure vs native MongoDB performance
- `azureApi='RU'` vs `'vCore'`: Compare Azure Cosmos DB platforms
- `hasPreloadedData='true'`: Compare prefetched vs on-demand explain execution

**Example Analysis**:

```
Average copilotDurationMs WHERE isAzure='true' AND azureApi='vCore'
vs
Average copilotDurationMs WHERE isAzure='false'
```

### Error Rate Analysis

**Error Properties**:

- `explainError='true'`: Explain command failure rate (Stage 3)
- `statsError='true'`: Stats retrieval failure rate (Stage 3, non-critical)
- `actionError` values: Index operation failure types and rates
- `llmError='llmGenerateResponseCallFailed'`: Copilot service failures

**Reliability Metrics**:

1. **Stage 1 success rate**: 100% - (errors via trpcToTelemetry) / total attempts
2. **Stage 2 success rate**: Same calculation
3. **Stage 3 success rate**: Consider both service errors and `explainError='true'`
4. **AI recommendations quality**: Track `explainError` and `statsError` impact on feedback sentiment

### User Experience Metrics

**Engagement Correlation**:

- Compare `copilotDurationMs` with feedback `sentiment` (do slower responses get worse feedback?)
- Track `tipsDismissed` rate vs `tipNavigated` count (are users finding tips useful?)
- Analyze `actionId` distribution (which recommendations do users actually execute?)

---

## Technical Implementation Notes

### Event Naming Conventions

- Frontend events: camelCase (e.g., `queryInsightsThumb`)
- Backend tRPC events: `documentDB.rpc.{type}.{path}`
- Feature-prefixed events: `queryInsights.{action}`
- Service events: `vscode-documentdb.queryInsights.{action}`

### Telemetry Middleware

```typescript
// Backend: trpcToTelemetry
context.telemetry.properties.result = 'Failed';
context.telemetry.properties.error = result.error.name;
context.telemetry.properties.errorMessage = result.error.message;

// Action handler: manual properties
context.telemetry.properties.actionId = actionId;
context.telemetry.properties.actionError = 'createIndexFailed';

// Frontend: reportEvent
trpcClient.common.reportEvent.mutate({
  eventName: 'queryInsightsThumb',
  properties: { sentiment, source },
  measurements: { queryLenth: query.filter.length },
});
```

### Error Handling Pattern

1. All backend errors caught by `trpcToTelemetry` middleware
2. Custom error codes use `(error as Error & { code?: string }).code`
3. Error display suppressed in middleware (`suppressDisplay: true`)
4. Errors propagated to frontend for UI-specific handling

### Performance

- Fire-and-forget pattern for frontend events (`.mutate()` without await)
- Failed telemetry logged to console.debug (non-blocking)
- Stage prefetching uses promise tracking to avoid duplicates
- Minimum 1.5s duration for Stage 2 to prevent jarring UI transitions
