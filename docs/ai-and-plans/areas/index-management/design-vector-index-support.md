---
area: index-management
kind: design
status: active
created: 2026-07-27
code:
    - src/webviews/documentdb/indexView/**
verified: 2026-08-14
---

# Vector index support for Index Management

**Status:** Azure DocumentDB vCore creation and listing contract manually
validated; ready for display-first implementation

**Scope:** The Index Management tab in Collection View, including creation,
listing, classification, details, validation, and command handoff.

**Primary service documentation:**

- [Integrated Vector Store - Azure DocumentDB](https://learn.microsoft.com/azure/documentdb/vector-search)
- [Half-Precision Vector Support](https://learn.microsoft.com/azure/documentdb/half-precision)
- [Product Quantization](https://learn.microsoft.com/azure/documentdb/product-quantization)
- [MongoDB Atlas Vector Search index definition](https://www.mongodb.com/docs/vector-search/index/vector-search-type/)
- [MongoDB `$vectorSearch` stage](https://www.mongodb.com/docs/vector-search/query/aggregation-stages/vector-search-stage/)
- [MongoDB `$listSearchIndexes` stage](https://www.mongodb.com/docs/manual/reference/operator/aggregation/listSearchIndexes/)

This document records the service contract and maps it to the Index Management
implementation as it exists after the Standard/Wildcard/Vector drawer redesign.
It is intentionally a planning document, not a claim that the current UI already
supports vector indexes.

---

## Executive summary

Azure DocumentDB and MongoDB Atlas both store vector embeddings and support
nearest-neighbor similarity search over the MongoDB wire protocol. They do not
share an index-management contract.

Azure DocumentDB declares a vector index through the ordinary `createIndexes`
command, the special key value `"cosmosSearch"`, and a
`cosmosSearchOptions` object:

```javascript
db.runCommand({
  createIndexes: 'products',
  indexes: [
    {
      name: 'description_vector',
      key: { embedding: 'cosmosSearch' },
      cosmosSearchOptions: {
        kind: 'vector-hnsw',
        dimensions: 1536,
        similarity: 'COS',
        m: 16,
        efConstruction: 64,
      },
    },
  ],
});
```

Azure DocumentDB supports three approximate nearest-neighbor algorithms:

- IVF (`vector-ivf`)
- HNSW (`vector-hnsw`)
- DiskANN (`vector-diskann`)

MongoDB Atlas declares a separate search-index resource through
`createSearchIndexes` and `type: "vectorSearch"`:

```javascript
db.runCommand({
  createSearchIndexes: 'products',
  indexes: [
    {
      name: 'description_vector',
      type: 'vectorSearch',
      definition: {
        fields: [
          {
            type: 'vector',
            path: 'embedding',
            numDimensions: 1536,
            similarity: 'cosine',
          },
        ],
      },
    },
  ],
});
```

Atlas supports HNSW and flat indexing, optional HNSW tuning, scalar or binary
quantization, filter fields, nested vector fields, and stored source. Atlas
search-index creation, update, and deletion are asynchronous. The extension
must inspect `$listSearchIndexes` and preserve both `status` and `queryable`.

The extension currently has a **Vector** tab, but it is only a placeholder. It
has no vector draft state, payload, validation, preview, creation path, or list
badge. The existing traditional-index backend can carry Azure
`cosmosSearchOptions`.

PR [#732](https://github.com/microsoft/vscode-documentdb/pull/732) is scoped to
implementing that Vector tab for Azure DocumentDB. MongoDB Atlas should
eventually show a separate **Search Index** tab because Atlas search indexes use
a different resource model, command family, lifecycle, and set of options.
Automatic environment-based tab switching is not available yet and is not part
of the current Vector work.

Atlas Search Index support is tracked as future work in
[#815](https://github.com/microsoft/vscode-documentdb/issues/815). It needs
triage, and the team will return to it based on customer requests. The Atlas API
research later in this document is retained as a future reference, not as an
implementation requirement for PR #732.

---

## What a vector index is

An embedding model converts text, images, audio, or other content into a
fixed-length numeric array:

```text
"comfortable red running shoe"
              |
              v
       embedding model
              |
              v
[0.17, -0.42, 0.81, ... 1536 values]
```

Semantically similar items should produce vectors that are close to one another
under the selected similarity metric. A query uses the same embedding model to
produce a query vector, then asks DocumentDB for the nearest indexed vectors.

```text
                           sneakers
                              *
                        *           * running shoes

            formal shoes *

                                                   * kitchen table
```

A vector is technically stored as an array, but a vector index does **not** use
the ordinary multikey interpretation of that array:

```text
Ordinary index over an array          Vector index over an embedding

["sale", "summer"]                   [0.17, -0.42, 0.81]
     |       |                                  |
     v       v                                  v
2 scalar index entries                 1 point in vector space
```

The `"cosmosSearch"` key value tells DocumentDB to treat the whole numeric array
as one vector. The number of values must match the configured `dimensions`.
Query vectors must use the same dimensions and embedding model as the indexed
vectors.

---

## Is this DocumentDB-only?

No. Azure DocumentDB and MongoDB Atlas both expose vector indexing through the
MongoDB wire protocol, but their commands, definitions, query stages, and
lifecycle semantics are different.

Azure DocumentDB uses this service-specific extension to ordinary indexes:

```javascript
{
  key: { embedding: 'cosmosSearch' },
  cosmosSearchOptions: {
    kind: 'vector-hnsw',
    dimensions: 1536,
    similarity: 'COS',
  },
}
```

Atlas uses dedicated search-index commands and aggregation stages:

```javascript
db.runCommand({
  createSearchIndexes: 'products',
  indexes: [
    {
      name: 'embedding_vector',
      type: 'vectorSearch',
      definition: {
        fields: [
          /* vector and filter definitions */
        ],
      },
    },
  ],
});
```

Provider command matrix:

| Operation         | Azure DocumentDB                       | MongoDB Atlas             |
| ----------------- | -------------------------------------- | ------------------------- |
| Create            | `createIndexes`                        | `createSearchIndexes`     |
| List/status       | `listIndexes` / `getIndexes()`         | `$listSearchIndexes`      |
| Update definition | Recreate after verification            | `updateSearchIndex`       |
| Drop              | `dropIndex`                            | `dropSearchIndex`         |
| Query             | `$search.cosmosSearch`                 | `$vectorSearch`           |
| Resource model    | Traditional index                      | Search index              |
| Completion        | Command/list behavior must be verified | Asynchronous; poll status |

This plan assumes that Atlas operations use only database commands,
aggregation stages, or MongoDB Node driver helpers that issue those operations
over the wire protocol. It does not use the Atlas Administration REST API.

For the current extension work, the practical contract is:

- Implement the Vector tab only for Azure DocumentDB.
- Build, validate, list, and delete `cosmosSearch` indexes on the extension host.
- Do not expose an unrestricted `runCommand` procedure to the webview.
- Do not add Atlas command branching to the Vector tab.
- Return actionable server errors when an Azure DocumentDB tier or version does
  not support the selected vector option.

Future issue [#815](https://github.com/microsoft/vscode-documentdb/issues/815)
will own Atlas detection, switching from Vector to Search Index, and the Atlas
search-index command lifecycle. Until that work is implemented, the extension
cannot automatically substitute the correct tab for an Atlas connection.

`getClusterMetadata()` currently provides deployment clues such as
`domainInfo_api`, but metadata alone does not establish algorithm or cluster-tier
support. A future environment switch should use an explicit capability response
or controlled feature probe instead of a hostname-only rule.

The current `listSearchIndexesForAtlas()` helper catches unsupported-command
errors and returns an empty array. A capability probe cannot use that result as
is because it does not distinguish "Atlas with no search indexes" from
"operation unsupported." Preserve a typed capability/error result at the host
boundary while keeping ordinary list refreshes resilient.

---

## Service-supported algorithms

### IVF

IVF groups vectors into lists (clusters). During a search, DocumentDB identifies
nearby lists and searches vectors within those lists.

```text
Vector space

  [list A]         [list B]            [list C]
   * * *             * *                 * * *
    *                 Q  *                 *
                         ^
                    query starts near B
