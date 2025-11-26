/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { type Document, type WithId, type WriteError } from 'mongodb';
import { l10n } from 'vscode';
import { isBulkWriteError, type ClustersClient } from '../../../../documentdb/ClustersClient';
import { ext } from '../../../../extensionVariables';
import { ConflictResolutionStrategy, type DocumentDetails, type EnsureTargetExistsResult } from '../types';
import { type BatchWriteResult, type ErrorType, type PartialProgress } from '../writerTypes';
import { StreamingDocumentWriter } from './StreamingDocumentWriter';

/**
 * Raw document counts extracted from MongoDB driver responses.
 * Uses MongoDB-specific field names (internal use only).
 */
interface RawDocumentCounts {
    processedCount: number;
    insertedCount?: number;
    matchedCount?: number;
    modifiedCount?: number;
    upsertedCount?: number;
    collidedCount?: number;
}

/**
 * DocumentDB with MongoDB API implementation of StreamingDocumentWriter.
 *
 * This implementation supports Azure Cosmos DB for MongoDB (vCore and RU-based) as well as
 * MongoDB Community Edition and other MongoDB-compatible databases.
 *
 * Key features:
 * - Implements all 4 conflict resolution strategies in a single writeBatch method
 * - Pre-filters conflicts in Skip strategy for optimal performance
 * - Handles wire protocol error codes (11000 for duplicates, 16500/429 for throttling)
 * - Uses bulkWrite for efficient batch operations
 * - Extracts detailed error information from driver errors
 *
 * @example
 * const writer = new DocumentDbStreamingWriter(client, 'testdb', 'testcollection');
 *
 * const result = await writer.streamDocuments(
 *   documentStream,
 *   { conflictResolutionStrategy: ConflictResolutionStrategy.Skip },
 *   { onProgress: (count, details) => console.log(`${count}: ${details}`) }
 * );
 */
export class DocumentDbStreamingWriter extends StreamingDocumentWriter<string> {
    constructor(
        private readonly client: ClustersClient,
        databaseName: string,
        collectionName: string,
    ) {
        super(databaseName, collectionName);
    }

    // =================================
    // ABSTRACT METHOD IMPLEMENTATIONS
    // =================================

    /**
     * Writes a batch of documents using the specified conflict resolution strategy.
     *
     * Dispatches to the appropriate internal method based on strategy:
     * - Skip: Pre-filter conflicts, insert only new documents
     * - Overwrite: Replace existing documents (upsert)
     * - Abort: Insert all, stop on first conflict
     * - GenerateNewIds: Remove _id, insert with new IDs
     */
    protected override async writeBatch(
        documents: DocumentDetails[],
        strategy: ConflictResolutionStrategy,
        actionContext?: IActionContext,
    ): Promise<BatchWriteResult<string>> {
        switch (strategy) {
            case ConflictResolutionStrategy.Skip:
                return this.writeWithSkipStrategy(documents, actionContext);
            case ConflictResolutionStrategy.Overwrite:
                return this.writeWithOverwriteStrategy(documents, actionContext);
            case ConflictResolutionStrategy.Abort:
                return this.writeWithAbortStrategy(documents, actionContext);
            case ConflictResolutionStrategy.GenerateNewIds:
                return this.writeWithGenerateNewIdsStrategy(documents, actionContext);
            default:
                throw new Error(l10n.t('Unknown conflict resolution strategy: {0}', strategy));
        }
    }

    /**
     * Classifies DocumentDB with MongoDB API errors into specific types for retry handling.
     *
     * Classification:
     * - Throttle: Code 429, 16500, or rate limit messages
     * - Network: Connection errors (ECONNRESET, ETIMEDOUT, etc.)
     * - Conflict: BulkWriteError with code 11000 (duplicate key)
     * - Other: All other errors
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
     * Extracts partial progress from DocumentDB with MongoDB API error objects.
     *
     * Parses BulkWriteError to extract counts of documents processed before the error.
     */
    protected override extractPartialProgress(
        error: unknown,
        _actionContext?: IActionContext,
    ): PartialProgress | undefined {
        if (!error || typeof error !== 'object') {
            return undefined;
        }

        const rawCounts = this.extractRawDocumentCounts(error);
        return this.translateToPartialProgress(rawCounts);
    }

