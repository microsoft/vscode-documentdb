/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IAzExtLogOutputChannel, type TreeElementStateManager } from '@microsoft/vscode-azext-utils';
import { type AzureResourcesExtensionApiWithActivity } from '@microsoft/vscode-azext-utils/activity';
import { type AzureHostExtensionApi } from '@microsoft/vscode-azext-utils/hostapi';
import type * as vscode from 'vscode';
import { type DatabasesFileSystem } from './DatabasesFileSystem';
import { type MongoDBLanguageClient } from './documentdb/scrapbook/languageClient';
import { type MongoVCoreBranchDataProvider } from './tree/azure-resources-view/documentdb/mongo-vcore/MongoVCoreBranchDataProvider';
import { type ConnectionsBranchDataProvider } from './tree/connections-view/ConnectionsBranchDataProvider';
import { type DiscoveryBranchDataProvider } from './tree/discovery-view/DiscoveryBranchDataProvider';
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
    export const prefix: string = 'azureDatabases';
    export let fileSystem: DatabasesFileSystem;
    export let mongoLanguageClient: MongoDBLanguageClient;
    export let rgApi: AzureHostExtensionApi;

    // Since the Azure Resources extension did not update API interface, but added a new interface with activity
    // we have to use the new interface AzureResourcesExtensionApiWithActivity instead of AzureResourcesExtensionApi
    export let rgApiV2: AzureResourcesExtensionApiWithActivity;

    export let state: TreeElementStateManager;

    // TODO: To avoid these stupid variables below the rgApiV2 should have the following public fields (but they are private):
    // - AzureResourceProviderManager,
    // - AzureResourceBranchDataProviderManager,
    // - WorkspaceResourceProviderManager,
    // - WorkspaceResourceBranchDataProviderManager,

    // used for the resources tree
    export let mongoVCoreBranchDataProvider: MongoVCoreBranchDataProvider;
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

    export let discoveryBranchDataProvider: DiscoveryBranchDataProvider;

    export namespace settingsKeys {
        export const mongoShellPath = 'mongo.shell.path';
        export const mongoShellArgs = 'mongo.shell.args';
        export const documentLabelFields = 'documentDB.documentLabelFields';
        export const enableEndpointDiscovery = 'documentDB.enableEndpointDiscovery';
        export const mongoShellTimeout = 'mongo.shell.timeout';
        export const batchSize = 'documentDB.batchSize';
        export const confirmationStyle = 'documentDB.confirmationStyle';
        export const showOperationSummaries = 'documentDB.showOperationSummaries';
        export const cosmosDbAuthentication = 'documentDB.preferredAuthenticationMethod';
        export const authManagedIdentityClientId = 'documentDB.authentication.managedIdentity.clientID';

        export namespace vsCode {
            export const proxyStrictSSL = 'http.proxyStrictSSL';
        }
    }
}
