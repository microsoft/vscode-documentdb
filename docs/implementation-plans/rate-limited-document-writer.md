# Rate-Limited Document Writer Implementation Plan

## Document Information

- **Created**: September 30, 2025
- **Purpose**: Implementation plan for adding rate-**File**: `src/services/taskService/tasks/copy-and-paste/documentInterfaces.ts`

**Change**: Add progressCallback to DocumentWriterOptions

```typescript
export interface DocumentWriterOptions {
  batchSize?: number;
  progressCallback?: (writtenInBatch: number) => void;
}
```

**Rationale**:

- Writer reports how many docs were written in the current batch
- Task receives callbacks and computes overall progress
- Simpler contract - writer doesn't need to know total document countting and retry logic to DocumentDbDocumentWriter
- **Target File**: `src/services/taskService/tasks/copy-and-paste/documentdb/documentDbDocumentWriter.ts`
- **Feature Branch**: `feature/copy-and-paste`

---

## Executive Summary

This plan adds intelligent rate-limiting and retry mechanisms to the DocumentDB document writer to handle throttling errors (HTTP 429, Azure Cosmos DB 16500) and network issues. The implementation uses adaptive batch sizing to automatically find optimal throughput while preserving all existing conflict resolution strategies.

---

## Current State Analysis

### Existing Implementation

The current `DocumentDbDocumentWriter` implementation:

1. **No Retry Logic**: All documents are written in a single batch with no retry on failure
2. **No Rate Limiting**: No handling of throttling errors (429/16500)
3. **No Batch Management**: Receives all documents and tries to insert them at once
4. **Complex Conflict Resolution**: Has well-implemented strategies (Abort, Skip, Overwrite, GenerateNewIds)
5. **Transaction Support**: Uses transactions for the Overwrite strategy

### Key Observations

1. **GenerateNewIds Path** (lines 48-84):
   - Transforms documents by removing `_id` and storing it in `_original_id` field
   - Uses unordered inserts (conflicts shouldn't occur)
   - Has its own error handling

2. **Standard Insert Path** (lines 86-93):
   - Uses ordered=true for Abort strategy
   - Uses ordered=false for Skip/Overwrite strategies
   - Relies on MongoDB's insertMany behavior

3. **Overwrite Strategy** (lines 107-129):
   - **Current**: Uses transactions to delete + re-insert conflicting documents
   - **Will Change**: Moving to `bulkWrite` with `replaceOne` + `upsert: true` for better performance

4. **Error Handling** (lines 131-159):
   - Properly handles `MongoBulkWriteError`
   - Maps write errors to user-friendly format
   - Preserves error context (documentId, error message)

---

## Design Decisions

### Decision 1: Batch Size Management Strategy

**Options Considered:**

- A) Fixed batch size with no adjustment
- B) Adaptive batch sizing that responds to throttling
- C) Pre-calculated optimal batch size based on RU estimation

**Decision: Option B - Adaptive Batch Sizing**

**Rationale:**

- Database load varies over time (other users, background tasks)
- Different document sizes consume different RUs
- Adaptive approach learns the current optimal size without requiring RU calculation
- Simpler than RU estimation while being effective

**Implementation:**

- Start with 100 documents per batch (matches current `CopyPasteCollectionTask.bufferSize`)
- On throttle: Reduce to 50% of current size (aggressive reduction for quick recovery)
- On success: Increase by 10 documents (linear growth to avoid oscillation)
- Limits: Min 1, Max 1000 documents
- The writer exposes `getCurrentBatchSize()` so the task knows the optimal read buffer size

### Decision 2: Error Classification

**Categories:**

- **Throttle**: 429, 16500, messages with "rate limit"/"throttl"/"too many requests"
- **Network**: ECONNRESET, ETIMEDOUT, ENOTFOUND, messages with "timeout"/"network"
- **Conflict**: Error code 11000 (duplicate key)
- **Other**: All other errors (treated as non-retryable)

**Rationale:**

- Different error types need different handling strategies
- Network errors should retry without changing batch size
- Throttle errors indicate capacity issues requiring batch size reduction
- Conflict errors are already handled by existing strategies

