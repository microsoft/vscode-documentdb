# Data API Architecture

## Overview

The Data API provides a robust, database-agnostic framework for streaming and bulk writing documents between databases. It's designed to handle large-scale data operations with features like adaptive batching, automatic retry logic, and intelligent conflict resolution.

**Key Components:**

- **DocumentReader**: Streams documents from source collections
- **DocumentWriter**: Writes documents with conflict resolution and adaptive batching
- **StreamDocumentWriter**: Manages buffering and streaming coordination
- **BaseDocumentWriter**: Abstract base class with retry logic and mode switching

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
                ┌────────────────────┼────────────────────┐
                │                    │                    │
                ▼                    ▼                    ▼
    ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
    │ DocumentReader   │  │ DocumentWriter   │  │StreamDocumentWriter│
    │ (Source)         │  │ (Target)         │  │ (Coordinator)    │
    └────────┬─────────┘  └────────┬─────────┘  └────────┬─────────┘
             │                     │                     │
             │ 2. streamDocuments()│                     │
             │────────────────────────────────────────────►
             │                     │                     │
             │                     │ 3. getBufferConstraints()
             │                     │◄────────────────────│
             │                     │                     │
             │                     │ 4. Stream + Buffer  │
             │                     │                     │
             │                     │ 5. writeDocuments() │
             │                     │◄────────────────────│
             │                     │                     │
             │                     │ 6. Progress updates │
             │                     │─────────────────────►
             │                     │                     │
             │                     │ 7. Statistics       │
             │                     │─────────────────────►
             ▼                     ▼                     ▼
┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│   Source DB      │  │   Target DB      │  │  Task Progress   │
│   (Read-only)    │  │   (Writable)     │  │  & Telemetry     │
└──────────────────┘  └──────────────────┘  └──────────────────┘
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
const reader = new DocumentDbDocumentReader(client);
const stream = reader.streamDocuments(sourceDb, sourceCollection);

for await (const doc of stream) {
  // Process one document at a time
  console.log(doc.id);
}
```

### Keep-Alive Support

**Motivation:**
When streaming documents to a slow consumer (e.g., a rate-limited writer or complex processing logic), the database cursor might time out if no documents are requested for an extended period. This is common when the target database throttles writes, causing the reader to pause.

**Mechanism:**
The `DocumentReader` supports an optional keep-alive mode that maintains a background buffer. It periodically fetches documents from the database even if the consumer isn't requesting them immediately, ensuring the cursor remains active.

**Usage:**
Enable keep-alive by passing `keepAlive: true` in the options:

```typescript
const stream = reader.streamDocuments({
  keepAlive: true,
  keepAliveIntervalMs: 30000, // Optional: refill every 30s
  keepAliveTimeoutMs: 3600000, // Optional: abort after 1h
});
```

---

### DocumentWriter (Abstract Interface)

**Purpose:** Define contract for writing documents with conflict resolution

**Key Methods:**

- `writeDocuments()`: Bulk write with adaptive batching and retry logic
- `ensureTargetExists()`: Create collection if needed
- `getBufferConstraints()`: Return optimal batch size and memory limits

**Implementations:**

- **DocumentDbDocumentWriter**: Azure Cosmos DB for MongoDB API
- **Future**: Azure Cosmos DB NoSQL (Core) API, PostgreSQL, etc.

**Conflict Resolution Strategies:**

1. **Skip**: Insert new documents, skip existing ones
2. **Overwrite**: Replace existing documents, insert new ones (upsert)
3. **Abort**: Stop on first conflict
4. **GenerateNewIds**: Remove original \_id, insert with new database-generated IDs

**Example:**

```typescript
const writer = new DocumentDbDocumentWriter(client, targetDb, targetCollection, config);

const result = await writer.writeDocuments(documents, {
  progressCallback: (count) => console.log(`Processed ${count}`),
  abortSignal: abortController.signal,
});

console.log(`Inserted: ${result.insertedCount}, Collided: ${result.collidedCount}`);
```

---

### StreamDocumentWriter (Utility Class)

**Purpose:** Coordinate streaming with automatic buffer management

**Key Features:**

- Automatic buffer flushing based on writer constraints
- Progress tracking with strategy-specific details
- Error handling based on conflict resolution strategy
- Statistics aggregation across multiple flushes

**Example:**

```typescript
const streamer = new StreamDocumentWriter(writer);

