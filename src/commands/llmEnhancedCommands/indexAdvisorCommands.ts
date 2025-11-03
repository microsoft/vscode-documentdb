/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { ClustersClient } from '../../documentdb/ClustersClient';
import { type CollectionStats, type IndexStats } from '../../documentdb/LlmEnhancedFeatureApis';
import { type ClusterMetadata } from '../../documentdb/utils/getClusterMetadata';
import { CopilotService } from '../../services/copilotService';
import { PromptTemplateService } from '../../services/promptTemplateService';
import { FALLBACK_MODELS, PREFERRED_MODEL } from './promptTemplates';

/**
 * Type of MongoDB command to optimize
 */
export enum CommandType {
    Find = 'find',
    Aggregate = 'aggregate',
    Count = 'count',
}

/**
 * Query object structure
 * NOTE: For now we only support find queries here
 */
export interface QueryObject {
    // Filter criteria
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    filter?: any;
    // Sort specification
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sort?: any;
    // Projection specification
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    projection?: any;
    // Number of documents to skip
    skip?: number;
    // Maximum number of documents to return
    limit?: number;
}

/**
 * Context information needed for query optimization
 */
export interface QueryOptimizationContext {
    // The cluster/connection ID
    clusterId?: string;
    // Database name
    databaseName: string;
    // Collection name
    collectionName: string;
    // The query or pipeline to optimize
    // Will be removed in later version
    // Currently remains for aggregate and count commands
    query?: string;
    // The query object for find operations
    queryObject?: QueryObject;
    // The detected command type
    commandType: CommandType;
    // Pre-loaded execution plan
    executionPlan?: unknown;
    // Pre-loaded collection stats
    collectionStats?: CollectionStats;
    // Pre-loaded index stat
    indexStats?: IndexStats[];
    // Preferred LLM model for optimization
    preferredModel?: string;
    // Fallback LLM models
    fallbackModels?: string[];
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
 * Recursively removes constant values from query filters while preserving field names and operators
 * @param obj The object to process
 * @returns Processed object with constants removed
 */
function removeConstantsFromFilter(obj: unknown): unknown {
    if (obj === null || obj === undefined) {
        return obj;
    }

    if (Array.isArray(obj)) {
        return obj.map((item) => removeConstantsFromFilter(item));
    }

    if (typeof obj === 'object') {
        const result: Record<string, unknown> = {};

        for (const [key, value] of Object.entries(obj)) {
            // Keep MongoDB operators (start with $)
            if (key.startsWith('$')) {
                // For operators, recursively process their values
                if (typeof value === 'object' && value !== null) {
                    result[key] = removeConstantsFromFilter(value);
                } else {
                    // Replace primitive constant values with placeholder
                    result[key] = '<value>';
                }
            } else {
                // For field names, keep the key but process the value
                if (typeof value === 'object' && value !== null) {
                    // Recursively process nested objects (like operators on this field)
                    result[key] = removeConstantsFromFilter(value);
                } else {
                    // Replace constant value with placeholder
                    result[key] = '<value>';
                }
            }
        }

        return result;
    }

    // For primitive values at the root level, replace with placeholder
    return '<value>';
}

/**
 * Removes sensitive constant values from explain result while preserving structure and field names
 * @param explainResult The explain result to sanitize
 * @returns Sanitized explain result
 */
export function sanitizeExplainResult(explainResult: unknown): unknown {
    if (!explainResult || typeof explainResult !== 'object') {
        return explainResult;
    }

    const result = JSON.parse(JSON.stringify(explainResult)) as Record<string, unknown>;

    // Process command field if it exists
    if ('command' in result) {
        if (typeof result.command === 'string') {
            // Command is a string, redact it to avoid exposing query details
            result.command = '<redacted>';
        } else if (typeof result.command === 'object' && result.command !== null) {
            const command = result.command as Record<string, unknown>;
            if ('filter' in command) {
                command.filter = removeConstantsFromFilter(command.filter);
            }
            result.command = command;
        }
    }

    // Process queryPlanner section
    if ('queryPlanner' in result && typeof result.queryPlanner === 'object' && result.queryPlanner !== null) {
        const queryPlanner = result.queryPlanner as Record<string, unknown>;

        // Process parsedQuery
        if ('parsedQuery' in queryPlanner) {
            queryPlanner.parsedQuery = removeConstantsFromFilter(queryPlanner.parsedQuery);
        }

        // Process winningPlan
        if (
            'winningPlan' in queryPlanner &&
            typeof queryPlanner.winningPlan === 'object' &&
            queryPlanner.winningPlan !== null
        ) {
            queryPlanner.winningPlan = sanitizeStage(queryPlanner.winningPlan);
        }

        result.queryPlanner = queryPlanner;
    }

    // Process rejectedPlans
    if ('rejectedPlans' in result && Array.isArray(result.rejectedPlans)) {
        result.rejectedPlans = result.rejectedPlans.map((plan) => sanitizeStage(plan));
    }

    // Process executionStats section
    if ('executionStats' in result && typeof result.executionStats === 'object' && result.executionStats !== null) {
        const executionStats = result.executionStats as Record<string, unknown>;

        // Process executionStages
        if ('executionStages' in executionStats) {
            executionStats.executionStages = sanitizeStage(executionStats.executionStages);
        }

        result.executionStats = executionStats;
    }

    return result;
}

/**
 * Recursively sanitizes execution plan stages
 * @param stage The stage to sanitize
 * @returns Sanitized stage
 */
function sanitizeStage(stage: unknown): unknown {
    if (!stage || typeof stage !== 'object') {
        return stage;
    }

    if (Array.isArray(stage)) {
        return stage.map((item) => sanitizeStage(item));
    }

    const result = { ...stage } as Record<string, unknown>;

    // Process filter field if present
    if ('filter' in result) {
        result.filter = removeConstantsFromFilter(result.filter);
    }

    // Process indexFilterSet field if present (array of filter objects)
    if ('indexFilterSet' in result && Array.isArray(result.indexFilterSet)) {
        result.indexFilterSet = result.indexFilterSet.map((filter) => removeConstantsFromFilter(filter));
    }

    if ('runtimeFilterSet' in result && Array.isArray(result.runtimeFilterSet)) {
        result.runtimeFilterSet = result.runtimeFilterSet.map((filter) => removeConstantsFromFilter(filter));
    }

    // Recursively process nested stages
    if ('inputStage' in result) {
        result.inputStage = sanitizeStage(result.inputStage);
    }

    if ('inputStages' in result && Array.isArray(result.inputStages)) {
        result.inputStages = result.inputStages.map((s) => sanitizeStage(s));
    }

    if ('shards' in result && Array.isArray(result.shards)) {
        result.shards = result.shards.map((shard) => {
            if (typeof shard === 'object' && shard !== null && 'executionStages' in shard) {
                const shardObj = shard as Record<string, unknown>;
                return {
                    ...shardObj,
                    executionStages: sanitizeStage(shardObj.executionStages),
                };
            }
            // eslint-disable-next-line @typescript-eslint/no-unsafe-return
            return shard;
        });
    }

    return result;
}

/**
 * Gets the prompt template for a given command type
 * @param commandType The type of command
 * @returns The prompt template string
 */
async function getPromptTemplate(commandType: CommandType): Promise<string> {
    return PromptTemplateService.getIndexAdvisorPromptTemplate(commandType);
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
async function fillPromptTemplate(
    templateType: CommandType,
    context: QueryOptimizationContext,
    collectionStats: CollectionStats,
    indexes: Array<IndexStats>,
    executionStats: string,
    clusterInfo: ClusterMetadata,
): Promise<string> {
    // Get the template for this command type
    const template = await getPromptTemplate(templateType);

    // Note: Query information is currently not passed to the prompt
    // This may be re-enabled in the future if needed
    // if (templateType === CommandType.Find && context.queryObject) {
    //     // Format query object as structured information
    //     const queryParts: string[] = [];
    //
    //     if (context.queryObject.filter) {
    //         queryParts.push(`**Filter**: \`\`\`json\n${JSON.stringify(context.queryObject.filter, null, 2)}\n\`\`\``);
    //     }
    //
    //     if (context.queryObject.sort) {
    //         queryParts.push(`**Sort**: \`\`\`json\n${JSON.stringify(context.queryObject.sort, null, 2)}\n\`\`\``);
    //     }
    //
    //     if (context.queryObject.projection) {
    //         queryParts.push(`**Projection**: \`\`\`json\n${JSON.stringify(context.queryObject.projection, null, 2)}\n\`\`\``);
    //     }
    //
    //     if (context.queryObject.skip !== undefined) {
    //         queryParts.push(`**Skip**: ${context.queryObject.skip}`);
    //     }
    //
    //     if (context.queryObject.limit !== undefined) {
    //         queryParts.push(`**Limit**: ${context.queryObject.limit}`);
    //     }
    //
    //     queryInfo = queryParts.join('\n\n');
    // } else if (context.query) {
    //     // Fallback to string query for backward compatibility
    //     queryInfo = context.query;
    // }

    // Fill the template with actual data
    const filled = template
        .replace('{databaseName}', context.databaseName)
        .replace('{collectionName}', context.collectionName)
        .replace('{collectionStats}', JSON.stringify(collectionStats, null, 2) || 'N/A')
        .replace('{indexStats}', JSON.stringify(indexes, null, 2) || 'N/A')
        .replace('{executionStats}', executionStats)
        .replace('{isAzureCluster}', JSON.stringify(clusterInfo.domainInfo_isAzure, null, 2))
        .replace('{AzureClusterType}', clusterInfo.domainInfo_isAzure === 'true' ? JSON.stringify(clusterInfo.domainInfo_api, null, 2) : 'N/A',
        );
    // .replace('{query}', context.query || 'N/A');
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

    let explainResult: unknown;
    let collectionStats: CollectionStats;
    let indexes: Array<IndexStats>;
    let clusterInfo: ClusterMetadata;

    // Check if we have pre-loaded data
    const hasPreloadedData = queryContext.executionPlan;

    if (hasPreloadedData) {
        // Use pre-loaded data
        explainResult = queryContext.executionPlan;
        collectionStats = queryContext.collectionStats!;
        indexes = queryContext.indexStats!;

        // For pre-loaded data, create a minimal cluster info
        clusterInfo = {
            domainInfo_isAzure: 'false',
            domainInfo_api: 'N/A',
        };
    } else {
        if (!queryContext.clusterId) {
            throw new Error(l10n.t('clusterId is required when not using pre-loaded data'));
        }

        // Check if we have queryObject or need to parse query string
        if (!queryContext.queryObject && !queryContext.query) {
            throw new Error(l10n.t('query or queryObject is required when not using pre-loaded data'));
        }

        // Get the MongoDB client
        const client = await ClustersClient.getClient(queryContext.clusterId);
        clusterInfo = await client.getClusterMetadata();

        // Prepare query options based on input format
        let explainOptions: QueryObject | undefined;
        let parsedQuery: {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            filter?: any;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            pipeline?: any[];
            explainOptions?: QueryObject;
        } | undefined;

        if (queryContext.queryObject) {
            // Use queryObject directly for find operations
            explainOptions = queryContext.queryObject;
        } else if (queryContext.query) {
            // Parse the query string for backward compatibility
            parsedQuery = parseQueryString(queryContext.query, queryContext.commandType);
            explainOptions = parsedQuery.explainOptions;
        }

        // Gather information needed for optimization
        try {
            // Execute explain based on command type
            if (queryContext.commandType === CommandType.Find) {
                const explainData = await client.explainFind(
                    queryContext.databaseName,
                    queryContext.collectionName,
                    explainOptions,
                );
                explainResult = explainData;
            } else if (queryContext.commandType === CommandType.Aggregate) {
                const explainData = await client.explainAggregate(
                    queryContext.databaseName,
                    queryContext.collectionName,
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
                    parsedQuery?.pipeline || [],
                );
                explainResult = explainData;
            } else if (queryContext.commandType === CommandType.Count) {
                explainResult = await client.explainCount(
                    queryContext.databaseName,
                    queryContext.collectionName,
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
                    parsedQuery?.filter || {},
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
    }

    // Sanitize explain result to remove constant values while preserving field names
    const sanitizedExplainResult = sanitizeExplainResult(explainResult);

    // Format execution stats for the prompt
    const sanitizedExecutionStats = JSON.stringify(sanitizedExplainResult, null, 2);

    // Fill the prompt template
    const commandType = queryContext.commandType;
    const promptContent = await fillPromptTemplate(
        commandType,
        queryContext,
        collectionStats,
        indexes,
        sanitizedExecutionStats,
        clusterInfo,
    );

    // Send to Copilot with configured models
    const preferredModelToUse = queryContext.preferredModel || PREFERRED_MODEL;
    const fallbackModelsToUse = queryContext.fallbackModels || FALLBACK_MODELS;

    const response = await CopilotService.sendMessage([vscode.LanguageModelChatMessage.User(promptContent)], {
        preferredModel: preferredModelToUse,
        fallbackModels: fallbackModelsToUse,
    });

    // Check if the preferred model was used
    if (response.modelUsed !== preferredModelToUse && preferredModelToUse) {
        // Show warning if not using preferred model
        void vscode.window.showWarningMessage(
            l10n.t(
                'Index optimization is using model "{actualModel}" instead of preferred "{preferredModel}". Recommendations may be less optimal.',
                {
                    actualModel: response.modelUsed,
                    preferredModel: preferredModelToUse,
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
