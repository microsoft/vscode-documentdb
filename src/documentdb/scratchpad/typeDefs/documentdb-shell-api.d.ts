/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// =============================================================================
// DocumentDB Shell API Type Definitions
//
// This file declares the shell API surface available in DocumentDB scratchpad
// (.documentdb) files. It is loaded by the TypeScript language service to
// provide autocompletion, hover docs, and signature help.
//
// IMPORTANT:
//   - All JSDoc content is original writing — not copied from MongoDB docs.
//   - Only DocumentDB-supported methods are included.
//   - This file is the single source of truth for the scratchpad shell API.
//   - When full MongoDB API support is added, a separate .d.ts can be swapped in.
// =============================================================================

// ---------------------------------------------------------------------------
// BSON Types (used as return types)
// ---------------------------------------------------------------------------

/** A 12-byte unique identifier commonly used as `_id` values. */
declare class ObjectId {
    constructor(hexString?: string);
    /** Returns the 24-character hex representation. */
    toString(): string;
    /** Returns the ObjectId as a hex string. */
    toHexString(): string;
    /** Returns the Date the ObjectId was generated. */
    getTimestamp(): Date;
    /** Checks equality with another ObjectId. */
    equals(other: ObjectId): boolean;
}

/** A 128-bit universally unique identifier (RFC 4122). */
declare class UUID {
    constructor(hexString?: string);
    toString(): string;
}

/** A 32-bit signed integer. */
declare class Int32 {
    constructor(value: number);
    valueOf(): number;
}

/** A 64-bit signed integer. */
declare class Long {
    constructor(low: number, high?: number);
    valueOf(): number;
    toString(): string;
}

/** A 128-bit decimal floating-point value (IEEE 754). */
declare class Decimal128 {
    constructor(value: string);
    toString(): string;
}

/** A 64-bit double-precision floating-point value. */
declare class Double {
    constructor(value: number);
    valueOf(): number;
}

/** An internal timestamp type used by the replication log. */
declare class Timestamp {
    constructor(low: number, high: number);
}

/** A binary data container. */
declare class Binary {
    constructor(buffer: unknown, subType?: number);
}

/** A BSON regular expression. */
declare class BSONRegExp {
    constructor(pattern: string, flags?: string);
}

/** Represents the smallest possible BSON value for comparisons. */
declare class MinKey {
    constructor();
}

/** Represents the largest possible BSON value for comparisons. */
declare class MaxKey {
    constructor();
}

/** A reference to a document in another collection. */
declare class DBRef {
    constructor(collection: string, id: ObjectId, db?: string);
}

/** An executable JavaScript code value stored in BSON. */
declare class Code {
    constructor(code: string, scope?: object);
}

// ---------------------------------------------------------------------------
// BSON Constructor Functions (shell globals)
// ---------------------------------------------------------------------------

/**
 * Creates a new ObjectId.
 * @param hexString Optional 24-character hex string. Generates a new ID if omitted.
 * @example ObjectId("507f1f77bcf86cd799439011")
 */
declare function ObjectId(hexString?: string): ObjectId;

/**
 * Creates a new UUID.
 * @param hexString Optional UUID hex string. Generates a new UUID if omitted.
 * @example UUID("123e4567-e89b-12d3-a456-426614174000")
 */
declare function UUID(hexString?: string): UUID;

/**
 * Parses a date string into a Date object. Equivalent to `new Date(dateString)`.
 * @param dateString An ISO 8601 date string. Uses current time if omitted.
 * @example ISODate("2025-01-15T00:00:00Z")
 */
declare function ISODate(dateString?: string): Date;

/**
 * Creates a 32-bit integer value.
 * @param value The numeric value or string representation.
 * @example NumberInt(42)
 */
declare function NumberInt(value?: number | string): Int32;

/**
 * Creates a 64-bit integer value.
 * @param value The numeric value or string representation.
 * @example NumberLong(9007199254740993)
 */
declare function NumberLong(value?: number | string): Long;

/**
 * Creates a 128-bit decimal value for high-precision arithmetic.
 * @param value A string representation of the decimal number.
 * @example NumberDecimal("0.1")
 */
declare function NumberDecimal(value?: string): Decimal128;