const result = await streamer.streamDocuments(
  { conflictResolutionStrategy: ConflictResolutionStrategy.Skip },
  documentStream,
  {
    onProgress: (count, details) => {
      console.log(`Processed ${count} - ${details}`);
    },
    abortSignal: abortController.signal,
  },
);

console.log(`Total: ${result.totalProcessed}, Flushes: ${result.flushCount}`);
```

---

### BaseDocumentWriter (Abstract Base Class)

**Purpose:** Provide shared logic for all DocumentWriter implementations

**Key Features:**

- **Adaptive Batching**: Dual-mode operation (Fast/RU-limited)
- **Retry Logic**: Exponential backoff for throttle and network errors
- **Mode Switching**: Auto-detect RU limits and adjust parameters
- **Conflict Handling**: Dual-path approach (primary + fallback)
- **Progress Tracking**: Incremental updates via callbacks

**Abstract Methods (Database-Specific):**

- `writeWithSkipStrategy()`
- `writeWithOverwriteStrategy()`
- `writeWithAbortStrategy()`
- `writeWithGenerateNewIdsStrategy()`
- `extractDetailsFromError()`
- `extractConflictDetails()`
- `classifyError()`

---

## Buffer Flow Architecture

### Overview

The Data API uses a multi-level buffering strategy to optimize throughput while respecting memory and database constraints.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                        BUFFER FLOW ARCHITECTURE                              │
│                    From Source Database to Target Database                   │
└──────────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────────┐
│  LEVEL 1: SOURCE DATABASE                                                  │
│  • Millions of documents                                                   │
│  • Documents: 1 KB - XX MB each                                            │
└────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ AsyncIterable<DocumentDetails>
                                    │ (Streaming, O(1) memory)
                                    ▼
┌────────────────────────────────────────────────────────────────────────────┐
│  LEVEL 2: DOCUMENTREADER                                                   │
│  • streamDocuments() → AsyncIterable                                       │
│  • No buffering - pure streaming                                           │
│  • Memory: O(1) - only current document                                    │
└────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ Stream one document at a time
                                    ▼
╔════════════════════════════════════════════════════════════════════════════╗
║  LEVEL 3: STREAMDOCUMENTWRITER BUFFER (Main Memory Buffer)                ║
║                                                                            ║
║  ┌──────────────────────────────────────────────────────────────────────┐ ║
║  │  In-Memory Buffer: DocumentDetails[]                                │ ║
║  │  ┌────────────────────────────────────────────────────────────────┐ │ ║
║  │  │  Document 1 (estimated: 2 KB)                                  │ │ ║
║  │  │  Document 2 (estimated: 5 KB)                                  │ │ ║
║  │  │  Document 3 (estimated: 1 KB)                                  │ │ ║
║  │  │  ...                                                            │ │ ║
║  │  │  Document N (estimated: 3 KB)                                  │ │ ║
║  │  └────────────────────────────────────────────────────────────────┘ │ ║
║  │                                                                      │ ║
║  │  BUFFER CONSTRAINTS (from writer.getBufferConstraints()):           │ ║
║  │  • optimalDocumentCount: 100 - 2,000 (adaptive)                    │ ║
║  │  • maxMemoryMB: 24 MB (conservative limit)                         │ ║
║  │                                                                      │ ║
║  │  FLUSH TRIGGERS (whichever comes first):                            │ ║
║  │  ✓ buffer.length >= optimalDocumentCount                           │ ║
║  │  ✓ bufferMemoryEstimate >= maxMemoryMB * 1024 * 1024              │ ║
║  │                                                                      │ ║
║  │  MEMORY ESTIMATION:                                                 │ ║
║  │  • JSON.stringify(doc.documentContent).length * 2                  │ ║
║  │  • Accounts for UTF-16 encoding (2 bytes per char)                 │ ║
║  │  • Fallback: 1 KB if serialization fails                           │ ║
║  └──────────────────────────────────────────────────────────────────────┘ ║
╚════════════════════════════════════════════════════════════════════════════╝
                                    │
                                    │ When flush triggered
                                    │ (count OR memory limit reached)
                                    ▼
┌────────────────────────────────────────────────────────────────────────────┐
│  LEVEL 4: DOCUMENTWRITER BATCH PROCESSING                                  │
│  • Receives full buffer from StreamDocumentWriter                          │
│  • May sub-batch if buffer > currentBatchSize                             │
│  • Applies retry logic and adaptive batch sizing                           │
│                                                                             │
│  ADAPTIVE BATCH SIZING:                                                    │
│  ┌──────────────────────────────────────────────────────────────────────┐ │
│  │  FAST MODE (Default - Unlimited throughput)                          │ │
│  │  • Initial batch: 500 documents                                      │ │
│  │  • Growth rate: 20% per success                                      │ │
│  │  • Maximum: 2,000 documents                                          │ │
│  │  • Target: vCore, local MongoDB, self-hosted                         │ │
│  └──────────────────────────────────────────────────────────────────────┘ │
│                                   │                                         │
│                                   │ First throttle detected                 │
│                                   ▼                                         │
│  ┌──────────────────────────────────────────────────────────────────────┐ │
│  │  RU-LIMITED MODE (Auto-switch on throttle)                           │ │
│  │  • Initial batch: 100 documents                                      │ │
│  │  • Growth rate: 10% per success                                      │ │
│  │  • Maximum: 1,000 documents                                          │ │
│  │  • Target: Azure Cosmos DB RU-based                                  │ │
│  └──────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
│  RETRY LOGIC:                                                              │
│  • Throttle errors: Exponential backoff, shrink batch, switch mode        │
│  • Network errors: Exponential backoff (1s → 5s max)                      │
│  • Conflict errors: Handle based on strategy                              │
│  • Other errors: Throw immediately (no retry)                             │
└────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ Sub-batch if needed
                                    │ (batch <= currentBatchSize)
                                    ▼
╔════════════════════════════════════════════════════════════════════════════╗
║  LEVEL 5: DATABASE-SPECIFIC WIRE PROTOCOL                                 ║
║  (Example shown: DocumentDbDocumentWriter → MongoDB API)                  ║
║                                                                            ║
║  ┌──────────────────────────────────────────────────────────────────────┐ ║
║  │  MongoDB Wire Protocol:                                              │ ║
║  │  • BSON encoding of documents                                        │ ║
║  │  • Protocol overhead (~1-2 KB per message)                           │ ║
║  │  • Wire message limit: ~48 MB (hard limit)                           │ ║
║  │                                                                       │ ║
║  │  ENCODING CONSIDERATIONS:                                            │ ║
║  │  • BSON format: Binary encoding with type metadata                  │ ║
║  │  • Protocol headers: Command structure, collection name (~1-2 KB)   │ ║
║  │                                                                       │ ║
║  │  Wire message safety calculation (24 MB buffer):                     │ ║
║  │  • Buffer estimate: 24 MB (JSON serialization estimate)             │ ║
║  │  • BSON encoding: Similar size (binary but includes metadata)       │ ║
║  │  • Protocol headers: ~1-2 KB                                         │ ║
║  │  • Total wire size: ~24-26 MB ✓ (well under 48 MB limit)           │ ║
║  └──────────────────────────────────────────────────────────────────────┘ ║
║                                                                            ║
║  NOTE: Other database implementations will have different protocols:      ║
║  • Azure Cosmos DB NoSQL API: REST/HTTPS with JSON (no BSON)             ║
║  • PostgreSQL: Binary protocol with COPY command                          ║
║  • Each implementation handles its own wire protocol constraints          ║
╚════════════════════════════════════════════════════════════════════════════╝
                                    │
                                    │ Database-specific wire transmission
                                    ▼
┌────────────────────────────────────────────────────────────────────────────┐
│  LEVEL 6: TARGET DATABASE                                                  │
│  • Documents inserted/updated based on conflict strategy                   │
│  • Returns operation statistics (inserted, matched, upserted, etc.)        │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## Buffer Memory Constraints

### Conservative Limits

The Data API uses conservative memory limits to ensure reliable operation across different environments:

```
┌────────────────────────────────────────────────────────────────────────────┐
│                     MEMORY CONSTRAINT RATIONALE                            │
└────────────────────────────────────────────────────────────────────────────┘

