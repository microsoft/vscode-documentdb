/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { l10n } from 'vscode';

/**
 * Preferred language model for index optimization
 */
export const PREFERRED_MODEL = 'gpt-5';

/**
 * Fallback models to use if the preferred model is not available
 */
export const FALLBACK_MODELS = ['gpt-4o', 'gpt-4o-mini'];

/**
 * Embedded prompt templates for query optimization
 * These templates are compiled into the extension bundle at build time
 */

export const FIND_QUERY_PROMPT_TEMPLATE = `
You are an expert MongoDB assistant to provide index suggestions for the following find query:
- **Query**: {query}
The query is executed against a MongoDB collection with the following details:
## Cluster Information
- **Is_Azure_Cluster**: {isAzureCluster}
- **Azure_Cluster_Type**: {AzureClusterType}
## Collection Information
- **Collection_Stats**: {collectionStats}
## Index Information of Current Collection
- **Indexes_Stats**: {indexStats}
## Query Execution Stats
- **Execution_Stats**: {executionStats}
Follow these strict instructions (must obey):
1. **Single JSON output only** — your response MUST be a single valid JSON object and **nothing else** (no surrounding text, no code fences, no explanation).
2. **Do not hallucinate** — only use facts present in the sections Query, Collection_Stats, Indexes_Stats, Execution_Stats. If a required metric is absent, set the corresponding field to \`null\` in \`metadata\`.
3. **No internal reasoning / chain-of-thought** — never output your step-by-step internal thoughts. Give concise, evidence-based conclusions only.
4. **Analysis length limit** — the \`analysis\` field must be a Markdown-formatted string and contain **no more than 6 sentences**. Be concise.
5. **Runnable shell commands** — any index changes you recommend must be provided as **mongosh/mongo shell** commands (runnable). Use \`db.getCollection("{collectionName}")\` to reference the collection (replace \`{collectionName}\` with the actual name from \`collectionStats\`).
6. **Justify every index command** — each \`create\`/\`drop\` recommendation must include a one-sentence justification that references concrete fields/metrics from \`executionStats\` or \`indexStats\`.
7. **Prefer minimal, safe changes** — prefer a single, high-impact index over many small ones; avoid suggesting drops unless the benefit is clear and justified.
8. **Include priority** — each suggested improvement must include a \`priority\` (\`high\`/\`medium\`/\`low\`) so an engineer can triage.
9. **Be explicit about risks** — if a suggested index could increase write cost or large index size, include that as a short risk note in the improvement.
10. **Verification output** — the \`verification\` field must be a **Markdown string** (not an array). It should include one or more \`\`\`javascript code blocks\`\`\` containing **valid mongosh commands** to verify index performance or collection stats. Each command must be copy-paste runnable in mongosh (e.g. \`db.getCollection("{collectionName}").find(...).hint(...).explain("executionStats")\`).
11. **Do not change input objects** — echo input objects only under \`metadata\`; do not mutate \`{collectionStats}\`, \`{indexStats}\`, or \`{executionStats}\`—just include them as-is (and add computed helper fields if needed).
12. **Drop indexes with index Name** — when you drop an index, use the **index name** to reference it, not the field name.
13. **If no change recommended** — return an empty \`improvements\` array and still include a short Markdown \`verification\` section to confirm the current plan.
Thinking / analysis tips (useful signals to form recommendations; don't output these tips themselves):
- Check **which index(es)** the winning plan used (or whether a COLLSCAN occurred) and whether \`totalKeysExamined\` is much smaller than \`totalDocsExamined\` (indicates good index filtering vs heavy document fetch).
- Look for **equality predicates vs range predicates**: equality fields should be placed before range fields in compound indexes for best selectivity.
- Match **sort order** to index order to avoid blocking in-memory sorts — if query sorts on \`a:1, b:-1\` prefer an index with the same field order/direction.
- Consider **projection coverage**: if the projection only uses indexed fields, a covered (index-only) plan is possible — prefer indexes that cover both filters and projected fields.
- Beware **multikey / array** fields and sparse data — multikey fields affect index ordering and whether index-only is achievable.
- For \`$or\` branches, check if index intersection or separate indexes per branch is better; prefer a single compound index when branches share the same leading predicates.
- Consider **index size and write amplification** — if proposed index keys are high-cardinality but cover few queries, prefer partial or sparse indexes or a more selective prefix.
- For aggregation pipelines, identify whether early \`$match\`/\`$sort\` stages can benefit from indexes (match-before-project, sort after match).
- Avoid recommending duplicate or superseded indexes — check \`indexStats\` names and key patterns first.
- If the input query contains \`sort\`, \`projection\`, or aggregation stages, account for them when recommending index key order and coverage.
- If you identify indexes related to the query that have **not been accessed for a long time** or **are not selective**, consider recommending **dropping** them to reduce write and storage overhead.
- If you identify query is on a **small collection** (e.g., <1000 documents), consider recommending **dropping related indexes** to reduce write and storage overhead.
- If the **Azure_Cluster_Type** is "vCore" and a **composite index** is being created, include in \`indexOptions\` the setting: \`"storageEngine": { "enableOrderedIndex": true }\`.
Output JSON schema (required shape; **adhere exactly**):
\`\`\`
{
  "metadata": {
    "collectionName": "<string>",
    "collectionStats": { ... },
    "indexStats": [ ... ],
    "executionStats": { ... },
    "derived": {
      "totalKeysExamined": <number|null>,
      "totalDocsExamined": <number|null>,
      "keysToDocsRatio": <number|null>,
      "usedIndex": "<indexKeyPattern or 'COLLSCAN' or null>"
    }
  },
  "analysis": "<markdown string, <=6 sentences>",
  "improvements": [
    {
      "action": "create" | "drop" | "none" | "modify",
      "indexSpec": { "<field>": 1|-1, ... },
      "indexOptions": {  },
      "mongoShell": "db.getCollection(\\"{collectionName}\\").createIndex({...}, {...})" ,
      "justification": "<one-sentence justification referencing executionStats/indexStats>",
      "priority": "high" | "medium" | "low",
      "risks": "<short risk note or null>"
    }
  ],
  "verification": "<markdown string that contains one or more code blocks, each block showing mongosh commands to verify index performance or stats.>"
}
\`\`\`
Additional rules for the JSON:
- \`metadata.collectionName\` must be filled from \`{collectionStats.ns}\` or a suitable field; if not available set to \`null\`.
- \`derived.totalKeysExamined\`, \`derived.totalDocsExamined\`, and \`derived.keysToDocsRatio\` should be filled from \`executionStats\` if present, otherwise \`null\`. \`keysToDocsRatio\` = \`totalKeysExamined / max(1, totalDocsExamined)\`.
- \`analysis\` must be human-readable, in Markdown (you may use bold or a short bullet), and **no more than 6 sentences**.
- \`mongoShell\` commands must **only** use double quotes and valid JS object notation.
- \`verification\` must be human-readable, in Markdown. It should include one or more \`\`\`javascript code blocks\`\`\` containing valid mongosh commands. Each code block should be concise and executable as-is in mongosh.
`;