/**
 * Creates a Timestamp value.
 * @example Timestamp(0, 0)
 */
declare function Timestamp(low: number, high: number): Timestamp;

/**
 * Creates a binary data value.
 * @example BinData(0, "ZGF0YQ==")
 */
declare function BinData(subType: number, base64: string): Binary;

/**
 * Creates a hex binary data value.
 * @example HexData(0, "48656C6C6F")
 */
declare function HexData(subType: number, hex: string): Binary;

/**
 * Creates a BSON regular expression.
 * @example BSONRegExp("^test", "i")
 */
declare function BSONRegExp(pattern: string, flags?: string): BSONRegExp;

/**
 * Creates a MD5 binary data value.
 * @example MD5("abc123")
 */
declare function MD5(hex: string): Binary;

/**
 * Creates a MinKey value for comparison operations.
 * @example MinKey()
 */
declare function MinKey(): MinKey;

/**
 * Creates a MaxKey value for comparison operations.
 * @example MaxKey()
 */
declare function MaxKey(): MaxKey;

/**
 * Creates a Double value.
 * @example Double(3.14)
 */
declare function Double(value: number): Double;

/**
 * Creates a Code value.
 * @example Code("function() { return 1; }")
 */
declare function Code(code: string, scope?: object): Code;

/**
 * Creates a DBRef (database reference) value.
 * @example DBRef("collectionName", ObjectId("..."))
 */
declare function DBRef(collection: string, id: ObjectId, db?: string): DBRef;

// ---------------------------------------------------------------------------
// Shell Globals
// ---------------------------------------------------------------------------

/** The current database object. Use `db.<collection>` to access collections. */
declare const db: DocumentDBDatabase;

/**
 * Switches the current database context.
 * @param database The name of the database to switch to.
 * @example use("myDatabase")
 */
declare function use(database: string): void;

/**
 * Displays help information about available shell commands and methods.
 * @example help()
 */
declare function help(): void;

/**
 * Prints values to the output. Accepts any number of arguments.
 * @example print("Count:", 42)
 */
declare function print(...args: unknown[]): void;

/**
 * Prints a value in formatted JSON to the output.
 * @example printjson({ name: "test" })
 */
declare function printjson(...args: unknown[]): void;

/**
 * Pauses execution for the specified number of milliseconds.
 * @param ms Duration in milliseconds.
 * @example sleep(1000)
 */
declare function sleep(ms: number): void;

/**
 * Returns the shell version string.
 * @example version()
 */
declare function version(): string;

// ---------------------------------------------------------------------------
// EJSON utility
// ---------------------------------------------------------------------------

/** Utilities for working with Extended JSON (EJSON) serialization. */
declare const EJSON: {
    /**
     * Serializes a value to an Extended JSON string.
     * @param value The value to serialize.
     * @param options Formatting options.
     * @example EJSON.stringify({ _id: ObjectId("...") })
     */
    stringify(value: unknown, options?: { relaxed?: boolean; indent?: number | string }): string;

    /**
     * Parses an Extended JSON string back into a JavaScript value.
     * @param text The EJSON string to parse.
     * @example EJSON.parse('{"$oid": "507f1f77bcf86cd799439011"}')
     */
    parse(text: string): unknown;
};

// ---------------------------------------------------------------------------
// Result Types
// ---------------------------------------------------------------------------

/** Result returned by an insertOne operation. */
interface InsertOneResult {
    /** Whether the operation was acknowledged by the server. */
    acknowledged: boolean;
    /** The _id of the inserted document. */
    insertedId: ObjectId;
}

/** Result returned by an insertMany operation. */
interface InsertManyResult {
    /** Whether the operation was acknowledged by the server. */
    acknowledged: boolean;
    /** A map of the index to the _id of each inserted document. */
    insertedIds: { [index: number]: ObjectId };
}

/** Result returned by an updateOne or updateMany operation. */
interface UpdateResult {
    /** Whether the operation was acknowledged by the server. */
    acknowledged: boolean;
    /** The number of documents matched by the filter. */
    matchedCount: number;
    /** The number of documents modified. */
    modifiedCount: number;
    /** The number of documents upserted. */
    upsertedCount: number;
    /** The _id of the upserted document, if applicable. */
    upsertedId: ObjectId | null;
}