StreamDocumentWriter Buffer:
├─ maxMemoryMB: 24 MB (conservative)
│  ├─ Measurement errors: JSON estimate vs actual encoding
│  ├─ Object overhead: V8 internal structures
│  └─ Safety margin: Prevent OOM errors

Database Wire Protocol Limits (implementation-specific):
├─ MongoDB API: 48 MB per message (hard limit)
│  ├─ BSON encoding: Binary with type metadata (similar size to JSON)
│  ├─ Protocol headers: Command structure, collection name (~1-2 KB)
│  └─ Safety calculation: 24 MB buffer + 2 KB headers ≈ 24-26 MB ✓
│
├─ Azure Cosmos DB NoSQL API: Variable (typically ~2 MB per request)
│  ├─ REST/HTTPS: JSON over HTTP (no BSON)
│  └─ Recommendation: Smaller batches for better latency
│
└─ PostgreSQL COPY: Limited by memory and network buffers
   └─ CSV format: Text-based, similar to JSON size

Adaptive Batch Size:
├─ Fast Mode: Up to 2,000 documents
│  └─ Typical size: 2,000 × 1 KB = 2 MB (well under 24 MB)
└─ RU-Limited Mode: Up to 1,000 documents
   └─ Typical size: 1,000 × 1 KB = 1 MB (conservative)
