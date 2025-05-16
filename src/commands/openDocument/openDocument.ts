/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { DocumentsViewController } from '../../webviews/documentdb/documentView/documentsViewController';

export function openDocumentView(
    _context: IActionContext,
    props: {
        id: string;

        clusterId: string;
        databaseName: string;
        collectionName: string;
        documentId: string;

        mode: string;
    },
): void {
    const view = new DocumentsViewController({
        id: props.id,

        clusterId: props.clusterId,
        databaseName: props.databaseName,
        collectionName: props.collectionName,
        documentId: props.documentId,

        mode: props.mode,
    });

    view.revealToForeground(vscode.ViewColumn.Active);
}