/** Result returned by a deleteOne or deleteMany operation. */
interface DeleteResult {
    /** Whether the operation was acknowledged by the server. */
    acknowledged: boolean;
    /** The number of documents deleted. */
    deletedCount: number;
}

/** Result returned by a bulkWrite operation. */
interface BulkWriteResult {
    /** Whether the operation was acknowledged by the server. */
    acknowledged: boolean;
    insertedCount: number;
    matchedCount: number;
    modifiedCount: number;
    deletedCount: number;
    upsertedCount: number;
    insertedIds: { [index: number]: ObjectId };
    upsertedIds: { [index: number]: ObjectId };
}

// ---------------------------------------------------------------------------
// Database Interface
// ---------------------------------------------------------------------------

/**
 * Represents the current database. Access collections via `db.<name>` or
 * `db.getCollection("<name>")`.
 */
interface DocumentDBDatabase {
    /**
     * Returns a collection object for the specified name.
     * @param name The collection name.
     * @example db.getCollection("users")
     */
    getCollection(name: string): DocumentDBCollection;

    /**
     * Returns an array of collection names in the current database.
     * @example db.getCollectionNames()
     */
    getCollectionNames(): string[];

    /**
     * Returns metadata about collections. Optionally filter by name or options.
     * @param filter Optional filter document.
     * @param nameOnly When true, returns only collection names.
     * @example db.getCollectionInfos()
     */
    getCollectionInfos(filter?: object, nameOnly?: boolean): object[];

    /**
     * Creates a new collection in the current database.
     * @param name The name of the collection to create.
     * @param options Optional creation options (e.g. capped, size).
     * @example db.createCollection("logs", { capped: true, size: 10000 })
     */
    createCollection(name: string, options?: object): object;

    /**
     * Drops the current database and all its collections.
     * @example db.dropDatabase()
     */
    dropDatabase(): object;

    /**
     * Executes a database command directly.
     * @param command The command document.
     * @example db.runCommand({ ping: 1 })
     */
    runCommand(command: object): object;

    /**
     * Executes a command against the admin database.
     * @param command The command document.
     * @example db.adminCommand({ listDatabases: 1 })
     */
    adminCommand(command: object): object;

    /**
     * Runs a database-level aggregation pipeline.
     * @param pipeline An array of aggregation stage documents.
     * @example db.aggregate([{ $listLocalSessions: {} }])
     */
    aggregate(pipeline: object[]): DocumentDBAggregationCursor;

    /**
     * Switches the database context to another database on the same cluster.
     * @param database The name of the target database.
     * @example db.getSiblingDB("admin")
     */
    getSiblingDB(database: string): DocumentDBDatabase;

    /**
     * Returns the name of the current database.
     * @example db.getName()
     */
    getName(): string;

    /**
     * Returns storage statistics for the current database.
     * @param options Optional statistics options or scale factor.
     * @example db.stats()
     */
    stats(options?: object): object;

    /**
     * Returns the server version string.
     * @example db.version()
     */
    version(): string;

    /**
     * Creates a read-only view backed by an aggregation pipeline.
     * @param name The name of the view to create.
     * @param source The source collection name.
     * @param pipeline The aggregation pipeline for the view.
     * @example db.createView("activeUsers", "users", [{ $match: { active: true } }])
     */
    createView(name: string, source: string, pipeline: object[]): object;

    /**
     * Lists available database commands.
     * @example db.listCommands()
     */
    listCommands(): object;

    /**
     * Access a collection by name. Equivalent to `db.getCollection(name)`.
     * @example db.users.find({})
     * @example db["my-collection"].find({})
     */
    [collectionName: string]: DocumentDBCollection | ((...args: unknown[]) => unknown);
}

// ---------------------------------------------------------------------------
// Collection Interface
// ---------------------------------------------------------------------------

/** Represents a collection in the current database. */
interface DocumentDBCollection {
    /**
     * Selects documents matching the filter. Returns a cursor for further
     * refinement with `.limit()`, `.sort()`, `.skip()`, etc.
     * @param filter Optional query filter document.
     * @param projection Optional fields to include or exclude.
     * @example db.users.find({ age: { $gt: 21 } })
     * @example db.users.find({}, { name: 1, email: 1 })
     */
    find(filter?: object, projection?: object): DocumentDBFindCursor;