```

### Buffer Scenarios

**Scenario 1: Small Documents (1 KB average)**

```
Buffer fills by DOCUMENT COUNT first:
• optimalDocumentCount: 2,000 docs (Fast Mode)
• Estimated memory: 2,000 × 1 KB = 2 MB
• Well under 24 MB limit ✓
• Flush trigger: Document count (2,000 docs)
```

**Scenario 2: Medium Documents (20 KB average)**

```
Buffer fills by DOCUMENT COUNT first:
• optimalDocumentCount: 2,000 docs (Fast Mode)
• Estimated memory: 2,000 × 20 KB = 40 MB
• EXCEEDS 24 MB limit at ~1,200 docs
• Flush trigger: Memory limit (24 MB, ~1,200 docs)
```

**Scenario 3: Large Documents (500 KB average)**

```
Buffer fills by MEMORY LIMIT first:
• optimalDocumentCount: 2,000 docs (Fast Mode)
• Estimated memory: 2,000 × 500 KB = 1,000 MB
• EXCEEDS 24 MB limit at ~48 docs
• Flush trigger: Memory limit (24 MB, ~48 docs)
```

**Scenario 4: Mixed Sizes (1 KB - 16 MB)**

```
Buffer fills dynamically:
• Small docs: Added until count or memory limit
• Large doc (e.g., 16 MB): Triggers immediate flush
• Flush trigger: Whichever limit hit first
```

---

## Dual-Mode Adaptive Batching

### Optimization Strategy

The writer uses dual-mode operation to optimize for different database environments:

```
┌────────────────────────────────────────────────────────────────────────────┐
│                      DUAL-MODE ADAPTIVE BATCHING                           │
└────────────────────────────────────────────────────────────────────────────┘

START (All operations begin here)
│
├─ Mode: FAST MODE (Default)
│  ├─ Initial batch: 500 documents
│  ├─ Growth rate: 20% per success
│  ├─ Maximum: 2,000 documents
│  └─ Target environments:
│     ├─ Azure Cosmos DB for MongoDB vCore (70%)
│     ├─ Local MongoDB (15%)
│     └─ Self-hosted MongoDB (10%)
│
├─ Growth pattern (Fast Mode):
│  │  Batch 1: 500 docs  (1.0s)
│  │  Batch 2: 600 docs  (1.2s)  ← 20% growth
│  │  Batch 3: 720 docs  (1.4s)  ← 20% growth
│  │  Batch 4: 864 docs  (1.7s)  ← 20% growth
│  │  Batch 5: 1,037→1,000 (2.0s) ← Hit max in some modes
│  │  Batch 6+: 2,000 docs (2.0s) ← Maximum batch size
│  └─ Result: ~4x faster than RU mode
│
└─ First throttle detected → ONE-WAY SWITCH
   │
   ├─ Mode: RU-LIMITED MODE
   │  ├─ Initial batch: 100 documents
   │  ├─ Growth rate: 10% per success
   │  ├─ Maximum: 1,000 documents
   │  └─ Target environments:
   │     └─ Azure Cosmos DB RU-based (5%)
   │
   ├─ Batch size adjustment after switch:
   │  ├─ If proven capacity ≤ 100: Use proven capacity
   │  └─ If proven capacity > 100: Start at 100, grow later
   │
   └─ Growth pattern (RU-Limited Mode):
      │  Batch 1: 100 docs  (1.0s)
      │  Batch 2: 110 docs  (1.1s)  ← 10% growth
      │  Batch 3: 121 docs  (1.2s)  ← 10% growth
      │  ...
      │  Batch N: 1,000 docs (10.0s) ← Maximum batch size
      └─ Result: Optimized for throttled environment
