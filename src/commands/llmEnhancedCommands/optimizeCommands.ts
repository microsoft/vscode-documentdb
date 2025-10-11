/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { ClustersClient } from '../../documentdb/ClustersClient';
import { type CollectionStats, type IndexStats } from '../../documentdb/IndexAdvisorApis';
import { CopilotService } from '../../services/copilotService';
import {
    AGGREGATE_QUERY_PROMPT_TEMPLATE,
    COUNT_QUERY_PROMPT_TEMPLATE,
    FIND_QUERY_PROMPT_TEMPLATE,
} from './promptTemplates';

/**
 * Preferred language model for index optimization
 */
export const PREFERRED_MODEL = 'gpt-5';

/**
 * Fallback models to use if the preferred model is not available
 */
export const FALLBACK_MODELS = ['gpt-4o', 'gpt-4o-mini'];

/**
 * Type of MongoDB command to optimize
 */
export enum CommandType {
    Find = 'find',
    Aggregate = 'aggregate',
    Count = 'count',
}

/**
 * Context information needed for query optimization
 */
export interface QueryOptimizationContext {
    // The cluster/connection ID
    clusterId: string;
    // Database name
    databaseName: string;
    // Collection name
    collectionName: string;
    // The query or pipeline to optimize
    query: string;
    // The detected command type
    commandType: CommandType;
}

/**
 * Result from query optimization
 */
export interface OptimizationResult {
    // The optimization recommendations
    recommendations: string;
    // The model used to generate recommendations
    modelUsed: string;
}

/**
 * Gets the prompt template for a given command type
 * @param commandType The type of command
 * @returns The prompt template string
 */
function getPromptTemplate(commandType: CommandType): string {
    switch (commandType) {
        case CommandType.Find:
            return FIND_QUERY_PROMPT_TEMPLATE;
        case CommandType.Aggregate:
            return AGGREGATE_QUERY_PROMPT_TEMPLATE;
        case CommandType.Count:
            return COUNT_QUERY_PROMPT_TEMPLATE;
        default:
            throw new Error(l10n.t('Prompt template not found for command type: {type}', { type: commandType }));
    }
}

/**
 * Detects the type of MongoDB command from the query string
 * @param command The MongoDB command string
 * @returns The detected command type
 */
export function detectCommandType(command: string): CommandType {
    const trimmed = command.trim().toLowerCase();

    // Check for aggregate
    if (trimmed.includes('.aggregate(') || trimmed.startsWith('[')) {
        return CommandType.Aggregate;
    }

    // Check for count
    if (trimmed.includes('.count(') || trimmed.includes('.countdocuments(')) {
        return CommandType.Count;
    }

    if (trimmed.includes('.find(')) {
        return CommandType.Find;
    }

    // Throw unsupported if we see other commands
    throw new Error(l10n.t('Unsupported command type detected.'));
}

/**
 * Fills a prompt template with actual data
 * @param templateType The type of template to use (find, aggregate, or count)
 * @param context The query optimization context
 * @param collectionStats Statistics about the collection
 * @param indexes Current indexes on the collection
 * @param executionStats Execution statistics from explain()
 * @returns The filled prompt template
 */
function fillPromptTemplate(
    templateType: CommandType,
    context: QueryOptimizationContext,
    collectionStats: CollectionStats,
    indexes: Array<IndexStats>,
    executionStats: string,
): string {
    // Get the template for this command type
    const template = getPromptTemplate(templateType);

    // Fill the template with actual data
    let filled = template
        .replace('{databaseName}', context.databaseName)
        .replace('{collectionName}', context.collectionName)
        .replace('{collectionStats}', JSON.stringify(collectionStats, null, 2))
        .replace('{indexStats}', JSON.stringify(indexes, null, 2))
        .replace('{executionStats}', executionStats);

    // Replace query/pipeline placeholder based on command type
    if (templateType === CommandType.Aggregate) {
        filled = filled.replace('{pipeline}', context.query);
    } else {
        filled = filled.replace('{query}', context.query);
    }

    return filled;
}