```

Creation option:

- `numLists`: number of clusters used to organize vectors.

Query-time option:

- `nProbes`: number of nearby lists searched. The default is `1`, and it cannot
  exceed `numLists`.

Trade-off:

- More lists reduce the number of vectors searched per list and can improve
  latency.
- Searching too few lists can miss relevant neighbors and reduce recall.
- `numLists: 1` is similar to brute-force search: high recall, limited
  performance.

Current service guidance recommends IVF primarily for smaller datasets (roughly
under 10,000 vectors) and M10/M20 tiers. The documentation recommends using a
`numLists` value derived from collection size, but the UI should present that as
a recommendation rather than silently changing a user's value.

### HNSW

HNSW builds a multilayer graph connecting nearby vectors. Searches begin in
sparse upper layers and descend into denser layers.

```text
Sparse layer          A -------- D
                       \        /
Middle layer       A --- B --- D --- F
                    \   |     /     /
Dense layer       A--B--C--D--E--F--G
```

Creation options:

- `m`: maximum connections per graph layer. Default `16`, range `2`-`100`.
- `efConstruction`: size of the candidate list used while building the graph.
  Default `64`, range `4`-`1000`, and must be at least `2 * m`.

Query-time option:

- `efSearch`: candidate-list size during search. Default `40`; larger values can
  improve recall at the cost of latency.

Trade-off:

- Strong speed/recall behavior for many workloads.
- More memory and a slower build than IVF.
- Larger `m` and `efConstruction` can improve graph quality while increasing
  memory and build cost.

Current service guidance recommends HNSW for datasets up to roughly 50,000
vectors and M30 or higher tiers.

### DiskANN

DiskANN builds a graph intended for high-recall, low-latency search at larger
scale while reducing the memory pressure associated with keeping a full graph
in memory.

Creation options:

- `maxDegree`: maximum graph edges per node. Default `32`, range `20`-`2048`.
- `lBuild`: number of candidate neighbors evaluated during construction.
  Default `50`, range `10`-`500`.

Query-time option:

- `lSearch`: dynamic candidate-list size. Default `40`, range `10`-`1000`.
  `k` must be less than or equal to `lSearch`.

Trade-off:

- Recommended service option for large datasets.
- Higher `maxDegree` and `lBuild` can improve recall and index quality but
  increase storage, build time, and compute cost.

Current service guidance recommends DiskANN on M30 or higher tiers and describes
it as suitable for approximately 500,000 vectors and beyond.

### Comparison

| Algorithm | Service key      | Primary build setting | Main characteristic                   |
| --------- | ---------------- | --------------------- | ------------------------------------- |
| IVF       | `vector-ivf`     | `numLists`            | Fast/light build for smaller datasets |
| HNSW      | `vector-hnsw`    | `m`, `efConstruction` | Strong in-memory graph speed/recall   |
| DiskANN   | `vector-diskann` | `maxDegree`, `lBuild` | Recommended scalable graph option     |

Dataset counts and tier guidance are recommendations from current service docs,
not timeless validation rules. Server capabilities and documentation should be
the source of truth.

---

## Shared settings

### Field path

The index key contains exactly one vector field path:

```javascript
key: { "content.embedding": "cosmosSearch" }
```

The path can use dot notation. The service documentation states that vectors
must use the supported numeric-array representation; documents whose field is
missing, has the wrong type, or has an incompatible vector shape are not indexed
and therefore do not appear in vector results.

Only one vector is indexed per path, and only one vector index can be created
per vector path.

### Dimensions

`dimensions` is the fixed number of numeric values in each vector. It comes from
the embedding model, not from an index-tuning preference.

Examples:

```text
Model output length       Index dimensions
-------------------       ----------------
384                       384
768                       768
1536                      1536
```

The UI may infer a likely value from sampled documents, but it must identify the
value as observed/suggested and let the user confirm it. The embedding model is
the authoritative source.

The Index Management router currently returns only field-path strings from
`SchemaStore.getKnownFields()`. The schema analyzer exposes array/item type
metadata but not a fixed vector length through this route. A separate
`src/utils/schemaInference.ts` implementation can infer `vectorLength`, but it
is not currently connected to this drawer. Do not pretend that the existing
field suggestions can reliably supply dimensions without additional work.

### Similarity

Azure DocumentDB supports these metrics:

- `COS`: cosine distance, commonly used for semantic embeddings.
- `L2`: Euclidean distance.
- `IP`: inner product.

Cosine similarity compares direction:

```text
cos(A, B) = (A dot B) / (|A| * |B|)
```

Euclidean distance compares geometric distance:

```text
L2(A, B) = sqrt(sum((Ai - Bi)^2))
```

Inner product compares the vector dot product:

```text
IP(A, B) = sum(Ai * Bi)
```

The UI should explain the names but should not recommend a metric solely from
sample values. The correct choice normally comes from the embedding model and
application's retrieval design.

### Compression

Current service documentation supports:

- No compression: default maximum of 2,000 dimensions.
- Half precision (`compression: "half"`): IVF/HNSW, up to 4,000 dimensions.
- Product quantization (`compression: "pq"`): DiskANN, up to 16,000 dimensions.

Half precision stores index values at lower precision. Product quantization
compresses vector subspaces and has additional settings:

- `pqCompressedDims`: compressed dimension count; may be automatically chosen.
- `pqSampleSize`: vectors used for centroid training; default `1000`, documented
  range `1000`-`100000`.

Compression trades storage and search speed against precision/recall. Queries
can use `oversampling` to retrieve extra candidates and rerank them using
full-precision vectors.

Compression is a good candidate for a later or advanced UI phase. The first
implementation should not hold back basic vector creation if compression design
is not ready, but its typed domain model should leave room for it.

---

## Commands

### Create an IVF index

```javascript
db.runCommand({
  createIndexes: 'products',
  indexes: [
    {
      name: 'embedding_ivf',
      key: { embedding: 'cosmosSearch' },
      cosmosSearchOptions: {
        kind: 'vector-ivf',
        dimensions: 1536,
        similarity: 'COS',
        numLists: 10,
      },
    },
  ],
});
```

### Create an HNSW index

```javascript
db.runCommand({
  createIndexes: 'products',
  indexes: [
    {
      name: 'embedding_hnsw',
      key: { embedding: 'cosmosSearch' },
      cosmosSearchOptions: {
        kind: 'vector-hnsw',
        dimensions: 1536,
        similarity: 'COS',
        m: 16,
        efConstruction: 64,
      },
    },
  ],
});
```

### Create a DiskANN index

```javascript
db.runCommand({
  createIndexes: 'products',
  indexes: [
    {
      name: 'embedding_diskann',
      key: { embedding: 'cosmosSearch' },
      cosmosSearchOptions: {
        kind: 'vector-diskann',
        dimensions: 1536,
        similarity: 'COS',
        maxDegree: 32,
        lBuild: 50,
      },
    },
  ],
});
```

### Create a half-precision index

```javascript
db.runCommand({
  createIndexes: 'products',
  indexes: [
    {
      name: 'embedding_hnsw_half',
      key: { embedding: 'cosmosSearch' },
      cosmosSearchOptions: {
        kind: 'vector-hnsw',
        dimensions: 3072,
        similarity: 'COS',
        compression: 'half',
        m: 16,
        efConstruction: 64,
      },
    },
  ],
});
```

### Create a DiskANN product-quantized index

```javascript
db.runCommand({
  createIndexes: 'products',
  indexes: [
    {
      name: 'embedding_diskann_pq',
      key: { embedding: 'cosmosSearch' },
      cosmosSearchOptions: {
        kind: 'vector-diskann',
        dimensions: 1536,
        similarity: 'COS',
        compression: 'pq',
        pqCompressedDims: 96,
        pqSampleSize: 2000,
      },
    },
  ],
});
```

### List vector indexes

Azure DocumentDB returns vector definitions through the ordinary index-listing
path:

```javascript
db.products.getIndexes();
```

An Azure DocumentDB vCore deployment tested on 2026-07-27 returned the vector
key plus a `cosmosSearchOptions` object:

```javascript
{
  v: 2,
  name: 'dbg_vec_hnsw_l2_4d_m16_ef64',
  key: { 'vectorDebug.hnswL2_4d': 'cosmosSearch' },
  cosmosSearchOptions: {
    kind: 'vector-hnsw',
    dimensions: 4,
    similarity: 'L2',
    m: 16,
    efConstruction: 64,
  },
}
```

The same deployment accepted and returned IVF, HNSW, DiskANN, HNSW with half
precision, and DiskANN with product quantization. Every definition round-tripped
its algorithm, dimensions, similarity, tuning values, and compression settings
through `getIndexes()`.

The implementation should parse the observed `cosmosSearchOptions` property.
It may also accept `cosmosSearch` defensively because service documentation or
other supported service versions could use that shape. Preserve unknown options
in the raw definition.

### Verified manual test handoff

The service test was performed on 2026-07-27 against an Azure DocumentDB vCore
cluster, using database `MyDatabase` and collection
`vector_index_debug_cases`.

The test used `db.runCommand({ createIndexes: ... })` once per index. Each index
used a distinct vector field path so all five definitions could coexist in the
same collection. The following fixtures were created:

| Index name                               | Field path                      | Definition exercised                                                          |
| ---------------------------------------- | ------------------------------- | ----------------------------------------------------------------------------- |
| `dbg_vec_ivf_cos_4d_lists10`             | `vectorDebug.ivfCos4d`          | IVF, 4 dimensions, COS, `numLists: 10`                                        |
| `dbg_vec_hnsw_l2_4d_m16_ef64`            | `vectorDebug.hnswL2_4d`         | HNSW, 4 dimensions, L2, `m: 16`, `efConstruction: 64`                         |
| `dbg_vec_diskann_ip_4d_degree32_build50` | `vectorDebug.diskannIp4d`       | DiskANN, 4 dimensions, IP, `maxDegree: 32`, `lBuild: 50`                      |
| `dbg_vec_hnsw_half_cos_3072d_m16_ef64`   | `vectorDebug.hnswHalfCos3072d`  | HNSW, 3072 dimensions, COS, half precision                                    |
| `dbg_vec_diskann_pq_cos_1536d_c96_s2000` | `vectorDebug.diskannPqCos1536d` | DiskANN, 1536 dimensions, COS, PQ, compressed dimensions 96, sample size 2000 |

The verification command was:

```javascript
db.getCollection('vector_index_debug_cases')
  .getIndexes()
  .filter(function (index) {
    return index.name.indexOf('dbg_vec_') === 0;
  });
