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
    ext.outputChannel.trace(
        l10n.t('Query generation started: type={type}, targetQueryType={targetQueryType}', {
            type: queryContext.generationType,
            targetQueryType: queryContext.targetQueryType || 'Find',
        }),
    );

    // Check if Copilot is available
    ext.outputChannel.trace(l10n.t('Checking GitHub Copilot availability...'));
    const copilotAvailable = await CopilotService.isAvailable();
    if (!copilotAvailable) {
        ext.outputChannel.error(l10n.t('GitHub Copilot is not available'));
        throw new Error(
            l10n.t(
                'GitHub Copilot is not available. Please install the GitHub Copilot extension and ensure you have an active subscription.',
            ),
        );
    }
    ext.outputChannel.trace(l10n.t('GitHub Copilot is available'));

    // Get the MongoDB client
    ext.outputChannel.trace(l10n.t('Connecting to cluster: {clusterId}', { clusterId: queryContext.clusterId }));
    const getClientStart = Date.now();
    const client = await ClustersClient.getClient(queryContext.clusterId);
    context.telemetry.measurements.getClientDurationMs = Date.now() - getClientStart;
    ext.outputChannel.trace(
        l10n.t('Connected to cluster [{durationMs}ms]', {
            durationMs: context.telemetry.measurements.getClientDurationMs.toString(),
        }),
    );

    // Gather schema information
    ext.outputChannel.trace(l10n.t('Gathering schema information...'));
    const schemas: Array<SchemaDefinition> = [];
    const schemaGatheringStart = Date.now();

    try {
        if (queryContext.generationType === QueryGenerationType.CrossCollection) {
            ext.outputChannel.trace(
                l10n.t('Discovering collections in database: {databaseName}', {
                    databaseName: queryContext.databaseName,
                }),
            );
            // Get all collections in the database
            const listCollectionsStart = Date.now();
            const collections = await client.listCollections(queryContext.databaseName);
            context.telemetry.measurements.listCollectionsDurationMs = Date.now() - listCollectionsStart;
            ext.outputChannel.trace(
                l10n.t('Found {count} collections [{durationMs}ms]', {
                    count: collections.length.toString(),
                    durationMs: context.telemetry.measurements.listCollectionsDurationMs.toString(),
                }),
            );

            let collectionIndex = 0;
            for (const collection of collections) {
                collectionIndex++;
                ext.outputChannel.trace(
                    l10n.t('Sampling documents from collection: {collectionName}', {
                        collectionName: collection.name,
                    }),
                );
                const sampleDocsStart = Date.now();
                const sampleDocs = await client.getSampleDocuments(queryContext.databaseName, collection.name, 3);
                const sampleDocsDuration = Date.now() - sampleDocsStart;
                context.telemetry.measurements[`sampleDocs_${collectionIndex}_DurationMs`] = sampleDocsDuration;
                ext.outputChannel.trace(
                    l10n.t('Sampled {count} documents from collection: {collectionName} [{durationMs}ms]', {
                        count: sampleDocs.length.toString(),
                        collectionName: collection.name,
                        durationMs: sampleDocsDuration.toString(),
                    }),
                );

                if (sampleDocs.length > 0) {
                    ext.outputChannel.trace(
                        l10n.t('Generating schema from {count} sample documents for collection: {collectionName}', {
                            count: sampleDocs.length.toString(),
                            collectionName: collection.name,
                        }),
                    );
                    const schema = generateSchemaDefinition(sampleDocs, collection.name);
                    schemas.push(schema);
                } else {
                    ext.outputChannel.trace(
                        l10n.t('No sample documents found for collection: {collectionName}', {
                            collectionName: collection.name,
                        }),
                    );
                    schemas.push({ collectionName: collection.name, fields: {} });
                }
            }
        } else {
            if (!queryContext.collectionName) {
                throw new Error(l10n.t('Collection name is required for single-collection query generation'));
            }

            ext.outputChannel.trace(
                l10n.t('Sampling documents from collection: {databaseName}.{collectionName}', {
                    databaseName: queryContext.databaseName,
                    collectionName: queryContext.collectionName,
                }),
            );
            const sampleDocsStart = Date.now();
            const sampleDocs = await client.getSampleDocuments(
                queryContext.databaseName,
                queryContext.collectionName,
                10,
            );
            context.telemetry.measurements.sampleDocsDurationMs = Date.now() - sampleDocsStart;
            ext.outputChannel.trace(
                l10n.t('Retrieved {count} sample documents [{durationMs}ms]', {
                    count: sampleDocs.length.toString(),
                    durationMs: context.telemetry.measurements.sampleDocsDurationMs.toString(),
                }),
            );

            ext.outputChannel.trace(l10n.t('Generating schema from sample documents...'));
            const schema = generateSchemaDefinition(sampleDocs, queryContext.collectionName);
            schemas.push(schema);
        }
        ext.outputChannel.trace(
            l10n.t('Schema generation complete for {count} collection(s)', { count: schemas.length.toString() }),
        );
        context.telemetry.measurements.schemaGatheringDurationMs = Date.now() - schemaGatheringStart;
        ext.outputChannel.trace(
            l10n.t('Schema gathering completed [{durationMs}ms]', {
                durationMs: context.telemetry.measurements.schemaGatheringDurationMs.toString(),
            }),
        );
    } catch (error) {
        context.telemetry.measurements.schemaGatheringDurationMs = Date.now() - schemaGatheringStart;
        ext.outputChannel.error(
            l10n.t('Schema gathering failed: {message}', {
                message: error instanceof Error ? error.message : String(error),
            }),
        );
        throw new Error(
            l10n.t('Failed to gather schema information: {message}', {
                message: error instanceof Error ? error.message : String(error),
            }),
        );
    }

    // Fill the prompt template
    ext.outputChannel.trace(l10n.t('Filling prompt template...'));
    const promptContent = await fillPromptTemplate(queryContext.generationType, queryContext, schemas);
    ext.outputChannel.trace(l10n.t('Prompt template filled successfully'));

    // Send to Copilot with configured models
    ext.outputChannel.trace(
        l10n.t('Sending request to GitHub Copilot (preferred model: {preferredModel})...', {
            preferredModel: PREFERRED_MODEL || 'none specified',
        }),
    );
    const llmCallStart = Date.now();
    const response = await CopilotService.sendMessage([vscode.LanguageModelChatMessage.User(promptContent)], {
        preferredModel: PREFERRED_MODEL,
        fallbackModels: FALLBACK_MODELS,
    });
    context.telemetry.measurements.llmCallDurationMs = Date.now() - llmCallStart;
    ext.outputChannel.trace(
        l10n.t('Received response from model: {modelUsed} [{durationMs}ms]', {
            modelUsed: response.modelUsed,
            durationMs: context.telemetry.measurements.llmCallDurationMs.toString(),
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
    ext.outputChannel.trace(l10n.t('Parsing language model response...'));
    try {
        const result = JSON.parse(response.text) as { explanation: string; command: Record<string, unknown> };

        ext.outputChannel.trace(l10n.t('Query generation completed successfully'));
        return {
            generatedQuery: JSON.stringify(result.command, null, 2),
            explanation: result.explanation,
            modelUsed: response.modelUsed,
        };
    } catch {
        ext.outputChannel.error(l10n.t('Failed to parse language model response'));
        throw new Error(
            l10n.t('Failed to parse the response from the language model. LLM output:\n{output}', {
                output: response.text,
            }),
        );
    }
}