```

### Mode Transition Example

```typescript
// Operation starts in Fast mode
writer.currentMode = FAST_MODE;
writer.currentBatchSize = 500;

// Batch 1: 500 docs → Success → Grow to 600
// Batch 2: 600 docs → Success → Grow to 720
// Batch 3: 720 docs → THROTTLE DETECTED!

// Mode switch triggered
writer.switchToRuLimitedMode(400); // 400 docs succeeded before throttle

// Result:
// - Mode: RU_LIMITED_MODE
// - Batch size: 100 (proven capacity 400 > 100, so start conservative)
// - Max batch: 1,000 (down from 2,000)
// - Growth: 10% (down from 20%)

// Subsequent batches
// Batch 4: 100 docs → Success → Grow to 110
// Batch 5: 110 docs → Success → Grow to 121
// ... (continues in RU-limited mode)
```

---

## Conflict Resolution Strategies

### Strategy Comparison

| Strategy           | Behavior                   | Use Case             | Statistics Tracked          |
| ------------------ | -------------------------- | -------------------- | --------------------------- |
| **Skip**           | Insert new, skip existing  | Incremental sync     | inserted, skipped           |
| **Overwrite**      | Replace or insert (upsert) | Full sync, updates   | matched, modified, upserted |
| **Abort**          | Stop on first conflict     | Strict validation    | inserted, errors            |
| **GenerateNewIds** | New IDs for all documents  | Duplicate collection | inserted                    |

### Skip Strategy

**Flow:**

1. Pre-filter conflicts by querying for existing \_id values
2. Insert only non-conflicting documents
3. Return skipped documents in errors array
4. Continue processing despite conflicts

**Note:** Pre-filtering is a performance optimization. Conflicts can still occur due to concurrent writes, handled by fallback path.

**Example:**

```typescript
// MongoDB API implementation
async writeWithSkipStrategy(documents) {
  // Performance optimization: Pre-filter
  const { docsToInsert, conflictIds } = await this.preFilterConflicts(documents);

  // Insert non-conflicting documents
  const result = await collection.insertMany(docsToInsert);

  // Return collided documents in errors array (primary path)
  return {
    insertedCount: result.insertedCount,
    collidedCount: conflictIds.length,
    processedCount: result.insertedCount + conflictIds.length,
    errors: conflictIds.map(id => ({
      documentId: id,
      error: new Error('Document already exists (skipped)')
    }))
  };
}
```

### Overwrite Strategy

**Flow:**

1. Use bulkWrite with replaceOne + upsert:true
2. Replace existing documents or insert new ones
3. Return matched, modified, and upserted counts

**Example:**

```typescript
// MongoDB API implementation
async writeWithOverwriteStrategy(documents) {
  const bulkOps = documents.map(doc => ({
    replaceOne: {
      filter: { _id: doc._id },
      replacement: doc,
      upsert: true
    }
  }));

  const result = await collection.bulkWrite(bulkOps);

  return {
    matchedCount: result.matchedCount,
    modifiedCount: result.modifiedCount,
    upsertedCount: result.upsertedCount,
    processedCount: result.matchedCount + result.upsertedCount
  };
}
```

### Abort Strategy

**Flow (Primary Path - Recommended):**

1. Insert documents using insertMany
2. Catch BulkWriteError with duplicate key errors (code 11000)
3. Extract conflict details and return in errors array
4. Include processedCount showing documents inserted before conflict

**Flow (Fallback Path):**

- If conflicts are thrown instead of returned, retry loop catches them
- Provides robustness for race conditions and unknown unique indexes

**Example:**

```typescript
// MongoDB API implementation
async writeWithAbortStrategy(documents) {
  try {
    const result = await collection.insertMany(documents);
    return {
      insertedCount: result.insertedCount,
      processedCount: result.insertedCount
    };
  } catch (error) {
    // Primary path: Handle expected conflicts
    if (isBulkWriteError(error) && hasDuplicateKeyError(error)) {
      return {
        insertedCount: error.insertedCount ?? 0,
        processedCount: error.insertedCount ?? 0,
        errors: extractConflictErrors(error) // Detailed conflict info
      };
    }
    // Fallback: Throw unexpected errors for retry logic
    throw error;
  }
}
```

### GenerateNewIds Strategy

**Flow:**

1. Remove \_id from each document
2. Store original \_id in backup field (\_original_id or \_original_id_N)
3. Insert documents (database generates new \_id values)
4. Return insertedCount

**Example:**

```typescript
// MongoDB API implementation
async writeWithGenerateNewIdsStrategy(documents) {
  const transformed = documents.map(doc => {
    const { _id, ...docWithoutId } = doc;
    const backupField = findAvailableFieldName(doc); // Avoid collisions
    return { ...docWithoutId, [backupField]: _id };
  });

  const result = await collection.insertMany(transformed);

  return {
    insertedCount: result.insertedCount,
    processedCount: result.insertedCount
  };
}
```

---

## Error Classification and Handling

### Error Types

```typescript
type ErrorType = 'throttle' | 'network' | 'conflict' | 'other';
```

**Classification Logic:**

1. **Throttle**: Rate limiting errors
   - Codes: 429, 16500
   - Messages: "rate limit", "throttl", "too many requests"
   - Handling: Exponential backoff, shrink batch, switch to RU mode

2. **Network**: Connection and timeout errors
   - Codes: ECONNRESET, ETIMEDOUT, ENOTFOUND, ENETUNREACH
   - Messages: "timeout", "network", "connection"
   - Handling: Exponential backoff retry (1s → 5s max)

3. **Conflict**: Duplicate key errors
   - Codes: 11000 (MongoDB duplicate key)
   - Handling: Based on conflict resolution strategy

4. **Other**: All other errors
   - Handling: Throw immediately (no retry)

### Retry Flow

```
┌────────────────────────────────────────────────────────────────┐
│                      RETRY FLOW DIAGRAM                        │
└────────────────────────────────────────────────────────────────┘

