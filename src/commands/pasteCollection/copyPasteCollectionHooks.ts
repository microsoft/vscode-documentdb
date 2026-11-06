/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ClustersClient } from '../../documentdb/ClustersClient';
import { CredentialCache } from '../../documentdb/CredentialCache';
import { ext } from '../../extensionVariables';
import { type TaskTelemetryContext } from '../../services/taskService/taskHost';
import { SourceValidationError } from '../../services/taskService/tasks/copy-and-paste/CopyPasteCollectionTask';
import { type CopyPasteConfig } from '../../services/taskService/tasks/copy-and-paste/copyPasteConfig';

export function createValidateSource(
    config: CopyPasteConfig,
): (signal: AbortSignal, context?: TaskTelemetryContext) => Promise<void> {
    return async (_signal, context): Promise<void> => {
        // Validate source cluster credentials (stale reference protection)
        if (!CredentialCache.hasCredentials(config.source.clusterId)) {
            // Clear the stale clipboard reference
            ext.copiedCollectionNode = undefined;
            void vscode.commands.executeCommand('setContext', 'documentdb.copiedCollectionNode', false);

            if (context) {
                context.telemetry.properties.sourceClusterDisconnected = 'true';
            }

            throw new SourceValidationError(
                vscode.l10n.t(
                    'The source cluster is no longer connected. Please reconnect and copy the collection again.',
                ),
            );
        }

        // Validate source collection still exists
        const sourceClient = await ClustersClient.getClient(config.source.clusterId);
        const collections = await sourceClient.listCollections(config.source.databaseName);
        const collectionExists = collections.some((c) => c.name === config.source.collectionName);

        if (!collectionExists) {
            // Clear the stale clipboard reference
            ext.copiedCollectionNode = undefined;
            void vscode.commands.executeCommand('setContext', 'documentdb.copiedCollectionNode', false);

            if (context) {
                context.telemetry.properties.sourceCollectionNotFound = 'true';
            }

            throw new SourceValidationError(
                vscode.l10n.t(
                    'The source collection "{0}" no longer exists in database "{1}". It may have been deleted or renamed.',
                    config.source.collectionName,
                    config.source.databaseName,
                ),
            );
        }
    };
}

export function createCollectMetadata(config: CopyPasteConfig): (context: TaskTelemetryContext) => Promise<void> {
    return async (context): Promise<void> => {
        const metadataPromises = [collectClusterMetadata(config.source.clusterId, 'source', context)];
        if (config.source.clusterId !== config.target.clusterId) {
            metadataPromises.push(collectClusterMetadata(config.target.clusterId, 'target', context));
        }
        await Promise.allSettled(metadataPromises);
    };
}

/**
 * Collects cluster metadata for telemetry purposes.
 * This method attempts to gather cluster information without failing the task if metadata collection fails.
 *
 * @param clusterId Cluster ID to collect metadata for
 * @param prefix Prefix for telemetry properties (e.g., 'source' or 'target')
 * @param context Telemetry context to add properties to
 */
async function collectClusterMetadata(clusterId: string, prefix: string, context: TaskTelemetryContext): Promise<void> {
    try {
        const client = await ClustersClient.getClient(clusterId);
        const metadata = await client.getClusterMetadata();

        // Add metadata with prefix to avoid conflicts between source and target
        for (const [key, value] of Object.entries(metadata)) {
            if (value !== undefined && value !== null) {
                context.telemetry.properties[`${prefix}_${key}`] = String(value);
            }
        }

        context.telemetry.properties[`${prefix}_metadataCollectionSuccess`] = 'true';
    } catch (error) {
        // Log the error but don't fail the task
        context.telemetry.properties[`${prefix}_metadata_error`] =
            error instanceof Error ? error.message : 'Unknown error';
        context.telemetry.properties[`${prefix}_metadataCollectionSuccess`] = 'false';
    }
}
