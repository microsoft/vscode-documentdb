# MongoDB Connection String Parameters: Duplicate Key Behavior

This document explains which MongoDB connection string parameters can have multiple values (appear as duplicate keys) and which cannot, based on the official MongoDB specifications and driver implementations.

## Summary

According to the [MongoDB Connection String Specification](https://github.com/mongodb/specifications/blob/master/source/connection-string/connection-string-spec.md), most connection string parameters follow a "last value wins" behavior when a key appears multiple times. However, there are specific parameters that are **explicitly designed to accept multiple values**.

## Parameters That Can Have Multiple Values (Whitelist)

### 1. `readPreferenceTags`

- **Purpose**: Specifies ordered tag sets for read preference to select replica set members
- **Behavior**: Each occurrence adds another element to the tag set list; order matters
- **Example**: 
  ```
  ?readPreference=secondary&readPreferenceTags=dc:ny,rack:1&readPreferenceTags=dc:ny&readPreferenceTags=
  ```
- **Source**: 
  - [MongoDB Connection String Specification - Lists](https://github.com/mongodb/specifications/blob/master/source/connection-string/connection-string-spec.md#values)
  - [MongoDB Java Driver Documentation](https://mongodb.github.io/mongo-java-driver/3.12/javadoc/com/mongodb/ConnectionString.html)
  - [libmongoc Documentation](https://mongoc.org/libmongoc/1.23.0/mongoc_read_prefs_t.html)

**Note**: An empty value for `readPreferenceTags=` means "match any secondary as a last resort" and should always be last if you want that fallback.

## Parameters That Cannot Have Multiple Values

For all other connection string parameters, if a key appears multiple times, **the last value wins** according to the MongoDB specification. This means:

- Only the final occurrence of the parameter is used
- Earlier occurrences are ignored
- This is standard URI behavior

### Common Parameters (Last Value Wins)

The following are common parameters that **cannot** be duplicated meaningfully:

- `ssl` / `tls` - Enable/disable TLS connection
- `appName` - Application identifier for logging and profiling
- `replicaSet` - Replica set name
- `authSource` - Authentication database
- `authMechanism` - Authentication mechanism
- `retryWrites` - Enable/disable retryable writes
- `retryReads` - Enable/disable retryable reads
- `w` - Write concern
- `journal` - Journal write concern
- `wtimeoutMS` - Write timeout
- `maxPoolSize` - Maximum connection pool size
- `minPoolSize` - Minimum connection pool size
- `maxIdleTimeMS` - Maximum idle time for pooled connections
- `connectTimeoutMS` - Connection timeout
- `socketTimeoutMS` - Socket timeout
- `serverSelectionTimeoutMS` - Server selection timeout
- `readPreference` - Read preference mode (note: different from `readPreferenceTags`)
- `compressors` - Comma-separated list of compressor names (single value, but contains comma-separated items)

**Source**: 
- [MongoDB Connection String Specification - Repeated Keys](https://github.com/mongodb/specifications/blob/master/source/connection-string/connection-string-spec.md#repeated-keys)
- [MongoDB Connection String Options](https://www.mongodb.com/docs/manual/reference/connection-string-options/)

## Special Cases

### `compressors`

While `compressors` accepts multiple compressor types (e.g., `compressors=snappy,zlib,zstd`), it is **not a duplicate key scenario**. The parameter appears once with a comma-separated list of values.

**Example**: `?compressors=snappy,zlib` (correct) vs. `?compressors=snappy&compressors=zlib` (incorrect, last value wins)

### `authMechanismProperties`

Accepts comma-separated key:value pairs as a single parameter value, not as duplicate keys.

**Example**: `?authMechanismProperties=TOKEN_RESOURCE:mongodb://foo,SOME_KEY:value`

## Implications for Deduplication Logic

Based on this research, connection string deduplication should:

1. **For `readPreferenceTags`**: Preserve all unique values in order
2. **For all other parameters**: Remove exact duplicate key=value pairs (same key with same value)
3. **For conflicting values** (same key, different values): Keep only the last value, as per MongoDB specification

## Driver Implementation

The `mongodb-connection-string-url` npm package (version ~3.0.2 used in this project) implements this behavior through the WhatWG URL API:

- `searchParams.get(key)` returns the **last value** for a key
- `searchParams.getAll(key)` returns **all values** as an array
- `searchParams.set(key, value)` replaces all occurrences with a single value

**Source**: [mongodb-connection-string-url on npm](https://www.npmjs.com/package/mongodb-connection-string-url)

## Azure Cosmos DB for MongoDB Considerations

Azure Cosmos DB's MongoDB API follows the same connection string specification. Using duplicate parameters (e.g., `appName=Name1&appName=Name2`) results in undefined behavior, and only the last value is used.

**Source**: [Microsoft Documentation - Connect to Azure Cosmos DB with MongoDB API](https://learn.microsoft.com/en-us/azure/cosmos-db/mongodb/connect-account)

## Recommendations

1. **Avoid duplicate parameters** in connection strings except for `readPreferenceTags`
2. **Document warnings** when duplicate parameters are detected (except `readPreferenceTags`)
3. **Implement safe deduplication** that:
   - Preserves multiple `readPreferenceTags` values
   - Removes exact duplicate key=value pairs for other parameters
   - Warns users when conflicting values exist (same key, different values)

## References

1. [MongoDB Connection String Specification](https://github.com/mongodb/specifications/blob/master/source/connection-string/connection-string-spec.md)
2. [MongoDB Connection String Options](https://www.mongodb.com/docs/manual/reference/connection-string-options/)
3. [MongoDB Java Driver - ConnectionString](https://mongodb.github.io/mongo-java-driver/3.12/javadoc/com/mongodb/ConnectionString.html)
4. [libmongoc - Read Preferences](https://mongoc.org/libmongoc/1.23.0/mongoc_read_prefs_t.html)
5. [mongodb-connection-string-url npm package](https://www.npmjs.com/package/mongodb-connection-string-url)
6. [Connection String Specification - WhatWG URL API](https://specifications.readthedocs.io/en/latest/connection-string/connection-string-spec/)