/**
 * Optimizes a MongoDB query using Copilot AI
 * @param context Action context for telemetry
 * @param queryContext Query optimization context
 * @returns Optimization recommendations
 */
export async function optimizeQuery(
    context: IActionContext,
    queryContext: QueryOptimizationContext,
): Promise<OptimizationResult> {
    // Check if Copilot is available
    const copilotAvailable = await CopilotService.isAvailable();
    if (!copilotAvailable) {
        throw new Error(
            l10n.t(
                'GitHub Copilot is not available. Please install the GitHub Copilot extension and ensure you have an active subscription.',
            ),
        );
    }

    // Get the MongoDB client
    const client = await ClustersClient.getClient(queryContext.clusterId);

    // Parse the query to extract filter, sort, projection, etc.
    const parsedQuery = parseQueryString(queryContext.query, queryContext.commandType);

    // Gather information needed for optimization
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let explainResult: any;
    let collectionStats: CollectionStats;
    let indexes: Array<IndexStats>;

    try {
        // Execute explain based on command type
        if (queryContext.commandType === CommandType.Find) {
            const explainData = await client.explainFind(
                queryContext.databaseName,
                queryContext.collectionName,
                parsedQuery.explainOptions,
            );
            explainResult = explainData;
        } else if (queryContext.commandType === CommandType.Aggregate) {
            const explainData = await client.explainAggregate(
                queryContext.databaseName,
                queryContext.collectionName,
                // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
                parsedQuery.pipeline || [],
            );
            explainResult = explainData;
        } else if (queryContext.commandType === CommandType.Count) {
            explainResult = await client.explainCount(
                queryContext.databaseName,
                queryContext.collectionName,
                // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
                parsedQuery.filter || {},
            );
        }

        collectionStats = await client.getCollectionStats(queryContext.databaseName, queryContext.collectionName);
        indexes = await client.getIndexStats(queryContext.databaseName, queryContext.collectionName);
    } catch (error) {
        throw new Error(
            l10n.t('Failed to gather query optimization data: {message}', {
                message: error instanceof Error ? error.message : String(error),
            }),
        );
    }

    // Format execution stats for the prompt
    const executionStats = JSON.stringify(explainResult, null, 2);

    // Fill the prompt template
    const commandType = queryContext.commandType;
    const promptContent = fillPromptTemplate(commandType, queryContext, collectionStats, indexes, executionStats);

    // Send to Copilot with configured models
    const response = await CopilotService.sendMessage([vscode.LanguageModelChatMessage.User(promptContent)], {
        preferredModel: PREFERRED_MODEL,
        fallbackModels: FALLBACK_MODELS,
    });

    // Check if the preferred model was used
    if (response.modelUsed !== PREFERRED_MODEL && PREFERRED_MODEL) {
        // Show warning if not using preferred model
        void vscode.window.showWarningMessage(
            l10n.t(
                'Index optimization is using model "{actualModel}" instead of preferred "{preferredModel}". Recommendations may be less optimal.',
                {
                    actualModel: response.modelUsed,
                    preferredModel: PREFERRED_MODEL,
                },
            ),
        );
    }

    // Add telemetry for the model used
    context.telemetry.properties.modelUsed = response.modelUsed;
    context.telemetry.properties.commandType = commandType;

    return {
        recommendations: response.text,
        modelUsed: response.modelUsed,
    };
}

/**
 * Converts MongoDB-like query syntax to valid JSON
 * Handles single quotes, unquoted keys, and MongoDB operators
 */