```

It returned five entries in 494 ms. Each entry contained:

- `v: 2`.
- The supplied index name.
- A one-field key whose direction was the string `"cosmosSearch"`.
- A `cosmosSearchOptions` object containing the supplied algorithm, dimensions,
  similarity, tuning, and compression options without observed transformation.

This test establishes the create and list response contract for that vCore
deployment. It does not establish query correctness, build readiness,
performance, populated-collection PQ training, tier portability, statistics,
hide/unhide behavior, or deletion behavior.

### Query a vector index

Vector queries use the `$search` aggregation stage and `cosmosSearch` operator:

```javascript
const queryVector = [0.12, -0.34, 0.56 /* ... */];

db.products.aggregate([
  {
    $search: {
      cosmosSearch: {
        path: 'embedding',
        vector: queryVector,
        k: 10,
        efSearch: 40,
      },
      returnStoredSource: true,
    },
  },
  {
    $project: {
      similarityScore: { $meta: 'searchScore' },
      document: '$$ROOT',
    },
  },
]);
```

Algorithm-specific query settings are not index-creation settings:

- IVF: `nProbes`
- HNSW: `efSearch`
- DiskANN: `lSearch`
- Compressed indexes: optional `oversampling`

They belong in query authoring/playground support, not in the Create Index form.

### Drop a vector index

Vector indexes use the normal index name for deletion:

```javascript
db.products.dropIndex('embedding_hnsw');
```

Hide/unhide support through `collMod`, usage reporting through `$indexStats`,
and build-state reporting must be verified against Azure DocumentDB before the
Index Management row enables those actions for vector indexes.

---

## Future reference: MongoDB Atlas Search Index API over the wire protocol

> **Out of scope for PR #732.** Atlas should eventually use a separate Search
> Index tab rather than the Azure DocumentDB Vector tab. Automatic environment
> switching and Atlas implementation are tracked by
> [#815](https://github.com/microsoft/vscode-documentdb/issues/815), need triage,
> and will be prioritized based on customer requests. The API details below are
> retained only to inform that future work.

Atlas Vector Search indexes are search-index resources, not entries created by
the ordinary `createIndexes` command. All operations below travel through the
MongoDB wire protocol. Raw commands provide the clearest contract; supported
MongoDB Node driver search-index helpers are also acceptable because they issue
the same database operations.

Search-index management commands are available in MongoDB 7.0 and in 6.0 from
6.0.7. Current MongoDB documentation lists Node driver 6.6.0 or later for the
search-index management helpers. Atlas role privileges still apply:

- Listing requires `listSearchIndexes`; the built-in `read` role includes it.
- Creation, update, and deletion require their corresponding search-index
  actions. Built-in `readWrite` commonly supplies the management permissions.

The extension should surface authorization errors directly and must not infer
that a connection can manage indexes merely because it can query them.

### Atlas definition model

A stable bring-your-own-embedding definition can contain one or more vector
fields and zero or more filter fields:

```javascript
{
  fields: [
    {
      type: 'vector',
      path: 'embedding',
      numDimensions: 1536,
      similarity: 'cosine',
      quantization: 'scalar',
      indexingMethod: 'hnsw',
      hnswOptions: {
        maxEdges: 16,
        numEdgeCandidates: 100,
      },
    },
    {
      type: 'filter',
      path: 'tenantId',
    },
  ],
}
```

Vector field settings:

| Setting                         | Values / limits                     | Notes                                    |
| ------------------------------- | ----------------------------------- | ---------------------------------------- |
| `path`                          | Field path                          | Required                                 |
| `numDimensions`                 | Positive integer, maximum 8192      | Must match indexed and query vectors     |
| `similarity`                    | `euclidean`, `cosine`, `dotProduct` | Required                                 |
| `indexingMethod`                | `hnsw`, `flat`                      | Optional; HNSW is the default            |
| `quantization`                  | `none`, `scalar`, `binary`          | Optional; `none` is the baseline default |
| `hnswOptions.maxEdges`          | 16-64, default 16                   | HNSW only                                |
| `hnswOptions.numEdgeCandidates` | 100-3200, default 100               | HNSW build quality/cost                  |

Atlas accepts BSON numeric arrays and supported BSON `BinData` vector subtypes,
including `float32`, `int8`, and `int1`. Automatic binary quantization and
`int1` representations require dimensions divisible by eight. Binary
quantization is not currently supported for nested vector indexes.

Atlas filter fields use `{ type: "filter", path }`. Supported filter values
include boolean, date, ObjectId, numeric, string, UUID, and arrays of supported
values. A `$vectorSearch.filter` expression can refer only to paths indexed as
filter fields.

### Create

```javascript
db.runCommand({
  createSearchIndexes: 'products',
  indexes: [
    {
      name: 'embedding_vector',
      type: 'vectorSearch',
      definition: {
        fields: [
          {
            type: 'vector',
            path: 'embedding',
            numDimensions: 1536,
            similarity: 'cosine',
            quantization: 'scalar',
            indexingMethod: 'hnsw',
          },
          {
            type: 'filter',
            path: 'tenantId',
          },
        ],
      },
    },
  ],
});
```

The command acknowledges the requested resource before all search nodes finish
building it. A successful command response means "accepted," not "ready for
queries." The UI must refresh or poll `$listSearchIndexes` until the resource is
queryable or reaches a terminal failure state.

Current Atlas documentation lists three search indexes on Free clusters, ten on
Flex clusters, and a high hard limit of 2,500 on dedicated deployments, subject
to practical tier and workload constraints. These service limits can change and
should be displayed as guidance, not hard-coded client validation.

### List definitions and status

List every search index:

```javascript
db.products.aggregate([{ $listSearchIndexes: {} }]);
```

List one by name:

```javascript
db.products.aggregate([
  {
    $listSearchIndexes: {
      name: 'embedding_vector',
    },
  },
]);
```

The stage can filter by `name` or `id`, but not both. Relevant output fields are:

- `id` and `name` for identity.
- `status` for aggregate lifecycle state.
- `queryable` for whether an active generation can serve queries.
- `latestDefinitionVersion` and `latestDefinition` for the requested
  definition.
- `statusDetail` for per-host progress or failures.

`status` and `queryable` are independent and must not be collapsed into a single
ready/building flag:

| Status           | Typical queryability                           | UI meaning                                           |
| ---------------- | ---------------------------------------------- | ---------------------------------------------------- |
| `PENDING`        | False                                          | Accepted and waiting to build                        |
| `BUILDING`       | False for new index; may be true during update | Building a generation                                |
| `READY`          | True                                           | Latest definition is active                          |
| `STALE`          | True                                           | Queryable, but data or definition may be out of date |
| `FAILED`         | True or false                                  | Show failure and retain actual queryability          |
| `DELETING`       | False                                          | Deletion is in progress                              |
| `DOES_NOT_EXIST` | False                                          | No active search-index resource                      |

During an update, Atlas can continue serving the old active generation while a
replacement builds. A `BUILDING` index can therefore be queryable. Details
should identify the build state without falsely declaring the index unusable.

The existing `ClustersClient.listSearchIndexesForAtlas()` method already issues
the empty `$listSearchIndexes` stage. Its normalization must read vector fields
from `latestDefinition.fields`; current server output does not require a
top-level `fields` property.

### Update

```javascript
db.runCommand({
  updateSearchIndex: 'products',
  name: 'embedding_vector',
  definition: {
    fields: [
      {
        type: 'vector',
        path: 'embedding',
        numDimensions: 1536,
        similarity: 'cosine',
        quantization: 'binary',
        indexingMethod: 'hnsw',
      },
      {
        type: 'filter',
        path: 'tenantId',
      },
    ],
  },
});
```

Update is asynchronous. Atlas stages the new definition and can keep the old
one queryable until the replacement becomes ready. Index Management should
continue showing the server-reported active/queryable state and the latest
requested definition instead of optimistically replacing the row with a
completed state.

Update support is not required to ship initial creation, but the provider model
must not assume all vector indexes are immutable or can only be edited through a
drop/recreate round trip.

### Drop

```javascript
db.runCommand({
  dropSearchIndex: 'products',
  name: 'embedding_vector',
});
```

Drop is also asynchronous. Keep a deleting row visible while
`$listSearchIndexes` reports `DELETING`; remove it only after it disappears or
reports `DOES_NOT_EXIST`. Do not call ordinary `dropIndex()` for an Atlas search
index.

### Query

Approximate nearest-neighbor search uses `numCandidates`:

```javascript
const queryVector = [0.12, -0.34, 0.56 /* ... */];