    /**
     * Returns the first document matching the filter, or null if none match.
     * @param filter Optional query filter document.
     * @param projection Optional fields to include or exclude.
     * @example db.users.findOne({ _id: ObjectId("...") })
     */
    findOne(filter?: object, projection?: object): object | null;

    /**
     * Inserts a single document into the collection.
     * @param document The document to insert.
     * @param options Optional insert options.
     * @example db.users.insertOne({ name: "Alice", age: 30 })
     */
    insertOne(document: object, options?: object): InsertOneResult;

    /**
     * Inserts multiple documents into the collection.
     * @param documents An array of documents to insert.
     * @param options Optional insert options (e.g. ordered).
     * @example db.users.insertMany([{ name: "Bob" }, { name: "Carol" }])
     */
    insertMany(documents: object[], options?: object): InsertManyResult;

    /**
     * Updates the first document matching the filter.
     * @param filter The selection criteria for the update.
     * @param update The update operations to apply (e.g. `{ $set: { ... } }`).
     * @param options Optional update options (e.g. upsert).
     * @example db.users.updateOne({ _id: id }, { $set: { name: "Alice" } })
     */
    updateOne(filter: object, update: object, options?: object): UpdateResult;

    /**
     * Updates all documents matching the filter.
     * @param filter The selection criteria for the update.
     * @param update The update operations to apply.
     * @param options Optional update options.
     * @example db.users.updateMany({ active: false }, { $set: { archived: true } })
     */
    updateMany(filter: object, update: object, options?: object): UpdateResult;

    /**
     * Deletes the first document matching the filter.
     * @param filter The selection criteria for deletion.
     * @param options Optional delete options.
     * @example db.users.deleteOne({ _id: id })
     */
    deleteOne(filter: object, options?: object): DeleteResult;

    /**
     * Deletes all documents matching the filter.
     * @param filter The selection criteria for deletion.
     * @param options Optional delete options.
     * @example db.logs.deleteMany({ createdAt: { $lt: ISODate("2024-01-01") } })
     */
    deleteMany(filter: object, options?: object): DeleteResult;

    /**
     * Executes an aggregation pipeline on the collection.
     * @param pipeline An array of aggregation stage documents.
     * @param options Optional aggregation options.
     * @example db.orders.aggregate([{ $match: { status: "shipped" } }, { $group: { _id: "$customer", total: { $sum: "$amount" } } }])
     */
    aggregate(pipeline: object[], options?: object): DocumentDBAggregationCursor;

    /**
     * Counts documents matching the filter using an aggregation pipeline.
     * @param filter Optional query filter document.
     * @param options Optional count options (e.g. limit, skip).
     * @example db.users.countDocuments({ active: true })
     */
    countDocuments(filter?: object, options?: object): number;

    /**
     * Returns a fast approximate count of all documents in the collection.
     * Uses collection metadata rather than scanning documents.
     * @param options Optional estimation options.
     * @example db.users.estimatedDocumentCount()
     */
    estimatedDocumentCount(options?: object): number;

    /**
     * Returns an array of distinct values for a given field.
     * @param field The field path to get distinct values for.
     * @param filter Optional query filter to limit which documents are considered.
     * @param options Optional command options.
     * @example db.users.distinct("country")
     * @example db.users.distinct("city", { country: "US" })
     */
    distinct(field: string, filter?: object, options?: object): unknown[];

    /**
     * Creates an index on the specified field(s).
     * @param keys A document specifying the index key pattern.
     * @param options Optional index creation options (e.g. unique, name).
     * @example db.users.createIndex({ email: 1 }, { unique: true })
     */
    createIndex(keys: object, options?: object): string;

    /**
     * Returns an array of documents describing the indexes on this collection.
     * @example db.users.getIndexes()
     */
    getIndexes(): object[];

    /**
     * Drops an index by name or key specification.
     * @param nameOrSpec The index name string or key specification document.
     * @example db.users.dropIndex("email_1")
     * @example db.users.dropIndex({ email: 1 })
     */
    dropIndex(nameOrSpec: string | object): object;

