/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { type Document, type WithId, type WriteError } from 'mongodb';
import { l10n } from 'vscode';
import { isBulkWriteError, type ClustersClient } from '../../../../documentdb/ClustersClient';
import { ext } from '../../../../extensionVariables';
import { type CopyPasteConfig } from '../../tasks/copy-and-paste/copyPasteConfig';
import { type DocumentDetails, type EnsureTargetExistsResult } from '../types';
import { type ErrorType, type ProcessedDocumentsDetails, type StrategyWriteResult } from '../writerTypes';
import { BaseDocumentWriter } from './BaseDocumentWriter';

/**
 * DocumentDB with MongoDB API implementation of DocumentWriter.
 *
 * This implementation supports Azure Cosmos DB for MongoDB (vCore and RU-based) as well as
 * MongoDB Community Edition and other MongoDB-compatible databases.
 *
 * This implementation provides conflict resolution strategies and error classification
 * while delegating batch orchestration, retry logic, and adaptive batching to BaseDocumentWriter.
 *
 * Key features:
 * - Pre-filters conflicts in Skip strategy for optimal performance
 * - Handles wire protocol error codes (11000 for duplicates, 16500/429 for throttling)
 * - Uses bulkWrite for efficient batch operations
 * - Extracts detailed error information from driver errors
 *
 * Supported conflict resolution strategies:
 * - Skip: Pre-filter existing documents, insert only new ones
 * - Overwrite: Replace existing documents or insert new ones (upsert)
 * - Abort: Insert all documents, return conflicts in errors array
 * - GenerateNewIds: Remove _id, insert with database-generated IDs
 */
export class DocumentDbDocumentWriter extends BaseDocumentWriter<string> {
    public constructor(
        private readonly client: ClustersClient,
        databaseName: string,
        collectionName: string,
        config: CopyPasteConfig,
    ) {
        super(databaseName, collectionName, config.onConflict);
    }

    /**
     * Implements the Skip conflict resolution strategy.
     *
     * PERFORMANCE OPTIMIZATION:
     * This implementation pre-filters conflicts by querying for existing _id values
     * before attempting insertion. This avoids the overhead of handling bulk write
     * errors for documents we know will conflict.
     *
     * However, conflicts can still occur due to:
     * - Concurrent writes from other clients between the query and insert
     * - Network race conditions
     * - Replication lag in distributed systems
     *
     * The dual-path conflict handling in BaseDocumentWriter.writeBatchWithRetry()
     * will catch any unexpected conflicts via the fallback path.
     *
     * @param documents Batch of documents to insert
     * @param _actionContext Optional context for telemetry (unused in this implementation)
     * @returns StrategyWriteResult with inserted/skipped counts and conflict details
     */
    protected override async writeWithSkipStrategy(
        documents: DocumentDetails[],
        _actionContext?: IActionContext,
    ): Promise<StrategyWriteResult<string>> {
        const rawDocuments = documents.map((doc) => doc.documentContent as WithId<Document>);
        const { docsToInsert, conflictIds } = await this.preFilterConflicts(rawDocuments);

        if (conflictIds.length > 0) {
            ext.outputChannel.debug(
                l10n.t(
                    '[Writer] Skipping {0} conflicting documents (server-side detection)',
                    conflictIds.length.toString(),
                ),
            );

            // Log each skipped document with its native _id format for detailed debugging
            for (const id of conflictIds) {
                ext.outputChannel.appendLog(
                    l10n.t('[Writer] Skipped document with _id: {0}', this.formatDocumentId(id)),
                );
            }
        }

        let insertedCount = 0;
        if (docsToInsert.length > 0) {
            const insertResult = await this.client.insertDocuments(
                this.databaseName,
                this.collectionName,
                docsToInsert,
                true,
            );
            insertedCount = insertResult.insertedCount ?? 0;
        }

        const skippedCount = conflictIds.length;
        const processedCount = insertedCount + skippedCount;

        const errors = conflictIds.map((id) => ({
            documentId: this.formatDocumentId(id),
            error: new Error('Document already exists (skipped)'),
        }));

        return {
            insertedCount,
            skippedCount,
            processedCount,
            errors: errors.length > 0 ? errors : undefined,
        };
    }

