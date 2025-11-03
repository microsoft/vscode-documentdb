# Index Advisor Data Flow - Privacy Review Documentation

## Overview

This document describes the data flow for the MongoDB Index Advisor feature, with emphasis on customer data handling and privacy considerations. The Index Advisor feature uses GitHub Copilot's language models to analyze query execution plans and provide index optimization recommendations.

## Current Implementation (v1.0)

The Index Advisor supports two operational modes:

1. **Standard Mode**: Fetches data from the database in real-time
2. **Preload Mode**: Uses pre-provided execution plan and statistics

### Data Flow Diagram - Standard Mode

```
┌─────────────────┐
│  User Input     │
│  (Find Query)   │
└────────┬────────┘
         │
         v
┌─────────────────────────────────────────────────────────┐
│  Query Optimization Context                             │
│  - Database name                                        │
│  - Collection name                                      │
│  - Query object (filter, sort, projection, etc.)        │
│  - Command type (Find/Aggregate/Count)                  │
│  - Cluster ID (for database connection)                 │
└────────┬────────────────────────────────────────────────┘
         │
         v
┌─────────────────────────────────────────────────────────┐
│  Data Collection Process                                │
│  1. Execute query with explain() to get execution plan  │
│  2. Fetch collection statistics (collStats)             │
│  3. Fetch index statistics ($indexStats)                │
│  4. Get cluster metadata (Azure/non-Azure info)         │
└────────┬────────────────────────────────────────────────┘
         │
         v
┌─────────────────────────────────────────────────────────┐
│  Data Sanitization Process                              │
│  1. Remove constant values from query filters           │
│  2. Replace literal values with <value> placeholder     │
│  3. Preserve field names and operators                  │
│  4. Sanitize all stages in execution plan               │
│  5. Process command field, parsedQuery, and stages      │
└────────┬────────────────────────────────────────────────┘
         │
         v
┌─────────────────────────────────────────────────────────┐
│  Data Sent to LLM (GitHub Copilot)                      │
│  + Database name (metadata)                             │
│  + Collection name (metadata)                           │
│  + Collection statistics (counts, sizes)                │
│  + Index statistics (names, keys, usage stats)          │
│  + Sanitized execution plan (structure only)            │
│  + Cluster metadata (Azure type, API version)           │
│  - NO actual customer data values from queries          │
│  - NO literal filter values                             │
└────────┬────────────────────────────────────────────────┘
         │
         v
┌─────────────────────────────────────────────────────────┐
│  GitHub Copilot LLM Processing                          │
│  - Analyzes execution plan structure                    │
│  - Reviews collection and index statistics              │
│  - Generates index recommendations                      │
└────────┬────────────────────────────────────────────────┘
         │
         v
┌─────────────────────────────────────────────────────────┐
│  Response                                               │
│  - Index recommendations                                │
│  - Performance optimization suggestions                 │
│  - Explanation of recommendations                       │
└────────┬────────────────────────────────────────────────┘
         │
         v
┌─────────────────┐
│  Display to     │
│  User           │
└─────────────────┘
```

### Data Flow Diagram - Preload Mode

```
┌─────────────────────────────────────┐
│  User Input (Preload Mode)          │
│  - Pre-collected execution plan     │
│  - Pre-collected collection stats   │
│  - Pre-collected index stats        │
└────────┬────────────────────────────┘
         │
         v
┌─────────────────────────────────────────────────────────┐
│  Query Optimization Context (Preload)                   │
│  - Database name                                        │
│  - Collection name                                      │
│  - Command type (Find/Aggregate/Count)                  │
│  - executionPlan (pre-provided)                         │
│  - collectionStats (pre-provided)                       │
│  - indexStats (pre-provided)                            │
│  - NO cluster ID (database connection not needed)       │
└────────┬────────────────────────────────────────────────┘
         │
         v
┌─────────────────────────────────────────────────────────┐
│  Data Sanitization Process                              │
│  1. Remove constant values from query filters           │
│  2. Replace literal values with <value> placeholder     │
│  3. Preserve field names and operators                  │
│  4. Sanitize all stages in execution plan               │
│  5. Process command field, parsedQuery, and stages      │
│  Note: Pre-loaded execution plan may already contain    │
│        customer query values that need sanitization     │
└────────┬────────────────────────────────────────────────┘
         │
         v
┌─────────────────────────────────────────────────────────┐
│  Data Sent to LLM (GitHub Copilot)                      │
│  + Database name (metadata)                             │
│  + Collection name (metadata)                           │
│  + Collection statistics (from pre-loaded data)         │
│  + Index statistics (from pre-loaded data)              │
│  + Sanitized execution plan (structure only)            │
│  + Minimal cluster metadata (isAzure: false)            │
│  - NO actual customer data values from queries          │
│  - NO literal filter values                             │
└────────┬────────────────────────────────────────────────┘
         │
         v
┌─────────────────────────────────────────────────────────┐
│  GitHub Copilot LLM Processing                          │
│  - Analyzes execution plan structure                    │
│  - Reviews collection and index statistics              │
│  - Generates index recommendations                      │
└────────┬────────────────────────────────────────────────┘
         │
         v
┌─────────────────────────────────────────────────────────┐
│  Response                                               │
│  - Index recommendations                                │
│  - Performance optimization suggestions                 │
│  - Explanation of recommendations                       │
└────────┬────────────────────────────────────────────────┘
         │
         v
┌─────────────────┐
│  Display to     │
│  User           │
└─────────────────┘
```

