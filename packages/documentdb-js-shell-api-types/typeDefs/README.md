# DocumentDB Shell API Type Definitions

## About this file

`documentdb-shell-api.d.ts` provides TypeScript type definitions for the
DocumentDB query playground IntelliSense experience. It declares the shell API surface
available in `.documentdb.js` query playground files, enabling autocompletion, hover
documentation, and signature help via VS Code's built-in TypeScript language
service.

## How the API surface was determined

Azure DocumentDB is a fully managed database service that uses the MongoDB wire
protocol for compatibility. As stated in the
[official compatibility documentation](https://learn.microsoft.com/en-us/azure/documentdb/compatibility-query-language):

> "Client-side wrapper functions, such as `deleteMany()` and `updateMany()`,
> internally invoke the corresponding server commands (`delete()` and
> `update()`). Any function that relies on supported server commands is
> compatible with Azure DocumentDB."

The methods included in this file were **manually selected** to provide a
productive query playground editing experience. The selection criteria:

1. **Server command support**: Each method maps to a server-side command listed
   as supported (✅) in the Azure DocumentDB compatibility matrix. For example,
   `collection.find()` maps to the `find` command, `collection.insertOne()` maps
   to `insert`, `collection.updateOne()` maps to `update`, etc.

2. **Common usage patterns**: Methods were chosen based on the most common
   operations users perform in the query playground environment — querying,
   inserting, updating, deleting, indexing, and aggregation.

3. **Deliberately excluded**: Methods that map to unsupported or not-applicable
   server commands were omitted. For instance, `mapReduce()` (deprecated),
   replication commands, and certain sharding operations that are managed by the
   Azure platform are not included.

## Reference documentation

The following Azure DocumentDB compatibility pages were used as the source of
truth for determining supported operations:

- **MQL compatibility (operators, commands, indexes)**:
  https://learn.microsoft.com/en-us/azure/documentdb/compatibility-query-language
- **Feature compatibility**:
  https://learn.microsoft.com/en-us/azure/documentdb/compatibility-features
- **MQL commands reference**:
  https://learn.microsoft.com/en-us/azure/documentdb/commands/
- **MQL operators reference**:
  https://learn.microsoft.com/en-us/azure/documentdb/operators/

## JSDoc content

All JSDoc descriptions in the `.d.ts` file are **original writing** authored for
this extension. They describe the same operations using our own wording and
DocumentDB terminology.

## Maintenance

When Azure DocumentDB adds support for new operations or deprecates existing
ones, this file should be updated to match. Refer to the compatibility pages
listed above for the current support matrix.