    /**
     * Drops the entire collection and all its documents and indexes.
     * @example db.tempData.drop()
     */
    drop(): boolean;

    /**
     * Performs multiple write operations in a single batch.
     * @param operations An array of write operation documents.
     * @param options Optional bulk write options (e.g. ordered).
     * @example db.users.bulkWrite([{ insertOne: { document: { name: "Dan" } } }])
     */
    bulkWrite(operations: object[], options?: object): BulkWriteResult;

    /**
     * Replaces a single document matching the filter with a new document.
     * @param filter The selection criteria.
     * @param replacement The replacement document (cannot contain update operators).
     * @param options Optional replace options (e.g. upsert).
     * @example db.users.replaceOne({ _id: id }, { name: "Alice", age: 31 })
     */
    replaceOne(filter: object, replacement: object, options?: object): UpdateResult;

    /**
     * Atomically finds a document matching the filter and updates it.
     * Returns the document as it was before or after the update.
     * @param filter The selection criteria.
     * @param update The update operations to apply.
     * @param options Optional options (e.g. returnDocument, upsert, projection).
     * @example db.users.findOneAndUpdate({ _id: id }, { $inc: { visits: 1 } })
     */
    findOneAndUpdate(filter: object, update: object, options?: object): object | null;

    /**
     * Atomically finds a document matching the filter and deletes it.
     * Returns the deleted document.
     * @param filter The selection criteria.
     * @param options Optional options (e.g. projection, sort).
     * @example db.users.findOneAndDelete({ _id: id })
     */
    findOneAndDelete(filter: object, options?: object): object | null;

    /**
     * Atomically finds a document matching the filter and replaces it.
     * Returns the document as it was before or after the replacement.
     * @param filter The selection criteria.
     * @param replacement The replacement document.
     * @param options Optional options (e.g. returnDocument, upsert).
     * @example db.users.findOneAndReplace({ _id: id }, { name: "Alice", age: 31 })
     */
    findOneAndReplace(filter: object, replacement: object, options?: object): object | null;

    /**
     * Returns an explainable object that provides query plan information.
     * @param verbosity Optional explain verbosity level.
     * @example db.users.explain().find({ age: { $gt: 21 } })
     */
    explain(verbosity?: string): DocumentDBCollection;

    /**
     * Renames this collection to a new name.
     * @param newName The new collection name.
     * @param dropTarget If true, drops any existing collection with the new name.
     * @example db.oldName.renameCollection("newName")
     */
    renameCollection(newName: string, dropTarget?: boolean): object;

    /**
     * Returns storage and index statistics for the collection.
     * @param options Optional statistics options.
     * @example db.users.stats()
     */
    stats(options?: object): object;

    /**
     * Returns true if the collection is a capped collection.
     * @example db.logs.isCapped()
     */
    isCapped(): boolean;
}

// ---------------------------------------------------------------------------
// Find Cursor Interface
// ---------------------------------------------------------------------------

/**
 * A cursor returned by `find()`. Supports method chaining to refine the query
 * before results are retrieved.
 */
interface DocumentDBFindCursor {
    /**
     * Limits the number of documents returned.
     * @param n Maximum number of documents.
     * @example db.users.find({}).limit(10)
     */
    limit(n: number): DocumentDBFindCursor;

    /**
     * Skips the first n documents in the result set.
     * @param n Number of documents to skip.
     * @example db.users.find({}).skip(20)
     */
    skip(n: number): DocumentDBFindCursor;

    /**
     * Specifies the sort order for the result set.
     * @param spec A document with field names as keys and 1 (ascending) or -1 (descending) as values.
     * @example db.users.find({}).sort({ age: -1 })
     */
    sort(spec: object): DocumentDBFindCursor;

    /**
     * Retrieves all remaining documents as an array.
     * @example const docs = db.users.find({}).toArray()
     */
    toArray(): object[];

    /**
     * Iterates over each document, calling the provided function.
     * @param fn A function to call for each document.
     * @example db.users.find({}).forEach(doc => print(doc.name))
     */
    forEach(fn: (doc: object) => void): void;

    /**
     * Transforms each document using the provided function and returns a new cursor.
     * @param fn A mapping function applied to each document.
     * @example db.users.find({}).map(doc => doc.name)
     */
    map(fn: (doc: object) => unknown): DocumentDBFindCursor;

