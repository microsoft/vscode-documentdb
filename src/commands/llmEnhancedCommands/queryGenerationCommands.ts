/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { type Document } from 'mongodb';
import * as vscode from 'vscode';
import { ClustersClient } from '../../documentdb/ClustersClient';
import { CopilotService } from '../../services/copilotService';
import { PromptTemplateService } from '../../services/promptTemplateService';
import { generateSchemaDefinition, type SchemaDefinition } from '../../utils/schemaInference';
import { FALLBACK_MODELS, PREFERRED_MODEL, getQueryTypeConfig } from './promptTemplates';

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
 * @returns The filled prompt template
 */
async function fillPromptTemplate(
    templateType: QueryGenerationType,
    context: QueryGenerationContext,
    schemas: Array<SchemaDefinition>,
): Promise<string> {
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

    const filled = template
        .replace('{databaseName}', context.databaseName)
        .replace('{collectionName}', context.collectionName || 'N/A')
        .replace(/{targetQueryType}/g, targetQueryType)
        .replace('{queryTypeGuidelines}', guidelines)
        .replace('{outputSchema}', outputSchema)
        .replace('{schemaInfo}', schemaInfo)
        .replace('{naturalLanguageQuery}', context.naturalLanguageQuery);

    return filled;
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

    // Gather schema information
    const schemas: Array<SchemaDefinition> = [];

    try {
        if (queryContext.generationType === QueryGenerationType.CrossCollection) {
            // Get all collections in the database
            const collections = await client.listCollections(queryContext.databaseName);

            for (const collection of collections) {
                const sampleDocs = await client.getSampleDocuments(queryContext.databaseName, collection.name, 3);

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

            const sampleDocs = await client.getSampleDocuments(
                queryContext.databaseName,
                queryContext.collectionName,
                10,
            );

            const schema = generateSchemaDefinition(sampleDocs, queryContext.collectionName);
            schemas.push(schema);
        }
    } catch (error) {
        throw new Error(
            l10n.t('Failed to gather schema information: {message}', {
                message: error instanceof Error ? error.message : String(error),
            }),
        );
    }

    // Fill the prompt template
    const promptContent = await fillPromptTemplate(queryContext.generationType, queryContext, schemas);

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
    context.telemetry.properties.collectionCount = schemas.length.toString();

    // Parse the response
    try {
        const result = JSON.parse(response.text) as { explanation: string; command: Record<string, unknown> };

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
