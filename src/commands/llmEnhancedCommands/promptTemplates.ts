/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Embedded prompt templates for query optimization
 * These templates are compiled into the extension bundle at build time
 */

export const FIND_QUERY_PROMPT_TEMPLATE = `# MongoDB Find Query Optimization

You are an expert MongoDB database administrator helping to optimize a find query.

## Database Information
- **Database**: {databaseName}
- **Collection**: {collectionName}
- **Document Count**: {documentCount}

## Current Query
\`\`\`javascript
{query}
\`\`\`

## Current Indexes
{indexes}

## Query Execution Stats
{executionStats}

## Task
Analyze the query and current indexes, then provide recommendations for:
1. New indexes that should be created to optimize this query
2. Existing indexes that are not being used and could be removed
3. Compound index suggestions if applicable
4. Any query rewrite suggestions to improve performance

Please provide specific index creation commands in MongoDB syntax.
`;

export const AGGREGATE_QUERY_PROMPT_TEMPLATE = `# MongoDB Aggregation Pipeline Optimization

You are an expert MongoDB database administrator helping to optimize an aggregation pipeline.

## Database Information
- **Database**: {databaseName}
- **Collection**: {collectionName}
- **Document Count**: {documentCount}

## Current Aggregation Pipeline
\`\`\`javascript
{pipeline}
\`\`\`

## Current Indexes
{indexes}

## Pipeline Execution Stats
{executionStats}

## Task
Analyze the aggregation pipeline and current indexes, then provide recommendations for:
1. Pipeline stage reordering for better performance
2. Indexes that should be created to optimize pipeline stages (especially $match and $sort)
3. Existing indexes that are not being used and could be removed
4. $match stages that could be moved earlier in the pipeline
5. Any other pipeline optimization suggestions

Please provide specific index creation commands and optimized pipeline structure in MongoDB syntax.
`;

export const COUNT_QUERY_PROMPT_TEMPLATE = `# MongoDB Count Query Optimization

You are an expert MongoDB database administrator helping to optimize a count query.

## Database Information
- **Database**: {databaseName}
- **Collection**: {collectionName}
- **Document Count**: {documentCount}

## Current Count Query
\`\`\`javascript
{query}
\`\`\`

## Current Indexes
{indexes}

## Query Execution Stats
{executionStats}

## Task
Analyze the count query and current indexes, then provide recommendations for:
1. Indexes that should be created to optimize the count operation
2. Whether to use estimatedDocumentCount() vs countDocuments() based on the use case
3. Existing indexes that could help with the query filter
4. Any query optimization suggestions

Please provide specific recommendations and index creation commands in MongoDB syntax.
`;