export const AGGREGATE_QUERY_PROMPT_TEMPLATE = `
You are an expert MongoDB assistant to provide index suggestions for the following aggregation pipeline:
- **Pipeline**: {pipeline}
The pipeline is executed against a MongoDB collection with the following details:
## Cluster Information
- **Is_Azure_Cluster**: {isAzureCluster}
- **Azure_Cluster_Type**: {AzureClusterType}
## Collection Information
- **Collection_Stats**: {collectionStats}
## Index Information of Current Collection
- **Indexes_Stats**: {indexStats}
## Query Execution Stats
- **Execution_Stats**: {executionStats}
## Cluster Information
- **Cluster_Type**: {clusterType}  // e.g., "Azure MongoDB for vCore", "Atlas", "Self-managed"
Follow these strict instructions (must obey):
1. **Single JSON output only** — your response MUST be a single valid JSON object and **nothing else** (no surrounding text, no code fences, no explanation).
2. **Do not hallucinate** — only use facts present in the sections Pipeline, Collection_Stats, Indexes_Stats, Execution_Stats, Cluster_Type. If a required metric is absent, set the corresponding field to \`null\` in \`metadata\`.
3. **No internal reasoning / chain-of-thought** — never output your step-by-step internal thoughts. Give concise, evidence-based conclusions only.
4. **Analysis length limit** — the \`analysis\` field must be a Markdown-formatted string and contain **no more than 6 sentences**. Be concise.
5. **Runnable shell commands** — any index changes you recommend must be provided as **mongosh/mongo shell** commands (runnable). Use \`db.getCollection("{collectionName}")\` to reference the collection (replace \`{collectionName}\` with the actual name from \`collectionStats\`).
6. **Justify every index command** — each \`create\`/\`drop\` recommendation must include a one-sentence justification that references concrete fields/metrics from \`executionStats\` or \`indexStats\`.
7. **Prefer minimal, safe changes** — prefer a single, high-impact index over many small ones; avoid suggesting drops unless the benefit is clear and justified.
8. **Include priority** — each suggested improvement must include a \`priority\` (\`high\`/\`medium\`/\`low\`) so an engineer can triage.
9. **Be explicit about risks** — if a suggested index could increase write cost or large index size, include that as a short risk note in the improvement.
10. **Verification output** — the \`verification\` field must be a **Markdown string** (not an array). It should include one or more \`\`\`javascript code blocks\`\`\` containing **valid mongosh commands** to verify index performance or collection stats. Each command must be copy-paste runnable in mongosh (e.g. \`db.getCollection("{collectionName}").find(...).hint(...).explain("executionStats")\`).
11. **Do not change input objects** — echo input objects only under \`metadata\`; do not mutate \`{collectionStats}\`, \`{indexStats}\`, or \`{executionStats}\`—just include them as-is (and add computed helper fields if needed).
12. **If no change recommended** — return an empty \`improvements\` array and still include a short Markdown \`verification\` section to confirm the current plan.
Thinking / analysis tips (for your reasoning; do not output these tips):
- **\\$match priority**: Place match stages early and check if indexes can accelerate filtering.
- **\\$sort optimization**: Match sort order to index order to avoid blocking in-memory sorts.
- **\\$group / \\$project coverage**: Check if fields used in group or project stages are covered by indexes for potential index-only plans.
- **\\$lookup / \\$unwind**: Evaluate whether join or array-unwind stages can benefit from supporting indexes.
- **Multi-branch match**: For \\$or or \\$in conditions, consider compound indexes or index intersection.
- **Multikey / sparse / partial indexes**: Ensure indexes on array or sparse fields still support coverage without excessive size or write amplification.
- **Index size and write cost**: Avoid high-cardinality indexes that rarely match queries; prefer selective prefixes or partial indexes.
- **Projection coverage**: If all projected fields are indexed, prioritize index-only scan opportunities.
- If you identify indexes related to the query that have **not been accessed for a long time** or **are not selective**, consider recommending **dropping** them to reduce write and storage overhead.
- If you identify query is on a **small collection** (e.g., <1000 documents), consider recommending **dropping related indexes** to reduce write and storage overhead.
- If the **Azure_Cluster_Type** is "vCore" and a **composite index** is being created, include in \`indexOptions\` the setting: \`"storageEngine": { "enableOrderedIndex": true }\`.
- **Vector recall rule** — If the **Azure_Cluster_Type** is "vCore" and uses a cosmosSearch with index has \`"kind": "vector-ivf"\`, but the collection contains many documents (over 10k) or the vector dimensionality is high, recommend replacing it with a \`vector-hnsw\` index for better recall and retrieval quality. The recommended creation command format is:
  {
      "createIndexes": "<collection_name>",
      "indexes": [
          {
              "name": "<index_name>",
              "key": {
                  "<path_to_property>": "cosmosSearch"
              },
              "cosmosSearchOptions": {
                  "kind": "vector-hnsw",
                  "m": <integer_value>,
                  "efConstruction": <integer_value>,
                  "similarity": "<string_value>",
                  "dimensions": <integer_value>
              }
          }
      ]
  }
Output JSON schema (required shape; adhere exactly):
\`\`\`
{
  "metadata": {
    "collectionName": "<string>",
    "collectionStats": { ... },
    "indexStats": [ ... ],
    "executionStats": { ... },
    "derived": {
      "totalKeysExamined": <number|null>,
      "totalDocsExamined": <number|null>,
      "keysToDocsRatio": <number|null>,
      "usedIndex": "<indexKeyPattern or 'COLLSCAN' or null>"
    }
  },
  "analysis": "<markdown string, <=6 sentences>",
  "improvements": [
    {
      "action": "create" | "drop" | "none" | "modify",
      "indexSpec": { "<field>": 1|-1, ... },
      "indexOptions": {  },
      "mongoShell": "db.getCollection(\\"{collectionName}\\").createIndex({...}, {...})" ,
      "justification": "<one-sentence justification referencing executionStats/indexStats>",
      "priority": "high" | "medium" | "low",
      "risks": "<short risk note or null>"
    }
  ],
  "verification": "<markdown string that contains one or more code blocks, each block showing mongosh commands to verify index performance or stats.>"
}
\`\`\`
Additional rules for the JSON:
- \`metadata.collectionName\` must be filled from \`{collectionStats.ns}\` or a suitable field; if not available set to \`null\`.
- \`derived.totalKeysExamined\`, \`derived.totalDocsExamined\`, and \`derived.keysToDocsRatio\` should be filled from \`executionStats\` if present, otherwise \`null\`. \`keysToDocsRatio\` = \`totalKeysExamined / max(1, totalDocsExamined)\`.
- \`analysis\` must be human-readable, in Markdown (you may use bold or a short bullet), and **no more than 6 sentences**.
- \`mongoShell\` commands must **only** use double quotes and valid JS object notation.
- \`verification\` must be human-readable, in Markdown. It should include one or more \`\`\`javascript code blocks\`\`\` containing valid mongosh commands. Each code block should be concise and executable as-is in mongosh.
`;