### Operational Modes Comparison

| Aspect | Standard Mode | Preload Mode |
|--------|---------------|--------------|
| **Database Connection** | Required (uses cluster ID) | Not required |
| **Data Collection** | Real-time from database | Pre-provided by caller |
| **Use Case** | Interactive optimization in VS Code | Batch processing, external tools, testing |
| **Execution Plan** | Fetched via explain() | Provided in context |
| **Collection Stats** | Fetched via collStats | Provided in context |
| **Index Stats** | Fetched via $indexStats | Provided in context |
| **Cluster Metadata** | Fetched from connection | Minimal default (non-Azure) |
| **Sanitization** | Applied to fetched data | Applied to pre-loaded data |
| **Privacy Impact** | Same (all data sanitized) | Same (all data sanitized) |

### Customer Data Categories

#### Standard Mode: Data Collected from Database

1. **Query Execution Plan**:
   - Fetched: Complete explain() output from MongoDB
   - Contains: Query filters with actual literal values
   - Purpose: Performance analysis
   - Lifecycle: Sanitized before sending to LLM

2. **Collection Statistics**:
   - Document count, storage size, index sizes
   - Average document size
   - Number of indexes

3. **Index Statistics**:
   - Index names and key patterns
   - Index usage statistics (ops, since)
   - Index sizes

4. **Cluster Metadata**:
   - Whether cluster is hosted on Azure
   - Azure Cosmos DB API type (if applicable)

#### Preload Mode: Data Provided by Caller

1. **Pre-loaded Execution Plan**:
   - Source: Provided by external caller
   - Contains: May include query filters with actual literal values
   - **Privacy Risk**: Caller must ensure they want to share this data
   - Lifecycle: Sanitized before sending to LLM (same as standard mode)

2. **Pre-loaded Collection Statistics**:
   - Provided as-is by caller
   - Expected format: Same as MongoDB collStats output

3. **Pre-loaded Index Statistics**:
   - Provided as-is by caller
   - Expected format: Same as MongoDB $indexStats output

4. **Cluster Metadata**:
   - Not provided in preload mode
   - Default: `{ isAzure: false, api: 'N/A' }`

**The extension still applies full sanitization** to preloaded data.

#### Data Sent to LLM (After Sanitization)

1. **Metadata**:
   - Database name (e.g., "customerDB")
   - Collection name (e.g., "users")
   - Command type ("find", "aggregate", or "count")

2. **Collection Statistics**:
   - Numeric metrics only (counts, sizes)
   - No customer data values
   ```json
   {
     "count": 150000,
     "size": 45000000,
     "avgObjSize": 300,
     "storageSize": 50000000,
     "totalIndexSize": 5000000,
     "nindexes": 3
   }
   ```

3. **Index Statistics**:
   - Index definitions (field names and sort order)
   - Usage statistics (operation counts)
   - **NO indexed values**
   ```json
   [
     {
       "name": "email_1",
       "key": { "email": 1 },
       "accesses": {
         "ops": 12500,
         "since": "2024-01-15T10:30:00.000Z"
       }
     }
   ]
   ```

4. **Sanitized Execution Plan**:
   - Query structure with field names
   - Operators and stage types
   - Performance metrics (nReturned, executionTimeMillis, etc.)
   - **All literal values replaced with `<value>` placeholder**

5. **Cluster Metadata**:
   - `isAzureCluster`: boolean indicator
   - `AzureClusterType`: API type if Azure (e.g., "MongoDB RU", "MongoDB vCore")

### Sanitization Process Details

The sanitization process is implemented in `src/commands/llmEnhancedCommands/indexAdvisorCommands.ts` and includes the following operations:

#### 1. Filter Value Sanitization

Original filter values are replaced with the generic placeholder `<value>`:

**Before Sanitization (Never Sent):**
```json
{
  "filter": {
    "email": "john.doe@example.com",
    "age": { "$gt": 25 },
    "status": "active"
  }
}
```

