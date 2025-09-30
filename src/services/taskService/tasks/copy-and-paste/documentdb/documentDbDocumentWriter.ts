/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type Document, type WithId, type WriteError } from 'mongodb';
import { l10n } from 'vscode';
import { ClustersClient, isBulkWriteError } from '../../../../../documentdb/ClustersClient';
import { ext } from '../../../../../extensionVariables';
import { ConflictResolutionStrategy, type CopyPasteConfig } from '../copyPasteConfig';
import {
    type BulkWriteResult,
    type DocumentDetails,
    type DocumentWriter,
    type DocumentWriterOptions,
    type EnsureCollectionExistsResult,
} from '../documentInterfaces';

/**
 * Result of writing a single batch with retry logic.
 */
interface BatchWriteResult {
    /** Number of documents successfully inserted */
    insertedCount: number;
    /** Number of documents from input batch that were processed */
    processedCount: number;
    /** Whether throttling occurred during this batch */
    wasThrottled: boolean;
    /** Errors from the write operation, if any */
    errors?: Array<{ documentId?: string; error: Error }>;
}

/**
 * DocumentDB-specific implementation of DocumentWriter.
 */
export class DocumentDbDocumentWriter implements DocumentWriter {
    // Adaptive batch sizing instance variables
    private currentBatchSize: number = 100; // Matches CopyPasteCollectionTask.bufferSize
    private readonly minBatchSize: number = 1;
    private readonly maxBatchSize: number = 1000;

    /**
     * Gets the current adaptive batch size.
     * The task can use this to optimize its read buffer size.
     *
     * @returns Current batch size
     */
    public getCurrentBatchSize(): number {
        return this.currentBatchSize;
    }

    /**
     * Classifies an error into categories for appropriate handling.
     *
     * @param error The error to classify
     * @returns Error category: 'throttle', 'network', 'conflict', or 'other'
     */
    private classifyError(error: unknown): 'throttle' | 'network' | 'conflict' | 'other' {
        if (!error) {
            return 'other';
        }

        // Check for MongoDB bulk write errors
        if (isBulkWriteError(error)) {
            // Check if any write errors are conflicts (duplicate key error code 11000)
            const writeErrors = Array.isArray(error.writeErrors) ? error.writeErrors : [error.writeErrors];
            if (writeErrors.some((we) => (we as WriteError)?.code === 11000)) {
                return 'conflict';
            }
        }

        // Type guard for objects with code or message properties
        const errorObj = error as { code?: number | string; message?: string };

        // Check for throttle errors
        if (errorObj.code === 429 || errorObj.code === 16500 || errorObj.code === '429' || errorObj.code === '16500') {
            return 'throttle';
        }

        // Check error message for throttle indicators
        const message = errorObj.message?.toLowerCase() || '';
        if (message.includes('rate limit') || message.includes('throttl') || message.includes('too many requests')) {
            return 'throttle';
        }

        // Check for network errors
        if (
            errorObj.code === 'ECONNRESET' ||
            errorObj.code === 'ETIMEDOUT' ||
            errorObj.code === 'ENOTFOUND' ||
            errorObj.code === 'ENETUNREACH'
        ) {
            return 'network';
        }

        if (message.includes('timeout') || message.includes('network') || message.includes('connection')) {
            return 'network';
        }

        return 'other';
    }

    /**
     * Delays execution for the specified duration.
     *
     * @param ms Milliseconds to sleep
     */
    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    /**
     * Calculates retry delay with exponential backoff and jitter.
     *
     * @param attempt Current attempt number (0-based)
     * @returns Delay in milliseconds
     */
    private calculateRetryDelay(attempt: number): number {
        const base = 1000; // 1 second base delay
        const multiplier = 1.5;
        const maxDelay = 5000; // 5 seconds max

        // Calculate exponential backoff
        const exponentialDelay = base * Math.pow(multiplier, attempt);
        const cappedDelay = Math.min(exponentialDelay, maxDelay);

        // Add ±30% jitter
        const jitterRange = cappedDelay * 0.3;
        const jitter = Math.random() * jitterRange * 2 - jitterRange; // Random value between -30% and +30%

        return Math.floor(cappedDelay + jitter);
    }

