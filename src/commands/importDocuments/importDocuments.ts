/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { parseError, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { EJSON, type Document } from 'bson';
import * as fs from 'node:fs/promises';
import * as vscode from 'vscode';
import { ClustersClient, isBulkWriteError } from '../../documentdb/ClustersClient';
import {
    AzureDomains,
    getHostsFromConnectionString,
    hasDomainSuffix,
} from '../../documentdb/utils/connectionStringHelpers';
import { ext } from '../../extensionVariables';
import { CollectionItem } from '../../tree/documentdb/CollectionItem';
import { BufferErrorCode, createMongoDbBuffer, type DocumentBuffer } from '../../utils/documentBuffer';
import { getRootPath } from '../../utils/workspacUtils';

export async function importDocuments(
    context: IActionContext,
    selectedItem: vscode.Uri | CollectionItem | undefined,
    uris: vscode.Uri[] | undefined,
): Promise<void> {
    if (selectedItem instanceof vscode.Uri) {
        uris ||= [selectedItem];
        selectedItem = undefined;
    } else {
        uris ||= [];
    }

    if (!uris || uris.length === 0) {
        uris = await askForDocuments(context);
    }

    const ignoredUris: vscode.Uri[] = []; //account for https://github.com/Microsoft/vscode/issues/59782
    uris = uris.filter((uri) => {
        if (uri.fsPath.toLocaleLowerCase().endsWith('.json')) {
            return true;
        } else {
            ignoredUris.push(uri);
            return false;
        }
    });

    if (ignoredUris.length) {
        ext.outputChannel.warn(
            l10n.t('Ignoring the following files that do not match the "*.json" file name pattern:'),
        );
        ignoredUris.forEach((uri) => ext.outputChannel.warn(`  ${uri.fsPath}`));

        void vscode.window
            .showWarningMessage(
                l10n.t('{0} file(s) were ignored because they do not match the "*.json" pattern.', ignoredUris.length),
                l10n.t('Show Output'),
            )
            .then((choice) => {
                if (choice === l10n.t('Show Output')) {
                    ext.outputChannel.show();
                }
            });
    }

    if (!selectedItem) {
        return undefined;
    }

    if (!(selectedItem instanceof CollectionItem)) {
        throw new Error('Selected item must be a CollectionItem');
    }

    context.telemetry.properties.experience = selectedItem.experience.api;

    try {
        await ext.state.runWithTemporaryDescription(selectedItem.id, l10n.t('Importing…'), async () => {
            await importDocumentsWithProgress(selectedItem, uris);
        });
    } finally {
        // Always refresh at the database level (parent of the collection) so collection
        // descriptions (document counts) update correctly, even after partial failures
        const databaseId = selectedItem.id.substring(0, selectedItem.id.lastIndexOf('/'));
        ext.state.notifyChildrenChanged(databaseId);
    }
}

export async function importDocumentsWithProgress(selectedItem: CollectionItem, uris: vscode.Uri[]): Promise<void> {
    const result = await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: l10n.t('Importing documents…'),
            cancellable: true,
        },
        async (progress, cancellationToken) => {
            progress.report({ increment: 0, message: l10n.t('Loading documents…') });

            ext.outputChannel.info(
                l10n.t(
                    'Starting import of {0} file(s) into collection "{1}"',
                    uris.length,
                    selectedItem.collectionInfo.name,
                ),
            );

            const countUri = uris.length;
            const incrementUri = 25 / (countUri || 1);
            const documents: unknown[] = [];
            let hasErrors = false;

            for (let i = 0; i < countUri; i++) {
                const increment = (i + 1) * incrementUri;
                progress.report({
                    increment: Math.floor(increment),
                    message: l10n.t('Loading document {num} of {countUri}', { num: i + 1, countUri }),
                });

                ext.outputChannel.trace(l10n.t('Parsing file {0}: {1}', i + 1, uris[i].fsPath));

                const result = await parseAndValidateFile(selectedItem, uris[i]);

                // Note to future maintainers: the validation can return 0 valid documents and still have errors.

                if (result.errors && result.errors.length) {
                    ext.outputChannel.error(
                        l10n.t('Errors found in file "{path}". Please fix these:', { path: uris[i].path }),
                    );
                    for (const err of result.errors) {
                        ext.outputChannel.error(`  ${err}`);
                    }
                    hasErrors = true;
                }

                if (result.documents && result.documents.length > 0) {
                    ext.outputChannel.trace(
                        l10n.t('Loaded {0} document(s) from "{1}"', result.documents.length, uris[i].path),
                    );
                    documents.push(...result.documents);
                }
            }

            ext.outputChannel.info(l10n.t('Total documents to import: {0}', documents.length));

            const countDocuments = documents.length;
            const incrementDocuments = 75 / (countDocuments || 1);
            let count = 0;
            let buffer: DocumentBuffer<unknown> | undefined;
            if (selectedItem instanceof CollectionItem) {
                // Get the connection string from the ClustersClient, not from the cluster model.
                // For Discovery View items, the cluster model may not have connectionString populated,
                // but the ClustersClient will have it after authentication.
                const client = await ClustersClient.getClient(selectedItem.cluster.clusterId);
                const connectionString = client.getConnectionString();

                // Determine if this is an Azure MongoDB RU resource
                // Fall back to non-RU buffer if connection string is unavailable
                let isRuResource = false;
                if (connectionString) {
                    const hosts = getHostsFromConnectionString(connectionString);
                    isRuResource = hasDomainSuffix(AzureDomains.RU, ...hosts);
                }

                if (isRuResource) {
                    // For Azure MongoDB RU, we use a buffer with maxDocumentCount = 1
                    buffer = createMongoDbBuffer<unknown>({
                        maxDocumentCount: 1,
                    });
                } else {
                    buffer = createMongoDbBuffer<unknown>();
                }
            }

            let wasCancelled = false;

            for (let i = 0; i < countDocuments; i++) {
                if (cancellationToken.isCancellationRequested) {
                    wasCancelled = true;
                    ext.outputChannel.warn(l10n.t('Import operation was canceled after {0} document(s).', count));
                    break;
                }

                progress.report({
                    increment: incrementDocuments,
                    message: l10n.t('Importing document {num} of {countDocuments}', {
                        num: i + 1,
                        countDocuments,
                    }),
                });

                const result = await insertDocument(selectedItem, documents[i], buffer);

                // 'count' in result means that the result is from the buffer
                count += result.count;
                // check if error occurred as partial failure would happen in bulk insertion
                hasErrors = hasErrors || result.errorOccurred;
            }

            // Do insertion for the last batch for bulk insertion
            if (!wasCancelled && buffer && buffer.getStats().documentCount > 0) {
                const lastBatchFlushResult = await insertDocument(selectedItem, undefined, buffer);

                count += lastBatchFlushResult.count;
                hasErrors = hasErrors || lastBatchFlushResult.errorOccurred;
            }

            // let's make sure we reach 100% progress, useful in case of errors etc.
            progress.report({ increment: 100, message: l10n.t('Finished importing') });

            return { hasErrors, count, wasCancelled };
        },
    );

    if (result.wasCancelled) {
        const message = l10n.t('Import canceled. Inserted {0} document(s) before cancellation.', result.count);
        ext.outputChannel.warn(message);
        void vscode.window.showWarningMessage(message, l10n.t('Show Output')).then((choice) => {
            if (choice === l10n.t('Show Output')) {
                ext.outputChannel.show();
            }
        });
        return;
    }

    const message =
        (result.hasErrors ? l10n.t('Import completed with errors.') : l10n.t('Import successful.')) +
        ' ' +
        l10n.t('Inserted {0} document(s).', result.count);

    if (result.hasErrors) {
        ext.outputChannel.warn(message);

        void vscode.window
            .showWarningMessage(message + ' ' + l10n.t('See output for more details.'), l10n.t('Show Output'))
            .then((choice) => {
                if (choice === l10n.t('Show Output')) {
                    ext.outputChannel.show();
                }
            });
    } else {
        ext.outputChannel.info(message);
        // We should not use await here, otherwise the node status will not be updated until the message is closed
        void vscode.window.showInformationMessage(message);
    }
}