**After Sanitization (Sent to LLM):**
```json
{
  "filter": {
    "email": "<value>",
    "age": { "$gt": "<value>" },
    "status": "<value>"
  }
}
```

#### 2. Execution Plan Stage Sanitization

All stages in the execution plan are recursively sanitized:

- **`command` field**: Redacted or filter values replaced
- **`parsedQuery` field**: Filter values replaced
- **`filter` field in stages**: Values replaced
- **`indexFilterSet` array**: Each filter object sanitized
- **`runtimeFilterSet` array**: Each filter object sanitized
- **Nested stages**: Recursively processed
  - `inputStage`
  - `inputStages` array
  - `shards` array with `executionStages`

#### 3. What Gets Sanitized

| Component | Original Data | After Sanitization |
|-----------|---------------|-------------------|
| Filter literal values | `"john@example.com"` | `"<value>"` |
| Numeric comparisons | `{ "$gt": 25 }` | `{ "$gt": "<value>" }` |
| Array values | `["active", "pending"]` | `["<value>", "<value>"]` |
| Nested object values | `{ "city": "Seattle" }` | `{ "city": "<value>" }` |
| Field names | `"email"` | `"email"` (Preserved) |
| Operators | `"$gt"`, `"$in"` | `"$gt"`, `"$in"` (Preserved) |
| Stage types | `"IXSCAN"`, `"FETCH"` | `"IXSCAN"`, `"FETCH"` (Preserved) |
| Performance metrics | `nReturned: 100` | `nReturned: 100` (Preserved) |

#### 4. Code Reference

Key sanitization functions in `indexAdvisorCommands.ts`:

```typescript
// Main sanitization entry point
export function sanitizeExplainResult(explainResult: unknown): unknown

// Removes constants from filter objects
function removeConstantsFromFilter(obj: unknown): unknown

// Recursively sanitizes execution plan stages
function sanitizeStage(stage: unknown): unknown
```

**Preload Mode Code Pattern:**

```typescript
// Check if we have pre-loaded data
const hasPreloadedData = queryContext.executionPlan;

if (hasPreloadedData) {
    // Use pre-loaded data (no database connection needed)
    explainResult = queryContext.executionPlan;
    collectionStats = queryContext.collectionStats!;
    indexes = queryContext.indexStats!;

    // For pre-loaded data, create a minimal cluster info
    clusterInfo = {
        domainInfo_isAzure: 'false',
        domainInfo_api: 'N/A',
    };
} else {
    // Standard mode: fetch from database
    const client = await ClustersClient.getClient(queryContext.clusterId);
    // ... fetch execution plan, stats, etc.
}

// Regardless of mode, sanitize before sending to LLM
const sanitizedExplainResult = sanitizeExplainResult(explainResult);
```

### Complete Example: Find Query

#### User's Query (Input):
```javascript
db.users.find({
  "email": "john.doe@example.com",
  "age": { "$gt": 25 }
}).sort({ "name": -1 }).limit(10)
```

#### Query Object (Parsed Locally):
```json
{
  "filter": {
    "email": "john.doe@example.com",
    "age": { "$gt": 25 }
  },
  "sort": { "name": -1 },
  "limit": 10
}
```

#### Execution Plan (Before Sanitization - Never Sent):
```json
{
  "queryPlanner": {
    "parsedQuery": {
      "email": "john.doe@example.com",
      "age": { "$gt": 25 }
    },
    "winningPlan": {
      "stage": "LIMIT",
      "limitAmount": 10,
      "inputStage": {
        "stage": "FETCH",
        "filter": {
          "age": { "$gt": 25 }
        },
        "inputStage": {
          "stage": "IXSCAN",
          "keyPattern": { "email": 1 },
          "indexFilterSet": [
            { "email": "john.doe@example.com" }
          ]
        }
      }
    }
  },
  "executionStats": {
    "nReturned": 1,
    "executionTimeMillis": 15,
    "totalKeysExamined": 1,
    "totalDocsExamined": 1
  }
}
```

#### Execution Plan (After Sanitization - Sent to LLM):
```json
{
  "queryPlanner": {
    "parsedQuery": {
      "email": "<value>",
      "age": { "$gt": "<value>" }
    },
    "winningPlan": {
      "stage": "LIMIT",
      "limitAmount": 10,
      "inputStage": {
        "stage": "FETCH",
        "filter": {
          "age": { "$gt": "<value>" }
        },
        "inputStage": {
          "stage": "IXSCAN",
          "keyPattern": { "email": 1 },
          "indexFilterSet": [
            { "email": "<value>" }
          ]
        }
      }
    }
  },
  "executionStats": {
    "nReturned": 1,
    "executionTimeMillis": 15,
    "totalKeysExamined": 1,
    "totalDocsExamined": 1
  }
}
```

