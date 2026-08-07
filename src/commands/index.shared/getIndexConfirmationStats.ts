/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ClustersClient } from '../../documentdb/ClustersClient';
import { type IndexItem } from '../../tree/documentdb/IndexItem';

/**
 * Fetch the size + usage of a single index for a confirmation dialog, so the
 * tree-view delete / hide / unhide prompts match the level of detail shown in
 * the Index Management webview.
 *
 * Both statistics come from optional server commands (`collStats` for the index
 * size, `$indexStats` for the usage counter) that some cluster tiers do not
 * support. Any failure — or a missing entry — yields `undefined`, which
 * `confirmIndexAction` renders as "Not available".
 */
export async function getIndexConfirmationStats(node: IndexItem): Promise<{ sizeBytes?: number; usageOps?: number }> {
    const client = await ClustersClient.getClient(node.cluster.clusterId);
    const dbName = node.databaseInfo.name;
    const collName = node.collectionInfo.name;
    const indexName = node.indexInfo.name;

    let sizeBytes: number | undefined;
    try {
        const stats = await client.getCollectionStats(dbName, collName);
        const bytes = stats.indexSizes?.[indexName];
        if (typeof bytes === 'number') {
            sizeBytes = bytes;
        }
    } catch {
        // Ignore — size stays unknown.
    }

    let usageOps: number | undefined;
    try {
        const indexStats = await client.getIndexStats(dbName, collName);
        const stat = indexStats.find((s) => s.name === indexName);
        if (stat && stat.accesses !== 'N/A') {
            usageOps = stat.accesses.ops;
        }
    } catch {
        // Ignore — usage stays unknown.
    }

    return { sizeBytes, usageOps };
}