    /**
     * Writes a batch of documents with retry logic for rate limiting and network errors.
     * Implements immediate batch splitting when throttled.
     *
     * @param client ClustersClient instance
     * @param databaseName Target database name
     * @param collectionName Target collection name
     * @param batch Documents to write
     * @param config Copy-paste configuration
     * @param ordered Whether to use ordered inserts
     * @param options Write options including progress callback
     * @returns Promise with batch write result
     */
    private async writeBatchWithRetry(
        client: ClustersClient,
        databaseName: string,
        collectionName: string,
        batch: DocumentDetails[],
        config: CopyPasteConfig,
        ordered: boolean,
        options?: DocumentWriterOptions,
    ): Promise<BatchWriteResult> {
        let currentBatch = batch;
        const maxAttempts = 10;
        let attempt = 0;
        let wasThrottled = false;
        let totalInserted = 0; // Track total documents inserted across retries

        while (attempt < maxAttempts) {
            try {
                // Convert DocumentDetails to raw documents
                const rawDocuments = currentBatch.map((doc) => doc.documentContent as WithId<Document>);

                // For Overwrite strategy, use bulkWrite with replaceOne + upsert
                if (config.onConflict === ConflictResolutionStrategy.Overwrite) {
                    const collection = client.getCollection(databaseName, collectionName);

                    // Important: Sharded clusters - ensure filter includes full shard key.
                    // If shard key ≠ _id, include that key in the filter for proper routing.
                    const bulkOps = rawDocuments.map((doc) => ({
                        replaceOne: {
                            filter: { _id: doc._id },
                            replacement: doc,
                            upsert: true,
                        },
                    }));

                    const result = await collection.bulkWrite(bulkOps, {
                        ordered: false, // Parallelize on the server
                        writeConcern: { w: 1 }, // Can raise to 'majority' if needed
                        bypassDocumentValidation: true, // Only if safe
                    });

                    const documentsWritten = result.insertedCount + result.upsertedCount;

                    // Report progress for successful write
                    if (documentsWritten > 0) {
                        options?.progressCallback?.(documentsWritten);
                    }

                    return {
                        insertedCount: totalInserted + documentsWritten,
                        processedCount: batch.length,
                        wasThrottled,
                    };
                }

                // For other strategies, use insertDocuments
                const insertResult = await client.insertDocuments(databaseName, collectionName, rawDocuments, ordered);

                // Report progress for successful write
                if (insertResult.insertedCount > 0) {
                    options?.progressCallback?.(insertResult.insertedCount);
                }

                return {
                    insertedCount: totalInserted + insertResult.insertedCount,
                    processedCount: batch.length,
                    wasThrottled,
                };
            } catch (error: unknown) {
                const errorType = this.classifyError(error);

                if (errorType === 'throttle') {
                    wasThrottled = true;

                    // Check if some documents were successfully inserted before throttling
                    let documentsInserted = 0;
                    if (isBulkWriteError(error) && error.result?.insertedCount) {
                        documentsInserted = error.result.insertedCount;

                        // Validation: cross-check with insertedIds if available
                        if (error.insertedIds) {
                            const insertedIdsCount = Object.keys(error.insertedIds).length;
                            if (insertedIdsCount !== documentsInserted) {
                                ext.outputChannel.debug(
                                    l10n.t(
                                        'Throttle error: insertedCount ({0}) does not match insertedIds count ({1})',
                                        documentsInserted.toString(),
                                        insertedIdsCount.toString(),
                                    ),
                                );
                            }
                        }

                        ext.outputChannel.debug(
                            l10n.t(
                                'Throttle error: {0} documents were successfully inserted before throttling occurred',
                                documentsInserted.toString(),
                            ),
                        );
                    }

                    // Remove successfully inserted documents from the batch
                    if (documentsInserted > 0) {
                        // Track total inserted and report progress
                        totalInserted += documentsInserted;
                        options?.progressCallback?.(documentsInserted);

                        // With ordered inserts, documents are inserted sequentially
                        // We can simply slice off the successfully inserted documents
                        currentBatch = currentBatch.slice(documentsInserted);

                        // Use the successful insert count as the new batch size - this is the proven capacity!
                        // This is more accurate than halving because we know exactly what the database can handle
                        this.currentBatchSize = Math.max(this.minBatchSize, documentsInserted);

                        ext.outputChannel.debug(
                            l10n.t(
                                'Adjusted batch size to {0} based on successful inserts before throttle',
                                this.currentBatchSize.toString(),
                            ),
                        );

                        // CRITICAL: Reset attempt counter when making progress
                        // We only fail after 10 attempts WITHOUT progress, not 10 total attempts
                        attempt = 0;
                    } else if (currentBatch.length > 1) {
                        // No documents inserted - split batch in half as fallback
                        const halfSize = Math.floor(currentBatch.length / 2);
                        currentBatch = currentBatch.slice(0, halfSize);

                        ext.outputChannel.debug(
                            l10n.t('Throttle error with no inserts: reducing batch size to {0}', halfSize.toString()),
                        );
                    }

                    // Calculate backoff delay and sleep
                    const delay = this.calculateRetryDelay(attempt);
                    await this.sleep(delay);

                    attempt++;
                    continue;
                } else if (errorType === 'network') {
                    // Fixed delay for network errors, no batch size change
                    await this.sleep(2000);
                    attempt++;
                    continue;
                } else if (errorType === 'conflict' && isBulkWriteError(error)) {
                    // Return partial results for conflict errors
                    const writeErrorsArray = (
                        Array.isArray(error.writeErrors) ? error.writeErrors : [error.writeErrors]
                    ) as Array<WriteError>;

                    // Log detailed information about each conflicting document
                    writeErrorsArray.forEach((writeError) => {
                        try {
                            const operation = writeError.getOperation();
                            const documentId: unknown = operation?._id;
                            if (documentId !== undefined) {
                                // Format the document ID appropriately (could be ObjectId, string, number, etc.)
                                let formattedId: string;
                                try {
                                    formattedId = JSON.stringify(documentId);
                                } catch {
                                    // Fallback if JSON.stringify fails
                                    formattedId = typeof documentId === 'string' ? documentId : '[complex object]';
                                }

                                ext.outputChannel.error(
                                    l10n.t(
                                        'Conflict error for document with _id: {0}. Error: {1}',
                                        formattedId,
                                        writeError.errmsg || 'Unknown conflict error',
                                    ),
                                );
                            } else {
                                ext.outputChannel.error(
                                    l10n.t(
                                        'Conflict error for document (no _id available). Error: {0}',
                                        writeError.errmsg || 'Unknown conflict error',
                                    ),
                                );
                            }
                        } catch (logError) {
                            // Fail silently if we can't extract document info
                            ext.outputChannel.warn(
                                l10n.t('Failed to extract conflict document information: {0}', String(logError)),
                            );
                        }
                    });

                    return {
                        insertedCount: totalInserted + error.result.insertedCount,
                        processedCount: batch.length,
                        wasThrottled,
                        errors: writeErrorsArray.map((writeError) => ({
                            documentId: (writeError.getOperation()._id as string) || undefined,
                            error: new Error(writeError.errmsg || 'Unknown write error'),
                        })),
                    };
                } else {
                    // Other errors - throw immediately
                    throw error;
                }
            }
        }

        // Max attempts reached without progress
        throw new Error(
            l10n.t(
                'Failed to write batch after {0} attempts without progress. Total inserted: {1}, remaining: {2}',
                maxAttempts.toString(),
                totalInserted.toString(),
                currentBatch.length.toString(),
            ),
        );
    }