**Key Privacy Point**: The LLM receives the execution plan structure showing:
- Field names being queried ("email", "age")
- Operators being used ("$gt")
- Index usage patterns
- Performance metrics

But it does NOT receive:
- The actual email address "john.doe@example.com"
- The actual age threshold value 25
- Any other literal values from the query

This allows the LLM to understand query patterns and suggest index optimizations without accessing sensitive customer data.

## Proposed Future Enhancement (v2.0) - Under Privacy Review

### Overview of Proposed Change

To enable more accurate index recommendations for complex queries, we are considering providing the original query structure and unsanitized execution plans to the LLM. This would allow the model to:

1. Understand the actual selectivity of filter conditions
2. Provide more precise index recommendations based on data distribution
3. Suggest compound indexes with optimal field order based on actual query patterns

### Additional Data Flow (Proposed)

```
┌─────────────────────────────────────┐
│  User Input (New Option)            │
│  - Original query with literals     │
│  - User consent to share query data │
└────────┬────────────────────────────┘
         │
         v
┌─────────────────────────────────────┐
│  Data Sent to LLM (Additional)      │
│  + Original query with filter values│
│  + Unsanitized execution plan       │
│  ! May contain customer data in     │
│    query predicates                 │
└─────────────────────────────────────┘
```

### Privacy Concerns with Proposed Enhancement

#### New Customer Data Being Sent to LLM:

1. **Original Query Filters**:
   - Content: Actual literal values used in query predicates
   - Risk: May contain sensitive customer data
   - Example:
     ```javascript
     db.users.find({
       "email": "customer@company.com",     // WARNING: Customer email
       "accountId": "ACC-789012",           // WARNING: Account identifier
       "lastLoginDate": { "$gte": ISODate("2024-01-15") }  // WARNING: Temporal data
     })
     ```

2. **Unsanitized Execution Plan**:
   - Contains: Filter predicates with actual values
   - Risk: Exposes data values throughout the execution plan tree
   - Impact: All stages (IXSCAN, FETCH, etc.) would include literal values

3. **Data Distribution Insights**:
   - Cardinality of specific values
   - Selectivity ratios based on actual data
   - Could reveal business logic and data patterns

#### Privacy Risk Assessment:

| Data Type | Current (v1.0) | Proposed (v2.0) | Risk Level |
|-----------|----------------|-----------------|------------|
| Filter literal values | NO (Sanitized to `<value>`) | **Would be sent** | **High** |
| Collection statistics | Sent (aggregate only) | Sent | Low (metadata) |
| Index definitions | Sent (structure only) | Sent | Low (metadata) |
| Execution plan structure | Sent (sanitized) | **Sent unsanitized** | **High** |
| Database/collection names | Sent | Sent | Low (metadata) |
| Performance metrics | Sent | Sent | Low (numeric only) |
| Query field names | Sent | Sent | Low-Medium (schema info) |

### Benefits of Proposed Enhancement:

1. **Improved Recommendation Accuracy**:
   - Better understanding of query selectivity
   - More precise compound index field ordering
   - Cardinality-aware index suggestions

2. **Performance Optimization**:
   - Recommendations based on actual data distribution
   - Better coverage analysis for multi-field indexes
   - More accurate impact predictions

3. **Cost Optimization**:
   - Identify over-indexing based on actual usage patterns
   - Recommend index consolidation opportunities

## Privacy Best Practices

### Current Implementation (v1.0):

1. **Aggressive Sanitization**: All literal values replaced with placeholders (both modes)
2. **Metadata Only**: Only structural and statistical data sent to LLM
3. **No Sample Data**: Unlike query generation, no documents fetched
4. **Field Names Preserved**: Allows meaningful recommendations
5. **Operator Preservation**: Maintains query pattern analysis capability
6. **Mode-Independent Privacy**: Sanitization applied regardless of standard or preload mode

### Preload Mode Specific Considerations:

1. **Caller Responsibility**: External callers must understand the data they provide
2. **Pre-sanitization Option**: Callers can sanitize data before providing it (defense in depth)
3. **Extension Still Sanitizes**: Even in preload mode, the extension applies full sanitization
4. **No Database Connection**: Preload mode cannot verify data sensitivity against database
5. **Use Case Awareness**: Primarily for testing, batch processing, and external tool integration

### If Future Enhancement Implemented (v2.0):

1. **Explicit Consent Required**: Users must opt-in to share query values
2. **Clear Data Disclosure**: Show exactly what data will be shared

## Compliance Notes

- Current implementation (v1.0) with sanitization minimizes PII exposure
- Metadata sharing (database/collection names, field names) may still be considered sensitive in some contexts
- Organizations should review their data classification policies
- Proposed v2.0 enhancement would require additional privacy impact assessment
