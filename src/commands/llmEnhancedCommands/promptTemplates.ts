/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { l10n } from 'vscode';

import { promptTemplateLoader } from '../../utils/PromptTemplateLoader';

/**
 * Preferred language model for index optimization
 */
export const PREFERRED_MODEL = 'gpt-5';

/**
 * Fallback models to use if the preferred model is not available
 */
export const FALLBACK_MODELS = ['gpt-4o', 'gpt-4o-mini'];

/**
 * Lazy-loaded prompt templates for query optimization.
 * These templates are stored as markdown files in resources/prompts and loaded on demand.
 */

/**
 * Loads the find query prompt template
 * @returns The find query prompt template content
 */
export async function getFindQueryPromptTemplate(): Promise<string> {
    return promptTemplateLoader.loadTemplate('find-query-prompt-template.md');
}

/**
 * Loads the aggregate query prompt template
 * @returns The aggregate query prompt template content
 */
export async function getAggregateQueryPromptTemplate(): Promise<string> {
    return promptTemplateLoader.loadTemplate('aggregate-query-prompt-template.md');
}

/**
 * Loads the count query prompt template
 * @returns The count query prompt template content
 */
export async function getCountQueryPromptTemplate(): Promise<string> {
    return promptTemplateLoader.loadTemplate('count-query-prompt-template.md');
}

/**
 * Loads the cross-collection query prompt template
 * @returns The cross-collection query prompt template content
 */
export async function getCrossCollectionQueryPromptTemplate(): Promise<string> {
    return promptTemplateLoader.loadTemplate('cross-collection-query-prompt-template.md');
}

/**
 * Loads the single collection query prompt template
 * @returns The single collection query prompt template content
 */
export async function getSingleCollectionQueryPromptTemplate(): Promise<string> {
    return promptTemplateLoader.loadTemplate('single-collection-query-prompt-template.md');
}

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
