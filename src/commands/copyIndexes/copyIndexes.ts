/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { getIndexExclusionReason } from '../../documentdb/ClustersClient';
import {
    CopyPasteBufferService,
    type CopiedIndexScope,
    type CopiedIndexSelection,
} from '../../services/CopyPasteBufferService';
import { type IndexItem } from '../../tree/documentdb/IndexItem';
import { type IndexesItem } from '../../tree/documentdb/IndexesItem';

export async function copyIndex(context: IActionContext, node: IndexItem): Promise<void> {
    if (!node) {
        throw new Error(vscode.l10n.t('No index selected.'));
    }

    const exclusionReason = getIndexExclusionReason(node.indexInfo);
    if (exclusionReason === 'builtInId') {
        throw new Error(vscode.l10n.t('The built-in _id index cannot be copied.'));
    }
    if (exclusionReason === 'notCopyable') {
        throw new Error(
            vscode.l10n.t('The selected {0} index is not supported by Copy/Paste Indexes.', node.indexInfo.type),
        );
    }

    await storeAndNotify(
        context,
        createSelection(node, { kind: 'index', indexName: node.indexInfo.name }),
        vscode.l10n.t(
            'Index "{0}" from collection "{1}" is ready to paste.',
            node.indexInfo.name,
            node.collectionInfo.name,
        ),
    );
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
    const selectedAction = await vscode.window.showInformationMessage(message, cancelCopy);
    const copyCancelled = selectedAction === cancelCopy;
    context.telemetry.properties.copyCancelled = copyCancelled ? 'true' : 'false';
    if (copyCancelled) {
        await CopyPasteBufferService.clearIndexes();
    }
}
