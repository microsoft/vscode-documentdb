# Task Service Architecture

Technical documentation for the Task Service framework, which provides long-running background task management for the DocumentDB VS Code extension.

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Core Components](#core-components)
4. [Task Lifecycle](#task-lifecycle)
5. [Resource Tracking](#resource-tracking)
6. [Progress Reporting](#progress-reporting)
7. [Data API](#data-api)
8. [Implementing Tasks](#implementing-tasks)
9. [Design Decisions](#design-decisions)
10. [File Structure](#file-structure)

---

## Overview

The Task Service provides a framework for managing long-running background operations in VS Code. It handles:

- **Task lifecycle management** (start, stop, state transitions)
- **Progress reporting** to VS Code progress notifications
- **Resource conflict detection** (preventing concurrent operations on same collections)
- **Telemetry integration** for observability
- **Graceful cancellation** via AbortSignal

The primary use case is the **Copy-and-Paste Collection** feature, which streams documents between databases with adaptive batching, retry logic, and progress reporting.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           TASK SERVICE ARCHITECTURE                         │
└─────────────────────────────────────────────────────────────────────────────┘

                              ┌────────────────────┐
                              │   VS Code Command  │
                              │  (copyCollection)  │
                              └─────────┬──────────┘
                                        │
                                        ▼
┌───────────────────────────────────────────────────────────────────────────┐
│                           TaskServiceManager                              │
│  ─────────────────────────────────────────────────────────────────────    │
│  • Singleton registry of all tasks                                        │
│  • Progress notification coordination                                     │
│  • Resource conflict checking                                             │
│  • Task lookup and management                                             │
└─────────────────────────────────┬─────────────────────────────────────────┘
                                  │ registerTask()
                                  ▼
┌───────────────────────────────────────────────────────────────────────────┐
│                              Task (Abstract)                              │
│  ─────────────────────────────────────────────────────────────────────    │
│  • State machine (Pending → Running → Completed/Failed/Stopped)           │
│  • AbortController for cancellation                                       │
│  • Event emitters (onDidChangeState, onDidChangeStatus)                   │
│  • Telemetry context propagation                                          │
│  │                                                                        │
│  │ Template Method Pattern:                                               │
│  ├─ start() → onInitialize() → doWork()                                   │
│  └─ stop() → triggers AbortSignal                                         │
└─────────────────────────────────┬─────────────────────────────────────────┘
                                  │ extends
                                  ▼
┌───────────────────────────────────────────────────────────────────────────┐
│                        CopyPasteCollectionTask                            │
│  ─────────────────────────────────────────────────────────────────────    │
│  • Implements ResourceTrackingTask interface                              │
│  • Coordinates DocumentReader and StreamingDocumentWriter                 │
│  • Maps streaming progress to task progress                               │
│  • Handles StreamingWriterError for partial statistics                    │
└───────────────────────────────────────────────────────────────────────────┘
                    │                               │
                    ▼                               ▼
        ┌───────────────────┐           ┌───────────────────────────┐
        │  DocumentReader   │           │  StreamingDocumentWriter  │
        │  (Source)         │           │  (Target)                 │
        └───────────────────┘           └───────────────────────────┘
```

---

## Core Components

### Task (Abstract Base Class)

**Location:** `taskService.ts`

The `Task` class implements the template method pattern for consistent lifecycle management. Subclasses only need to implement business logic.

**Key Responsibilities:**

- State machine management with defined transitions
- AbortController integration for graceful cancellation
- Event emission for UI updates
- Telemetry context propagation

**State Machine:**

```
                    ┌──────────────────────────────────────┐
                    │                                      │
                    ▼                                      │
┌─────────┐     ┌────────────┐     ┌─────────┐     ┌──────┴────┐
│ Pending │ ──► │Initializing│ ──► │ Running │ ──► │ Completed │
└─────────┘     └──────┬─────┘     └────┬────┘     └───────────┘
                       │                │
                       │                │ (abort/error)
                       │                ▼
                       │           ┌─────────┐     ┌─────────┐
                       └──────────►│Stopping │ ──► │ Stopped │
                                   └─────────┘     └─────────┘
                                        │
                                        ▼
                                   ┌─────────┐
                                   │ Failed  │
                                   └─────────┘
```

**Protected Methods for Subclasses:**

| Method             | Purpose                                   | When Called            |
| ------------------ | ----------------------------------------- | ---------------------- |
| `onInitialize()`   | Setup before main work (count docs, etc.) | After `start()` called |
| `doWork()`         | Main business logic                       | After initialization   |
| `updateProgress()` | Report progress (0-100) with message      | During `doWork()`      |
| `updateStatus()`   | Update state machine (internal use)       | Managed by base class  |

### TaskServiceManager (Singleton)

**Location:** `taskService.ts`

Manages the registry of all tasks and coordinates with VS Code's progress API.

**Key Responsibilities:**

- Task registration and lookup
- Resource conflict checking before task start
- Progress notification lifecycle
- Task event forwarding

### ResourceTrackingTask (Interface)

**Location:** `taskServiceResourceTracking.ts`

Interface for tasks that use database resources (collections, databases). Enables conflict detection.

```typescript
interface ResourceTrackingTask {
  getUsedResources(): ResourceDefinition[];
}

interface ResourceDefinition {
  connectionId: string;
  databaseName: string;
  collectionName?: string;
}
```

---

## Task Lifecycle

### 1. Task Creation

```typescript
const task = new CopyPasteCollectionTask(config, reader, writer);
```

- Task starts in `Pending` state
- AbortController is created
- Unique ID is generated

### 2. Task Registration

```typescript
TaskServiceManager.registerTask(task);
```

- Task is added to registry
- Resource conflict check is performed
- If conflict exists, registration fails

### 3. Task Start

```typescript
await task.start();
```

**Initialization Phase:**

1. State transitions to `Initializing`
2. `onInitialize()` is called with AbortSignal and telemetry context
3. Task can count documents, ensure target exists, etc.
4. Telemetry event `taskService.taskInitialization` is recorded

**Execution Phase:**

1. State transitions to `Running`
2. `doWork()` is called with AbortSignal and telemetry context
3. Progress updates flow through `updateProgress()`
4. Telemetry event `taskService.taskExecution` is recorded

### 4. Task Completion

**Success:**

- State transitions to `Completed`
- Final message includes current progress details
- Output channel logs success with `✓` prefix

**Abort (user-initiated):**

- `stop()` triggers AbortController
- State transitions to `Stopping` → `Stopped`
- Final message preserves last progress for context
- Output channel logs with `■` prefix

**Failure:**

- State transitions to `Failed`
- Error is captured in TaskStatus
- Output channel logs with `!` prefix

### 5. Progress Notification

The `TaskServiceManager` shows a VS Code progress notification:

```
[Cancel] Copying "myCollection" from "source" to "target"
         45% - Processed 450 of 1000 documents - 450 inserted
```

Progress is updated via `updateProgress()` which:

1. Updates internal status
2. Fires `onDidChangeStatus` event
3. Manager updates VS Code progress notification

---

## Resource Tracking

### Purpose

Prevents concurrent operations on the same database resources (e.g., two tasks copying to the same collection).

### How It Works

```typescript
// Task declares its resources
class CopyPasteCollectionTask implements ResourceTrackingTask {
  getUsedResources(): ResourceDefinition[] {
    return [
      { connectionId: 'src', databaseName: 'db1', collectionName: 'col1' },
      { connectionId: 'tgt', databaseName: 'db2', collectionName: 'col2' },
    ];
  }
}

// Manager checks for conflicts before registration
if (hasResourceConflict(newTask, existingTasks)) {
  throw new Error('Resource conflict detected');
}
```

### Conflict Rules

- Same `connectionId` + `databaseName` + `collectionName` = **Conflict**
- Operations on different collections in same database = **OK**
- Read-only operations currently use same conflict model (conservative)

---

## Progress Reporting

### Two-Layer Progress Flow

```
StreamingDocumentWriter                    Task                        VS Code
        │                                   │                            │
        │ onProgress(count, details)        │                            │
        │──────────────────────────────────►│                            │
        │                                   │ updateProgress(%, msg)     │
        │                                   │───────────────────────────►│
        │                                   │                            │
        │                                   │ [onDidChangeStatus event]  │
        │                                   │───────────────────────────►│
        │                                   │                            │ notification.report()
```

### Progress Message Format

The progress message includes strategy-specific details:

```
Skip:           "Processed 500 of 5546 documents (9%) - 450 inserted, 50 skipped"
Overwrite:      "Processed 500 of 5546 documents (9%) - 300 replaced, 200 created"
GenerateNewIds: "Processed 500 of 5546 documents (9%) - 500 inserted"
Abort:          "Processed 500 of 5546 documents (9%) - 500 inserted"
```

### Immediate Progress Reporting

During throttle recovery, partial progress is reported immediately (not batched):

```
[StreamingWriter] Throttle: wrote 9 docs, 491 remaining in batch
[CopyPasteTask] onProgress: 0% (9/5546 docs) - 9 inserted
```

This ensures users see continuous progress even under heavy throttling.

---

## Data API

The Data API provides the document streaming and writing infrastructure. See [`data-api/README.md`](./data-api/README.md) for complete documentation.

### Key Components

| Component                   | Purpose                                     |
| --------------------------- | ------------------------------------------- |
| `DocumentReader`            | Streams documents from source (O(1) memory) |
| `StreamingDocumentWriter`   | Abstract base class for streaming writes    |
| `DocumentDbStreamingWriter` | MongoDB/DocumentDB implementation           |
| `BatchSizeAdapter`          | Adaptive batching (fast/RU-limited modes)   |
| `RetryOrchestrator`         | Exponential backoff for transient failures  |
| `WriteStats`                | Statistics aggregation                      |

### Conflict Resolution Strategies

| Strategy           | Behavior                          | Use Case          |
| ------------------ | --------------------------------- | ----------------- |
| **Skip**           | Skip existing documents, continue | Incremental sync  |
| **Overwrite**      | Replace existing (upsert)         | Full data refresh |
| **Abort**          | Stop on first conflict            | Strict validation |
| **GenerateNewIds** | Generate new `_id` values         | Duplicating data  |

### Pre-filtering Optimization (Skip Strategy)

For the **Skip** strategy, the writer performs a pre-filtering step **once** before the retry loop to efficiently identify which documents already exist in the target:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     PRE-FILTER FLOW (Skip Strategy)                         │
└─────────────────────────────────────────────────────────────────────────────┘

writeBatchWithRetry() receives [doc1, doc2, doc3, doc4, doc5]
           │
           ▼
┌──────────────────────────────────────┐
│ 1. Pre-filter (ONCE before retries)  │
│    Query target: which IDs exist?    │
│    Result: doc2, doc4 already exist  │
└──────────────────────────────────────┘
           │
           ├──► Report skipped immediately: {skipped: 2}
           │
           ▼
┌──────────────────────────────────────┐
│ 2. Retry loop (only insertable docs) │
│    [doc1, doc3, doc5] → insert       │
│    Throttle? → slice & retry         │
└──────────────────────────────────────┘
           │
           ▼
       Final result
```

This optimization:

- **Reduces redundant queries**: Existing IDs are checked once, not on every retry
- **Accurate progress reporting**: Skipped documents are reported immediately
- **Handles race conditions**: The insert still handles rare conflicts (documents inserted after pre-filter)

---

## Implementing Tasks

### Minimal Task Implementation

```typescript
class MyTask extends Task {
  readonly type = 'my-task';
  readonly name = 'My Task Name';

  protected async doWork(signal: AbortSignal, context: IActionContext): Promise<void> {
    for (let i = 0; i < 100; i++) {
      if (signal.aborted) return;

      // Do work...
      this.updateProgress(i, `Processing item ${i}`);
    }
  }
}
```

### Task with Initialization

```typescript
class MyTask extends Task {
  readonly type = 'my-task';
  readonly name = 'My Task Name';

  protected async onInitialize(signal: AbortSignal, context: IActionContext): Promise<void> {
    // Count items, validate config, etc.
    this.totalItems = await this.countItems();

    // Add telemetry
    context.telemetry.measurements.totalItems = this.totalItems;
  }

  protected async doWork(signal: AbortSignal, context: IActionContext): Promise<void> {
    // Main work using this.totalItems...
  }
}
```

### Task with Resource Tracking

```typescript
class MyTask extends Task implements ResourceTrackingTask {
  readonly type = 'my-task';
  readonly name = 'My Task Name';

  getUsedResources(): ResourceDefinition[] {
    return [
      {
        connectionId: this.config.connectionId,
        databaseName: this.config.databaseName,
        collectionName: this.config.collectionName,
      },
    ];
  }

  protected async doWork(signal: AbortSignal, context: IActionContext): Promise<void> {
    // Work that uses the declared resources...
  }
}
```

---

## Design Decisions

### Why Template Method Pattern?

The `Task` base class uses the template method pattern (`start()` calls `onInitialize()` then `doWork()`) for several reasons:

1. **Consistent lifecycle**: All tasks have the same state transitions
2. **Centralized telemetry**: Base class wraps phases in telemetry contexts
3. **Error handling**: Base class catches errors and updates state appropriately
4. **Abort handling**: Signal propagation is automatic

### Why Separate Initialization Phase?

The `onInitialize()` phase exists because:

1. **Progress denominator**: Tasks often need to count items before starting (for accurate %)
2. **Target preparation**: Create target collections before streaming begins
3. **Validation**: Fail fast before starting expensive operations
4. **Telemetry separation**: Track initialization time separately from work time

### Why Resource Tracking as Interface?

Resource tracking is an interface (`ResourceTrackingTask`) rather than built into `Task` because:

1. **Not all tasks need it**: Some tasks don't use database resources
2. **Interface segregation**: Keep `Task` focused on lifecycle
3. **Type safety**: TypeScript can distinguish resource-tracking tasks

### Why Immediate Progress Reporting?

During throttle recovery, progress is reported immediately (not accumulated) because:

1. **User feedback**: Users see continuous progress even under heavy throttling
2. **Accurate stats**: Partial progress is reflected in final statistics
3. **Abort responsiveness**: Progress updates check abort signal

### Why Preserve Message on Stop?

When a task is stopped, the final message includes the last progress state:

```
"Task stopped. Processed 500 of 5546 documents (9%) - 500 inserted"
```

This provides context about what was accomplished before stopping.

### Why Single Buffer in StreamingDocumentWriter?

The writer uses a single buffer (not two-level buffering) because:

1. **Simplicity**: One buffer size to reason about
2. **Adaptive sizing**: Buffer size adapts based on throttle responses
3. **Memory predictability**: Clear memory limits without hidden second buffer

---

## File Structure

```
src/services/taskService/
├── README.md                           # This documentation
├── taskService.ts                      # Task base class + TaskServiceManager
├── taskService.test.ts                 # Task lifecycle tests
├── taskServiceResourceTracking.ts      # Resource conflict detection
├── taskServiceResourceTracking.test.ts
├── resourceUsageHelper.ts              # Memory monitoring utilities
├── data-api/                           # Document streaming infrastructure
│   ├── README.md                       # Data API documentation
│   ├── types.ts                        # Public interfaces
│   ├── readers/
│   │   ├── BaseDocumentReader.ts       # Abstract reader (see JSDoc for diagrams)
│   │   ├── DocumentDbDocumentReader.ts # MongoDB/DocumentDB implementation
│   │   └── KeepAliveOrchestrator.ts    # Isolated keep-alive logic
│   └── writers/
│       ├── StreamingDocumentWriter.ts  # Abstract writer (see JSDoc for diagrams)
│       ├── StreamingDocumentWriter.test.ts # Comprehensive tests
│       ├── DocumentDbStreamingWriter.ts # MongoDB/DocumentDB implementation
│       ├── writerTypes.internal.ts     # Internal types (PreFilterResult, etc.)
│       ├── BatchSizeAdapter.ts         # Adaptive batching
│       ├── RetryOrchestrator.ts        # Retry logic
│       └── WriteStats.ts               # Statistics aggregation
└── tasks/
    ├── DemoTask.ts                     # Simple example task
    └── copy-and-paste/
        ├── CopyPasteCollectionTask.ts  # Main copy-paste task
        └── copyPasteConfig.ts          # Configuration types
```

---

## Telemetry

### Naming Convention

**Base class properties** use `task_` prefix:

- `task_id`, `task_type`, `task_name`
- `task_phase` (initialization/execution)
- `task_final_state` (completed/stopped/failed)

**Implementation properties** use domain names:

- `sourceCollectionSize`, `targetWasCreated`
- `conflictResolution`, `totalProcessedDocuments`

### Events

| Event                            | Phase          | Properties                       |
| -------------------------------- | -------------- | -------------------------------- |
| `taskService.taskInitialization` | Initialization | task\_\*, source/target metadata |
| `taskService.taskExecution`      | Execution      | task\_\*, processing stats       |

---

## Error Handling

### StreamingWriterError

When a write operation fails, `StreamingWriterError` captures partial statistics:

```typescript
try {
  await writer.streamDocuments(stream, config, options);
} catch (error) {
  if (error instanceof StreamingWriterError) {
    // error.partialStats contains what was processed before failure
    context.telemetry.measurements.processedBeforeError = error.partialStats.totalProcessed;
  }
  throw error;
}
```

### Task Failure Notifications

When a task transitions to `Failed`, the framework handles failure reporting centrally:

1. **Error logging**: The `Task` base class automatically logs the error to the output channel via `ext.outputChannel.error()` — task authors do NOT need to do this manually.
2. **User notification**: The `TaskProgressReportingService` automatically shows an error notification with a **"Show Output"** button, allowing the user to view error details on demand.
3. **No auto-show**: The output channel is NOT opened automatically — this avoids disrupting the user's workflow. The user can choose to view it via the button.

Task authors do **not** need to:

- Call `ext.outputChannel.show()` on failure
- Show their own error notifications via `vscode.window.showErrorMessage()`

Both are handled by the framework. If a task needs custom failure behavior (e.g., logging additional context), it can handle errors in `doWork()` before re-throwing.

### Error Classification

The `StreamingDocumentWriter` classifies errors for retry decisions:

| Type        | Behavior           | Examples                 |
| ----------- | ------------------ | ------------------------ |
| `throttle`  | Retry with backoff | HTTP 429, MongoDB 16500  |
| `network`   | Retry with backoff | ECONNRESET, ETIMEDOUT    |
| `conflict`  | Handle by strategy | Duplicate key (11000)    |
| `validator` | No retry           | Schema validation errors |
| `other`     | No retry           | Unknown errors           |