### Decision 3: Retry Strategy

**Throttle Errors:**

- Immediate batch splitting (halve the current batch)
- Exponential backoff: base 1000ms, multiplier 1.5, max 5000ms
- Add 30% jitter to prevent thundering herd
- Retry indefinitely until success or non-throttle error

**Network Errors:**

- Fixed 2-second delay (no exponential backoff)
- Keep batch size unchanged
- Max 10 retry attempts

**Other Errors:**

- No retry, throw immediately
- Let existing error handling deal with them

**Rationale:**

- Throttling needs aggressive batch reduction to find working size
- Network issues are transient and don't require batch changes
- Other errors are likely permanent (bad data, permissions, etc.)

### Decision 4: Progress Reporting

**Challenge**: The writer doesn't know the total number of documents to copy - only the task knows this.

**Decision**: Add local `progressCallback` to `DocumentWriterOptions` that reports batch-level progress

**Signature:**

```typescript
progressCallback?: (writtenInBatch: number) => void
```

**Rationale:**

- Writer only knows about the current batch being written
- Task receives callbacks and translates to overall progress (written/total)
- Task tracks cumulative progress across all batches
- Simpler contract - writer reports what it knows, task does the math

### Decision 5: Preserve Existing Functionality

**Critical Requirement**: All existing conflict resolution strategies must continue to work exactly as they do now.

**Approach:**

- Wrap the batch write logic without changing conflict resolution paths
- For GenerateNewIds: Apply batching around the client.insertDocuments call
- For Overwrite: Let errors bubble up to existing transaction handler
- For Abort/Skip: Maintain ordered parameter behavior

---

## Implementation Plan

### Phase 1: Add Supporting Infrastructure

#### 1.1 Update DocumentWriterOptions Interface

**File**: `src/services/taskService/tasks/copy-and-paste/documentInterfaces.ts`

**Change**: Add progressCallback to DocumentWriterOptions

```typescript
export interface DocumentWriterOptions {
  batchSize?: number;
  progressCallback?: (writtenInBatch: number) => void;
}
```

**Rationale**:

- Writer reports how many docs were written in the current batch
- Task receives callbacks and computes overall progress
- Simpler contract - writer doesn't need to know total document count

#### 1.2 Add Instance Variables to DocumentDbDocumentWriter

**File**: `src/services/taskService/tasks/copy-and-paste/documentdb/documentDbDocumentWriter.ts`

**Add after class declaration**:

```typescript
private currentBatchSize: number = 100; // Matches CopyPasteCollectionTask.bufferSize
private readonly minBatchSize: number = 1;
private readonly maxBatchSize: number = 1000;
```

**Rationale**:

- Track adaptive batch sizing across multiple write operations
- Start with 100 to match the existing task buffer size
- Allows writer to adapt based on actual database capacity

#### 1.3 Add BatchWriteResult Interface

**Add to documentDbDocumentWriter.ts** (before class or in documentInterfaces.ts):

```typescript
/**
 * Result of writing a single batch with retry logic.
 */
interface BatchWriteResult {
  /** Number of documents successfully inserted */
  insertedCount: number;
  /** Number of documents from input batch that were processed */
  processedCount: number;
  /** Whether throttling occurred during this batch */
  wasThrottled: boolean;
  /** Errors from the write operation, if any */
  errors?: Array<{ documentId?: string; error: Error }>;
}
```

### Phase 2: Add Public API for Task Integration

#### 2.1 Add getCurrentBatchSize Method

**Signature**:

```typescript
/**
 * Gets the current adaptive batch size.
 * The task can use this to optimize its read buffer size.
 *
 * @returns Current batch size
 */
public getCurrentBatchSize(): number
```

**Implementation**:

```typescript
return this.currentBatchSize;
```

**Rationale**:

- Task needs to know optimal buffer size for reading documents
- Avoids reading too many docs that won't fit in a write batch
- Enables dynamic coordination between reader and writer throughput

### Phase 3: Add Helper Methods

#### 3.1 Error Classification Method