async function askForDocuments(context: IActionContext): Promise<vscode.Uri[]> {
    const openDialogOptions: vscode.OpenDialogOptions = {
        canSelectMany: true,
        openLabel: l10n.t('Import'),
        filters: {
            JSON: ['json'],
        },
    };
    const rootPath: string | undefined = getRootPath();
    if (rootPath) {
        openDialogOptions.defaultUri = vscode.Uri.file(rootPath);
    }
    return await context.ui.showOpenDialog(openDialogOptions);
}

async function parseAndValidateFile(
    node: CollectionItem,
    uri: vscode.Uri,
): Promise<{ documents: unknown[]; errors: string[] }> {
    try {
        if (node instanceof CollectionItem) {
            // await needs to catch the error here, otherwise it will be thrown to the caller
            return await parseAndValidateFileForMongo(uri);
        }
    } catch (e) {
        return { documents: [], errors: [parseError(e).message] };
    }

    return { documents: [], errors: [l10n.t('Unknown error')] };
}

/**
 * @param uri - An array of `vscode.Uri` objects representing the file paths to the JSON documents.
 * EJSON is used to read documents that are supposed to be converted into BSON.
 * EJSON supports more datatypes and is specific to MongoDB. This is currently used for MongoDB clusters/DocumentDB.
 * @returns A promise that resolves to an array of parsed documents as unknown objects.
 */