    /**
     * Ensures the target collection exists, creating it if necessary.
     */
    public override async ensureTargetExists(): Promise<EnsureTargetExistsResult> {
        const collections = await this.client.listCollections(this.databaseName);
        const collectionExists = collections.some((col) => col.name === this.collectionName);

        if (!collectionExists) {
            await this.client.createCollection(this.databaseName, this.collectionName);
            return { targetWasCreated: true };
        }

        return { targetWasCreated: false };
    }

    // =================================
    // STRATEGY IMPLEMENTATIONS
    // =================================

    /**
     * Implements the Skip conflict resolution strategy.
     *
     * Pre-filters conflicts by querying for existing _id values before insertion.
     */
    private async writeWithSkipStrategy(
        documents: DocumentDetails[],
        _actionContext?: IActionContext,
    ): Promise<BatchWriteResult<string>> {
        const rawDocuments = documents.map((doc) => doc.documentContent as WithId<Document>);
        const { docsToInsert, conflictIds } = await this.preFilterConflicts(rawDocuments);

        if (conflictIds.length > 0) {
            ext.outputChannel.debug(
                l10n.t(
                    '[DocumentDbStreamingWriter] Skipping {0} conflicting documents (server-side detection)',
                    conflictIds.length.toString(),
                ),
            );

            for (const id of conflictIds) {
                ext.outputChannel.trace(
                    l10n.t('[DocumentDbStreamingWriter] Skipped document with _id: {0}', this.formatDocumentId(id)),
                );
            }
        }

        let insertedCount = 0;
        let fallbackCollidedCount = 0;
        const fallbackErrors: Array<{ documentId: string; error: Error }> = [];

        if (docsToInsert.length > 0) {
            try {
                const insertResult = await this.client.insertDocuments(
                    this.databaseName,
                    this.collectionName,
                    docsToInsert,
                    true,
                );
                insertedCount = insertResult.insertedCount ?? 0;
            } catch (error) {
                // Fallback: Handle race condition conflicts during insert
                // Another process may have inserted documents after our pre-filter check
                if (isBulkWriteError(error)) {
                    const writeErrors = this.extractWriteErrors(error);
                    const duplicateErrors = writeErrors.filter((e) => e?.code === 11000);

                    if (duplicateErrors.length > 0) {
                        ext.outputChannel.debug(
                            l10n.t(
                                '[DocumentDbStreamingWriter] Fallback: {0} race condition conflicts detected during Skip insert',
                                duplicateErrors.length.toString(),
                            ),
                        );

                        // Extract counts from the error - some documents may have been inserted
                        const rawCounts = this.extractRawDocumentCounts(error);
                        insertedCount = rawCounts.insertedCount ?? 0;
                        fallbackCollidedCount = duplicateErrors.length;

                        // Build errors for the fallback conflicts
                        for (const writeError of duplicateErrors) {
                            const documentId = this.extractDocumentIdFromWriteError(writeError);
                            fallbackErrors.push({
                                documentId: documentId ?? '[unknown]',
                                error: new Error(l10n.t('Document already exists (race condition, skipped)')),
                            });
                        }
                    } else {
                        // Non-duplicate bulk write error - re-throw
                        throw error;
                    }
                } else {
                    // Non-bulk write error - re-throw
                    throw error;
                }
            }
        }

        const collidedCount = conflictIds.length + fallbackCollidedCount;
        const errors = [
            ...conflictIds.map((id) => ({
                documentId: this.formatDocumentId(id),
                error: new Error(l10n.t('Document already exists (skipped)')),
            })),
            ...fallbackErrors,
        ];

        return {
            insertedCount,
            collidedCount,
            processedCount: insertedCount + collidedCount,
            errors: errors.length > 0 ? errors : undefined,
        };
    }