```typescript
/**
 * Classifies an error into categories for appropriate handling.
 *
 * @param error The error to classify
 * @returns Error category: 'throttle', 'network', 'conflict', or 'other'
 */
private classifyError(error: unknown): 'throttle' | 'network' | 'conflict' | 'other'
```

**Logic**:

- Check for error codes 429, 16500 → 'throttle'
- Check for error codes ECONNRESET, ETIMEDOUT, ENOTFOUND → 'network'
- Check for error code 11000 → 'conflict'
- Check error messages for "rate limit", "throttl", "timeout", "network" → classify accordingly
- Default → 'other'

#### 3.2 Sleep Utility Method

```typescript
/**
 * Delays execution for the specified duration.
 *
 * @param ms Milliseconds to sleep
 */
private sleep(ms: number): Promise<void>
```

**Implementation**:

```typescript
return new Promise((resolve) => setTimeout(resolve, ms));
```

#### 3.3 Retry Delay Calculator

```typescript
/**
 * Calculates retry delay with exponential backoff and jitter.
 *
 * @param attempt Current attempt number (0-based)
 * @returns Delay in milliseconds
 */
private calculateRetryDelay(attempt: number): number
```

**Formula**:

- Base: 1000ms
- Exponential: base × 1.5^attempt
- Cap: 5000ms (5 seconds as specified)
- Jitter: ±30% randomness
- Final: Math.floor(cappedDelay + jitter)

### Phase 4: Core Retry Logic

#### 4.1 Create BatchWriteResult Interface

**Add to documentDbDocumentWriter.ts** (before class or in documentInterfaces.ts):

```typescript
/**
 * Result of writing a single batch with retry logic.
 */
interface BatchWriteResult {
  /** Number of documents successfully inserted */
  insertedCount: number;
  /** Number of documents from input batch that were processed */
  processedCount: number;
  /** Whether throttling occurred during this batch */
  wasThrottled: boolean;
  /** Errors from the write operation, if any */
  errors?: Array<{ documentId?: string; error: Error }>;
}
```

#### 4.2 Implement writeBatchWithRetry Method

**Signature**:

```typescript
/**
 * Writes a batch of documents with retry logic for rate limiting and network errors.
 * Implements immediate batch splitting when throttled.
 *
 * @param client ClustersClient instance
 * @param databaseName Target database name
 * @param collectionName Target collection name
 * @param batch Documents to write
 * @param config Copy-paste configuration
 * @returns Promise with batch write result
 */
private async writeBatchWithRetry(
    client: ClustersClient,
    databaseName: string,
    collectionName: string,
    batch: DocumentDetails[],
    config: CopyPasteConfig,
): Promise<BatchWriteResult>
```

**Logic Flow**:

1. Initialize: `currentBatch = batch`, `maxAttempts = 10`, `attempt = 0`
2. Loop: `while (attempt < maxAttempts)`
3. Try to insert `currentBatch`:
   - Map DocumentDetails to raw documents
   - Call `client.insertDocuments()` with appropriate `ordered` flag
   - On success: Return `{ insertedCount, processedCount, wasThrottled: false }`
4. Catch errors:
   - Classify error type
   - **If 'throttle'**:
     - Set `wasThrottled = true`
     - If `currentBatch.length > 1`: Split batch in half
     - Calculate backoff delay and sleep
     - Increment attempt and continue
   - **If 'network'**:
     - Sleep for fixed 2000ms
     - Increment attempt and continue (keep same batch)
   - **If 'conflict' or 'other'**:
     - If it's a `MongoBulkWriteError`, return with partial results and errors
     - Otherwise throw error (let existing handlers deal with it)
5. After max attempts: Throw error with context

**Critical**: When splitting batch on throttle, update `currentBatch` immediately before retry

### Phase 5: Modify Main writeDocuments Method

#### 5.1 Update Method Signature

No changes to signature - we preserve the interface contract.

#### 5.2 Implement Batching Loop

**New Structure**:

```typescript
async writeDocuments(...): Promise<BulkWriteResult> {
    // Existing empty check
    if (documents.length === 0) {
        return { insertedCount: 0, errors: [] };
    }

    const client = await ClustersClient.getClient(connectionId);

    // For GenerateNewIds: Transform documents first, then batch
    if (config.onConflict === ConflictResolutionStrategy.GenerateNewIds) {
        const transformedDocuments = /* existing transformation */;
        return this.writeDocumentsInBatches(
            client, databaseName, collectionName,
            transformedDocuments.map(doc => ({ id: undefined, documentContent: doc })),
            config, false, options
        );
    }

    // For other strategies: Use batching with appropriate ordered flag
    return this.writeDocumentsInBatches(
        client, databaseName, collectionName,
        documents,
        config,
        config.onConflict === ConflictResolutionStrategy.Abort,
        options
    );
}
```

#### 5.3 Create writeDocumentsInBatches Helper

**Signature**:

```typescript
/**
 * Writes documents in adaptive batches with retry logic.
 *
 * @param client ClustersClient instance
 * @param databaseName Target database
 * @param collectionName Target collection
 * @param documents Documents to write
 * @param config Copy-paste configuration
 * @param ordered Whether to use ordered inserts
 * @param options Write options including progress callback
 * @returns Bulk write result
 */
private async writeDocumentsInBatches(
    client: ClustersClient,
    databaseName: string,
    collectionName: string,
    documents: DocumentDetails[],
    config: CopyPasteConfig,
    ordered: boolean,
    options?: DocumentWriterOptions,
): Promise<BulkWriteResult>
```

**Logic**:

```typescript
let totalInserted = 0;
let allErrors: Array<{ documentId?: string; error: Error }> = [];
let pendingDocs = [...documents];

while (pendingDocs.length > 0) {
  // Take a batch with current adaptive size
  const batch = pendingDocs.slice(0, this.currentBatchSize);

  try {
    // Write batch with retry
    const result = await this.writeBatchWithRetry(client, databaseName, collectionName, batch, config);

    totalInserted += result.insertedCount;
    pendingDocs = pendingDocs.slice(result.processedCount);

    // Adjust batch size for next iteration
    if (result.wasThrottled) {
      this.currentBatchSize = Math.max(this.minBatchSize, Math.floor(this.currentBatchSize * 0.5));
    } else if (this.currentBatchSize < this.maxBatchSize) {
      this.currentBatchSize = Math.min(this.maxBatchSize, this.currentBatchSize + 10);
    }

    // Collect errors if any
    if (result.errors) {
      allErrors.push(...result.errors);

      // For Abort strategy, stop immediately on first error
      if (config.onConflict === ConflictResolutionStrategy.Abort) {
        break;
      }
    }

    // Report progress (just the count written in this batch)
    options?.progressCallback?.(result.insertedCount);
  } catch (error) {
    // This is a fatal error - return what we have so far
    const errorObj = error instanceof Error ? error : new Error(String(error));
    allErrors.push({ documentId: undefined, error: errorObj });
    break;
  }
}

return {
  insertedCount: totalInserted,
  errors: allErrors.length > 0 ? allErrors : null,
};
```

### Phase 6: Task Integration

**File**: `src/services/taskService/tasks/copy-and-paste/CopyPasteCollectionTask.ts`

#### 6.1 Dynamic Buffer Sizing

**Current**: Task uses fixed `bufferSize = 100`

**Change**: Query writer for optimal batch size periodically

```typescript
// In the doWork() method, before the streaming loop
let documentsReadSinceLastAdjustment = 0;
const adjustmentInterval = 500; // Recheck every 500 docs

for await (const document of documentStream) {
  // ... existing code ...

  // Periodically adjust buffer size based on writer's current batch size
  documentsReadSinceLastAdjustment++;
  if (documentsReadSinceLastAdjustment >= adjustmentInterval) {
    const optimalBatchSize = this.documentWriter.getCurrentBatchSize();
    // Could adjust read buffer or just log for telemetry
    documentsReadSinceLastAdjustment = 0;
  }

  // ... rest of existing code ...
}
```

**Rationale**:

- Keeps task and writer in sync on optimal throughput
- Avoids reading more docs than writer can handle
- Can be used for telemetry and diagnostics