async function parseAndValidateFileForMongo(uri: vscode.Uri): Promise<{ documents: unknown[]; errors: string[] }> {
    const fileContent = await fs.readFile(uri.fsPath, 'utf8');
    const parsed = EJSON.parse(fileContent) as unknown;
    const errors: string[] = [];
    const documents: unknown[] = [];

    if (!parsed || typeof parsed !== 'object') {
        errors.push(l10n.t('Document must be an object.'));
    } else if (Array.isArray(parsed)) {
        documents.push(
            ...parsed
                .map((document: unknown) => {
                    // Only top-level array is supported
                    if (!document || typeof document !== 'object' || Array.isArray(document)) {
                        errors.push(l10n.t('Document must be an object. Skipping…') + '\n' + EJSON.stringify(document));
                        return undefined;
                    }

                    return document;
                })
                .filter((e) => e),
        );
    } else if (typeof parsed === 'object') {
        documents.push(parsed);
    }

    return { documents, errors };
}

async function insertDocument(
    node: CollectionItem,
    document: unknown,
    buffer: DocumentBuffer<unknown> | undefined,
): Promise<{ count: number; errorOccurred: boolean }> {
    try {
        // Check for valid buffer
        if (!buffer) {
            ext.outputChannel.error(l10n.t('Import failed: document buffer is not initialized.'));
            return { count: 0, errorOccurred: true };
        }

        // Route to appropriate handler based on node type
        if (node instanceof CollectionItem) {
            return await insertDocumentWithBufferIntoCluster(node, buffer, document as Document);
        }

        // Should only reach here if node is neither CollectionItem nor CosmosDBContainerResourceItem
        ext.outputChannel.error(l10n.t('Import failed: unsupported node type.'));
        return { count: 0, errorOccurred: true };
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        ext.outputChannel.error(l10n.t('Import failed with unexpected error: {0}', errorMessage));
        return { count: 0, errorOccurred: true };
    }
}

async function insertDocumentWithBufferIntoCluster(
    node: CollectionItem,
    buffer: DocumentBuffer<unknown>,
    document?: Document,
    // If document is undefined, it means that we are flushing the buffer
    // It is used for the last batch, and not recommended to be used for normal batches
): Promise<{ count: number; errorOccurred: boolean }> {
    const databaseName = node.databaseInfo.name;
    const collectionName = node.collectionInfo.name;
    // Try to add document to buffer
    const insertOrFlushToBufferResult = buffer.insertOrFlush(document);
    // If successful, no immediate action needed
    if (insertOrFlushToBufferResult.success) {
        return { count: 0, errorOccurred: false };
    }

    let documentsToProcess = insertOrFlushToBufferResult.documentsToProcess;
    if (insertOrFlushToBufferResult.errorCode === BufferErrorCode.BufferFull) {
        // The buffer has been flushed by the insertOrFlush method.
        // Reinserting the current document into the buffer ensures it is processed after the flush.
        // This is safe because the document has already been validated (e.g., it is not too large and not undefined).
        buffer.insert(document);
    } else if (insertOrFlushToBufferResult.errorCode === BufferErrorCode.EmptyDocument) {
        documentsToProcess = buffer.flush();
    }

    // Documents to process could be the current document (if too large)
    // or the contents of the buffer (if it was full)
    const client = await ClustersClient.getClient(node.cluster.clusterId);
    try {
        const insertResult = await client.insertDocuments(
            databaseName,
            collectionName,
            documentsToProcess as Document[],
            false,
        );
        return {
            count: insertResult.insertedCount,
            errorOccurred: false,
        };
    } catch (error) {
        if (isBulkWriteError(error)) {
            // Handle MongoDB bulk write errors
            // It could be a partial failure, so we need to check the result
            ext.outputChannel.warn(
                l10n.t(
                    'Bulk write error during import into "{0}.{1}": {2} document(s) inserted.',
                    databaseName,
                    collectionName,
                    error.result.insertedCount,
                ),
            );
            if (error.writeErrors) {
                const errors = Array.isArray(error.writeErrors) ? error.writeErrors : [error.writeErrors];
                for (const writeError of errors) {
                    ext.outputChannel.error(l10n.t('  Write error: {0}', String(writeError)));
                }
            }
            return {
                count: error.result.insertedCount,
                errorOccurred: true,
            };
        } else {
            // Handle other errors
            const errorMessage = error instanceof Error ? error.message : String(error);
            ext.outputChannel.error(
                l10n.t('Error inserting documents into "{0}.{1}": {2}', databaseName, collectionName, errorMessage),
            );
            return {
                count: 0,
                errorOccurred: true,
            };
        }
    }
}
