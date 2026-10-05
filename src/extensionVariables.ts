/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IAzExtLogOutputChannel, type TreeElementStateManager } from '@microsoft/vscode-azext-utils';
import { type AzureResourcesExtensionApiWithActivity } from '@microsoft/vscode-azext-utils/activity';
import type * as vscode from 'vscode';
import { type DatabasesFileSystem } from './DatabasesFileSystem';
import { type PlaygroundResultProvider } from './documentdb/playground/PlaygroundResultProvider';
import { type VCoreBranchDataProvider } from './tree/azure-resources-view/documentdb/VCoreBranchDataProvider';
import { type RUBranchDataProvider } from './tree/azure-resources-view/mongo-ru/RUBranchDataProvider';
import { type ClustersWorkspaceBranchDataProvider } from './tree/azure-workspace-view/ClustersWorkbenchBranchDataProvider';
import { type DocumentDbWorkspaceResourceProvider } from './tree/azure-workspace-view/DocumentDbWorkspaceResourceProvider';
import { type ConnectionsBranchDataProvider } from './tree/connections-view/ConnectionsBranchDataProvider';
import { type DiscoveryBranchDataProvider } from './tree/discovery-view/DiscoveryBranchDataProvider';
import { type CollectionItem } from './tree/documentdb/CollectionItem';
import { type HelpAndFeedbackBranchDataProvider } from './tree/help-and-feedback-view/HelpAndFeedbackBranchDataProvider';
import { type TreeElement } from './tree/TreeElement';

/**
 * Common variables used throughout the extension. They must be initialized in the activate() method of extension.ts
 *
 * A plain object rather than a TypeScript `namespace`: Oxc (used by Vite and Vitest) does not rewrite bare-name
 * references inside a namespace, so a namespace member read or written from inside the namespace would be
 * decoupled from `ext.<member>` (S2-F04).
 */
export interface ExtensionVariables {
    context: vscode.ExtensionContext;
    outputChannel: IAzExtLogOutputChannel;
    playgroundOutputChannel: vscode.OutputChannel;
    playgroundResultProvider: PlaygroundResultProvider;
    isBundle: boolean | undefined;
    secretStorage: vscode.SecretStorage;
    readonly prefix: string;
    fileSystem: DatabasesFileSystem;

    // TODO: TN improve this: This is a temporary solution to get going.
    copiedCollectionNode: CollectionItem | undefined;

    // Since the Azure Resources extension did not update API interface, but added a new interface with activity
    // we have to use the new interface AzureResourcesExtensionApiWithActivity instead of AzureResourcesExtensionApi
    rgApiV2: AzureResourcesExtensionApiWithActivity;

    state: TreeElementStateManager;

    // Azure Resources Extension integration
    //  > Azure Resources Extension: "Resources View"
    azureResourcesVCoreBranchDataProvider: VCoreBranchDataProvider;
    azureResourcesRUBranchDataProvider: RUBranchDataProvider;

    //  > Azure Resources Extension: "Workspace View"
    azureResourcesWorkspaceResourceProvider: DocumentDbWorkspaceResourceProvider;
    azureResourcesWorkspaceBranchDataProvider: ClustersWorkspaceBranchDataProvider;

    /**
     * This is the access point for the connections tree branch data provider.
     * We don't register it with any API as it's the only one provider we need.
     * It's temporarily here, but it's very likely that it will be moved elsewhere
     * once the itnernal API solidifies.
     */
    connectionsBranchDataProvider: ConnectionsBranchDataProvider;
    connectionsTreeView: vscode.TreeView<TreeElement>;

    discoveryBranchDataProvider: DiscoveryBranchDataProvider;
    discoveryTreeView: vscode.TreeView<TreeElement>;

    helpAndFeedbackBranchDataProvider: HelpAndFeedbackBranchDataProvider;
}

// Members other than `prefix` are assigned during activation, as they were in the former namespace.
export const ext = { prefix: 'documentDB' } as ExtensionVariables;
