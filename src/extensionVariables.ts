/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IAzExtLogOutputChannel, type TreeElementStateManager } from '@microsoft/vscode-azext-utils';
import { type AzureResourcesExtensionApiWithActivity } from '@microsoft/vscode-azext-utils/activity';
import type * as vscode from 'vscode';
import { type DatabasesFileSystem } from './DatabasesFileSystem';
import { type MongoDBLanguageClient } from './documentdb/scrapbook/languageClient';
import { type VCoreBranchDataProvider } from './tree/azure-resources-view/documentdb/VCoreBranchDataProvider';
import { type RUBranchDataProvider } from './tree/azure-resources-view/mongo-ru/RUBranchDataProvider';
import { type ConnectionsBranchDataProvider } from './tree/connections-view/ConnectionsBranchDataProvider';
import { type DiscoveryBranchDataProvider } from './tree/discovery-view/DiscoveryBranchDataProvider';
import { type TreeElement } from './tree/TreeElement';
import { type AccountsItem } from './tree/workspace-view/documentdb/AccountsItem';
import { type ClustersWorkspaceBranchDataProvider } from './tree/workspace-view/documentdb/ClustersWorkbenchBranchDataProvider';

/**
 * Namespace for common variables used throughout the extension. They must be initialized in the activate() method of extension.ts
 */
export namespace ext {
    export let context: vscode.ExtensionContext;
    export let outputChannel: IAzExtLogOutputChannel;
    export let isBundle: boolean | undefined;
    export let secretStorage: vscode.SecretStorage;
    export const prefix: string = 'documentDB';
    export let fileSystem: DatabasesFileSystem;
    export let mongoLanguageClient: MongoDBLanguageClient;

    // Since the Azure Resources extension did not update API interface, but added a new interface with activity
    // we have to use the new interface AzureResourcesExtensionApiWithActivity instead of AzureResourcesExtensionApi
    export let rgApiV2: AzureResourcesExtensionApiWithActivity;

    export let state: TreeElementStateManager;

    // Azure Resources Extension integration
    //  > Azure Resources Extension: "Resources View"
    export let azureResourcesVCoreBranchDataProvider: VCoreBranchDataProvider;
    export let azureResourcesRUBranchDataProvider: RUBranchDataProvider;

    //  > Azure Resources Extension: "Workspace View"
    // used for the workspace: these are the dedicated providers
    export let mongoClustersWorkspaceBranchDataProvider: ClustersWorkspaceBranchDataProvider;
    export let mongoClusterWorkspaceBranchDataResource: AccountsItem;

    /**
     * This is the access point for the connections tree branch data provider.
     * We don't register it with any API as it's the only one provider we need.
     * It's temporarily here, but it's very likely that it will be moved elsewhere
     * once the itnernal API solidifies.
     */
    export let connectionsBranchDataProvider: ConnectionsBranchDataProvider;
    export let connectionsTreeView: vscode.TreeView<TreeElement>;

    export let discoveryBranchDataProvider: DiscoveryBranchDataProvider;

    export namespace settingsKeys {
        export const shellPath = 'documentDB.mongoShell.path';
        export const shellArgs = 'documentDB.mongoShell.args';
        export const shellTimeout = 'documentDB.mongoShell.timeout';
        export const batchSize = 'documentDB.mongoShell.batchSize';
        export const confirmationStyle = 'documentDB.confirmations.confirmationStyle';
        export const showOperationSummaries = 'documentDB.userInterface.ShowOperationSummaries';
        export const showUrlHandlingConfirmations = 'documentDB.confirmations.showUrlHandlingConfirmations';
        export const localPort = 'documentDB.local.port';

        export namespace vsCode {
            export const proxyStrictSSL = 'http.proxyStrictSSL';
        }
    }
}