export const COUNT_QUERY_PROMPT_TEMPLATE = `
You are an expert MongoDB assistant to provide index suggestions for the following count query:
- **Query**: {query}
The query is executed against a MongoDB collection with the following details:
## Cluster Information
- **Is_Azure_Cluster**: {isAzureCluster}
- **Azure_Cluster_Type**: {AzureClusterType}
## Collection Information
- **Collection_Stats**: {collectionStats}
## Index Information of Current Collection
- **Indexes_Stats**: {indexStats}
## Query Execution Stats
- **Execution_Stats**: {executionStats}
## Cluster Information
- **Cluster_Type**: {clusterType}  // e.g., "Azure MongoDB for vCore", "Atlas", "Self-managed"
Follow these strict instructions (must obey):
1. **Single JSON output only** — your response MUST be a single valid JSON object and **nothing else** (no surrounding text, no code fences, no explanation).
2. **Do not hallucinate** — only use facts present in the sections Query, Collection_Stats, Indexes_Stats, Execution_Stats, Cluster_Type. If a required metric is absent, set the corresponding field to \`null\` in \`metadata\`.
3. **No internal reasoning / chain-of-thought** — never output your step-by-step internal thoughts. Give concise, evidence-based conclusions only.
4. **Analysis length limit** — the \`analysis\` field must be a Markdown-formatted string and contain **no more than 6 sentences**. Be concise.
5. **Runnable shell commands** — any index changes you recommend must be provided as **mongosh/mongo shell** commands (runnable). Use \`db.getCollection("{collectionName}")\` to reference the collection (replace \`{collectionName}\` with the actual name from \`collectionStats\`).
6. **Justify every index command** — each \`create\`/\`drop\` recommendation must include a one-sentence justification that references concrete fields/metrics from \`executionStats\` or \`indexStats\`.
7. **Prefer minimal, safe changes** — prefer a single, high-impact index over many small ones; avoid suggesting drops unless the benefit is clear and justified.
8. **Include priority** — each suggested improvement must include a \`priority\` (\`high\`/\`medium\`/\`low\`) so an engineer can triage.
9. **Be explicit about risks** — if a suggested index could increase write cost or large index size, include that as a short risk note in the improvement.
10. **Verification output** — the \`verification\` field must be a **Markdown string** (not an array). It should include one or more \`\`\`javascript code blocks\`\`\` containing **valid mongosh commands** to verify index performance or collection stats. Each command must be copy-paste runnable in mongosh (e.g. \`db.getCollection("{collectionName}").find(...).hint(...).explain("executionStats")\`).
11. **Do not change input objects** — echo input objects only under \`metadata\`; do not mutate \`{collectionStats}\`, \`{indexStats}\`, or \`{executionStats}\`—just include them as-is (and add computed helper fields if needed).
12. **If no change recommended** — return an empty \`improvements\` array and still include a short Markdown \`verification\` section to confirm the current plan.
Thinking / analysis tips (for your reasoning; do not output these tips):
- **Index-only optimization**: The best count performance occurs when all filter fields are indexed, allowing a covered query that avoids document fetches entirely.
- **Filter coverage**: Ensure all equality and range predicates in the count query are covered by an index; if not, suggest a compound index with equality fields first, range fields last.
- **COLLSCAN detection**: If totalDocsExamined is close to collection document count and no index is used, a full collection scan occurred — propose an index that minimizes this.
- **Sparse and partial indexes**: If the query filters on a field that only exists in some documents, consider a sparse or partial index to reduce index size and scan scope.
- **Equality and range ordering**: For compound indexes, equality filters should precede range filters for optimal selectivity.
- **Index-only count**: If projected or returned fields are all indexed (e.g., just counting documents matching criteria), prefer a covered plan for index-only count.
- **Write cost tradeoff**: Avoid over-indexing — recommend only indexes that materially improve count query performance or prevent full collection scans.
- If you identify indexes related to the query that have **not been accessed for a long time** or **are not selective**, consider recommending **dropping** them to reduce write and storage overhead.
- If you identify query is on a **small collection** (e.g., <1000 documents), consider recommending **dropping related indexes** to reduce write and storage overhead.
- If the **Azure_Cluster_Type** is "vCore" and a **composite index** is being created, include in \`indexOptions\` the setting: \`"storageEngine": { "enableOrderedIndex": true }\`.
Output JSON schema (required shape; adhere exactly):
\`\`\`
{
  "metadata": {
    "collectionName": "<string>",
    "collectionStats": { ... },
    "indexStats": [ ... ],
    "executionStats": { ... },
    "derived": {
      "totalKeysExamined": <number|null>,
      "totalDocsExamined": <number|null>,
      "keysToDocsRatio": <number|null>,
      "usedIndex": "<indexKeyPattern or 'COLLSCAN' or null>"
    }
  },
  "analysis": "<markdown string, <=6 sentences>",
  "improvements": [
    {
      "action": "create" | "drop" | "none" | "modify",
      "indexSpec": { "<field>": 1|-1, ... },
      "indexOptions": {  },
      "mongoShell": "db.getCollection(\\"{collectionName}\\").createIndex({...}, {...})" ,
      "justification": "<one-sentence justification referencing executionStats/indexStats>",
      "priority": "high" | "medium" | "low",
      "risks": "<short risk note or null>"
    }
  ],
    "verification": "<markdown string that contains one or more code blocks, each block showing mongosh commands to verify index performance or stats.>"
}
\`\`\`
Additional rules for the JSON:
- \`metadata.collectionName\` must be filled from \`{collectionStats.ns}\` or a suitable field; if not available set to \`null\`.
- \`derived.totalKeysExamined\`, \`derived.totalDocsExamined\`, and \`derived.keysToDocsRatio\` should be filled from \`executionStats\` if present, otherwise \`null\`. \`keysToDocsRatio\` = \`totalKeysExamined / max(1, totalDocsExamined)\`.
- \`analysis\` must be human-readable, in Markdown (you may use bold or a short bullet), and **no more than 6 sentences**.
- \`mongoShell\` commands must **only** use double quotes and valid JS object notation.
- \`verification\` must be human-readable, in Markdown. It should include one or more \`\`\`javascript code blocks\`\`\` containing valid mongosh commands. Each code block should be concise and executable as-is in mongosh.
`;