    /**
     * Implements the Overwrite conflict resolution strategy.
     *
     * Uses bulkWrite with replaceOne operations and upsert:true to either:
     * - Replace existing documents with matching _id (matched + modified)
     * - Insert new documents if _id doesn't exist (upserted)
     *
     * This strategy never produces conflicts since overwrites are intentional.
     *
     * @param documents Batch of documents to upsert
     * @param _actionContext Optional context for telemetry (unused in this implementation)
     * @returns StrategyWriteResult with matched/modified/upserted counts
     */
    protected override async writeWithOverwriteStrategy(
        documents: DocumentDetails[],
        _actionContext?: IActionContext,
    ): Promise<StrategyWriteResult<string>> {
        const rawDocuments = documents.map((doc) => doc.documentContent as WithId<Document>);
        const collection = this.client.getCollection(this.databaseName, this.collectionName);

        const bulkOps = rawDocuments.map((doc) => ({
            replaceOne: {
                filter: { _id: doc._id },
                replacement: doc,
                upsert: true,
            },
        }));

        const result = await collection.bulkWrite(bulkOps, {
            ordered: true,
            writeConcern: { w: 1 },
            bypassDocumentValidation: true,
        });

        const matchedCount = result.matchedCount ?? 0;
        const upsertedCount = result.upsertedCount ?? 0;
        const modifiedCount = result.modifiedCount ?? 0;

        return {
            matchedCount,
            modifiedCount,
            upsertedCount,
            processedCount: matchedCount + upsertedCount,
        };
    }

    /**
     * Implements the Abort conflict resolution strategy.
     *
     * PRIMARY PATH (Recommended):
     * Catches BulkWriteError with duplicate key errors (code 11000) and returns
     * conflict details in the StrategyWriteResult.errors array. This provides
     * clean error messages and better control over conflict reporting.
     *
     * FALLBACK PATH:
     * Throws unexpected errors (network, throttle, unknown conflicts) for the
     * retry logic in BaseDocumentWriter.writeBatchWithRetry() to handle.
     *
     * @param documents Batch of documents to insert
     * @param _actionContext Optional context for telemetry (unused in this implementation)
     * @returns StrategyWriteResult with inserted count and optional conflict errors
     * @throws Error for unexpected failures (network, throttle) that require retry
     */
    protected override async writeWithAbortStrategy(
        documents: DocumentDetails[],
        _actionContext?: IActionContext,
    ): Promise<StrategyWriteResult<string>> {
        const rawDocuments = documents.map((doc) => doc.documentContent as WithId<Document>);

        try {
            const insertResult = await this.client.insertDocuments(
                this.databaseName,
                this.collectionName,
                rawDocuments,
                true,
            );
            const insertedCount = insertResult.insertedCount ?? 0;

            return {
                insertedCount,
                processedCount: insertedCount,
            };
        } catch (error) {
            // Primary path: handle expected conflicts by returning in result
            if (isBulkWriteError(error)) {
                const writeErrors = this.extractWriteErrors(error);

                // Check if any write errors are duplicate key conflicts
                if (writeErrors.some((e) => e?.code === 11000)) {
                    ext.outputChannel.debug(
                        l10n.t('[Writer] Handling expected conflicts in Abort strategy (primary path)'),
                    );

                    // Extract document processing details from the error
                    const details = this.extractDocumentCounts(error);

                    // Build enhanced conflict error messages
                    const conflictErrors = writeErrors
                        .filter((e) => e?.code === 11000)
                        .map((writeError) => {
                            const documentId = this.extractDocumentId(writeError);
                            const originalMessage = this.extractErrorMessage(writeError);

                            const enhancedMessage = documentId
                                ? l10n.t(
                                      'Duplicate key error for document with _id: {0}. {1}',
                                      documentId,
                                      originalMessage,
                                  )
                                : l10n.t('Duplicate key error. {0}', originalMessage);

                            return {
                                documentId,
                                error: new Error(enhancedMessage),
                            };
                        });

                    // Log each conflict for debugging
                    for (const conflictError of conflictErrors) {
                        ext.outputChannel.appendLog(
                            l10n.t(
                                '[Writer] Conflict in Abort strategy for document with _id: {0}',
                                conflictError.documentId || '[unknown]',
                            ),
                        );
                    }

                    return {
                        processedCount: details.processedCount,
                        insertedCount: details.insertedCount,
                        matchedCount: details.matchedCount,
                        modifiedCount: details.modifiedCount,
                        upsertedCount: details.upsertedCount,
                        skippedCount: details.skippedCount,
                        errors: conflictErrors,
                    };
                }
            }

            // Fallback path: throw unexpected errors (network, throttle, other) for retry logic
            throw error;
        }
    }