function mongoQueryToJSON(str: string): string {
    let result = str;

    // Replace single quotes with double quotes
    result = result.replace(/'/g, '"');

    // Add quotes to unquoted MongoDB operators starting with $
    result = result.replace(/\$(\w+)/g, '"$$$1"');

    // Add quotes to unquoted object keys (word followed by colon)
    // This regex looks for word characters followed by optional whitespace and a colon
    // But not if they're already quoted or are part of a value
    result = result.replace(/(\{|,)\s*([a-zA-Z_]\w*)\s*:/g, '$1"$2":');

    return result;
}

/**
 * Extracts a method call argument from a query string
 * Example: extractMethodArg("sort({'name': -1})", "sort") => "{'name': -1}"
 */
function extractMethodArg(query: string, methodName: string): string | undefined {
    const pattern = new RegExp(`\\.${methodName}\\s*\\(\\s*([^)]+)\\s*\\)`, 'i');
    const match = query.match(pattern);
    return match ? match[1].trim() : undefined;
}

/**
 * Parses a query string to extract MongoDB query components
 * @param queryString The query string to parse
 * @param commandType The type of command
 * @returns Parsed query components
 */
function parseQueryString(
    queryString: string,
    commandType: CommandType,
): {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    filter?: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pipeline?: any[];
    explainOptions?: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        filter?: any;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        sort?: any;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        projection?: any;
        skip?: number;
        limit?: number;
    };
} {
    const trimmed = queryString.trim();

    try {
        if (commandType === CommandType.Aggregate) {
            // Parse aggregation pipeline
            // Handle both array format and .aggregate() format
            let pipelineStr = trimmed;

            // Remove .aggregate() wrapper if present
            const aggregateMatch = trimmed.match(/\.aggregate\s*\(\s*(\[[\s\S]*\])\s*\)/);
            if (aggregateMatch) {
                pipelineStr = aggregateMatch[1];
            }

            // Convert MongoDB syntax to JSON and parse
            const jsonStr = mongoQueryToJSON(pipelineStr);
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            const pipeline = JSON.parse(jsonStr);
            if (!Array.isArray(pipeline)) {
                throw new Error('Pipeline must be an array');
            }

            return { pipeline };
        } else if (commandType === CommandType.Count) {
            // Parse count query
            // Handle .count() or .countDocuments() format
            const countMatch = trimmed.match(/\.count(?:Documents)?\s*\(\s*(\{[\s\S]*?\})\s*\)/);
            let filterStr = countMatch ? countMatch[1] : trimmed.startsWith('{') ? trimmed : '{}';

            // Convert MongoDB syntax to JSON
            filterStr = mongoQueryToJSON(filterStr);
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            const filter = JSON.parse(filterStr);

            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            return { filter };
        } else {
            // Parse find query with chained methods
            // Example: db.test.find({'age': {$gt: 25}}).sort({'name': -1}).limit(15).project({'name': 1})

            let filterStr = '{}';

            // Extract filter from .find()
            const findMatch = trimmed.match(/\.find\s*\(\s*(\{[\s\S]*?\})\s*\)/);
            if (findMatch) {
                filterStr = findMatch[1];
            } else if (trimmed.startsWith('{')) {
                filterStr = trimmed;
            }

            // Convert MongoDB syntax to JSON and parse filter
            filterStr = mongoQueryToJSON(filterStr);
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            const filter = JSON.parse(filterStr);

            const explainOptions: {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                filter?: any;
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                sort?: any;
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                projection?: any;
                skip?: number;
                limit?: number;
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            } = { filter };

            // Extract sort from .sort()
            const sortStr = extractMethodArg(trimmed, 'sort');
            if (sortStr) {
                const sortJson = mongoQueryToJSON(sortStr);
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                explainOptions.sort = JSON.parse(sortJson);
            }

            // Extract projection from .project() or .projection()
            let projectionStr = extractMethodArg(trimmed, 'project');
            if (!projectionStr) {
                projectionStr = extractMethodArg(trimmed, 'projection');
            }
            if (projectionStr) {
                const projectionJson = mongoQueryToJSON(projectionStr);
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                explainOptions.projection = JSON.parse(projectionJson);
            }

            // Extract skip from .skip()
            const skipStr = extractMethodArg(trimmed, 'skip');
            if (skipStr) {
                explainOptions.skip = parseInt(skipStr, 10);
            }

            // Extract limit from .limit()
            const limitStr = extractMethodArg(trimmed, 'limit');
            if (limitStr) {
                explainOptions.limit = parseInt(limitStr, 10);
            }

            return { explainOptions };
        }
    } catch (error) {
        throw new Error(
            l10n.t('Failed to parse query string: {message}', {
                message: error instanceof Error ? error.message : String(error),
            }),
        );
    }
}
