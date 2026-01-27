# Data API Architecture

## Overview

The Data API provides a robust, database-agnostic framework for streaming and bulk writing documents between databases. It's designed to handle large-scale data operations with features like adaptive batching, automatic retry logic, and intelligent conflict resolution.

**Key Components:**

- **DocumentReader**: Streams documents from source collections
- **StreamingDocumentWriter**: Abstract base class for streaming writes with integrated buffering, batching, and retry logic

**Supported Databases:**

- Azure Cosmos DB for MongoDB API (vCore and RU-based)
- MongoDB (self-hosted, local, Azure VMs)
- Extensible to other databases via abstract base class

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           HIGH-LEVEL ARCHITECTURE                           │
└─────────────────────────────────────────────────────────────────────────────┘

                          ┌──────────────────────┐
                          │  CopyPasteTask or    │
                          │  Other Streaming Task│
                          └──────────┬───────────┘
                                     │
                                     │ 1. Creates components
                                     │
                ┌────────────────────┴────────────────────┐
                │                                         │
                ▼                                         ▼
    ┌──────────────────┐              ┌──────────────────────────────┐
    │ DocumentReader   │              │ StreamingDocumentWriter      │
    │ (Source)         │              │ (Target)                     │
    └────────┬─────────┘              └──────────────┬───────────────┘
             │                                       │
             │ 2. streamDocuments()                  │
             │───────────────────────────────────────►
             │                                       │
             │                        3. Buffer & Adaptive Batching
             │                                       │
             │                        4. Pre-filter (Skip strategy)
             │                                       │
             │                        5. Retry with Exponential Backoff
             │                                       │
             │                        6. Progress Callbacks
             │                                       │
             ▼                                       ▼
┌──────────────────┐                  ┌──────────────────┐
│   Source DB      │                  │   Target DB      │
│   (Read-only)    │                  │   (Writable)     │
└──────────────────┘                  └──────────────────┘
```

---

## Component Responsibilities

### DocumentReader

**Purpose:** Stream documents from source collections with minimal memory footprint

**Key Methods:**

- `streamDocuments()`: Returns AsyncIterable<DocumentDetails> for streaming
- `countDocuments()`: Returns total count for progress calculation

**Memory Characteristics:**

- O(1) memory usage - only current document in memory
- No buffering - pure streaming interface

**Example:**

```typescript
const reader = new DocumentDbDocumentReader(connectionId, databaseName, collectionName);
const stream = reader.streamDocuments({ keepAlive: true });

for await (const doc of stream) {
  console.log(doc.id);
}
```

---

### StreamingDocumentWriter

**Purpose:** Abstract base class for streaming document writes with integrated buffering, adaptive batching, retry logic, and progress reporting.

**Key Features:**

1. **Buffer Management**: Single-level buffering with adaptive flush triggers
2. **Integrated Retry Logic**: Uses RetryOrchestrator for transient failure handling
3. **Adaptive Batching**: Uses BatchSizeAdapter for dual-mode (fast/RU-limited) operation
4. **Pre-filtering (Skip Strategy)**: Queries target for existing IDs before insert to avoid duplicate logging
5. **Statistics Aggregation**: Uses WriteStats for progress tracking
6. **Immediate Progress Reporting**: Progress reported during throttle recovery
7. **Semantic Result Types**: Strategy-specific result types (`SkipBatchResult`, `OverwriteBatchResult`, etc.)

**Key Methods:**

- `streamDocuments(stream, config, options)`: Stream documents to target with automatic buffering and retry
- `ensureTargetExists()`: Create target collection if needed

**Example:**

```typescript
const writer = new DocumentDbStreamingWriter(client, databaseName, collectionName);

// Ensure target exists
await writer.ensureTargetExists();

// Stream documents with progress tracking
const result = await writer.streamDocuments(
  documentStream,
  { conflictResolutionStrategy: ConflictResolutionStrategy.Skip },
  {
    onProgress: (count, details) => console.log(`${count}: ${details}`),
    abortSignal: signal,
  },
);