    /**
     * Implements the GenerateNewIds conflict resolution strategy.
     *
     * Transforms each document by:
     * 1. Removing the original _id field
     * 2. Storing the original _id in a backup field (_original_id or _original_id_N)
     * 3. Inserting the document (DocumentDB with MongoDB API generates a new _id)
     *
     * The backup field name avoids collisions by checking for existing fields
     * and appending a counter if necessary (_original_id_1, _original_id_2, etc.).
     *
     * This strategy shouldn't produce conflicts since each document gets a new _id.
     *
     * @param documents Batch of documents to insert with new IDs
     * @param _actionContext Optional context for telemetry (unused in this implementation)
     * @returns StrategyWriteResult with inserted count
     */
    protected override async writeWithGenerateNewIdsStrategy(
        documents: DocumentDetails[],
        _actionContext?: IActionContext,
    ): Promise<StrategyWriteResult<string>> {
        // Transform documents: remove _id and store it in a backup field
        const transformedDocuments = documents.map((detail) => {
            const rawDocument = detail.documentContent as WithId<Document>;
            const { _id, ...docWithoutId } = rawDocument;
            const originalIdFieldName = this.findAvailableOriginalIdFieldName(docWithoutId);

            return {
                ...docWithoutId,
                [originalIdFieldName]: _id,
            } as Document;
        });

        const insertResult = await this.client.insertDocuments(
            this.databaseName,
            this.collectionName,
            transformedDocuments,
            true,
        );
        const insertedCount = insertResult.insertedCount ?? 0;

        return {
            insertedCount,
            processedCount: insertedCount,
        };
    }

    /**
     * Extracts processing details from DocumentDB with MongoDB API error objects.
     *
     * Parses both top-level properties and nested result objects to extract
     * operation statistics like insertedCount, matchedCount, etc.
     *
     * For BulkWriteError objects, also calculates skippedCount from duplicate
     * key errors (code 11000) when using Skip strategy.
     *
     * @param error Error object from DocumentDB operation
     * @param _actionContext Optional context for telemetry (unused in this implementation)
     * @returns ProcessedDocumentsDetails if statistics available, undefined otherwise
     */
    protected override extractDetailsFromError(
        error: unknown,
        _actionContext?: IActionContext,
    ): ProcessedDocumentsDetails | undefined {
        if (!error || typeof error !== 'object') {
            return undefined;
        }

        return this.extractDocumentCounts(error);
    }

    /**
     * Extracts conflict details from DocumentDB with MongoDB API BulkWriteError objects.
     *
     * Parses the writeErrors array and extracts:
     * - Document ID from the failed operation
     * - Error message from the database driver
     *
     * This is used by the fallback conflict handling path when conflicts
     * are thrown instead of returned in StrategyWriteResult.errors.
     *
     * @param error Error object from DocumentDB operation
     * @param _actionContext Optional context for telemetry (unused in this implementation)
     * @returns Array of conflict details with documentId and error message
     */
    protected override extractConflictDetails(
        error: unknown,
        _actionContext?: IActionContext,
    ): Array<{ documentId?: string; error: Error }> {
        if (!isBulkWriteError(error)) {
            return [];
        }

        const writeErrors = this.extractWriteErrors(error);
        this.logConflictErrors(writeErrors);

        return writeErrors.map((writeError) => ({
            documentId: this.extractDocumentId(writeError),
            error: new Error(this.extractErrorMessage(writeError)),
        }));
    }

    /**
     * Extracts write errors from a BulkWriteError, handling both array and single item cases.
     *
     * The database driver may return writeErrors as either:
     * - An array of WriteError objects
     * - A single WriteError object
     *
     * This helper normalizes both cases into an array for consistent processing.
     *
     * @param bulkError BulkWriteError from DocumentDB operation
     * @returns Array of WriteError objects (empty if no writeErrors present)
     */
    private extractWriteErrors(bulkError: { writeErrors?: unknown }): WriteError[] {
        const { writeErrors } = bulkError;

        if (!writeErrors) {
            return [];
        }

        const errorsArray = Array.isArray(writeErrors) ? writeErrors : [writeErrors];
        return errorsArray.filter((error): error is WriteError => error !== undefined);
    }

