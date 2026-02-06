/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { type Document } from 'mongodb';
import * as vscode from 'vscode';
import { ClustersClient } from '../../documentdb/ClustersClient';
import { ext } from '../../extensionVariables';
import { CopilotService } from '../../services/copilotService';
import { PromptTemplateService } from '../../services/promptTemplateService';
import { generateSchemaDefinition, type SchemaDefinition } from '../../utils/schemaInference';
import { FALLBACK_MODELS, PREFERRED_MODEL, getQueryTypeConfig, type FilledPromptResult } from './promptTemplates';

/**
 * Type of query generation
 */
export enum QueryGenerationType {
    CrossCollection = 'cross-collection',
    SingleCollection = 'single-collection',
}

/**
 * Context information needed for query generation
 */
export interface QueryGenerationContext {
    // The cluster/connection ID
    clusterId: string;
    // Database name
    databaseName: string;
    // Collection name (only for single-collection queries)
    collectionName?: string;
    // Query type of generated query
    targetQueryType?: 'Find' | 'Aggregation';
    // Natural language description of the query
    naturalLanguageQuery: string;
    // The type of query generation
    generationType: QueryGenerationType;
}

/**
 * Schema information for a collection
 */
export interface CollectionSchema {
    // Collection name
    collectionName: string;
    // Sample documents with schema information
    sampleDocuments: Array<Document>;
    // Inferred schema structure
    schemaDescription: string;
}

/**
 * Result from query generation
 */
export interface QueryGenerationResult {
    // The generated query
    generatedQuery: string;
    // Explanation of the query
    explanation: string;
    // The model used to generate the query
    modelUsed: string;
}

/**
 * Gets the prompt template for a given query generation type
 * @param generationType The type of query generation
 * @returns The prompt template string
 */
async function getPromptTemplate(generationType: QueryGenerationType): Promise<string> {
    return PromptTemplateService.getQueryGenerationPromptTemplate(generationType);
}

/**
 * Fills a prompt template with actual data
 * @param templateType The type of template to use
 * @param context The query generation context
 * @param schemas Collection schemas
 * @returns The filled prompt components
 */
async function fillPromptTemplate(
    templateType: QueryGenerationType,
    context: QueryGenerationContext,
    schemas: Array<SchemaDefinition>,
): Promise<FilledPromptResult> {
    // Get the template for this generation type
    const template = await getPromptTemplate(templateType);

    // Determine target query type (default to Find if not specified)
    const targetQueryType = context.targetQueryType || 'Find';

    // Get query type specific guidelines and output schema
    const { guidelines, outputSchema } = getQueryTypeConfig(targetQueryType);

    // Prepare schema information
    let schemaInfo: string;
    if (schemas.length > 0) {
        if (templateType === QueryGenerationType.CrossCollection) {
            schemaInfo = schemas
                .map(
                    (schema) =>
                        `### Collection: ${schema.collectionName || 'Unknown'}\n\nData Schema:\n\`\`\`json\n${JSON.stringify(schema.fields, null, 2)}\n\`\`\``,
                )
                .join('\n\n---\n\n');
        } else {
            const schema = schemas[0];
            schemaInfo = `Data Schema:\n\`\`\`json\n${JSON.stringify(schema.fields, null, 2)}\n\`\`\`\n\n`;
        }
    } else {
        schemaInfo = `No schema information available.\n\n`;
    }

    const craftedPrompt = template
        .replace(/{targetQueryType}/g, targetQueryType)
        .replace('{queryTypeGuidelines}', guidelines)
        .replace('{outputSchema}', outputSchema);

    // system-retrieved information
    let contextData: string;
    if (templateType === QueryGenerationType.CrossCollection) {
        contextData = `## Database Context
- **Database Name**: ${context.databaseName}

## Available Collections and Their Schemas
${schemaInfo}

## Query Type Requirement
- **Required Query Type**: ${targetQueryType}`;
    } else {
        contextData = `## Database Context
- **Database Name**: ${context.databaseName}
- **Collection Name**: ${context.collectionName || 'N/A'}

## Collection Schema
${schemaInfo}

## Query Type Requirement
- **Required Query Type**: ${targetQueryType}`;
    }

    return {
        craftedPrompt,
        userQuery: context.naturalLanguageQuery,
        contextData,
    };
}

/**
 * Generates a MongoDB query based on natural language input
 * @param context Action context for telemetry
 * @param queryContext Query generation context
 * @returns Generated query and explanation
 */