console.log(`Processed: ${result.totalProcessed}, Inserted: ${result.insertedCount}`);
```

> **Note:** For detailed sequence diagrams showing throttle recovery and network error handling,
> see the JSDoc comments in `StreamingDocumentWriter.ts`.

---

## Pre-filtering (Skip Strategy Optimization)

When using the **Skip** conflict resolution strategy, the writer can pre-filter documents by querying the target collection for existing IDs before attempting insertion. This optimization is performed **once per batch before the retry loop**.

### Why Pre-filtering?

Without pre-filtering, when throttling occurs:

1. Documents are partially inserted
2. Batch is sliced and retried
3. Skip detection happens again on retry
4. Same skipped documents are logged multiple times

With pre-filtering:

1. Existing IDs are queried once upfront
2. Skipped documents are reported immediately
3. Only insertable documents enter the retry loop
4. No duplicate logging on throttle retries

### Pre-filter Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     PRE-FILTER FLOW (Skip Strategy)                         │
└─────────────────────────────────────────────────────────────────────────────┘

    writeBatchWithRetry()
           │
           │ 1. Strategy == Skip?
           ▼
    ┌──────────────────────────────┐
    │ preFilterForSkipStrategy()   │
    │ ─────────────────────────────│
    │ Query: find({_id: {$in: ...}})│
    │ Returns: existing IDs        │
    └──────────────┬───────────────┘
                   │
                   │ 2. Report skipped docs immediately
                   │    via onPartialProgress()
                   │
                   │ 3. Remove skipped docs from batch
                   ▼
    ┌──────────────────────────────┐
    │ Retry loop with filtered     │
    │ batch (only insertable docs) │
    │ ─────────────────────────────│
    │ • Throttle → slice & retry   │
    │ • No duplicate skip logging  │
    │ • Accurate batch slicing     │
    └──────────────────────────────┘
```

### Benefits

| Benefit                    | Description                                           |
| -------------------------- | ----------------------------------------------------- |
| **No duplicate logging**   | Skipped documents logged once, not on every retry     |
| **Accurate batch slicing** | Throttle recovery slices only insertable documents    |
| **Reduced payload size**   | Insert requests contain only new documents            |
| **Cleaner trace output**   | Clear separation between pre-filter and insert phases |

### Race Condition Handling

If another process inserts documents between the pre-filter query and the insert operation, the writer handles this gracefully:

1. Duplicate key error (11000) is caught during insert
2. Documents are marked as "race condition skipped"
3. Operation continues with remaining documents

---

## Implementing New Database Writers

To add support for a new database, extend `StreamingDocumentWriter` and implement **3 abstract methods** plus 1 optional method:

```typescript
class MyDatabaseStreamingWriter extends StreamingDocumentWriter<string> {
  /**
   * Write a batch of documents using the specified strategy.
   * Returns strategy-specific results with semantic field names.
   */
  protected async writeBatch(
    documents: DocumentDetails[],
    strategy: ConflictResolutionStrategy,
  ): Promise<StrategyBatchResult<string>> {
    // Implement database-specific write logic
    // Return SkipBatchResult, OverwriteBatchResult, AbortBatchResult, or GenerateNewIdsBatchResult
  }

  /**
   * Classify an error for retry decisions.
   * Returns: 'throttle' | 'network' | 'conflict' | 'validator' | 'other'
   */
  protected classifyError(error: unknown): ErrorType {
    // Map database error codes to classification
  }

  /**
   * Extract partial progress from an error (for throttle recovery).
   */
  protected extractPartialProgress(error: unknown): PartialProgress | undefined {
    // Parse error to extract how many documents succeeded
  }

  /**
   * Ensure target collection exists.
   */
  public async ensureTargetExists(): Promise<EnsureTargetExistsResult> {
    // Create collection if needed
  }

  /**
   * OPTIONAL: Pre-filter for Skip strategy optimization.
   * Query target for existing IDs and return filtered batch.
   * Default implementation returns undefined (no pre-filtering).
   */
  protected async preFilterForSkipStrategy(documents: DocumentDetails[]): Promise<PreFilterResult<string> | undefined> {
    // Query target: find({_id: {$in: batchIds}})
    // Return { documentsToInsert, skippedResult } or undefined
  }
}
```

---

## Conflict Resolution Strategies

