/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { parseError, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { EJSON, type Document } from 'bson';
import * as fse from 'fs-extra';
import * as vscode from 'vscode';
import { ClustersClient } from '../../documentdb/ClustersClient';
import { ext } from '../../extensionVariables';
import { CollectionItem } from '../../tree/documentdb/CollectionItem';
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
        ext.outputChannel.appendLog(
            l10n.t('Ignoring the following files that do not match the "*.json" file name pattern:'),
        );
        ignoredUris.forEach((uri) => ext.outputChannel.appendLog(`${uri.fsPath}`));
        ext.outputChannel.show();
    }

    if (!selectedItem) {
        return undefined;
    }

    context.telemetry.properties.experience = selectedItem.experience.api;

    await ext.state.runWithTemporaryDescription(selectedItem.id, l10n.t('Importing…'), async () => {
        await importDocumentsWithProgress(selectedItem, uris);
    });

    ext.state.notifyChildrenChanged(selectedItem.id);
}

export async function importDocumentsWithProgress(selectedItem: CollectionItem, uris: vscode.Uri[]): Promise<void> {
    const result = await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: l10n.t('Importing documents…'),
        },
        async (progress) => {
            progress.report({ increment: 0, message: l10n.t('Loading documents…') });

            const countUri = uris.length;
            const incrementUri = 50 / (countUri || 1);
            const documents: unknown[] = [];
            let hasErrors = false;

            for (let i = 0, percent = 0; i < countUri; i++, percent += incrementUri) {
                progress.report({
                    increment: Math.floor(percent),
                    message: l10n.t('Loading document {num} of {countUri}', { num: i + 1, countUri }),
                });

                const result = await parseAndValidateFile(selectedItem, uris[i]);

                if (result.errors && result.errors.length) {
                    ext.outputChannel.appendLog(
                        l10n.t('Errors found in document {path}. Please fix these.', { path: uris[i].path }),
                    );
                    ext.outputChannel.appendLog(result.errors.join('\n'));
                    ext.outputChannel.show();
                    hasErrors = true;
                }

                if (result.documents && result.documents.length) {
                    documents.push(...result.documents);
                }
            }

            const countDocuments = documents.length;
            const incrementDocuments = 50 / (countDocuments || 1);
            let count = 0;

            for (let i = 0, percent = 0; i < countDocuments; i++, percent += incrementDocuments) {
                progress.report({
                    increment: Math.floor(percent),
                    message: l10n.t('Importing document {num} of {countDocuments}', {
                        num: i + 1,
                        countDocuments,
                    }),
                });

                const result = await insertDocument(selectedItem, documents[i]);

                if (result.error) {
                    ext.outputChannel.appendLog(
                        l10n.t('The insertion of document {number} failed with error: {error}', {
                            number: i + 1,
                            error: result.error,
                        }),
                    );
                    ext.outputChannel.show();
                    hasErrors = true;
                } else {
                    count++;
                }
            }

            progress.report({ increment: 50, message: l10n.t('Finished importing') });

            return hasErrors
                ? l10n.t('Import has accomplished with errors.')
                : l10n.t('Import successful.') +
                      ' ' +
                      l10n.t('Inserted {0} document(s). See output for more details.', count);
        },
    );

    // We should not use await here, otherwise the node status will not be updated until the message is closed
    vscode.window.showInformationMessage(result);
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
 * EJSON supports more datatypes and is specific to MongoDB. This is currently used for MongoDB clusters/vcore.
 * @returns A promise that resolves to an array of parsed documents as unknown objects.
 */
async function parseAndValidateFileForMongo(uri: vscode.Uri): Promise<{ documents: unknown[]; errors: string[] }> {
    const fileContent = await fse.readFile(uri.fsPath, 'utf8');
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

async function insertDocument(node: CollectionItem, document: unknown): Promise<{ document: unknown; error: string }> {
    try {
        if (node instanceof CollectionItem) {
            // await needs to catch the error here, otherwise it will be thrown to the caller
            return await insertDocumentIntoCluster(node, document as Document);
        }
    } catch (e) {
        return { document, error: parseError(e).message };
    }

    return { document, error: l10n.t('Unknown error') };
}

async function insertDocumentIntoCluster(
    node: CollectionItem,
    document: Document,
): Promise<{ document: Document; error: string }> {
    const client = await ClustersClient.getClient(node.cluster.id);
    const response = await client.insertDocuments(node.databaseInfo.name, node.collectionInfo.name, [document]);

    if (response?.acknowledged) {
        return { document, error: '' };
    } else {
        return {
            document,
            error: l10n.t('The insertion failed. The operation was not acknowledged by the database.'),
        };
    }
}