db.products.aggregate([
  {
    $vectorSearch: {
      index: 'embedding_vector',
      path: 'embedding',
      queryVector,
      numCandidates: 200,
      limit: 10,
      filter: { tenantId: 'tenant-a' },
    },
  },
  {
    $project: {
      embedding: 0,
      score: { $meta: 'vectorSearchScore' },
    },
  },
]);
```

Exact nearest-neighbor search uses `exact: true` and does not require
`numCandidates`:

```javascript
db.products.aggregate([
  {
    $vectorSearch: {
      index: 'embedding_vector',
      path: 'embedding',
      queryVector,
      exact: true,
      limit: 10,
    },
  },
]);
```

`$vectorSearch` must be the first pipeline stage. For ANN queries,
`numCandidates` must be at least `limit` and no greater than 10,000. Current
guidance suggests starting near 20 times `limit` and tuning recall and latency
for the workload. Query-time fields such as `numCandidates`, `exact`, and
`limit` do not belong in the Create Index drawer.

The stage also supports provider-specific advanced query options including
`parentFilter`, nested score mode, stored-source return, search-node preference,
and explain tracing. These belong in query authoring, not index creation.

### Nested vectors and stored source

For nested vectors, Atlas definitions can set `nestedRoot`. Applicable vector
and filter paths must be children of that root. Queries can combine nested
filters with `parentFilter` for top-level fields and can choose a nested score
mode such as `max` or `avg`.

`storedSource.include` or `storedSource.exclude` stores selected source fields
with the search index. Querying with `returnStoredSource: true` can avoid the
normal backend document lookup, but stored source can be stale. Both features
are valid advanced Atlas capabilities; neither is required for the first create
slice.

### Automated embeddings are preview-only

Atlas currently documents an `autoEmbed` field type under
`type: "vectorSearch"`. It can generate embeddings through supported Voyage AI
models, and current preview model choices include `voyage-4-large`, `voyage-4`,
`voyage-4-lite`, and `voyage-code-3`.

This is an Atlas-only Preview capability, not baseline vector-index support:

- An index cannot mix ordinary `vector` and `autoEmbed` fields.
- It introduces model selection, generated-embedding behavior, and preview
  lifecycle requirements beyond bring-your-own embeddings.
- It must be capability-gated and clearly labeled Preview if implemented.

Initial Index Management support should create ordinary `vector` fields only.
The typed model should leave room for a future separate Atlas automated-
embedding mode rather than silently treating it as an ordinary vector field.

---

## Current extension state

### Drawer

The redesigned drawer in
[`CreateIndexDrawer.tsx`](../../../../src/webviews/documentdb/indexView/components/CreateIndexDrawer.tsx)
has three tabs:

```text
[ Standard ] [ Wildcard ] [ Vector ]
```

Standard and Wildcard have focused forms and preserve their draft state. Vector
is now a working create form as well (see the implementation-progress entries
below); the notes in this section describe the _original placeholder_ state for
historical context.

Original Vector limitations (now resolved):

- `CreateIndexFormState` had no vector draft fields.
- `canSubmit` returned `false` for the Vector kind.
- `buildPayload()` had no Vector branch.
- JSON preview was not available from the Vector placeholder.
- Create, Create in Playground, and Create in Shell were disabled.
- Advanced settings were not exposed for Vector.

The tab structure is still the right foundation. Vector is sufficiently
different from Standard and Wildcard that it remains its own focused form.

### Typed create contract

[`CreateIndexInput`](../../../../src/webviews/documentdb/indexView/types.ts) is
currently shaped around ordinary and wildcard field keys. Its field types are
limited to `asc`, `desc`, `text`, `2dsphere`, and `hashed`.

[`CreateIndexInputSchema`](../../../../src/webviews/documentdb/indexView/indexCreation.ts)
and `buildIndexSpec()` contain no vector contract or validation.

The backend transport in
[`LlmEnhancedFeatureApis.createIndex()`](../../../../src/documentdb/LlmEnhancedFeatureApis.ts)
already:

1. Builds an index definition.
2. Copies unhandled options into that definition.
3. Calls `db.command({ createIndexes: collectionName, indexes: [...] })`.

Therefore `cosmosSearchOptions` would already be forwarded at runtime if it
reached this layer. This is the Azure DocumentDB path. The implementation should
still add an explicit typed `cosmosSearchOptions` field rather than relying on
the `[key: string]: unknown` escape hatch.

Atlas cannot use this helper because it issues `createIndexes`. Future issue
[#815](https://github.com/microsoft/vscode-documentdb/issues/815) will need
distinct Atlas create, list, update, and drop methods. They are not part of the
current Vector implementation.

### Listing and classification

[`ClustersClient.listIndexes()`](../../../../src/documentdb/ClustersClient.ts)
uses the normal driver's `collection.indexes()` method. This is the correct
starting path for DocumentDB `cosmosSearch` vector indexes.

[`ClustersClient.listSearchIndexesForAtlas()`](../../../../src/documentdb/ClustersClient.ts)
already issues `$listSearchIndexes`, and the tree's
[`IndexesItem`](../../../../src/tree/documentdb/IndexesItem.ts) merges those
records with traditional indexes. Index Management does not call this path, and
the current Vector scope should not add that integration.

The Index Management router currently loses vector-specific information:

- `toIndexRow()` preserves the key but does not map `cosmosSearch` or
  `cosmosSearchOptions`.
- `IndexTypeBadge` has no `Vector` member.
- `classifyIndex()` does not recognize the `"cosmosSearch"` direction, so a
  one-field vector index falls through to `Single Field`.
- Expanded details print the raw `cosmosSearch` direction but do not explain the
  algorithm, dimensions, similarity, or compression.
- The raw-definition action remains useful and should continue to preserve all
  service-returned fields.

The router comment saying search/vector indexes are intentionally not surfaced
should be corrected as part of implementation. DocumentDB vector indexes are
ordinary `listIndexes` entries with a special key value. Atlas search indexes
remain excluded from this tab until the separate Search Index work in #815.

### Optimistic creation

`IndexesTab.pendingCreateFromInput()` derives the optimistic key/name from the
ordinary `fields` payload. An Azure vector create can produce an optimistic row
with:

```javascript
key: [{ field: "embedding", direction: "cosmosSearch" }]
type: "Vector"
vectorOptions: { ... }
state: "creating"
```

The real row should replace the optimistic row after the next successful
`listIndexes` refresh, using the same name reconciliation behavior as current
index creation.

---

## Proposed Vector drawer

The Azure DocumentDB path should remain compact, with algorithm tuning and
compression settings behind progressive disclosure. It does not include an
Atlas provider selector or Atlas search-index controls.

```text
+---------------------------------------------------------+
| Create Index                                            |
+---------------------------------------------------------+
| [ Standard ] [ Wildcard ] [ Vector ]                    |
|                                                         |
| Vector field                                            |
| [ embedding                                         v ] |
| Observed: numeric array, 1536 values                     |
|                                                         |
| Algorithm                                               |
| [ DiskANN                                           v ] |
| Recommended for large collections                       |
|                                                         |
| Dimensions                 Similarity                    |
| [ 1536                  ]  [ Cosine (COS)            v ]|
|                                                         |
| Index name                                              |
| [ embedding_vector                                  ]   |
|                                                         |
| Advanced settings >                                     |
| Algorithm tuning, compression                           |
| JSON preview >                                          |
+---------------------------------------------------------+
| [Create Index] [Playground] [Shell] [Reset form]        |
+---------------------------------------------------------+
```

### Main form

Required:

- One vector field path.
- Positive integer dimensions.
- Similarity: COS, L2, or IP.
- Algorithm: IVF, HNSW, or DiskANN.

Recommended:

- Index name. It may be prefilled as `<field>_vector` and remain editable.
- Observed field metadata from schema sampling.
- A warning when the selected field is not observed as a numeric array.
- A warning, not an automatic override, when observed vector lengths conflict.
- Algorithm guidance based on document count and known tier, clearly labeled as
  guidance rather than capability truth.

Do not expose Standard options such as unique, sparse, TTL, partial filter, or
collation unless service documentation and end-to-end tests explicitly confirm
they are valid on vector indexes. The current Vector tab correctly does not
reuse Standard's Advanced page.

### Algorithm-specific advanced form

IVF:

```text
Number of lists       [ 10 ]
```

HNSW:

```text
Connections (m)       [ 16 ]
Build candidates      [ 64 ]
```

DiskANN:

```text
Maximum degree        [ 32 ]
Build candidates      [ 50 ]
```

Compression can follow in the same advanced page:

```text
Compression           [ None | Half | Product quantization ]
```

Only valid combinations should be selectable:

- Half: IVF or HNSW.
- Product quantization: DiskANN.
- No compression: all three.

When PQ is selected, reveal `pqCompressedDims` and `pqSampleSize` as optional
advanced values with documented defaults/ranges.

### Draft preservation

Add a Vector-specific draft to the existing per-kind form state. Switching among
Standard, Wildcard, and Vector must preserve all three drafts. Vector should not
reuse Standard's field list or mutate Standard state.

---

## Proposed typed model

Use a kind-discriminated create contract rather than adding many optional vector
fields to the existing ordinary payload:

```typescript
type VectorSimilarity = 'COS' | 'L2' | 'IP';

