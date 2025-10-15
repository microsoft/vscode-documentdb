/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import type { Document } from 'mongodb';
import * as vscode from 'vscode';
import { ClustersClient } from '../../documentdb/ClustersClient';
import { CopilotService } from '../../services/copilotService';
import { PromptTemplateService } from '../../services/PromptTemplateService';
import { FALLBACK_MODELS, PREFERRED_MODEL } from './promptTemplates';

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
    // Collection name (optional, only for single-collection queries)
    collectionName?: string;
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
 * Maximum array length before truncation
 */
const MAX_ARRAY_LENGTH = 5;

/**
 * Maximum string length in documents
 */
const MAX_STRING_LENGTH = 500;

/**
 * Truncates long arrays in a document while preserving dimension information
 * @param doc The document to process
 * @returns Processed document with truncated arrays
 */
export function truncateArraysInDocument(doc: Document): Document {
    const result: Document = {};

    for (const [key, value] of Object.entries(doc)) {
        if (Array.isArray(value)) {
            if (value.length > MAX_ARRAY_LENGTH) {
                // Truncate array and add dimension info
                const truncated = value.slice(0, MAX_ARRAY_LENGTH);
                result[key] = {
                    _truncated: true,
                    _originalLength: value.length,
                    _dimensions: value.length,
                    _sample: truncated,
                };
            } else {
                // Process array elements recursively
                result[key] = value.map((item) => {
                    if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
                        return truncateArraysInDocument(item as Document);
                    }
                    return item;
                });
            }
        } else if (typeof value === 'object' && value !== null) {
            // Recursively process nested objects
            result[key] = truncateArraysInDocument(value as Document);
        } else if (typeof value === 'string' && value.length > MAX_STRING_LENGTH) {
            // Truncate long strings
            result[key] = {
                _truncated: true,
                _originalLength: value.length,
                _preview: value.substring(0, MAX_STRING_LENGTH) + '...',
            };
        } else {
            result[key] = value;
        }
    }

    return result;
}

/**
 * Extracts schema information from sample documents
 * @param collectionName The collection name
 * @param documents Sample documents
 * @returns Schema information
 */
function extractSchemaInfo(collectionName: string, documents: Array<Document>): CollectionSchema {
    // Truncate arrays in all documents
    const processedDocuments = documents.map((doc) => truncateArraysInDocument(doc));

    // Generate a schema description
    const fieldTypes = new Map<string, Set<string>>();

    for (const doc of processedDocuments) {
        extractFieldTypes(doc, '', fieldTypes);
    }

    // Build schema description
    const schemaLines: string[] = [];
    for (const [field, types] of Array.from(fieldTypes.entries()).sort()) {
        schemaLines.push(`  - ${field}: ${Array.from(types).join(' | ')}`);
    }

    const schemaDescription = `Collection: ${collectionName}\nFields:\n${schemaLines.join('\n')}`;

    return {
        collectionName,
        sampleDocuments: processedDocuments,
        schemaDescription,
    };
}

/**
 * Recursively extracts field types from a document
 * @param obj The object to process
 * @param prefix Field name prefix for nested fields
 * @param fieldTypes Map to store field types
 */
function extractFieldTypes(obj: Document, prefix: string, fieldTypes: Map<string, Set<string>>): void {
    for (const [key, value] of Object.entries(obj)) {
        const fieldName = prefix ? `${prefix}.${key}` : key;

        if (value === null) {
            addFieldType(fieldTypes, fieldName, 'null');
        } else if (Array.isArray(value)) {
            if (typeof value[0] === 'object' && value[0] !== null && value[0]._truncated) {
                addFieldType(fieldTypes, fieldName, `array[${value[0]._dimensions}]`);
            } else {
                addFieldType(fieldTypes, fieldName, 'array');
                if (value.length > 0) {
                    const elementType = typeof value[0];
                    addFieldType(fieldTypes, fieldName, `array<${elementType}>`);
                }
            }
        } else if (typeof value === 'object' && value !== null) {
            if (value._truncated) {
                if (value._originalLength !== undefined) {
                    addFieldType(fieldTypes, fieldName, `string(truncated, length: ${value._originalLength})`);
                } else {
                    addFieldType(fieldTypes, fieldName, `array[${value._dimensions}] (truncated)`);
                }
            } else {
                addFieldType(fieldTypes, fieldName, 'object');
                extractFieldTypes(value as Document, fieldName, fieldTypes);
            }
        } else {
            addFieldType(fieldTypes, fieldName, typeof value);
        }
    }
}

