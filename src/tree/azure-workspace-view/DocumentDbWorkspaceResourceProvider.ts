/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type WorkspaceResource, type WorkspaceResourceProvider } from '@microsoft/vscode-azureresources-api';
import { l10n, type ProviderResult } from 'vscode';

/**
 * This class serves as the entry point for the workspace resources view.
 * It implements the `WorkspaceResourceProvider` interface to provide resources
 * that will be displayed in the workspace.
 *
 * In this implementation, we register the resource type we want to support,
 * which in this case is `DocumentDB and MongoDB Accounts` Entry.
 */
export class DocumentDbWorkspaceResourceProvider implements WorkspaceResourceProvider {
    getResources(): ProviderResult<WorkspaceResource[]> {
        return [
            {
                resourceType: 'vscode.documentdb.workspace.documentdb-accounts-resourceType',
                id: 'vscode.documentdb.workspace.accounts',
                name: l10n.t('DocumentDB and MongoDB Accounts'), // this name will be displayed in the workspace view, when no WorkspaceResourceBranchDataProvider is registered
            },
        ];
    }
}
