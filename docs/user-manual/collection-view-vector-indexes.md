> **User Manual** | [Manage Indexes in Collection View](./collection-view-index-management) | [Back to User Manual](../index#user-manual)

---

# Vector Indexes in Collection View

A vector index enables similarity search over embeddings. Instead of matching values exactly, it finds the stored vectors that are closest to a query vector, which is what powers semantic search, recommendations, and retrieval for AI applications.

Vector indexes are different from ordinary indexes in one important way: an array indexed by a Standard index produces one index entry per element, while a vector index treats the whole array as a single point in vector space. Every vector on the indexed path must therefore have the same number of values.

For detailed information about vector search, supported algorithms, and tier requirements, see the [Azure DocumentDB documentation](https://learn.microsoft.com/azure/documentdb/vector-search).

## Before you start

You need two things:

| Requirement           | Notes                                                                                                                      |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| A field of embeddings | The documents store the vector as an array of numbers on a single field path. Dot notation is supported for nested fields. |
| The vector dimensions | The fixed number of values in each vector. This comes from the embedding model you used, not from the extension.           |

Documents where the path is missing, has the wrong type, or has a different number of values are not indexed and do not appear in vector results.

The **Vector** tab creates a DocumentDB vector index. A deployment that does not support this index form rejects the create request.

## Create a vector index

1. Open the collection's **Indexes** tab.
2. Select **Create Index**.
3. Select **Vector**.
4. Enter the **Vector field** path.
5. Select an algorithm: **DiskANN**, **HNSW**, or **IVF**.
6. Enter the **Dimensions** and select a **Similarity** metric.
7. Optionally open **Advanced** to change algorithm tuning or enable compression.
8. Review the generated definition in **Preview as JSON**.
9. Select **Create Index**, or prepare the command in Playground or Shell first.

Only one vector index can be created per vector path, and the index covers exactly one field.

## Choose an algorithm

Each algorithm trades build cost, memory, and recall differently. DiskANN is preselected because it is the recommended scalable option.

| Algorithm   | Best for                                         | Tuning settings                                        |
| ----------- | ------------------------------------------------ | ------------------------------------------------------ |
| **DiskANN** | Scalable graph recommended for large collections | Maximum degree, Build candidates (`lBuild`)            |
| **HNSW**    | Balanced speed and recall for most workloads     | Connections (`m`), Build candidates (`efConstruction`) |
| **IVF**     | Fast, light build for smaller collections        | Number of lists                                        |

Switching algorithms keeps the settings you entered for the others, so you can compare configurations without retyping them.

## Set dimensions and similarity

**Dimensions** has no default. Enter the value your embedding model produces, as a positive whole number. Query vectors must use the same dimensions and the same embedding model as the indexed vectors.

**Similarity** selects the distance metric used to compare vectors:

| Metric                 | Use it when                                                                                           |
| ---------------------- | ----------------------------------------------------------------------------------------------------- |
| **Cosine (COS)**       | Direction matters more than magnitude. This is the default and the common choice for text embeddings. |
| **Euclidean (L2)**     | Straight-line distance in vector space is the meaningful measure.                                     |
| **Inner product (IP)** | Your embedding model is designed to be compared by dot product.                                       |

## Tune the algorithm

Algorithm tuning lives under **Advanced**. The defaults follow the current service recommendations, so you can create a working index without opening this page.

| Setting                             | Applies to | Default | Accepted range            |
| ----------------------------------- | ---------- | ------- | ------------------------- |
| Maximum degree                      | DiskANN    | 32      | 20 to 2048                |
| Build candidates (`lBuild`)         | DiskANN    | 50      | 10 to 500                 |
| Connections (`m`)                   | HNSW       | 16      | 2 to 100                  |
| Build candidates (`efConstruction`) | HNSW       | 64      | 4 to 1000                 |
| Number of lists                     | IVF        | 10      | Any positive whole number |

For HNSW, build candidates must be at least twice the number of connections. The form reports this before you can create the index.

## Compress the index

Compression reduces index size at some cost to recall. The available choice depends on the selected algorithm, and the form only offers the compatible one.

| Compression              | Available for | Notes                                       |
| ------------------------ | ------------- | ------------------------------------------- |
| **None**                 | All           | The default.                                |
| **Half precision**       | HNSW, IVF     | Stores vectors at reduced precision.        |
| **Product quantization** | DiskANN       | Adds two optional settings described below. |

Product quantization accepts two optional values:

- **Compressed dimensions**: a positive whole number that must be smaller than the vector dimensions.
- **Sample size**: a whole number from 1000 to 100000.

Leave either one empty to let the service choose it.

## Review before creating

Use **Preview as JSON** to verify the generated definition before you commit to it. The preview shows the field path, dimensions, similarity, algorithm, tuning, and compression exactly as they will be sent.

The drawer can also prepare the generated command in a **Query Playground** or the **Interactive Shell** instead of creating the index directly. Use that path when you want to adjust the command first, or keep working with the collection right after the index is created.

## Inspect a vector index

A vector index appears in the **Indexes** list like any other index. Expand its row to see the indexed path along with the algorithm, similarity metric, dimensions, and compression reported by the server.

Vector index builds can take noticeably longer than Standard index builds on large collections. The tab keeps refreshing while the state is **Building**.

## Related documentation

- [Manage Indexes in Collection View](./collection-view-index-management)
- [Wildcard Indexes in Collection View](./collection-view-wildcard-indexes)
- [Troubleshoot Index Management](./collection-view-index-management-troubleshooting)
