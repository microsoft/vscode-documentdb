# Data API Architecture

## Overview

The Data API provides a robust, database-agnostic framework for streaming and bulk writing documents between databases. It's designed to handle large-scale data operations with features like adaptive batching, automatic retry logic, and intelligent conflict resolution.

**Key Components:**

- **DocumentReader**: Streams documents from source collections
- **StreamingDocumentWriter**: Unified abstract base class for streaming writes with integrated buffering, batching, and retry logic

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
    │ (Source)         │              │ (Target - unified writer)    │
    └────────┬─────────┘              └──────────────┬───────────────┘
             │                                       │
             │ 2. streamDocuments()                  │
             │───────────────────────────────────────►
             │                                       │
             │                        3. Buffer & Adaptive Batching
             │                                       │
             │                        4. Retry with Exponential Backoff
             │                                       │
             │                        5. Progress Callbacks
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

**Purpose:** Unified base class for streaming document writes with integrated buffering, adaptive batching, retry logic, and progress reporting.

**Key Features:**

1. **Unified Buffer Management**: Single-level buffering with adaptive flush triggers
2. **Integrated Retry Logic**: Uses RetryOrchestrator for transient failure handling
3. **Adaptive Batching**: Uses BatchSizeAdapter for dual-mode (fast/RU-limited) operation
4. **Statistics Aggregation**: Uses WriteStats for progress tracking
5. **Two-Layer Progress Flow**: Simplified from previous four-layer approach

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

---

## Implementing New Database Writers

To add support for a new database, extend `StreamingDocumentWriter` and implement **only 3 abstract methods**:

```typescript
class MyDatabaseStreamingWriter extends StreamingDocumentWriter<string> {
  /**
   * Write a batch of documents using the specified strategy.
   * Handles all 4 conflict resolution strategies internally.
   */
  protected async writeBatch(
    documents: DocumentDetails[],
    strategy: ConflictResolutionStrategy,
  ): Promise<BatchWriteResult<string>> {
    // Implement database-specific write logic
  }

  /**
   * Classify an error for retry decisions.
   * Returns: 'throttle' | 'network' | 'conflict' | 'other'
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
}
```

---

## Conflict Resolution Strategies

| Strategy           | Behavior                                    | Use Case              |
| ------------------ | ------------------------------------------- | --------------------- |
| **Skip**           | Skip documents with existing \_id, continue | Safe incremental sync |
| **Overwrite**      | Replace existing documents (upsert)         | Full data refresh     |
| **Abort**          | Stop on first conflict                      | Strict validation     |
| **GenerateNewIds** | Generate new \_id values                    | Duplicating data      |

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

## File Structure

```
src/services/taskService/data-api/
├── types.ts                              # Public interfaces
├── writerTypes.ts                        # Internal writer types
├── readers/
│   ├── BaseDocumentReader.ts             # Abstract reader base class
│   └── DocumentDbDocumentReader.ts       # MongoDB implementation
└── writers/
    ├── StreamingDocumentWriter.ts        # Unified abstract base class
    ├── DocumentDbStreamingWriter.ts      # MongoDB implementation
    ├── RetryOrchestrator.ts              # Isolated retry logic
    ├── BatchSizeAdapter.ts               # Adaptive batch sizing
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