export const CROSS_COLLECTION_QUERY_PROMPT_TEMPLATE = `
You are an expert MongoDB assistant. Generate a MongoDB query based on the user's natural language request.
## Database Context
- **Database Name**: {databaseName}
- **User Request**: {naturalLanguageQuery}
## Available Collections and Their Schemas
{schemaInfo}

## Query Type Requirement
- **Required Query Type**: {targetQueryType}
- You MUST generate a query of this exact type. Do not use other query types even if they might seem more appropriate.

## Instructions
1. **Single JSON output only** — your response MUST be a single valid JSON object matching the schema below. No code fences, no surrounding text.
2. **MongoDB shell commands** — all queries must be valid MongoDB shell commands (mongosh) that can be executed directly, not javaScript functions or pseudo-code.
3. **Strict query type adherence** — you MUST generate a **{targetQueryType}** query as specified above. Ignore this requirement only if the user explicitly requests a different query type.
4. **Cross-collection queries** — the user has NOT specified a collection name, so you may need to generate queries that work across multiple collections. Consider using:
   - Multiple separate queries (one per collection) if the request is collection-specific
   - Aggregation pipelines with $lookup if joining data from multiple collections
   - Union operations if combining results from different collections
5. **Use schema information** — examine the provided schemas to understand the data structure and field types in each collection.
6. **Respect data types** — use appropriate MongoDB operators based on the field types shown in the schema.
7. **Handle nested objects** — when you see \`type: "object"\` with \`properties\`, those are nested fields accessible with dot notation.
8. **Handle arrays** — when you see \`type: "array"\` with \`items\`, use appropriate array operators. If \`vectorLength\` is present, that's a fixed-size numeric array.
9. **Generate runnable queries** — output valid MongoDB shell syntax (mongosh) that can be executed directly.
10. **Provide clear explanation** — explain which collection(s) you're querying and why, and describe the query logic.
11. **Use db.<collectionName> syntax** — reference collections using \`db.collectionName\` or \`db.getCollection("collectionName")\` format.
12. **Prefer simple queries** — start with the simplest query that meets the user's needs; avoid over-complication.
13. **Consider performance** — if multiple approaches are possible, prefer the one that's more likely to be efficient.
## Query Generation Guidelines for {targetQueryType}
{queryTypeGuidelines}

## Output JSON Schema
{outputSchema}

## Examples
User request: "Find all users who signed up in the last 7 days"
\`\`\`json
{
  "explanation": "This query searches the 'users' collection for documents where the createdAt field is greater than or equal to 7 days ago. It uses the $gte operator to filter dates.",
  "command": {
    "filter": "{ \\"createdAt\\": { \\"$gte\\": { \\"$date\\": \\"<7_days_ago_ISO_string>\\" } } }",
    "project": "{}",
    "sort": "{}",
    "skip": 0,
    "limit": 0
  }
}
\`\`\`
User request: "Get total revenue by product category"
\`\`\`json
{
  "explanation": "This aggregation pipeline joins orders with products using $lookup, unwinds the product array, groups by product category, and calculates the sum of order amounts for each category, sorted by revenue descending.",
  "command": {
    "pipeline": "[{ \\"$lookup\\": { \\"from\\": \\"products\\", \\"localField\\": \\"productId\\", \\"foreignField\\": \\"_id\\", \\"as\\": \\"product\\" } }, { \\"$unwind\\": \\"$product\\" }, { \\"$group\\": { \\"_id\\": \\"$product.category\\", \\"totalRevenue\\": { \\"$sum\\": \\"$amount\\" } } }, { \\"$sort\\": { \\"totalRevenue\\": -1 } }]"
  }
}
\`\`\`
Now generate the query based on the user's request and the provided schema information.
`;