/**
 * Adds a field type to the map
 * @param fieldTypes The map to add to
 * @param fieldName The field name
 * @param type The type to add
 */
function addFieldType(fieldTypes: Map<string, Set<string>>, fieldName: string, type: string): void {
    if (!fieldTypes.has(fieldName)) {
        fieldTypes.set(fieldName, new Set());
    }
    fieldTypes.get(fieldName)!.add(type);
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
    schemas: Array<CollectionSchema>,
): Promise<string> {
    // Get the template for this generation type
    const template = await getPromptTemplate(templateType);

    // Prepare schema information
    let schemaInfo: string;
    if (templateType === QueryGenerationType.CrossCollection) {
        // Include all collection schemas
        schemaInfo = schemas
            .map(
                (schema) =>
                    `## Collection: ${schema.collectionName}\n\n${schema.schemaDescription}\n\nSample Documents:\n\`\`\`json\n${JSON.stringify(schema.sampleDocuments, null, 2)}\n\`\`\``,
            )
            .join('\n\n---\n\n');
    } else {
        // Single collection schema
        const schema = schemas[0];
        schemaInfo = `${schema.schemaDescription}\n\nSample Documents:\n\`\`\`json\n${JSON.stringify(schema.sampleDocuments, null, 2)}\n\`\`\``;
    }

    // Fill the template with actual data
    const filled = template
        .replace('{databaseName}', context.databaseName)
        .replace('{collectionName}', context.collectionName || 'N/A')
        .replace('{schemaInfo}', schemaInfo)
        .replace('{naturalLanguageQuery}', context.naturalLanguageQuery);

    return filled;
}

/**
 * Generates a MongoDB query using Copilot AI based on natural language input
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
    const schemas: Array<CollectionSchema> = [];

    try {
        if (queryContext.generationType === QueryGenerationType.CrossCollection) {
            // Get all collections in the database
            const collections = await client.listCollections(queryContext.databaseName);

            // Sample documents from each collection (max 3 per collection)
            for (const collection of collections) {
                const sampleDocs = await client.getSampleDocuments(queryContext.databaseName, collection.name, 3);

                if (sampleDocs.length > 0) {
                    const schema = extractSchemaInfo(collection.name, sampleDocs);
                    schemas.push(schema);
                }
            }

            if (schemas.length === 0) {
                throw new Error(l10n.t('No collections with documents found in database {db}', { db: queryContext.databaseName }));
            }
        } else {
            // Single collection - sample up to 10 documents
            if (!queryContext.collectionName) {
                throw new Error(l10n.t('Collection name is required for single-collection query generation'));
            }

            const sampleDocs = await client.getSampleDocuments(
                queryContext.databaseName,
                queryContext.collectionName,
                10,
            );

            if (sampleDocs.length === 0) {
                throw new Error(
                    l10n.t('No documents found in collection {collection}', { collection: queryContext.collectionName }),
                );
            }

            const schema = extractSchemaInfo(queryContext.collectionName, sampleDocs);
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
    context.telemetry.properties.generationType = queryContext.generationType;
    context.telemetry.properties.collectionCount = schemas.length.toString();

    // Parse the response
    try {
        const result = JSON.parse(response.text) as { query: string; explanation: string };

        return {
            generatedQuery: result.query,
            explanation: result.explanation,
            modelUsed: response.modelUsed,
        };
    } catch (error) {
        // If JSON parsing fails, return the raw response
        return {
            generatedQuery: response.text,
            explanation: l10n.t('Generated query (manual parsing may be required)'),
            modelUsed: response.modelUsed,
        };
    }
}
