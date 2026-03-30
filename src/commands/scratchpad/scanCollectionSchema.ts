/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { type Document, type WithId } from 'mongodb';
import * as vscode from 'vscode';
import { ClustersClient } from '../../documentdb/ClustersClient';
import { SchemaStore } from '../../documentdb/SchemaStore';

/** Maximum number of documents to sample for schema discovery. */
const SCHEMA_SAMPLE_SIZE = 100;

/**
 * Samples documents from a collection and feeds them to SchemaStore
 * for field name discovery. Triggered by the "Scan Schema…" completion
 * item (Phase 3.3) when a collection has no schema data.
 *
 * @param clusterId Stable cluster ID for ClustersClient lookup
 * @param databaseName Database containing the collection
 * @param collectionName Collection to sample
 */
export async function scanCollectionSchema(
    clusterId: string,
    databaseName: string,
    collectionName: string,
): Promise<void> {
    try {
        const client = await ClustersClient.getClient(clusterId);
        const collection = client.getMongoClient().db(databaseName).collection(collectionName);

        // Use $sample for random sampling when possible
        const docs = await collection.aggregate([{ $sample: { size: SCHEMA_SAMPLE_SIZE } }]).toArray();

        if (docs.length === 0) {
            void vscode.window.showInformationMessage(
                l10n.t('Collection "{0}" is empty — no fields to discover.', collectionName),
            );
            return;
        }

        // Filter to documents with _id (required by SchemaStore.addDocuments)
        const validDocs = docs.filter((d): d is WithId<Document> => d !== null && typeof d === 'object' && '_id' in d);

        if (validDocs.length === 0) {
            return;
        }

        SchemaStore.getInstance().addDocuments(clusterId, databaseName, collectionName, validDocs);

        const fieldCount = SchemaStore.getInstance().getKnownFields(clusterId, databaseName, collectionName).length;

        void vscode.window.showInformationMessage(
            l10n.t('Schema scan complete — {0} fields discovered in "{1}".', String(fieldCount), collectionName),
        );
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        void vscode.window.showErrorMessage(
            l10n.t('Failed to scan schema for "{0}": {1}', collectionName, errorMessage),
        );
    }
}
