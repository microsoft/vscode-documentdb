/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { parseError } from '@microsoft/vscode-azext-utils';
import { type Document, type ObjectId, type WithId, type WriteError } from 'mongodb';
import { l10n } from 'vscode';
import { ClustersClient, isBulkWriteError } from '../../../../../documentdb/ClustersClient';
import { ConflictResolutionStrategy, type CopyPasteConfig } from '../copyPasteConfig';
import {
    type BulkWriteResult,
    type DocumentDetails,
    type DocumentWriter,
    type DocumentWriterOptions,
} from '../documentInterfaces';

/**
 * DocumentDB-specific implementation of DocumentWriter.
 */
export class DocumentDbDocumentWriter implements DocumentWriter {
    /**
     * Writes documents to a DocumentDB collection using bulk operations.
     *
     * @param connectionId Connection identifier to get the DocumentDB client
     * @param databaseName Name of the target database
     * @param collectionName Name of the target collection
     * @param documents Array of documents to write
     * @param options Optional write options
     * @returns Promise resolving to the bulk write result
     */
    async writeDocuments(
        connectionId: string,
        databaseName: string,
        collectionName: string,
        config: CopyPasteConfig,
        documents: DocumentDetails[],
        _options?: DocumentWriterOptions,
    ): Promise<BulkWriteResult> {
        if (documents.length === 0) {
            return {
                insertedCount: 0,
                errors: [],
            };
        }

        const client = await ClustersClient.getClient(connectionId);

        // Convert DocumentDetails to DocumentDB documents
        const rawDocuments = documents.map((doc) => doc.documentContent as WithId<Document>);

        // For GenerateNewIds strategy, transform documents before insertion
        if (config.onConflict === ConflictResolutionStrategy.GenerateNewIds) {
            const transformedDocuments = rawDocuments.map((doc) => {
                // Create a new document without _id to let MongoDB generate a new one
                const { _id, ...docWithoutId } = doc;

                // Find an available field name for storing the original _id
                const originalIdFieldName = this.findAvailableOriginalIdFieldName(docWithoutId);

                return {
                    ...docWithoutId,
                    [originalIdFieldName]: _id, // Store original _id in a field that doesn't conflict
                } as Document; // Cast to Document since we're removing _id
            });

            // Use the transformed documents for insertion
            try {
                const insertResult = await client.insertDocuments(
                    databaseName,
                    collectionName,
                    transformedDocuments,
                    false, // Always use unordered for GenerateNewIds since conflicts shouldn't occur
                );

                return {
                    insertedCount: insertResult.insertedCount,
                    errors: null,
                };
            } catch (error: unknown) {
                if (error instanceof Error) {
                    return {
                        insertedCount: 0,
                        errors: [{ documentId: undefined, error }],
                    };
                } else {
                    return {
                        insertedCount: 0,
                        errors: [{ documentId: undefined, error: new Error(String(error)) }],
                    };
                }
            }
        }

        try {
            const insertResult = await client.insertDocuments(
                databaseName,
                collectionName,
                rawDocuments,
                // For abort on conflict, we set ordered to true to make it throw on the first error
                // For skip on conflict, we set ordered to false
                // For overwrite on conflict, we use ordered as a filter to find documents that should be overwritten
                config.onConflict === ConflictResolutionStrategy.Abort,
            );

            return {
                insertedCount: insertResult.insertedCount,
                errors: null, // DocumentDB bulk write errors will be handled in the catch block
            };
        } catch (error: unknown) {
            if (isBulkWriteError(error)) {
                const writeErrorsArray = (
                    Array.isArray(error.writeErrors) ? error.writeErrors : [error.writeErrors]
                ) as Array<WriteError>;

                if (config.onConflict === ConflictResolutionStrategy.Overwrite) {
                    // For overwrite strategy, we need to delete the conflicting documents and then re-insert
                    const session = client.startTransaction();
                    const collection = client.getCollection(databaseName, collectionName);
                    try {
                        // eslint-disable-next-line @typescript-eslint/no-unsafe-return
                        const idsToOverwrite = writeErrorsArray.map((we) => we.getOperation()._id) as Array<ObjectId>;
                        const documentsToOverwrite = rawDocuments.filter((doc) =>
                            idsToOverwrite.includes((doc as WithId<Document>)._id as ObjectId),
                        );
                        await collection.deleteMany({ _id: { $in: idsToOverwrite } }, { session });
                        const insertResult = await collection.insertMany(documentsToOverwrite, { session });
                        await client.commitTransaction(session);
                        return {
                            insertedCount: insertResult.insertedCount,
                            errors: null,
                        };
                    } catch (error) {
                        await client.abortTransaction(session);
                        throw new Error(l10n.t('Failed to overwrite documents: {0}', parseError(error).message));
                    }
                }

                return {
                    insertedCount: error.result.insertedCount,
                    errors: writeErrorsArray.map((writeError) => ({
                        documentId: (writeError.getOperation()._id as string) || undefined,
                        error: new Error(writeError.errmsg || 'Unknown write error'),
                    })),
                };
            } else if (error instanceof Error) {
                return {
                    insertedCount: 0,
                    errors: [{ documentId: undefined, error }],
                };
            } else {
                // Handle unknown error types
                return {
                    insertedCount: 0,
                    errors: [{ documentId: undefined, error: new Error(String(error)) }],
                };
            }
        }
    }

    /**
     * Ensures the target collection exists.
     *
     * @param connectionId Connection identifier to get the DocumentDB client
     * @param databaseName Name of the target database
     * @param collectionName Name of the target collection
     * @returns Promise that resolves when the collection is ready
     */
    async ensureCollectionExists(connectionId: string, databaseName: string, collectionName: string): Promise<void> {
        const client = await ClustersClient.getClient(connectionId);

        // Check if collection exists by trying to list collections
        const collections = await client.listCollections(databaseName);
        const collectionExists = collections.some((col) => col.name === collectionName);

        // we could have just run 'createCollection' without this check. This will work just fine
        // for basic scenarios. However, an exiting collection with the same name but a different
        // configuration could lead to unexpected behavior.

        if (!collectionExists) {
            // Create the collection by running createCollection
            await client.createCollection(databaseName, collectionName);
        }
    }

    /**
     * Finds an available field name for storing the original _id value.
     * Uses _original_id if available, otherwise _original_id_1, _original_id_2, etc.
     *
     * @param doc The document to check for field name conflicts
     * @returns An available field name for storing the original _id
     */
    private findAvailableOriginalIdFieldName(doc: Partial<Document>): string {
        const baseFieldName = '_original_id';

        // Check if the base field name is available
        if (!(baseFieldName in doc)) {
            return baseFieldName;
        }

        // If _original_id exists, try _original_id_1, _original_id_2, etc.
        let counter = 1;
        let candidateFieldName = `${baseFieldName}_${counter}`;

        while (candidateFieldName in doc) {
            counter++;
            candidateFieldName = `${baseFieldName}_${counter}`;
        }

        return candidateFieldName;
    }
}