export async function generateQuery(
    context: IActionContext,
    queryContext: QueryGenerationContext,
): Promise<QueryGenerationResult> {
    ext.outputChannel.trace(
        l10n.t('[Query Generation] Started: type={type}, targetQueryType={targetQueryType}', {
            type: queryContext.generationType,
            targetQueryType: queryContext.targetQueryType || 'Find',
        }),
    );

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
    const getClientStart = Date.now();
    const client = await ClustersClient.getClient(queryContext.clusterId);
    context.telemetry.measurements.getClientDurationMs = Date.now() - getClientStart;

    // Gather schema information
    const schemas: Array<SchemaDefinition> = [];
    const schemaGatheringStart = Date.now();

    try {
        if (queryContext.generationType === QueryGenerationType.CrossCollection) {
            // Get all collections in the database
            const listCollectionsStart = Date.now();
            const collections = await client.listCollections(queryContext.databaseName);
            context.telemetry.measurements.listCollectionsDurationMs = Date.now() - listCollectionsStart;
            ext.outputChannel.trace(
                l10n.t('[Query Generation] listCollections completed in {ms}ms ({count} collections)', {
                    ms: context.telemetry.measurements.listCollectionsDurationMs.toString(),
                    count: collections.length.toString(),
                }),
            );

            let collectionIndex = 0;
            for (const collection of collections) {
                collectionIndex++;
                const sampleDocsStart = Date.now();
                const sampleDocs = await client.getSampleDocuments(queryContext.databaseName, collection.name, 3);
                const sampleDocsDuration = Date.now() - sampleDocsStart;
                context.telemetry.measurements[`sampleDocs_${collectionIndex}_DurationMs`] = sampleDocsDuration;
                ext.outputChannel.trace(
                    l10n.t('[Query Generation] Schema sampling for {collection} completed in {ms}ms', {
                        collection: collection.name,
                        ms: sampleDocsDuration.toString(),
                    }),
                );

                if (sampleDocs.length > 0) {
                    const schema = generateSchemaDefinition(sampleDocs, collection.name);
                    schemas.push(schema);
                } else {
                    schemas.push({ collectionName: collection.name, fields: {} });
                }
            }
        } else {
            if (!queryContext.collectionName) {
                throw new Error(l10n.t('Collection name is required for single-collection query generation'));
            }

            const sampleDocsStart = Date.now();
            const sampleDocs = await client.getSampleDocuments(
                queryContext.databaseName,
                queryContext.collectionName,
                10,
            );
            context.telemetry.measurements.sampleDocsDurationMs = Date.now() - sampleDocsStart;
            ext.outputChannel.trace(
                l10n.t('[Query Generation] Schema sampling completed in {ms}ms', {
                    ms: context.telemetry.measurements.sampleDocsDurationMs.toString(),
                }),
            );

            const schema = generateSchemaDefinition(sampleDocs, queryContext.collectionName);
            schemas.push(schema);
        }
        context.telemetry.measurements.schemaGatheringDurationMs = Date.now() - schemaGatheringStart;
    } catch (error) {
        context.telemetry.measurements.schemaGatheringDurationMs = Date.now() - schemaGatheringStart;
        throw new Error(
            l10n.t('Failed to gather schema information: {message}', {
                message: error instanceof Error ? error.message : String(error),
            }),
        );
    }

    // Fill the prompt template
    const { craftedPrompt, userQuery, contextData } = await fillPromptTemplate(
        queryContext.generationType,
        queryContext,
        schemas,
    );

    // Send to Copilot with configured models
    const llmCallStart = Date.now();
    ext.outputChannel.trace(
        l10n.t('[Query Generation] Calling Copilot (model: {model})...', {
            model: PREFERRED_MODEL || 'default',
        }),
    );
    const response = await CopilotService.sendMessage(
        [
            vscode.LanguageModelChatMessage.User(craftedPrompt),
            vscode.LanguageModelChatMessage.User(`## User Request\n${userQuery}`),
            vscode.LanguageModelChatMessage.User(contextData),
        ],
        {
            preferredModel: PREFERRED_MODEL,
            fallbackModels: FALLBACK_MODELS,
        },
    );
    context.telemetry.measurements.llmCallDurationMs = Date.now() - llmCallStart;
    ext.outputChannel.trace(
        l10n.t('[Query Generation] Copilot response received in {ms}ms (model: {model})', {
            ms: context.telemetry.measurements.llmCallDurationMs.toString(),
            model: response.modelUsed,
        }),
    );

    // Check if the preferred model was used
    if (response.modelUsed !== PREFERRED_MODEL && PREFERRED_MODEL) {
        // Show warning if not using preferred model
        void vscode.window.showWarningMessage(
            l10n.t(
                'Query generation is using model "{actualModel}" instead of preferred "{preferredModel}". Results may vary.',
                {
                    actualModel: response.modelUsed,
                    preferredModel: PREFERRED_MODEL,
                },
            ),
        );
    }

    // Add telemetry for the model used
    context.telemetry.properties.modelUsed = response.modelUsed;
    context.telemetry.properties.generationType = queryContext.targetQueryType || 'Find';

    // Parse the response
    try {
        const result = JSON.parse(response.text) as { explanation: string; command: Record<string, unknown> };
        if (result.command === undefined || result.command === null || result.explanation.startsWith('Error:')) {
            throw new Error(result.explanation);
        }

        ext.outputChannel.trace(l10n.t('[Query Generation] Completed successfully'));
        return {
            generatedQuery: JSON.stringify(result.command, null, 2),
            explanation: result.explanation,
            modelUsed: response.modelUsed,
        };
    } catch {
        throw new Error(
            l10n.t('Failed to parse the response from the language model. LLM output:\n{output}', {
                output: response.text,
            }),
        );
    }
}