    /**
     * Returns the count of documents matching the query. Deprecated in favor of `countDocuments()`.
     * @example db.users.find({ active: true }).count()
     */
    count(): number;

    /**
     * Returns the query execution plan.
     * @param verbosity Optional explain verbosity level.
     * @example db.users.find({ age: { $gt: 21 } }).explain()
     */
    explain(verbosity?: string): object;

    /**
     * Returns true if the cursor has more documents to return.
     * @example while (cursor.hasNext()) { print(cursor.next()); }
     */
    hasNext(): boolean;

    /**
     * Returns the next document from the cursor.
     * @example const doc = cursor.next()
     */
    next(): object | null;

    /**
     * Sets the number of documents to fetch in each batch from the server.
     * @param n The batch size.
     * @example db.users.find({}).batchSize(50)
     */
    batchSize(n: number): DocumentDBFindCursor;

    /**
     * Closes the cursor and releases server resources.
     * @example cursor.close()
     */
    close(): void;

    /**
     * Sets the collation options for string comparison.
     * @param spec A collation specification document.
     * @example db.users.find({}).collation({ locale: "en", strength: 2 })
     */
    collation(spec: object): DocumentDBFindCursor;

    /**
     * Instructs the query optimizer to use a specific index.
     * @param spec An index name or key pattern document.
     * @example db.users.find({}).hint({ email: 1 })
     */
    hint(spec: object | string): DocumentDBFindCursor;

    /**
     * Attaches a comment to the query for profiling and logging.
     * @param text The comment string.
     * @example db.users.find({}).comment("admin lookup")
     */
    comment(text: string): DocumentDBFindCursor;

    /**
     * Sets the maximum execution time in milliseconds for the operation.
     * @param ms Maximum time in milliseconds.
     * @example db.users.find({}).maxTimeMS(5000)
     */
    maxTimeMS(ms: number): DocumentDBFindCursor;

    /**
     * Sets the read concern level for the cursor.
     * @param level The read concern level string.
     * @example db.users.find({}).readConcern("majority")
     */
    readConcern(level: string): DocumentDBFindCursor;

    /**
     * Sets the read preference for routing the query.
     * @param mode The read preference mode.
     * @param tagSet Optional tag set for targeting specific members.
     * @example db.users.find({}).readPref("secondary")
     */
    readPref(mode: string, tagSet?: object[]): DocumentDBFindCursor;

    /**
     * Returns only the index key fields rather than the full document.
     * @example db.users.find({}).returnKey()
     */
    returnKey(): DocumentDBFindCursor;

    /**
     * Includes the internal storage engine record identifier with each document.
     * @example db.users.find({}).showRecordId()
     */
    showRecordId(): DocumentDBFindCursor;
}

// ---------------------------------------------------------------------------
// Aggregation Cursor Interface
// ---------------------------------------------------------------------------

/**
 * A cursor returned by `aggregate()`. Provides methods to consume
 * the aggregation pipeline results.
 */
interface DocumentDBAggregationCursor {
    /**
     * Retrieves all remaining documents as an array.
     * @example const results = db.orders.aggregate([...]).toArray()
     */
    toArray(): object[];

    /**
     * Iterates over each document, calling the provided function.
     * @param fn A function to call for each document.
     */
    forEach(fn: (doc: object) => void): void;

    /**
     * Returns true if the cursor has more documents to return.
     */
    hasNext(): boolean;

    /**
     * Returns the next document from the cursor.
     */
    next(): object | null;

    /**
     * Sets the number of documents to fetch in each batch from the server.
     * @param n The batch size.
     */
    batchSize(n: number): DocumentDBAggregationCursor;

    /**
     * Closes the cursor and releases server resources.
     */
    close(): void;

    /**
     * Returns the execution plan for the aggregation pipeline.
     * @param verbosity Optional explain verbosity level.
     * @example db.orders.aggregate([...]).explain()
     */
    explain(verbosity?: string): object;

    /**
     * Sets the maximum execution time in milliseconds for the operation.
     * @param ms Maximum time in milliseconds.
     */
    maxTimeMS(ms: number): DocumentDBAggregationCursor;
}