Write Attempt
     │
     ├─ Success
     │  ├─ Extract progress
     │  ├─ Report progress callback
     │  ├─ Grow batch size (if no conflicts)
     │  └─ Continue to next batch
     │
     └─ Error → classifyError()
        │
        ├─ THROTTLE
        │  ├─ Switch to RU-limited mode (if in Fast mode)
        │  ├─ Extract partial counts from error
        │  ├─ Shrink batch size to proven capacity
        │  ├─ Wait with exponential backoff
        │  └─ Retry with smaller batch
        │
        ├─ NETWORK
        │  ├─ Wait with exponential backoff
        │  └─ Retry same batch
        │
        ├─ CONFLICT
        │  ├─ Extract conflict details
        │  ├─ Handle based on strategy:
        │  │  ├─ Skip: Log conflicts, continue
        │  │  └─ Abort: Return errors, stop
        │  └─ Continue or stop based on strategy
        │
        └─ OTHER
           └─ Throw error immediately (no retry)
```

### Exponential Backoff

```typescript
// Backoff formula
delay = min(base * multiplier^attempt, maxDelay) + jitter

// Parameters
base = 1000ms
multiplier = 1.5
maxDelay = 5000ms
jitter = ±30% of calculated delay

// Example delays
Attempt 0: ~1000ms ± 300ms = 700-1300ms
Attempt 1: ~1500ms ± 450ms = 1050-1950ms
Attempt 2: ~2250ms ± 675ms = 1575-2925ms
Attempt 3+: ~5000ms ± 1500ms = 3500-6500ms (capped)
```

**Why jitter?** Prevents thundering herd when multiple clients retry simultaneously.

---

## Progress Tracking

### Multi-Level Progress Reporting

```
┌────────────────────────────────────────────────────────────────┐
│                  PROGRESS TRACKING FLOW                        │
└────────────────────────────────────────────────────────────────┘

