/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ClustersClient } from '../../documentdb/ClustersClient';
import { type IndexItem } from '../../tree/documentdb/IndexItem';
import { formatBytes, formatOps } from '../../webviews/documentdb/indexView/utils/format';

/**
 * Fetch and format the size + usage of a single index for a confirmation
 * dialog, so the tree-view delete / hide / unhide prompts match the level of
 * detail shown in the Index Management webview.
 *
 * Both statistics come from optional server commands (`collStats` for the index
 * size, `$indexStats` for the usage counter) that some cluster tiers do not
 * support. Any failure — or a missing entry — yields `undefined`, and the
 * confirmation dialog falls back to a dash for that field.
 */
export async function getIndexConfirmationStats(node: IndexItem): Promise<{ sizeText?: string; usageText?: string }> {
    const client = await ClustersClient.getClient(node.cluster.clusterId);
    const dbName = node.databaseInfo.name;
    const collName = node.collectionInfo.name;
    const indexName = node.indexInfo.name;

    let sizeText: string | undefined;
    try {
        const stats = await client.getCollectionStats(dbName, collName);
        const bytes = stats.indexSizes?.[indexName];
        if (typeof bytes === 'number') {
            sizeText = formatBytes(bytes);
        }
    } catch {
        // Ignore — size stays unknown and the dialog shows a dash.
    }

    let usageText: string | undefined;
    try {
        const indexStats = await client.getIndexStats(dbName, collName);
        const stat = indexStats.find((s) => s.name === indexName);
        if (stat && stat.accesses !== 'N/A') {
            usageText = formatOps(stat.accesses.ops);
        }
    } catch {
        // Ignore — usage stays unknown and the dialog shows a dash.
    }

    return { sizeText, usageText };
}