    /**
     * Implements the Overwrite conflict resolution strategy.
     *
     * Uses bulkWrite with replaceOne operations and upsert:true.
     */
    private async writeWithOverwriteStrategy(
        documents: DocumentDetails[],
        _actionContext?: IActionContext,
    ): Promise<BatchWriteResult<string>> {
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
     * Catches BulkWriteError with duplicate key errors and returns conflict details.
     */
    private async writeWithAbortStrategy(
        documents: DocumentDetails[],
        _actionContext?: IActionContext,
    ): Promise<BatchWriteResult<string>> {
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
            if (isBulkWriteError(error)) {
                const writeErrors = this.extractWriteErrors(error);

                if (writeErrors.some((e) => e?.code === 11000)) {
                    ext.outputChannel.debug(
                        l10n.t('[DocumentDbStreamingWriter] Handling expected conflicts in Abort strategy'),
                    );

                    const rawCounts = this.extractRawDocumentCounts(error);
                    const conflictErrors = writeErrors
                        .filter((e) => e?.code === 11000)
                        .map((writeError) => {
                            const documentId = this.extractDocumentIdFromWriteError(writeError);
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

                    for (const conflictError of conflictErrors) {
                        ext.outputChannel.appendLog(
                            l10n.t(
                                '[DocumentDbStreamingWriter] Conflict for document with _id: {0}',
                                conflictError.documentId || '[unknown]',
                            ),
                        );
                    }

                    // Return BatchWriteResult with raw MongoDB field names
                    return {
                        processedCount: rawCounts.processedCount,
                        insertedCount: rawCounts.insertedCount,
                        matchedCount: rawCounts.matchedCount,
                        modifiedCount: rawCounts.modifiedCount,
                        upsertedCount: rawCounts.upsertedCount,
                        collidedCount: rawCounts.collidedCount,
                        errors: conflictErrors,
                    };
                }
            }

            throw error;
        }
    }

    /**
     * Implements the GenerateNewIds conflict resolution strategy.
     *
     * Transforms documents by removing _id and storing it in a backup field.
     */
    private async writeWithGenerateNewIdsStrategy(
        documents: DocumentDetails[],
        _actionContext?: IActionContext,
    ): Promise<BatchWriteResult<string>> {
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

    // =================================
    // HELPER METHODS
    // =================================

    /**
     * Pre-filters documents to identify conflicts before attempting insertion.
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
     * Extracts raw document operation counts from DocumentDB result or error objects.
     * Returns MongoDB-specific field names for internal use.
     */
    private extractRawDocumentCounts(resultOrError: unknown): RawDocumentCounts {
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

        const insertedCount = topLevel.insertedCount ?? topLevel.result?.insertedCount;
        const matchedCount = topLevel.matchedCount ?? topLevel.result?.matchedCount;
        const modifiedCount = topLevel.modifiedCount ?? topLevel.result?.modifiedCount;
        const upsertedCount = topLevel.upsertedCount ?? topLevel.result?.upsertedCount;

        let collidedCount: number | undefined;
        if (isBulkWriteError(resultOrError)) {
            const writeErrors = this.extractWriteErrors(resultOrError);
            collidedCount = writeErrors.filter((writeError) => writeError?.code === 11000).length;
        }

        const processedCount = (insertedCount ?? 0) + (matchedCount ?? 0) + (upsertedCount ?? 0) + (collidedCount ?? 0);

        return {
            processedCount,
            insertedCount,
            matchedCount,
            modifiedCount,
            upsertedCount,
            collidedCount,
        };
    }

    /**
     * Translates raw MongoDB counts to semantic PartialProgress names.
     */
    private translateToPartialProgress(raw: RawDocumentCounts): PartialProgress {
        return {
            processedCount: raw.processedCount,
            insertedCount: raw.insertedCount,
            skippedCount: raw.collidedCount, // collided = skipped for Skip strategy
            replacedCount: raw.matchedCount, // matched = replaced for Overwrite
            createdCount: raw.upsertedCount, // upserted = created for Overwrite
        };
    }

    /**
     * Extracts write errors from a BulkWriteError.
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
     * Extracts the document ID from a WriteError.
     */
    private extractDocumentIdFromWriteError(writeError: WriteError): string | undefined {
        const operation = typeof writeError.getOperation === 'function' ? writeError.getOperation() : undefined;
        const documentId: unknown = operation?._id;

        return documentId !== undefined ? this.formatDocumentId(documentId) : undefined;
    }

    /**
     * Extracts the error message from a WriteError.
     */
    private extractErrorMessage(writeError: WriteError): string {
        return typeof writeError.errmsg === 'string' ? writeError.errmsg : 'Unknown write error';
    }

    /**
     * Formats a document ID as a string.
     */
    private formatDocumentId(documentId: unknown): string {
        try {
            return JSON.stringify(documentId);
        } catch {
            return typeof documentId === 'string' ? documentId : '[complex object]';
        }
    }

    /**
     * Finds an available field name for storing the original _id.
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
}