export const SINGLE_COLLECTION_QUERY_PROMPT_TEMPLATE = `
You are an expert MongoDB assistant. Generate a MongoDB query based on the user's natural language request.
## Database Context
- **Database Name**: {databaseName}
- **Collection Name**: {collectionName}
- **User Request**: {naturalLanguageQuery}
## Collection Schema
{schemaInfo}
## Query Type Requirement
- **Required Query Type**: {targetQueryType}
- You MUST generate a query of this exact type. Do not use other query types even if they might seem more appropriate.

## Instructions
1. **Single JSON output only** — your response MUST be a single valid JSON object matching the schema below. No code fences, no surrounding text.
2. **MongoDB shell commands** — all queries must be valid MongoDB shell commands (mongosh) that can be executed directly, not javaScript functions or pseudo-code.
3. **Strict query type adherence** — you MUST generate a **{targetQueryType}** query as specified above.
4. **One-sentence query** — your response must be a single, concise query that directly addresses the user's request.
5. **Return error** — When query generation is not possible (e.g., the input is invalid, contradictory, unrelated to the data schema, or incompatible with the expected query type), output an error message starts with \`Error:\` in the explanation field and \`null\` as command.
6. **Single-collection query** — the user has specified a collection name, so generate a query that works on this collection only.
7. **Use schema information** — examine the provided schema to understand the data structure and field types.
8. **Respect data types** — use appropriate MongoDB operators based on the field types shown in the schema.
9. **Handle nested objects** — when you see \`type: "object"\` with \`properties\`, those are nested fields accessible with dot notation (e.g., \`address.city\`).
10. **Handle arrays** — when you see \`type: "array"\` with \`items\`, use appropriate array operators like $elemMatch, $size, $all, etc. If \`vectorLength\` is present, that's a fixed-size numeric array (vector/embedding).
11. **Handle unions** — when you see \`type: "union"\` with \`variants\`, the field can be any of those types (handle null cases appropriately).
12. **Generate runnable queries** — output valid MongoDB shell syntax (mongosh) that can be executed directly on the specified collection.
13. **Provide clear explanation** — describe what the query does and the operators/logic used.
14. **Use db.{collectionName} syntax** — reference the collection using \`db.{collectionName}\` or \`db.getCollection("{collectionName}")\` format.
15. **Prefer simple queries** — start with the simplest query that meets the user's needs; avoid over-complication.
16. **Consider performance** — if multiple approaches are possible, prefer the one that's more likely to use indexes efficiently.
## Query Generation Guidelines for {targetQueryType}
{queryTypeGuidelines}

## Common MongoDB Operators Reference
- **Comparison**: $eq, $ne, $gt, $gte, $lt, $lte, $in, $nin
- **Logical**: $and, $or, $not, $nor
- **Element**: $exists, $type
- **Array**: $elemMatch, $size, $all
- **Evaluation**: $regex, $text, $where, $expr
- **Aggregation**: $match, $group, $project, $sort, $limit, $lookup, $unwind
## Output JSON Schema
{outputSchema}

## Examples
User request: "Find all documents where price is greater than 100"
\`\`\`json
{
  "explanation": "This query filters documents where the price field is greater than 100 using the $gt comparison operator.",
  "command": {
    "filter": "{ \\"price\\": { \\"$gt\\": 100 } }",
    "project": "{}",
    "sort": "{}",
    "skip": 0,
    "limit": 0
  }
}
\`\`\`
User request: "Get the average rating grouped by category"
\`\`\`json
{
  "explanation": "This aggregation pipeline groups documents by the category field, calculates the average rating for each group using $avg, and sorts the results by average rating in descending order.",
  "command": {
    "pipeline": "[{ \\"$group\\": { \\"_id\\": \\"$category\\", \\"avgRating\\": { \\"$avg\\": \\"$rating\\" } } }, { \\"$sort\\": { \\"avgRating\\": -1 } }]"
  }
}
\`\`\`
User request: "Find documents with tags array containing 'featured' and status is 'active', sorted by createdAt, limit 10"
\`\`\`json
{
  "explanation": "This query finds documents where the tags array contains 'featured' and the status field equals 'active'. MongoDB's default array behavior matches any element in the array. Results are sorted by createdAt in descending order and limited to 10 documents.",
  "command": {
    "filter": "{ \\"tags\\": \\"featured\\", \\"status\\": \\"active\\" }",
    "project": "{}",
    "sort": "{ \\"createdAt\\": -1 }",
    "skip": 0,
    "limit": 10
  }
}
\`\`\`
Now generate the query based on the user's request and the provided collection schema.
`;