    /**
     * Extracts the document ID from a DocumentDB WriteError's operation.
     *
     * Calls getOperation() on the WriteError to retrieve the failed document,
     * then extracts its _id field.
     *
     * @param writeError WriteError from DocumentDB operation
     * @returns Formatted document ID string, or undefined if not available
     */
    private extractDocumentId(writeError: WriteError): string | undefined {
        const operation = typeof writeError.getOperation === 'function' ? writeError.getOperation() : undefined;
        const documentId: unknown = operation?._id;

        return documentId !== undefined ? this.formatDocumentId(documentId) : undefined;
    }

    /**
     * Extracts the error message from a DocumentDB WriteError.
     *
     * MongoDB wire protocol WriteErrors have an `errmsg` property containing the error description.
     *
     * @param writeError WriteError from DocumentDB operation
     * @returns Error message string, or 'Unknown write error' if not available
     */
    private extractErrorMessage(writeError: WriteError): string {
        return typeof writeError.errmsg === 'string' ? writeError.errmsg : 'Unknown write error';
    }

    /**
     * Classifies DocumentDB with MongoDB API errors into specific types for retry handling.
     *
     * CLASSIFICATION LOGIC:
     * - Throttle: Code 429, 16500, or messages containing 'rate limit'/'throttl'/'too many requests'
     * - Network: Connection errors (ECONNRESET, ETIMEDOUT, etc.) or timeout/connection messages
     * - Conflict: BulkWriteError with code 11000 (duplicate key error)
     * - Other: All other errors (thrown immediately, no retry)
     *
     * @param error Error object from DocumentDB operation
     * @param _actionContext Optional context for telemetry (unused in this implementation)
     * @returns ErrorType classification for retry logic
     */
    protected override classifyError(error: unknown, _actionContext?: IActionContext): ErrorType {
        if (!error) {
            return 'other';
        }

        if (isBulkWriteError(error)) {
            const writeErrors = Array.isArray(error.writeErrors) ? error.writeErrors : [error.writeErrors];
            if (writeErrors.some((writeError) => (writeError as WriteError)?.code === 11000)) {
                return 'conflict';
            }
        }

        const errorObj = error as { code?: number | string; message?: string };

        if (errorObj.code === 429 || errorObj.code === 16500 || errorObj.code === '429' || errorObj.code === '16500') {
            return 'throttle';
        }

        const message = errorObj.message?.toLowerCase() ?? '';
        if (message.includes('rate limit') || message.includes('throttl') || message.includes('too many requests')) {
            return 'throttle';
        }

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
     * Ensures the target collection exists, creating it if necessary.
     *
     * Queries the database for the list of collections and checks if the target
     * collection name exists. If not found, creates the collection.
     *
     * @returns EnsureTargetExistsResult indicating whether creation was needed
     */
    public async ensureTargetExists(): Promise<EnsureTargetExistsResult> {
        const collections = await this.client.listCollections(this.databaseName);
        const collectionExists = collections.some((col) => col.name === this.collectionName);

        if (!collectionExists) {
            await this.client.createCollection(this.databaseName, this.collectionName);
            return { targetWasCreated: true };
        }

        return { targetWasCreated: false };
    }

    /**
     * Pre-filters documents to identify conflicts before attempting insertion.
     *
     * PERFORMANCE OPTIMIZATION FOR SKIP STRATEGY:
     * Queries the collection for documents with _id values matching the batch,
     * then filters out existing documents to avoid unnecessary insert attempts.
     *
     * IMPORTANT: This is an optimization, not a guarantee. Conflicts can still occur
     * due to concurrent writes from other clients between this query and the subsequent
     * insert operation. The dual-path conflict handling in BaseDocumentWriter handles
     * any race conditions via the fallback path.
     *
     * @param documents Batch of documents to check for conflicts
     * @returns Object with docsToInsert (non-conflicting) and conflictIds (existing)
     */
    private async preFilterConflicts(
        documents: WithId<Document>[],
    ): Promise<{ docsToInsert: WithId<Document>[]; conflictIds: unknown[] }> {
        const batchIds = documents.map((doc) => doc._id);
        const collection = this.client.getCollection(this.databaseName, this.collectionName);
        const existingDocs = await collection.find({ _id: { $in: batchIds } }, { projection: { _id: 1 } }).toArray();

        if (existingDocs.length === 0) {
            return {
                docsToInsert: documents,
                conflictIds: [],
            };
        }

        const docsToInsert = documents.filter((doc) => {
            return !existingDocs.some((existingDoc) => {
                try {
                    return JSON.stringify(existingDoc._id) === JSON.stringify(doc._id);
                } catch {
                    return false;
                }
            });
        });

        return {
            docsToInsert,
            conflictIds: existingDocs.map((doc) => doc._id),
        };
    }

    /**
     * Extracts document operation counts from DocumentDB result or error objects.
     *
     * Handles both:
     * - Successful operation results with counts at top level
     * - Error objects with counts nested in a result property
     *
     * For BulkWriteError objects with code 11000 (duplicate key), calculates
     * skippedCount from the number of conflict errors.
     *
     * @param resultOrError Result object or error from DocumentDB operation
     * @returns ProcessedDocumentsDetails with all available counts
     */
    private extractDocumentCounts(resultOrError: unknown): ProcessedDocumentsDetails {
        const topLevel = resultOrError as {
            insertedCount?: number;
            matchedCount?: number;
            modifiedCount?: number;
            upsertedCount?: number;
            result?: {
                insertedCount?: number;
                matchedCount?: number;
                modifiedCount?: number;
                upsertedCount?: number;
            };
        };

        // Extract counts, preferring top-level over nested result
        const insertedCount = topLevel.insertedCount ?? topLevel.result?.insertedCount;
        const matchedCount = topLevel.matchedCount ?? topLevel.result?.matchedCount;
        const modifiedCount = topLevel.modifiedCount ?? topLevel.result?.modifiedCount;
        const upsertedCount = topLevel.upsertedCount ?? topLevel.result?.upsertedCount;

        // Calculate skipped count from conflicts if this is a bulk write error
        let skippedCount: number | undefined;
        if (isBulkWriteError(resultOrError)) {
            const writeErrors = this.extractWriteErrors(resultOrError);
            // In skip strategy, conflicting documents are considered "skipped"
            skippedCount = writeErrors.filter((writeError) => writeError?.code === 11000).length;
        }

        // Calculate processedCount from defined values only
        const processedCount = (insertedCount ?? 0) + (matchedCount ?? 0) + (upsertedCount ?? 0) + (skippedCount ?? 0);

        return {
            processedCount,
            insertedCount,
            matchedCount,
            modifiedCount,
            upsertedCount,
            skippedCount,
        };
    }

    /**
     * Formats a document ID as a string for logging and error messages.
     *
     * Attempts JSON serialization first. Falls back to direct string conversion
     * if serialization fails, or returns '[complex object]' for non-serializable values.
     *
     * @param documentId Document ID of any type (ObjectId, string, number, etc.)
     * @returns Formatted string representation of the ID
     */
    private formatDocumentId(documentId: unknown): string {
        try {
            return JSON.stringify(documentId);
        } catch {
            return typeof documentId === 'string' ? documentId : '[complex object]';
        }
    }

    /**
     * Finds an available field name for storing the original _id during GenerateNewIds strategy.
     *
     * Checks if _original_id exists in the document. If it does, tries _original_id_1,
     * _original_id_2, etc. until finding an unused field name.
     *
     * This ensures we don't accidentally overwrite existing document data.
     *
     * @param doc Document to check for field name availability
     * @returns Available field name (_original_id or _original_id_N)
     */
    private findAvailableOriginalIdFieldName(doc: Partial<Document>): string {
        const baseFieldName = '_original_id';

        if (!(baseFieldName in doc)) {
            return baseFieldName;
        }

        let counter = 1;
        let candidateFieldName = `${baseFieldName}_${counter}`;

        while (candidateFieldName in doc) {
            counter++;
            candidateFieldName = `${baseFieldName}_${counter}`;
        }

        return candidateFieldName;
    }

    /**
     * Logs conflict errors with detailed information for debugging.
     *
     * For each WriteError in the array:
     * - Extracts document ID if available
     * - Extracts error message from database driver
     * - Logs to extension output channel
     *
     * Handles extraction failures gracefully by logging a warning.
     *
     * @param writeErrors Array of WriteError objects from DocumentDB operation
     */
    private logConflictErrors(writeErrors: ReadonlyArray<WriteError>): void {
        for (const writeError of writeErrors) {
            try {
                const documentId = this.extractDocumentId(writeError);
                const message = this.extractErrorMessage(writeError);

                if (documentId !== undefined) {
                    ext.outputChannel.error(
                        l10n.t('Conflict error for document with _id: {0}. Error: {1}', documentId, message),
                    );
                } else {
                    ext.outputChannel.error(
                        l10n.t('Conflict error for document (no _id available). Error: {0}', message),
                    );
                }
            } catch (logError) {
                ext.outputChannel.warn(
                    l10n.t('Failed to extract conflict document information: {0}', String(logError)),
                );
            }
        }
    }
}