interface StandardOrWildcardCreateIndexInput {
  kind: 'standard' | 'wildcard';
  fields: CreateIndexField[];
  name?: string;
  unique?: boolean;
  sparse?: boolean;
  expireAfterSeconds?: number;
  partialFilterExpression?: string;
  collation?: string;
  wildcardProjection?: string;
}

interface VectorCreateIndexInput {
  kind: 'vector';
  field: string;
  name: string;
  dimensions: number;
  similarity: VectorSimilarity;
  algorithm:
    | { kind: 'vector-ivf'; numLists: number }
    | { kind: 'vector-hnsw'; m: number; efConstruction: number }
    | { kind: 'vector-diskann'; maxDegree: number; lBuild: number };
  compression?: { kind: 'half' } | { kind: 'pq'; pqCompressedDims?: number; pqSampleSize?: number };
}

type CreateIndexInput = StandardOrWildcardCreateIndexInput | VectorCreateIndexInput;
```

The exact migration can preserve backward compatibility internally, but the
tRPC boundary should end with a discriminated Zod union. This prevents invalid
states such as a vector index with TTL or an IVF index carrying HNSW settings.

The host-side builder should produce:

```typescript
{
    key: { [input.field]: "cosmosSearch" },
    name: input.name,
    cosmosSearchOptions: {
        kind: input.algorithm.kind,
        dimensions: input.dimensions,
        similarity: input.similarity,
        // algorithm and compression options
    },
}
```

Both direct creation and Playground/Shell handoffs must call the same builder so
the previewed/prepared command is identical to the submitted command.

Future Atlas Search Index work should introduce a separate search-index contract
and command builder rather than expanding this Vector payload with Atlas-only
fields.

---

## Validation rules

At minimum, validate on both the webview and tRPC boundary:

- Exactly one nonempty vector field path.
- Nonempty index name that is not the reserved `"*"` value.
- Positive integer dimensions within the selected compression's documented
  service limit.
- Similarity is COS, L2, or IP.
- Algorithm is IVF, HNSW, or DiskANN.
- IVF `numLists` is a positive integer.
- HNSW `m` is `2`-`100`.
- HNSW `efConstruction` is `4`-`1000` and at least `2 * m`.
- DiskANN `maxDegree` is `20`-`2048`.
- DiskANN `lBuild` is `10`-`500`.
- Half compression is limited to IVF/HNSW.
- PQ compression is limited to DiskANN.
- PQ compressed dimensions are less than original dimensions when explicitly
  supplied.
- PQ sample size uses the documented range when explicitly supplied.

Do not encode dataset-size recommendations as validation failures. A user may
have workload-specific reasons to choose a different algorithm.

Server errors remain authoritative, especially for tier limitations and features
that differ by service version.

---

## Existing-index display

### Type column

Add `Vector` to `IndexTypeBadge` and detect it before the generic field-count
fallback:

```typescript
if (direction === 'cosmosSearch') {
  return 'Vector';
}
```

Expected table:

```text
Name                   Type          Properties
-------------------------------------------------------------
_id_                   Default
category_1             Single Field
metadata_$**_1         Wildcard
embedding_hnsw         Vector        HNSW · 1536 dims · COS
```

Vector is a true Type-column category because it is explicitly declared by the
key specification. It is unlike Multikey, which is a runtime property layered
onto another structural index type.

### Row model

Normalize the Azure DocumentDB response into a typed shape:

```typescript
interface VectorIndexOptions {
  kind: 'vector-ivf' | 'vector-hnsw' | 'vector-diskann';
  dimensions: number;
  similarity: 'COS' | 'L2' | 'IP';
  numLists?: number;
  m?: number;
  efConstruction?: number;
  maxDegree?: number;
  lBuild?: number;
  compression?: 'half' | 'pq';
  pqCompressedDims?: number;
  pqSampleSize?: number;
}