Task Level (CopyPasteCollectionTask)
    │
    ├─ Counts total documents: 10,000
    │
    └─ Creates StreamDocumentWriter with onProgress callback
       │
       │  StreamDocumentWriter Level
       │     │
       │     ├─ Maintains running totals:
       │     │  ├─ totalProcessed
       │     │  ├─ totalInserted
       │     │  ├─ totalCollided
       │     │  ├─ totalMatched
       │     │  └─ totalUpserted
       │     │
       │     └─ Calls DocumentWriter with progressCallback
       │        │
       │        │  DocumentWriter Level
       │        │     │
       │        │     ├─ Reports incremental progress:
       │        │     │  ├─ After each successful write
       │        │     │  ├─ After throttle with partial success
       │        │     │  └─ During retry loops
       │        │     │
       │        │     └─ Callback: count → StreamDocumentWriter
       │        │                │
       │        │                └─ Increments totals
       │        │                   │
       │        │                   └─ Callback: count, details → Task
       │        │                              │
       │        │                              └─ Updates UI: "Processed 500 - 450 inserted, 50 skipped"
       │
       └─ Final result with aggregated statistics

Progress Update Examples:

Skip Strategy:
  "Processed 500 - 450 inserted, 50 skipped"
  "Processed 1000 - 900 inserted, 100 skipped"

Overwrite Strategy:
  "Processed 500 - 300 matched, 200 upserted"
  "Processed 1000 - 600 matched, 400 upserted"

Abort/GenerateNewIds Strategy:
  "Processed 500 - 500 inserted"
  "Processed 1000 - 1000 inserted"
```

### Progress Callback Contract

```typescript
// DocumentWriter progressCallback
// Called during write operation for incremental updates
progressCallback?: (processedInBatch: number) => void;

// StreamDocumentWriter onProgress
// Called after each flush with formatted details
onProgress?: (processedCount: number, details?: string) => void;

// Task progress update
// Updates VS Code progress UI
updateProgress(percentage: number, message: string): void;
```

---

## Telemetry and Statistics

### Collected Metrics

```typescript
// StreamDocumentWriter adds to action context
actionContext.telemetry.measurements.streamTotalProcessed = totalProcessed;
actionContext.telemetry.measurements.streamTotalInserted = totalInserted;
actionContext.telemetry.measurements.streamTotalCollided = totalCollided;
actionContext.telemetry.measurements.streamTotalMatched = totalMatched;
actionContext.telemetry.measurements.streamTotalUpserted = totalUpserted;
actionContext.telemetry.measurements.streamFlushCount = flushCount;

// DocumentWriter could add mode transition metrics
actionContext.telemetry.properties.initialMode = 'fast';
actionContext.telemetry.properties.finalMode = 'ru-limited';
actionContext.telemetry.measurements.throttleCount = throttleCount;
actionContext.telemetry.measurements.modeSwitch Batch = 3; // Batch number when switched
```

### Statistics Validation

StreamDocumentWriter validates that incremental progress matches final counts:

```typescript
// During flush
let processedInFlush = 0;
const result = await writer.writeDocuments(buffer, {
  progressCallback: (count) => {
    processedInFlush += count; // Track incremental updates
  },
});

// After flush - validation
if (processedInFlush !== result.processedCount) {
  // Log warning - expected for Skip strategy with pre-filtering
  // where same documents may be reported multiple times during retries
  ext.outputChannel.warn(`Incremental (${processedInFlush}) !== Final (${result.processedCount})`);
}
```

**Why validation?** Helps identify issues in progress reporting vs final statistics, especially for strategies with pre-filtering.

---

## Extending the API

### Creating a New Database Implementation

To support a new database (e.g., Azure Cosmos DB NoSQL API), extend BaseDocumentWriter:

```typescript
export class CosmosDbNoSqlWriter extends BaseDocumentWriter<string> {
  constructor(
    private readonly client: CosmosClient,
    databaseName: string,
    containerName: string,
    conflictStrategy: ConflictResolutionStrategy,
  ) {
    super(databaseName, containerName, conflictStrategy);
  }