#### 6.2 Progress Callback Integration

**Update flushBuffer method**:

```typescript
private async flushBuffer(buffer: DocumentDetails[], signal: AbortSignal): Promise<void> {
    if (buffer.length === 0 || signal.aborted) {
        return;
    }

    const startTime = Date.now();

    // Track writes within this batch
    let writtenInCurrentFlush = 0;

    const result = await this.documentWriter.writeDocuments(
        this.config.target.connectionId,
        this.config.target.databaseName,
        this.config.target.collectionName,
        this.config,
        buffer,
        {
            batchSize: buffer.length,
            progressCallback: (writtenInBatch) => {
                // Accumulate writes in this flush
                writtenInCurrentFlush += writtenInBatch;

                // Update overall progress
                this.copiedDocuments += writtenInBatch;

                // Update UI
                const progressPercentage = this.sourceDocumentCount > 0
                    ? Math.min(100, Math.round((this.copiedDocuments / this.sourceDocumentCount) * 100))
                    : 0;

                this.updateProgress(
                    progressPercentage,
                    vscode.l10n.t(
                        'Copied {0} of {1} documents ({2}%)',
                        this.copiedDocuments.toString(),
                        this.sourceDocumentCount.toString(),
                        progressPercentage.toString()
                    )
                );
            }
        },
    );

    const flushDuration = Math.max(0, Date.now() - startTime);
    this.updateRunningStats(this.flushDurationStats, flushDuration);

    // Final update for this buffer
    this.processedDocuments += buffer.length;

    // Note: copiedDocuments already updated via progressCallback
    // Just ensure consistency
    if (writtenInCurrentFlush !== result.insertedCount) {
        // Log discrepancy for debugging
        ext.outputChannel.warn(
            vscode.l10n.t(
                'Progress callback reported {0} written, but result shows {1}',
                writtenInCurrentFlush.toString(),
                result.insertedCount.toString()
            )
        );
        // Trust the final result
        this.copiedDocuments = this.copiedDocuments - writtenInCurrentFlush + result.insertedCount;
    }

    // ... rest of error handling ...
}
```

**Rationale**:

- Task receives granular progress updates during retries
- User sees progress even for large batches that take time
- Task computes overall percentage (copied/total)
- Writer stays simple - just reports batch-level progress---

## Testing Strategy

### Unit Tests

1. **Error Classification**
   - Test throttle error detection (429, 16500)
   - Test network error detection (ECONNRESET, ETIMEDOUT)
   - Test conflict error detection (11000)
   - Test message-based classification

2. **Batch Size Adjustment**
   - Test reduction on throttle (50% decrease)
   - Test growth on success (linear increase by 10)
   - Test min/max boundaries

3. **Retry Logic**
   - Test exponential backoff calculation
   - Test jitter application
   - Test max attempts enforcement

### Integration Tests

1. **Throttling Scenario**
   - Simulate 429 errors
   - Verify batch size reduces and retries succeed
   - Verify batch size grows back after successes

2. **Network Error Scenario**
   - Simulate timeout errors
   - Verify fixed delay retry
   - Verify batch size unchanged

3. **Conflict Resolution**
   - Test all strategies still work (Abort, Skip, Overwrite, GenerateNewIds)
   - Verify transaction handling for Overwrite
   - Verify ordered parameter behavior

### Performance Tests

1. **Large Dataset**
   - 10,000+ documents
   - Verify memory usage stays reasonable
   - Verify progress reporting works

2. **Mixed Document Sizes**
   - Small (1KB) and large (100KB) documents
   - Verify adaptive batching handles both

---

## Risk Assessment

### High Risk Areas

1. **Overwrite Strategy Change**
   - **Risk**: `bulkWrite` with `replaceOne` behaves differently than transactions
   - **Mitigation**: Test thoroughly with conflicts, verify same end state as transaction approach
   - **Risk**: Sharded clusters might route incorrectly if shard key ≠ `_id`
   - **Mitigation**: Document requirement, add comment in code about shard key considerations

2. **Batch Splitting Edge Cases**
   - **Risk**: Single large document that always throttles
   - **Mitigation**: Handle single-document batches specially, wait with backoff

