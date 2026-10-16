/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';

import { inferViewIdFromTreeId } from '../../documentdb/Views';
import { type IndexesItem } from '../../tree/documentdb/IndexesItem';
import { type IndexItem } from '../../tree/documentdb/IndexItem';
import { trackJourneyCorrelationId } from '../../utils/commandTelemetry';
import { openCollectionViewInternal } from '../openCollectionView/openCollectionView';

export async function openIndexManagementView(context: IActionContext, node: IndexesItem | IndexItem): Promise<void> {
    trackJourneyCorrelationId(context, node);

    if (!node) {
        throw new Error(l10n.t('No node selected.'));
    }

    context.telemetry.properties.experience = node.experience.api;

    // Extract viewId from the cluster model, or infer from treeId prefix
    const viewId = node.cluster.viewId ?? inferViewIdFromTreeId(node.cluster.treeId);

    return openCollectionViewInternal(context, {
        clusterId: node.cluster.clusterId,
        clusterDisplayName: node.cluster.name,
        viewId: viewId,
        databaseName: node.databaseInfo.name,
        collectionName: node.collectionInfo.name,
        initialTab: 'tab_indexes',
    });
}