  // Implement conflict resolution strategies
  protected async writeWithSkipStrategy(documents: DocumentDetails[]): Promise<StrategyWriteResult<string>> {
    // Cosmos DB NoSQL API implementation
    // Use query to find existing items
    // Insert only non-existing items
    // Return skipped items in errors array
  }

  protected async writeWithOverwriteStrategy(documents: DocumentDetails[]): Promise<StrategyWriteResult<string>> {
    // Use upsertItem for each document
    // Return matched/upserted counts
  }

  protected async writeWithAbortStrategy(documents: DocumentDetails[]): Promise<StrategyWriteResult<string>> {
    // Use createItem with failIfExists
    // Catch 409 Conflict errors
    // Return conflict details in errors array
  }

  protected async writeWithGenerateNewIdsStrategy(documents: DocumentDetails[]): Promise<StrategyWriteResult<string>> {
    // Remove id property
    // Store original id in backup field
    // Insert with auto-generated ids
  }

  // Implement error handling
  protected classifyError(error: unknown): ErrorType {
    // Cosmos DB NoSQL error codes:
    // 429: Throttle
    // 408/503: Network
    // 409: Conflict
    if (error.statusCode === 429) return 'throttle';
    if (error.statusCode === 408 || error.statusCode === 503) return 'network';
    if (error.statusCode === 409) return 'conflict';
    return 'other';
  }

  protected extractDetailsFromError(error: unknown): ProcessedDocumentsDetails | undefined {
    // Parse Cosmos DB error response
    // Extract activity ID, request charge, retry after, etc.
  }

  protected extractConflictDetails(error: unknown): Array<{ documentId?: string; error: Error }> {
    // Extract resource ID from 409 Conflict error
  }

  // Implement collection management
  public async ensureTargetExists(): Promise<EnsureTargetExistsResult> {
    // Check if container exists
    // Create container if needed
  }
}
```

### Usage Pattern

```typescript
// Create writer for new database
const writer = new CosmosDbNoSqlWriter(cosmosClient, databaseName, containerName, ConflictResolutionStrategy.Skip);

// Use with StreamDocumentWriter (no changes needed!)
const streamer = new StreamDocumentWriter(writer);
const result = await streamer.streamDocuments(config, documentStream, options);
```

---

## Performance Considerations

### Throughput Optimization

**Fast Mode (Default):**

- Optimizes for unlimited throughput environments
- 4x faster than RU-limited mode for large datasets
- Auto-switches on first throttle detection

**RU-Limited Mode:**

- Optimizes for provisioned throughput environments
- Conservative growth prevents excessive throttling
- Respects proven capacity to minimize retries

### Memory Efficiency

**Streaming Architecture:**

- DocumentReader: O(1) memory (pure streaming)
- StreamDocumentWriter: O(buffer size) ≈ 24 MB max
- DocumentWriter: O(batch size) ≈ 2-20 MB typical
- Total: ~50 MB peak for entire pipeline

**Comparison to Naive Approach:**

- Naive: Load all documents into memory = O(n) = Potentially GBs
- Streaming: Constant memory = O(1) = ~50 MB

### Network Efficiency

**Batching Benefits:**

- Reduces round trips (1 batch vs N individual operations)
- Amortizes connection overhead
- Maximizes throughput utilization

**Adaptive Sizing:**

- Grows batch size when throughput available
- Shrinks batch size when throttled
- Balances throughput vs responsiveness

---

## Best Practices

### For Task Implementers

1. **Use StreamDocumentWriter** for automatic buffer management
2. **Provide progress callbacks** for user feedback
3. **Handle StreamWriterError** for Abort/Overwrite strategies
4. **Pass ActionContext** for telemetry
5. **Respect AbortSignal** for cancellation

### For Database Implementers

1. **Return conflicts in errors array** (primary path), don't throw
2. **Throw only unexpected errors** for retry logic
3. **Extract partial counts from errors** for accurate progress
4. **Classify errors correctly** for appropriate retry behavior
5. **Pre-filter conflicts** in Skip strategy for performance
6. **Log detailed error information** for debugging

### For API Consumers

1. **Don't load all documents into memory** - use streaming
2. **Monitor progress callbacks** for long operations
3. **Handle cancellation gracefully** via AbortSignal
4. **Choose appropriate conflict strategy** for use case
5. **Trust adaptive batching** - don't override constraints
