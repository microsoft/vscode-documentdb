/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { Views } from '../../documentdb/Views';
import { DocumentsViewController } from '../../webviews/documentdb/documentView/documentsViewController';

export function openDocumentView(
    _context: IActionContext,
    props: {
        id: string;

        clusterId: string;
        /**
         * Identifies which tree view owns this cluster (e.g., ConnectionsView, DiscoveryView, AzureResourcesView).
         * Required because the same cluster/Azure Resource ID can appear in multiple views, and we need to
         * know which branch data provider to query when looking up tree nodes.
         */
        viewId: string;
        databaseName: string;
        collectionName: string;
        documentId: string;

        mode: string;
    },
): void {
    const view = new DocumentsViewController({
        id: props.id,

        clusterId: props.clusterId,
        viewId: props.viewId ?? Views.ConnectionsView, // fallback for backward compatibility
        databaseName: props.databaseName,
        collectionName: props.collectionName,
        documentId: props.documentId,

        mode: props.mode,
    });

    view.revealToForeground(vscode.ViewColumn.Active);
}
