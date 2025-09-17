<!-- Learn More Section Badge or Breadcrumb -->

> **Learn More** - [Back to Learn More Index](./index.md)

---

# Copy and Paste Collections

The **Copy and Paste** feature in DocumentDB for VS Code provides a convenient way to move smaller datasets between collections, whether they are on the same server or across different connections. It is designed for quick, ad-hoc data transfers directly within the VS Code environment.

**Table of Contents**

- [How It Works](#how-it-works)
- [Important Considerations](#important-considerations)
- [Step-by-Step Guide](#step-by-step-guide)
  - [Flow 1: Paste into a Database (Create a New Collection)](#flow-1-paste-into-a-database-create-a-new-collection)
  - [Flow 2: Paste into an Existing Collection](#flow-2-paste-into-an-existing-collection)
- [For True Data Migrations](#for-true-data-migrations)

## How It Works

The copy-and-paste process is designed to be efficient for smaller collections by streaming data through your local machine. Here’s a step-by-step breakdown of the process:

1.  **Data Streaming**: The extension initiates a stream from the source collection, reading documents one by one.
2.  **In-Memory Buffering**: Documents are collected into a buffer in your computer's memory.
3.  **Bulk Write Operation**: Once the buffer is full, the extension performs a bulk write operation to the target collection. This is more efficient than writing documents one at a time.
4.  **Continuous Cycle**: This process repeats - refilling the buffer from the source and writing to the target - until all documents from the source collection have been copied.

This method avoids loading the entire collection into memory at once, making it suitable for collections that are moderately sized.

## Important Considerations

### Not a Snapshot Copy

The copy-and-paste operation is **not an atomic snapshot**. It is a live data transfer. If documents are being written to the source collection while the copy process is running, it is possible that only a subset of the new data will be copied. This feature is best used for moving smaller, relatively static datasets.

### Large Collection Warnings

Because this feature streams data through your local machine, it can be slow and resource-intensive for very large collections. To prevent accidental performance issues, the extension will show a warning for collections that exceed a certain size.

You can customize this behavior in the settings:

- **`documentDB.copyPaste.showLargeCollectionWarning`**: (Default: `true`) Set to `false` to disable the warning entirely.
- **`documentDB.copyPaste.largeCollectionWarningThreshold`**: (Default: `100000`) Adjust the number of documents that triggers the warning.

> For more details on handling large datasets, see the section on [For True Data Migrations](#for-true-data-migrations).

---

## Step-by-Step Guide

The process is guided by a wizard that adapts based on your target, providing two main flows.

### Flow 1: Paste into a Database (Create a New Collection)

This flow is triggered when you right-click a database in the Connections view and select `Paste Collection`.

#### Step 1: Large Collection Warning (Optional)

If the source collection contains a large number of documents, a warning dialog will appear first.

> This warning can be disabled or its threshold adjusted in the extension settings, as noted in the [Important Considerations](#important-considerations) section.

#### Step 2: Name the New Collection

You will be prompted to provide a name for the new collection.

#### Step 3: Confirmation

A final summary is displayed, showing the source and target details, including the new collection name. You must confirm to start the operation.

### Flow 2: Paste into an Existing Collection

This flow is triggered when you right-click an existing collection in the Connections View and select `Paste Collection`.

#### Step 1: Large Collection Warning (Optional)

If the source collection contains a large number of documents, a warning dialog will appear first.

> This warning can be disabled or its threshold adjusted in the extension settings, as noted in the [Important Considerations](#important-considerations) section.

#### Step 2: Choose a Conflict Resolution Strategy

Because you are merging documents into a collection that may already contain data, you must decide how to handle documents from the source that have the same `_id` as documents in the target.

You will be prompted to choose one of four strategies:

##### 1. **Abort on Conflict**

- **What it does**: The copy operation stops after processing the batch that contains the first document with a duplicate `_id`. Within that batch, all documents that do not have a duplicate `_id` will be inserted. Any documents inserted from previous batches will also remain. The operation is not rolled back.
- **Use case**: When you want to stop the process on the first conflict, accepting that some data may have already been transferred.
- **Example**: Target has a document:

  ```json
  { "_id": 3, "data": "original-three" }
  ```

  A batch of source documents is being processed:

  ```json
  [
    { "_id": 1, "data": "one" },
    { "_id": 2, "data": "two" },
    { "_id": 3, "data": "three" }
  ]
  ```

- **Result**: A conflict is detected for the document with `_id: 3`. The documents with `_id: 1` and `_id: 2` from the batch are inserted into the target collection. The copy operation then aborts. The target collection will contain the newly inserted documents and its original data. There is no automatic cleanup.

##### 2. **Skip Conflicting Documents**

- **What it does**: If a document with a duplicate `_id` is found, the source document is ignored, and the operation continues with the next document.
- **Use case**: When you want to merge new documents but leave existing ones untouched.
- **Example**: Target has a document:

  ```json
  { "_id": 1, "data": "original" }
  ```

  Source has documents:

  ```json
  { "_id": 1, "data": "new" }
  { "_id": 2, "data": "fresh" }
  ```

- **Result**: The document with `_id: 1` is skipped. The document with `_id: 2` is inserted.
  The target collection will contain
  ```json
  { "_id": 1, "data": "original" }
  { "_id": 2, "data": "fresh" }
  ```

##### 3. **Overwrite Existing Documents**

- **What it does**: If a document with a duplicate `_id` is found, the existing document in the target collection is replaced with the document from the source.
- **Use case**: When you want to update existing documents with fresh data from the source.
- **Example**: Target has a document:

  ```json
  { "_id": 1, "data": "original" }
  ```

  Source has a document:

  ```json
  { "_id": 1, "data": "new" }
  ```

- **Result**: The document with `_id: 1` in the target is replaced. The target collection will contain
  ```json
  { "_id": 1, "data": "new" }
  ```

##### 4. **Generate New IDs for All Documents**

- **What it does**: Ignores `_id` conflicts entirely by generating a new, unique `_id` for **every document** copied from the source. The original `_id` is preserved in a new field with a prefix `_original_id`.
- **Use case**: When you want to duplicate a collection's data without losing the reference to the original IDs. This is useful for creating copies for testing or development.
- **Example**: Target has a document:

  ```json
  { "_id": 1, "data": "original" }
  ```

  Source has a document:

  ```json
  { "_id": 1, "data": "new" }
  ```

- **Result**: A new document is inserted into the target with a brand new `_id`. The inserted document will look like:
  ```js
  { "_id": ObjectId("..."), "_original_id": 1, "data": "new" }
  ```
  The original document in the target remains untouched.

#### Step 3: Confirmation

A final summary is displayed, showing the source, the target, and the chosen conflict resolution strategy. You must confirm to start the operation.

---

## For True Data Migrations

The copy-and-paste feature is a developer convenience, not a dedicated migration tool. For production-level data migrations, especially those involving large datasets, complex transformations, or the need for data verification, a specialized migration service is strongly recommended.

Dedicated migration tools offer significant advantages:

- **Performance**: They often run directly within the data center, avoiding the need to transfer data through your local machine. This dramatically reduces network latency and external traffic costs.
- **Reliability**: They provide features like assessments, data validation, and better error handling to ensure a successful migration.
- **Migration Types**: They support both **offline migrations** (where the source database is taken offline) and **online migrations** (which allow the source application to continue running during the migration with minimal downtime).
- **Scalability**: Built to handle terabytes of data efficiently.

### Professional Data Migrations

The best tool often depends on your data source, target, and migration requirements. An internet search for "DocumentDB migrations" will provide a variety of options. Many cloud platforms and database vendors offer dedicated migration tools that are optimized for performance, reliability, and scale.

For example, Microsoft provides guidance on migrating between different versions of its own services, such as from Azure Cosmos DB for MongoDB (RU) to the vCore-based service:
[Migrate from Azure Cosmos DB for MongoDB (RU) to Azure Cosmos DB for MongoDB (vCore)](https://learn.microsoft.com/en-us/azure/cosmos-db/mongodb/how-to-migrate-vcore)

Before starting any significant migration, it is important to perform a thorough requirements analysis. For critical or large-scale projects, seeking professional help from migration specialists can ensure a successful outcome.