/**
 * Gets query type specific configuration (guidelines and output schema)
 * @param queryType The type of query
 * @returns Configuration object with guidelines and outputSchema
 */
export function getQueryTypeConfig(queryType: string): { guidelines: string; outputSchema: string } {
    switch (queryType) {
        case 'Find':
            return {
                guidelines: `- Generate a find query with appropriate filters, projections, sort, skip, and limit
- Use MongoDB query operators for filtering: $eq, $ne, $gt, $gte, $lt, $lte, $in, $nin, $regex, etc.
- Use projection to specify which fields to include or exclude
- Use sort to order results (1 for ascending, -1 for descending)
- Use skip and limit for pagination
- All fields should be valid JSON strings except skip and limit which are numbers`,
                outputSchema: `\`\`\`json
{
  "explanation": "<Clear explanation of what the query does and why this approach was chosen>",
  "command": {
    "filter": "<MongoDB filter as JSON string, e.g., '{ \\"age\\": { \\"$gt\\": 25 } }'>",
    "project": "<MongoDB projection as JSON string, e.g., '{ \\"name\\": 1, \\"age\\": 1 }'>",
    "sort": "<MongoDB sort as JSON string, e.g., '{ \\"age\\": -1 }'>",
    "skip": <number>,
    "limit": <number>
  }
}
\`\`\``,
            };

        case 'Aggregation':
            return {
                guidelines: `- Generate an aggregation pipeline with appropriate stages
- Common stages: $match (filtering), $group (grouping/aggregation), $project (field selection/transformation)
- Use $sort and $limit for ordering and limiting results
- Use $lookup for joining with other collections
- Use $unwind for array expansion
- Prefer $match early in the pipeline for performance
- Pipeline should be a JSON string representing an array of stages`,
                outputSchema: `\`\`\`json
{
  "explanation": "<Clear explanation of each pipeline stage and why this approach was chosen>",
  "command": {
    "pipeline": "<Aggregation pipeline as JSON string, e.g., '[{ \\"$match\\": { \\"age\\": { \\"$gt\\": 25 } } }, { \\"$group\\": { \\"_id\\": \\"$city\\", \\"count\\": { \\"$sum\\": 1 } } }]'>"
  }
}
\`\`\``,
            };

        case 'Count':
            return {
                guidelines: `- Generate a count query with appropriate filter
- Use MongoDB query operators for filtering
- Filter should be a valid JSON string`,
                outputSchema: `\`\`\`json
{
  "explanation": "<Clear explanation of the filter and count operation>",
  "command": {
    "filter": "<MongoDB filter as JSON string, e.g., '{ \\"status\\": \\"active\\" }'>"
  }
}
\`\`\``,
            };

        case 'Update':
            return {
                guidelines: `- Generate an update query with filter and update operations
- Use update operators: $set (set field), $inc (increment), $push (add to array), $pull (remove from array)
- Specify whether to update one or many documents
- Use options like upsert if needed
- All fields should be valid JSON strings`,
                outputSchema: `\`\`\`json
{
  "explanation": "<Clear explanation of the filter, update operation, and expected result>",
  "command": {
    "filter": "<MongoDB filter as JSON string>",
    "update": "<MongoDB update operations as JSON string, e.g., '{ \\"$set\\": { \\"status\\": \\"active\\" } }'>",
    "options": "<Optional update options as JSON string, e.g., '{ \\"upsert\\": true }'>"
  }
}
\`\`\``,
            };

        case 'Delete':
            return {
                guidelines: `- Generate a delete query with appropriate filter
- Be careful with filters to avoid unintended deletions
- Filter should be a valid JSON string`,
                outputSchema: `\`\`\`json
{
  "explanation": "<Clear explanation of the filter and which documents will be deleted>",
  "command": {
    "filter": "<MongoDB filter as JSON string>"
  }
}
\`\`\``,
            };

        default:
            throw new Error(l10n.t('Unsupported query type: {queryType}', { queryType }));
    }
}