3. **Progress Reporting**
   - **Risk**: Progress callback might be called multiple times for same docs during retries
   - **Mitigation**: Task tracks cumulative total, callback only reports delta
   - **Risk**: Discrepancy between progress callbacks and final result
   - **Mitigation**: Task reconciles at end of flush, trusts final result count

### Medium Risk Areas

1. **Error Classification Accuracy**
   - **Risk**: Misclassifying errors could lead to wrong retry behavior
   - **Mitigation**: Use comprehensive error message patterns, log classifications

2. **Memory Usage**
   - **Risk**: Holding large batches in memory
   - **Mitigation**: Current max batch size of 1000 documents is reasonable

### Low Risk Areas

1. **Batch Size Oscillation**
   - **Risk**: Batch size might oscillate around throttle threshold
   - **Mitigation**: Asymmetric adjustment (50% down, +10 up) should stabilize

---

## Implementation Checklist

### Phase 1: Infrastructure

- [ ] Update `DocumentWriterOptions` with `progressCallback`
- [ ] Add batch size instance variables to `DocumentDbDocumentWriter`
- [ ] Add `BatchWriteResult` interface

### Phase 2: Helper Methods

- [ ] Implement `classifyError` method
- [ ] Implement `sleep` method
- [ ] Implement `calculateRetryDelay` method

### Phase 3: Core Logic

- [ ] Implement `writeBatchWithRetry` method
- [ ] Implement `writeDocumentsInBatches` helper
- [ ] Update `writeDocuments` to use batching

### Phase 4: Testing

- [ ] Unit tests for error classification
- [ ] Unit tests for batch size adjustment
- [ ] Integration tests for all conflict strategies
- [ ] Performance tests with large datasets

### Phase 5: Documentation

- [ ] Add JSDoc comments to all new methods
- [ ] Update implementation decisions document
- [ ] Document retry behavior in code comments

---

## Open Questions

1. **Should we expose retry configuration?**
   - Current: Hard-coded max attempts (10), delays (1-5s)
   - Alternative: Make configurable via DocumentWriterOptions
   - Decision: Start with hard-coded, make configurable if needed

2. **Should batch size reset between different writeDocuments calls?**
   - Current: Batch size persists across calls (instance variable)
   - Alternative: Reset to default for each call
   - Decision: Keep persistent - helps with repeated operations across multiple flush cycles

3. **Should task dynamically adjust read buffer based on write batch size?**
   - Current: Task uses fixed 100-doc buffer
   - Alternative: Query `getCurrentBatchSize()` periodically and adjust
   - Decision: Optional enhancement - getCurrentBatchSize() is available for future use

---

## Success Criteria

1. ✅ Abort, Skip, and GenerateNewIds strategies work unchanged
2. ✅ Overwrite strategy uses `bulkWrite` with `replaceOne` + `upsert: true` (faster than transactions)
3. ✅ Throttling errors (429, 16500) trigger batch reduction and retry
4. ✅ Network errors trigger fixed-delay retry without batch changes
5. ✅ Batch size adapts: reduces on throttle, grows on success
6. ✅ Progress reporting works during retries (batch-level callbacks)
7. ✅ Task receives progress callbacks and computes overall percentage
8. ✅ Maximum 5-second delay between retries
9. ✅ No infinite loops - max 10 retry attempts
10. ✅ Memory usage stays reasonable for large datasets
11. ✅ Task can query optimal batch size via `getCurrentBatchSize()`
12. ✅ Writer starts with batch size of 100 (matching task buffer)

---

## Next Steps

1. **Get approval on this implementation plan**
2. **Implement Phase 1 & 2** (infrastructure and helpers)
3. **Implement Phase 3** (core retry logic)
4. **Test with all conflict strategies**
5. **Refine based on testing results**
6. **Update this document with actual implementation learnings**

---

## Revision History

| Date       | Version | Changes                     | Author       |
| ---------- | ------- | --------------------------- | ------------ |
| 2025-09-30 | 1.0     | Initial implementation plan | AI Assistant |
