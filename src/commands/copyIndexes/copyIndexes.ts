/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { openUrl, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { getIndexExclusionReason } from '../../documentdb/ClustersClient';
import {
    CopyPasteBufferService,
    type CopiedIndexScope,
    type CopiedIndexSelection,
} from '../../services/CopyPasteBufferService';
import { type TreeElement } from '../../tree/TreeElement';
import { IndexItem } from '../../tree/documentdb/IndexItem';
import { type IndexesItem } from '../../tree/documentdb/IndexesItem';

export async function copyIndex(
    context: IActionContext,
    clickedNode: IndexItem,
    selectedItems?: TreeElement[],
): Promise<void> {
    if (!clickedNode) {
        throw new Error(vscode.l10n.t('No index selected.'));
    }

    const selectedIndexNodes: IndexItem[] = [];
    for (const item of selectedItems?.length ? selectedItems : [clickedNode]) {
        if (item instanceof IndexItem && getIndexExclusionReason(item.indexInfo) === undefined) {
            selectedIndexNodes.push(item);
        }
    }
    const sourceNode = selectedIndexNodes[0];
    if (!sourceNode) {
        const exclusionReason = getIndexExclusionReason(clickedNode.indexInfo);
        if (exclusionReason === 'builtInId') {
            throw new Error(vscode.l10n.t('The built-in _id index cannot be copied.'));
        }
        if (exclusionReason === 'notCopyable') {
            throw new Error(
                vscode.l10n.t(
                    'The selected {0} index is not supported by Copy/Paste Indexes.',
                    clickedNode.indexInfo.type,
                ),
            );
        }
        throw new Error(vscode.l10n.t('No copyable indexes are selected.'));
    }

    const crossCollectionIndex = selectedIndexNodes.find((item) => !hasSameSource(sourceNode, item));
    if (crossCollectionIndex) {
        throw new Error(vscode.l10n.t('Select indexes from only one collection before copying.'));
    }

    const indexNames = [...new Set(selectedIndexNodes.map((item) => item.indexInfo.name))];
    const scope: CopiedIndexScope =
        indexNames.length === 1 ? { kind: 'index', indexName: indexNames[0] } : { kind: 'indexes', indexNames };
    const message =
        indexNames.length === 1
            ? vscode.l10n.t(
                  'Index "{0}" from collection "{1}" is ready to paste.',
                  indexNames[0],
                  sourceNode.collectionInfo.name,
              )
            : vscode.l10n.t(
                  '{0} indexes from collection "{1}" are ready to paste.',
                  indexNames.length.toString(),
                  sourceNode.collectionInfo.name,
              );

    await storeAndNotify(context, createSelection(sourceNode, scope), message);
}

export async function copyIndexes(context: IActionContext, node: IndexesItem): Promise<void> {
    if (!node) {
        throw new Error(vscode.l10n.t('No indexes node selected.'));
    }

    await storeAndNotify(
        context,
        createSelection(node, { kind: 'allIndexes' }),
        vscode.l10n.t(
            'The copyable secondary indexes from collection "{0}" are ready to paste.',
            node.collectionInfo.name,
        ),
    );
}

interface IndexSourceNode {
    readonly cluster: { readonly clusterId: string; readonly name: string };
    readonly databaseInfo: { readonly name: string };
    readonly collectionInfo: { readonly name: string };
}

function hasSameSource(left: IndexSourceNode, right: IndexSourceNode): boolean {
    return (
        left.cluster.clusterId === right.cluster.clusterId &&
        left.databaseInfo.name === right.databaseInfo.name &&
        left.collectionInfo.name === right.collectionInfo.name
    );
}

function createSelection(node: IndexSourceNode, scope: CopiedIndexScope): CopiedIndexSelection {
    return {
        source: {
            clusterId: node.cluster.clusterId,
            databaseName: node.databaseInfo.name,
            collectionName: node.collectionInfo.name,
        },
        sourceConnectionName: node.cluster.name,
        scope,
    };
}

async function storeAndNotify(
    context: IActionContext,
    selection: CopiedIndexSelection,
    message: string,
): Promise<void> {
    context.telemetry.properties.copyScope = selection.scope.kind;
    await CopyPasteBufferService.setIndexes(selection);

    const cancelCopy = vscode.l10n.t('Cancel Copy');
    const learnMore = vscode.l10n.t('Learn More');
    const selectedAction = await vscode.window.showInformationMessage(message, cancelCopy, learnMore);
    const copyCancelled = selectedAction === cancelCopy;
    context.telemetry.properties.copyCancelled = copyCancelled ? 'true' : 'false';
    if (copyCancelled) {
        await CopyPasteBufferService.clearIndexes();
    } else if (selectedAction === learnMore) {
        await openUrl(
            'https://microsoft.github.io/vscode-documentdb/user-manual/copy-and-paste#copy-and-paste-indexes-without-documents',
        );
        context.telemetry.properties.learnMoreClicked = 'true';
    }
}