| Strategy           | Result Type                 | Behavior                                    | Use Case              |
| ------------------ | --------------------------- | ------------------------------------------- | --------------------- |
| **Skip**           | `SkipBatchResult`           | Skip documents with existing \_id, continue | Safe incremental sync |
| **Overwrite**      | `OverwriteBatchResult`      | Replace existing documents (upsert)         | Full data refresh     |
| **Abort**          | `AbortBatchResult`          | Stop on first conflict                      | Strict validation     |
| **GenerateNewIds** | `GenerateNewIdsBatchResult` | Generate new \_id values                    | Duplicating data      |

---

## Adaptive Batching

The writer automatically adjusts batch sizes based on database response:

### Fast Mode (Default)

- **Initial**: 500 documents
- **Maximum**: 2000 documents
- **Growth**: 20% per successful batch
- **Use case**: vCore clusters, local MongoDB, unlimited-capacity environments

### RU-Limited Mode (Auto-detected)

- **Initial**: 100 documents
- **Maximum**: 1000 documents
- **Growth**: 10% per successful batch
- **Triggered by**: Throttling errors (429, 16500)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    ADAPTIVE BATCH SIZE BEHAVIOR                             │
└─────────────────────────────────────────────────────────────────────────────┘

Success:                     Throttle:
  ┌─────┐                      ┌─────┐
  │Batch│ → Grow by 20%        │Batch│ → Shrink by 50%
  │ OK  │   (up to max)        │ 429 │   Switch to RU-limited mode
  └─────┘                      └─────┘
```

---

## Retry Logic

The `RetryOrchestrator` handles transient failures:

- **Max attempts**: 10
- **Backoff**: Exponential with jitter
- **Retryable errors**: Throttle (429, 16500), Network (ECONNRESET, ETIMEDOUT)
- **Non-retryable errors**: Conflicts (handled by strategy), Other (bubble up)

---

## Keep-Alive Logic

The `KeepAliveOrchestrator` handles cursor timeouts during slow consumption:

- **Purpose**: Prevent database cursor timeouts when the consumer processes documents slowly
- **Mechanism**: Periodically reads from the database iterator into a buffer
- **Default interval**: 10 seconds
- **Default timeout**: 10 minutes (to prevent runaway operations)

When keep-alive is enabled:

1. Documents are read from the buffer if available (pre-fetched by timer)
2. If buffer is empty, documents are read directly from the database
3. Timer fires periodically to "tickle" the cursor and buffer documents

> **Note:** For detailed sequence diagrams, see the JSDoc comments in `BaseDocumentReader.ts`.

---

## File Structure

```
src/services/taskService/data-api/
├── README.md                             # This documentation
├── types.ts                              # Public interfaces (StreamWriteResult, DocumentDetails, etc.)
├── readers/
│   ├── BaseDocumentReader.ts             # Abstract reader base class (see JSDoc for sequence diagrams)
│   ├── DocumentDbDocumentReader.ts       # MongoDB/DocumentDB implementation
│   └── KeepAliveOrchestrator.ts          # Isolated keep-alive logic
└── writers/
    ├── StreamingDocumentWriter.ts        # Abstract base class (see JSDoc for sequence diagrams)
    ├── StreamingDocumentWriter.test.ts   # Comprehensive tests for streaming writer
    ├── DocumentDbStreamingWriter.ts      # MongoDB/DocumentDB implementation
    ├── writerTypes.internal.ts           # Internal types (StrategyBatchResult, PreFilterResult, etc.)
    ├── RetryOrchestrator.ts              # Isolated retry logic
    ├── BatchSizeAdapter.ts               # Adaptive batch sizing (fast/RU-limited modes)
    └── WriteStats.ts                     # Statistics aggregation
```

---

## Usage with CopyPasteCollectionTask

```typescript
// Create reader and writer
const reader = new DocumentDbDocumentReader(sourceConnectionId, sourceDb, sourceCollection);
const writer = new DocumentDbStreamingWriter(targetClient, targetDb, targetCollection);

// Create task
const task = new CopyPasteCollectionTask(config, reader, writer);

// Start task
await task.start();
```

The task handles:

1. Counting source documents for progress
2. Ensuring target collection exists
3. Streaming documents with progress updates
4. Handling errors with partial statistics
5. Reporting final summary