interface IndexRow {
  // existing fields...
  vectorOptions?: VectorIndexOptions;
}
```

Parsing must be defensive. An unknown future algorithm or option should not make
the entire index list fail. Preserve the Vector type based on the key and show
known options where possible; the raw-definition action remains the escape hatch
for unknown fields.

### Properties and expanded details

The Properties column can show compact, non-alarming descriptors:

```text
[HNSW] [1536 dimensions] [COS] [Half precision]
```

The expanded row should show:

```text
Vector field          embedding
Algorithm             HNSW
Dimensions            1536
Similarity            Cosine (COS)
Connections (m)       16
Build candidates      64
Compression           None
```

`describeKeyType()` should label the `cosmosSearch` key as a vector key instead
of displaying the raw sentinel with no explanation.

Sorting and text filtering should include algorithm, dimensions, similarity, and
compression when those values are present.

---

## Implementation progress and choices

### 2026-07-27: Existing vector index display

Phase 1 listing support is implemented for the Index Management table:

- `IndexItemModel` explicitly carries the server-reported
  `cosmosSearchOptions` document.
- The router normalizes known values into `IndexRow.vectorOptions`. It reads the
  observed `cosmosSearchOptions` container first and accepts `cosmosSearch` as a
  defensive fallback for other service versions.
- Classification is based on the key direction sentinel (`"cosmosSearch"`),
  not on whether the options object is complete. A malformed or future options
  object therefore remains a Vector row rather than falling back to Single
  Field.
- The Properties column shows only the algorithm badge so vector rows remain
  compact. The expanded card shows dimensions, readable algorithm, similarity,
  compression, and algorithm-specific tuning values for IVF, HNSW, and
  DiskANN.
- The expanded field badge presents the `cosmosSearch` key-direction sentinel
  as the semantic label `vector`, consistent with the existing `asc`/`desc`
  presentation. **View Raw Index Definition** preserves and displays the actual
  server value, `cosmosSearch`.
- Vector metadata participates in text filtering and Properties-column sorting.
  The raw-definition action continues to re-fetch and show the complete server
  document, preserving visibility into unknown future options without putting
  untyped values into the row UI.
- Focused tests cover the observed HNSW list shape, structural Vector
  classification, defensive normalization, unknown values, and search terms.

Implementation choices:

1. **Display-first scope:** This change only makes existing indexes accurately
   inspectable. Vector creation remains a separate phase; the Vector create tab
   is still intentionally unavailable.
2. **Optional normalized fields:** Known values are copied only when they have
   the expected primitive type. One malformed value cannot fail the entire
   index list.
3. **Keep table rows compact:** The Type column identifies the row as Vector and
   the Properties column shows only its algorithm. Dimensions, similarity,
   compression, and tuning values stay in the expanded details, where service
   terms remain recognizable in labels such as `Cosine (COS)`.
4. **No inferred lifecycle capability:** Delete and hide/unhide behavior is not
   changed by this display work. Capability gating still requires service
   verification.

Implementation and automated validation are complete for this display phase.
The six available test indexes provide the end-to-end visual verification set
for IVF, HNSW, DiskANN, and compression variants.

---

### 2026-07-27: Vector index creation (Phases 2–4)

The Vector tab is now a working create form for Azure DocumentDB
`cosmosSearch` indexes. Phases 2, 3, and 4 landed together as a single vertical
slice covering all three algorithms and both compression modes.

Typed contract and validation (Phase 2):

- `CreateIndexInput` is now a discriminated union of a field-keyed
  `FieldCreateIndexInput` (Standard/Wildcard) and a `VectorCreateIndexInput`
  (`kind: 'vector'`). Invalid states such as a vector index with TTL, or an IVF
  index carrying HNSW settings, are unrepresentable. `isVectorCreateIndexInput()`
  narrows the union at every consumer.
- `CreateIndexInputSchema` became a `z.union` of the existing field schema and a
  new vector schema. The vector schema uses discriminated unions for the
  algorithm (`vector-ivf` / `vector-hnsw` / `vector-diskann`) and compression
  (`half` / `pq`), with the documented service ranges: HNSW `m` 2–100 and
  `efConstruction` 4–1000 (and `>= 2 * m`), DiskANN `maxDegree` 20–2048 and
  `lBuild` 10–500, PQ `pqSampleSize` 1000–100000. Cross-field rules (half →
  IVF/HNSW, PQ → DiskANN, `pqCompressedDims < dimensions`) live in a top-level
  refinement.
- `buildIndexSpec()` and `buildCreateIndexShellCommand()` branch to a vector
  builder that emits `key: { <field>: 'cosmosSearch' }` plus a
  `cosmosSearchOptions` object. Direct create and Playground/Shell hand-offs use
  the same builder, so the previewed command equals the submitted command.
- `IndexSpecification` gained an explicit typed `cosmosSearchOptions` field
  instead of relying only on the `[key: string]: unknown` escape hatch.

Drawer and draft (Phases 3–4):

- `CreateIndexFormState` carries an independent Vector draft (field, name,
  dimensions, similarity, algorithm, per-algorithm tuning, compression, and PQ
  tuning). Switching among Standard, Wildcard, and Vector preserves all three
  drafts; Vector never mutates Standard's field list.
- The Vector main form is deliberately compact — vector field, algorithm
  (with a one-line recommendation), dimensions + similarity, and an optional
  custom name — matching the focused shape of the other two tabs. Algorithm
  tuning and compression live behind the shared **Advanced settings** page,
  which is now index-kind aware.
- Compression choices are constrained to valid pairings (half for IVF/HNSW, PQ
  for DiskANN); an incompatible selection collapses to "none" for the payload,
  preview, and validation rather than producing an invalid command.
- JSON preview, direct **Create Index**, **Create in Playground**, and **Create
  in Shell** are all enabled for Vector and render the `cosmosSearchOptions`
  document.
- Optimistic "Creating…" rows now understand vector input: the key uses the
  `cosmosSearch` sentinel (so `classifyIndex()` badges it **Vector**), the
  default name matches the server's `<field>_cosmosSearch`, and the algorithm
  badge appears immediately.
- Create telemetry records privacy-safe vector facts only: algorithm,
  similarity, compression kind, and a dimensions measurement — never the field
  name or vector values.

Implementation choices:

1. **Discriminated union over optional fields:** A kind-tagged union keeps the
   vector and field-keyed contracts from leaking into one another and lets Zod
   validate each shape against its own rules.
2. **HNSW as the default algorithm:** Its documented defaults (`m: 16`,
   `efConstruction: 64`) are well established and it is the balanced
   general-purpose choice, matching the recommended first vertical slice. No
   dataset-size guidance is encoded as a validation rule.
3. **Compression behind Advanced:** The main form stays minimal; tuning and
   compression are progressive disclosure, consistent with the Standard tab's
   Advanced page.
4. **Name left to the server by default:** When no custom name is given the
   service generates `<field>_cosmosSearch`; the input placeholder previews that
   value so the optimistic row reconciles by name.

Validation status: focused unit tests cover each algorithm's spec, compression
variants, the shell command, and the invalid-combination matrix. The repository
l10n, Prettier, ESLint, Jest (2746 tests), and `tsc` build checks all pass.
End-to-end creation against a live Azure DocumentDB vCore deployment is the
remaining manual verification step (Phase 6).

---

### 2026-07-27: Vector create UX refinements

Follow-up polish on the create experience, applied across all three tabs where
relevant:

- **Algorithm as radio cards:** the algorithm dropdown became three parallel
  selectable cards (HNSW / IVF / DiskANN), each carrying its own one-line
  description _inside_ the card. The previous dropdown could only show the
  chosen algorithm's description above it. Implemented as an ARIA `radiogroup`
  of buttons with roving `tabindex` and arrow-key navigation.
- **Flatter drawer:** the tinted background boxes behind option groups were
  removed. Shading is now reserved for the Advanced/JSON entries and the
  selected algorithm card, which reads noticeably cleaner. The Advanced settings
  and Preview as JSON entries were grouped under a titled **More options**
  section so they no longer float loose at the foot of the form.
- **Disabled-reason hint:** a live, muted requirement line now sits above the
  footer whenever the primary action is disabled, naming exactly what is still
  needed (e.g. _Add at least one index field_, _Enter the vector dimensions_).
  It updates as the form is filled, clears when valid, and is announced via
  `role="status"`.
- **Required markers:** the shared `DrawerSection` gained a `required` marker
  (a Fluent-style asterisk) applied to the Standard _Index fields_ and Vector
  _Vector field_ sections; Dimensions already carried a `Field required` marker.
  The asterisks are decorative (`aria-hidden`) — the requirement is conveyed
  functionally by the disabled action and the hint.
- **No premature name error:** an empty custom vector index name no longer shows
  an inline error. It is treated as "no name" (the server generates
  `<field>_cosmosSearch`), and the reserved `*` name is caught by validation on
  create, matching the other Create Index options.
- **Wildcard preview alignment:** the wildcard index-key preview is indented to
  line up with the left edge of the radio buttons above it.

---

## Capability and action handling

Verified on one Azure DocumentDB vCore deployment on 2026-07-27:

1. `createIndexes` accepted IVF, HNSW, and DiskANN definitions.
2. HNSW accepted half-precision compression.
3. DiskANN accepted product quantization with explicit compressed dimensions and
   sample size.
4. `getIndexes()` returned all five definitions through ordinary
   `listIndexes`.
5. Returned definitions used `cosmosSearchOptions` and preserved every supplied
   option.

Still verify against each supported Azure DocumentDB environment:

1. Algorithm and compression availability by tier and service version.
2. `$indexStats` usage and build-state reporting.
3. `collStats.indexSizes` entries by vector-index name.
4. `dropIndex(name)` behavior for each algorithm.
5. `collMod` hide/unhide behavior.
6. Empty-collection and populated-collection behavior, especially PQ training.
7. Query behavior for all algorithms, metrics, and compression modes.
8. Error behavior for wrong field type, dimensions, tier, duplicate vector path,
   and unsupported compression.

Until hide/unhide is verified, disable that action for Vector rows with an
explanatory tooltip. Delete can be enabled only after drop behavior is verified.

Capability UX options, in preferred order:

1. Explicit server capability response.
2. A cached, low-cost feature probe.
3. Deployment metadata plus server-side validation and actionable errors.
4. Always-visible tab with a clear unsupported response as the fallback.

Do not maintain a fragile host-suffix allowlist as the sole source of truth.

---

## Recommended implementation phases

### Phase 0: Verify the Azure DocumentDB service contract

Run the command matrix above against supported Azure DocumentDB tiers. Capture
creation responses, `getIndexes()` output, stats, delete, and hide/unhide
behavior. The 2026-07-27 vCore test establishes `cosmosSearchOptions` as the
observed list shape for that deployment; retain defensive parsing for
`cosmosSearch` until supported service versions are covered.

This is the most important prerequisite because it determines row parsing and
which actions can be enabled safely.

### Phase 1: Display the verified existing indexes

Use the five manually created `dbg_vec_*` indexes as end-to-end display fixtures:

- Preserve `cosmosSearchOptions` when `indexViewRouter.toIndexRow()` maps the raw
  `listIndexes` response.
- Classify a key direction of `"cosmosSearch"` as Vector before the generic
  single-field fallback.
- Add Vector to the type badge model.
- Normalize known options into `IndexRow.vectorOptions` while retaining the raw
  definition and unknown future options.
- Show field, algorithm, dimensions, similarity, tuning, and compression in the
  properties and expanded details views.
- Verify all five fixtures render distinctly, including no compression, half
  precision, and product quantization.
- Keep unsupported actions disabled until their service behavior is verified.

### Phase 2: Add typed vector creation and validation

- Add vector algorithm, similarity, compression, and tuning interfaces.
- Convert the create input into a kind-discriminated union.
- Add a Zod discriminated union with algorithm-specific validation.
- Add `cosmosSearchOptions` explicitly to `IndexSpecification`.
- Extend the shared index-spec and Shell/Playground command builders.
- Add focused unit tests for every algorithm and invalid combination.

### Phase 3: Implement the Vector draft and main drawer

- Add independent Vector state to `CreateIndexFormState`.
- Add vector field, algorithm, dimensions, similarity, and name controls.
- Preserve Vector state across tab switches and drawer close/reopen.
- Use collection count for guidance only.
- Enrich field suggestions with array/item metadata.
- Add observed-vector hints without claiming sampled data is authoritative.
- Enable JSON preview and Playground/Shell handoffs through the shared builder.

### Phase 4: Add advanced tuning

- Render algorithm-specific controls with service defaults and constraints.
- Decide whether half precision and product quantization belong in the first
  release.
- If included, add compression controls and dimension validation.
- Keep query-time controls out of index creation.

### Phase 5: Complete lifecycle and telemetry

- Support optimistic Vector rows and reconciliation through `listIndexes()`.
- Keep drafts on failure and show actionable service errors.
- Gate delete/hide/unhide from verified Azure DocumentDB capabilities.
- Record privacy-safe telemetry: algorithm, similarity, dimensions bucket,
  compression kind, success/failure, and activation source.
- Never record vector values, indexed data, field names, connection details, or
  raw server definitions.

### Phase 6: End-to-end validation

- Create/list/query/drop all three algorithms.
- Verify direct, Playground, and Shell command paths match.
- Verify unsupported deployments and tiers fail clearly.
- Verify localization, accessibility, keyboard use, and narrow drawer layouts.
- Run the repository's required l10n, formatting, lint, test, and build checks.

---

## Test plan

### Domain and command tests

- Each algorithm maps to `key: { field: "cosmosSearch" }` and emits only its own
  settings.
- Similarity and dimensions are preserved.
- HNSW cross-field constraint `efConstruction >= 2 * m`.
- Compression/algorithm compatibility.
- Direct create and Shell/Playground command builders use identical specs.
- BSON/shell formatting remains valid.

### Drawer tests

- Vector starts with intentional defaults.
- Switching tabs preserves Standard, Wildcard, and Vector drafts independently.
- Required fields control submit availability.
- Algorithm changes swap only the relevant advanced controls.
- Suggested dimensions are editable and identified as observed.
- Mismatched sampled lengths produce a warning, not silent coercion.
- Preview contains `cosmosSearchOptions`.
- Standard and Wildcard behavior does not regress.

### Listing tests

- A `cosmosSearch` key classifies as Vector before Single Field.
- Both documented option-container names normalize safely.
- IVF, HNSW, DiskANN, compression, and unknown future options do not break rows.
- Vector details render accessible labels.
- Raw definition retains unrecognized service fields.
- Missing/malformed options still produce a Vector row based on the key.

### Lifecycle tests

- Optimistic Vector row appears and reconciles by name.
- Failed creation preserves the Vector draft for retry.
- Refresh reports the server definition.
- Action availability follows verified capabilities.

---

## Open decisions

1. **Capability source:** What authoritative Azure DocumentDB signal reports
   tier and vector-algorithm support?
2. **Compression scope:** Ship half precision and product quantization with
   initial vector creation or follow in an advanced-settings iteration?
3. **Name behavior:** Require an explicit name, prefill `<field>_vector`, or rely
   on the backend-generated `<field>_cosmosSearch` name?
4. **Dimension inference:** Extend the shared schema analyzer with stable vector
   length metadata, or sample the selected path on demand?
5. **Default algorithm:** Avoid a universal default, or select one based on
   verified collection count and tier?
6. **Advanced defaults:** Send documented defaults explicitly or omit them and
   let the service own defaults? Omitting values is more future-proof; showing
   them improves predictability.
7. **Row actions:** Are hide/unhide and all current statistics supported for
   Azure DocumentDB vector indexes?
8. **Unknown algorithms:** Display a generic Vector badge plus raw settings, or
   expose an `Unknown vector algorithm` property?

---

## Recommended first vertical slice

Start with display because the five server-created fixtures already establish
the list contract:

1. Map and display all five `dbg_vec_*` indexes from `listIndexes()`.
2. Classify `"cosmosSearch"` as Vector and render algorithm-specific details.
3. Add focused listing and component tests using the exact observed response
   shape.
4. Build `createIndexes` from field, dimensions, similarity, name, `m`, and
   `efConstruction`.
5. Enable direct creation, preview, Playground, and Shell from the same builder.
6. Add IVF and DiskANN through the same algorithm union once the vertical path is
   proven.

This is intentionally a vertical slice, not the desired final product. The
public release should expose every Azure DocumentDB algorithm that the UI claims
to support and must not leave a selectable but nonfunctional option.

---

## Related repository material

- [DocumentDB-supported indexes](./reference-supported-indexes.md)
- [Collection View toolbar/tab redesign](./design-collectionview-toolbar.md)
- [Index Management UI notes](./design.md)
- [Generated index reference](../../../../packages/documentdb-js-operator-registry/src/indexReference.ts)
- [Current Create Index drawer](../../../../src/webviews/documentdb/indexView/components/CreateIndexDrawer.tsx)
- [Create-index validation and builder](../../../../src/webviews/documentdb/indexView/indexCreation.ts)
- [Index Management router](../../../../src/webviews/documentdb/indexView/indexViewRouter.ts)