    /**
     * Writes documents in adaptive batches with retry logic.
     *
     * @param client ClustersClient instance
     * @param databaseName Target database
     * @param collectionName Target collection
     * @param documents Documents to write
     * @param config Copy-paste configuration
     * @param ordered Whether to use ordered inserts
     * @param options Write options including progress callback
     * @returns Bulk write result
     */
    private async writeDocumentsInBatches(
        client: ClustersClient,
        databaseName: string,
        collectionName: string,
        documents: DocumentDetails[],
        config: CopyPasteConfig,
        ordered: boolean,
        options?: DocumentWriterOptions,
    ): Promise<BulkWriteResult> {
        let totalInserted = 0;
        const allErrors: Array<{ documentId?: string; error: Error }> = [];
        let pendingDocs = [...documents];

        while (pendingDocs.length > 0) {
            // Take a batch with current adaptive size
            const batch = pendingDocs.slice(0, this.currentBatchSize);

            try {
                // Write batch with retry
                const result = await this.writeBatchWithRetry(
                    client,
                    databaseName,
                    collectionName,
                    batch,
                    config,
                    ordered,
                    options, // Pass options to enable progress reporting during retries
                );

                totalInserted += result.insertedCount;
                pendingDocs = pendingDocs.slice(result.processedCount);

                // Adjust batch size for next iteration
                // Note: If throttling occurred, writeBatchWithRetry already set currentBatchSize
                // based on the actual number of successful inserts (more accurate than percentage growth)
                if (!result.wasThrottled && this.currentBatchSize < this.maxBatchSize) {
                    // Grow batch size by 10% on success without throttling
                    const growthFactor = 1.1; // 10% increase
                    this.currentBatchSize = Math.min(
                        this.maxBatchSize,
                        Math.floor(this.currentBatchSize * growthFactor),
                    );
                }

                // Collect errors if any
                if (result.errors) {
                    allErrors.push(...result.errors);

                    // For Abort strategy, stop immediately on first error
                    if (config.onConflict === ConflictResolutionStrategy.Abort) {
                        break;
                    }
                }

                // Progress is now reported inside writeBatchWithRetry for all cases
                // No need to report here - it's already been reported
            } catch (error) {
                // This is a fatal error - return what we have so far
                const errorObj = error instanceof Error ? error : new Error(String(error));
                allErrors.push({ documentId: undefined, error: errorObj });
                break;
            }
        }

        return {
            insertedCount: totalInserted,
            errors: allErrors.length > 0 ? allErrors : null,
        };
    }

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
        options?: DocumentWriterOptions,
    ): Promise<BulkWriteResult> {
        if (documents.length === 0) {
            return {
                insertedCount: 0,
                errors: [],
            };
        }

        const client = await ClustersClient.getClient(connectionId);

        // For GenerateNewIds strategy, transform documents before batching
        if (config.onConflict === ConflictResolutionStrategy.GenerateNewIds) {
            const rawDocuments = documents.map((doc) => doc.documentContent as WithId<Document>);
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

            // Convert transformed documents back to DocumentDetails format
            const transformedDocumentDetails = transformedDocuments.map((doc) => ({
                id: undefined,
                documentContent: doc,
            }));

            return this.writeDocumentsInBatches(
                client,
                databaseName,
                collectionName,
                transformedDocumentDetails,
                config,
                false, // Always use unordered for GenerateNewIds since conflicts shouldn't occur
                options,
            );
        }

        // For other strategies: Use ordered inserts for predictable throttle handling
        // IMPORTANT DESIGN DECISION: ordered: true (DO NOT CHANGE)
        //
        // Rationale for ordered inserts:
        // 1. Simplicity: Simple slice-based retry logic when throttled (no ID filtering needed)
        // 2. Predictability: Documents inserted sequentially, insertedCount tells exact progress
        // 3. Reliability: No issues with complex _id types (objects, arrays)
        // 4. Accurate batch learning: insertedCount directly indicates proven database capacity
        // 5. Abort strategy: Ensures we stop immediately on first conflict
        //
        // Performance consideration:
        // - Ordered inserts are ~10-30% slower than unordered in optimal conditions
        // - However, they provide significantly simpler and more reliable throttle handling
        // - For RU-limited environments (Azure Cosmos DB), reliability > raw speed
        //
        // Future optimization:
        // - A dedicated writer for unthrottled environments can use ordered: false
        // - This writer prioritizes correctness and ease of maintenance
        return this.writeDocumentsInBatches(
            client,
            databaseName,
            collectionName,
            documents,
            config,
            true, // Ordered for reliability and simplicity - see comment above
            options,
        );
    }

    /**
     * Ensures the target collection exists.
     *
     * @param connectionId Connection identifier to get the DocumentDB client
     * @param databaseName Name of the target database
     * @param collectionName Name of the target collection
     * @returns Promise resolving to information about whether the collection was created
     */
    async ensureCollectionExists(
        connectionId: string,
        databaseName: string,
        collectionName: string,
    ): Promise<EnsureCollectionExistsResult> {
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
            return { collectionWasCreated: true };
        }

        return { collectionWasCreated: false };
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
