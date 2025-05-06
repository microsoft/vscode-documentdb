/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * entry-point for mongoClusters-related code. Activated from ./src/extension.ts
 *
 * We'll try to have everything related to mongoClusters-support managed from here.
 * In case of a failure with this plan, this comment section will be updated.
 */
import {
    callWithTelemetryAndErrorHandling,
    type IActionContext,
    registerCommand,
    registerCommandWithTreeNodeUnwrapping,
} from '@microsoft/vscode-azext-utils';
import { AzExtResourceType } from '@microsoft/vscode-azureresources-api';
import * as vscode from 'vscode';
import { addConnectionFromRegistry } from '../commands/addConnectionFromRegistry/addConnectionFromRegistry';
import { addDiscoveryRegistry } from '../commands/addDiscoveryRegistry/addDiscoveryRegistry';
import { copyAzureConnectionString } from '../commands/copyConnectionString/copyConnectionString';
import { createMongoCollection } from '../commands/createContainer/createContainer';
import { createAzureDatabase } from '../commands/createDatabase/createDatabase';
import { createMongoDocument } from '../commands/createDocument/createDocument';
import { deleteAzureContainer } from '../commands/deleteContainer/deleteContainer';
import { deleteAzureDatabase } from '../commands/deleteDatabase/deleteDatabase';
import {
    clustersExportEntireCollection,
    clustersExportQueryResults,
} from '../commands/exportDocuments/exportDocuments';
import { filterProviderContent } from '../commands/filterProviderContent/filterProviderContent';
import { importDocuments } from '../commands/importDocuments/importDocuments';
import { launchShell } from '../commands/launchShell/launchShell';
import { newConnection } from '../commands/newConnection/newConnection';
import { newEmulatorConnection } from '../commands/newEmulatorConnection/newEmulatorConnection';
import { openCollectionView, openCollectionViewInternal } from '../commands/openCollectionView/openCollectionView';
import { openMongoDocumentView } from '../commands/openDocument/openDocument';
import { refreshTreeElement } from '../commands/refreshTreeElement/refreshTreeElement';
import { refreshView } from '../commands/refreshView/refreshView';
import { removeConnection } from '../commands/removeConnection/removeConnection';
import { removeDiscoveryRegistry } from '../commands/removeDiscoveryRegistry/removeDiscoveryRegistry';
import { updateCredentials } from '../commands/updateCredentials/updateCredentials';
import { ext } from '../extensionVariables';
import { AzureDiscoveryProvider } from '../plugins/service-azure/AzureDiscoveryProvider';
import { DiscoveryService } from '../services/discoveryServices';
import { MongoVCoreBranchDataProvider } from '../tree/azure-resources-view/documentdb/mongo-vcore/MongoVCoreBranchDataProvider';
import { ConnectionsBranchDataProvider } from '../tree/connections-view/ConnectionsBranchDataProvider';
import { DiscoveryBranchDataProvider } from '../tree/discovery-view/DiscoveryBranchDataProvider';
import { WorkspaceResourceType } from '../tree/workspace-api/SharedWorkspaceResourceProvider';
import { ClustersWorkspaceBranchDataProvider } from '../tree/workspace-view/documentdb/ClustersWorkbenchBranchDataProvider';
import { enableMongoVCoreSupport, enableWorkspaceSupport } from './activationConditions';
import { registerScrapbookCommands } from './scrapbook/registerScrapbookCommands';
import { Views } from './Views';

export class ClustersExtension implements vscode.Disposable {
    dispose(): Promise<void> {
        return Promise.resolve();
    }

    registerDiscoveryServices(_activateContext: IActionContext) {
        DiscoveryService.registerProvider(new AzureDiscoveryProvider());
    }

    registerConnectionsTree(_activateContext: IActionContext): void {
        ext.connectionsBranchDataProvider = new ConnectionsBranchDataProvider();

        const treeView = vscode.window.createTreeView(Views.ConnectionsView, {
            canSelectMany: true,
            showCollapseAll: true,
            treeDataProvider: ext.connectionsBranchDataProvider,
        });
        ext.context.subscriptions.push(treeView);
    }

    registerDiscoveryTree(_activateContext: IActionContext): void {
        /**
         * Here, a behavior similar to Workspace Branch Data Providers from Azure Resources will be needed.
         */
        ext.discoveryBranchDataProvider = new DiscoveryBranchDataProvider();

        const treeView = vscode.window.createTreeView(Views.DiscoveryView, {
            showCollapseAll: true,
            treeDataProvider: ext.discoveryBranchDataProvider,
        });

        ext.context.subscriptions.push(treeView);
    }

    async activate(): Promise<void> {
        await callWithTelemetryAndErrorHandling(
            'cosmosDB.mongoClusters.activate',
            async (activateContext: IActionContext) => {
                activateContext.telemetry.properties.isActivationEvent = 'true';

                // TODO: Implement https://github.com/microsoft/vscode-documentdb/issues/30
                // for staged hand-over from Azure Databases to this DocumentDB extension

                // eslint-disable-next-line no-constant-condition
                if (false && enableMongoVCoreSupport()) {
                    // on purpose, transition is still in progress
                    activateContext.telemetry.properties.enabledVCore = 'true';

                    ext.mongoVCoreBranchDataProvider = new MongoVCoreBranchDataProvider();
                    ext.rgApiV2.resources.registerAzureResourceBranchDataProvider(
                        AzExtResourceType.MongoClusters,
                        ext.mongoVCoreBranchDataProvider,
                    );
                }

                // eslint-disable-next-line no-constant-condition
                if (false && enableWorkspaceSupport()) {
                    // on purpose, transition is still in progress
                    activateContext.telemetry.properties.enabledWorkspace = 'true';

                    ext.mongoClustersWorkspaceBranchDataProvider = new ClustersWorkspaceBranchDataProvider();
                    ext.rgApiV2.resources.registerWorkspaceResourceBranchDataProvider(
                        WorkspaceResourceType.MongoClusters,
                        ext.mongoClustersWorkspaceBranchDataProvider,
                    );
                }

                this.registerDiscoveryServices(activateContext);
                this.registerConnectionsTree(activateContext);
                this.registerDiscoveryTree(activateContext);

                //// General Commands:

                registerCommandWithTreeNodeUnwrapping('command.documentDB.refresh', refreshTreeElement);

                registerCommandWithTreeNodeUnwrapping('command.documentDB.createDatabase', createAzureDatabase);
                registerCommandWithTreeNodeUnwrapping(
                    'command.documentDB.copyConnectionString',
                    copyAzureConnectionString,
                );

                //// Connections View Commands:
                registerCommandWithTreeNodeUnwrapping(
                    'command.documentDB.connectionsView.newConnection',
                    newConnection,
                );

                registerCommandWithTreeNodeUnwrapping(
                    'command.documentDB.connectionsView.updateCredentials',
                    updateCredentials,
                );

                registerCommandWithTreeNodeUnwrapping(
                    'command.documentDB.connectionsView.newEmulatorConnection',
                    newEmulatorConnection,
                );

                registerCommand('command.documentDB.connectionsView.refresh', (context: IActionContext) => {
                    return refreshView(context, Views.ConnectionsView);
                });

                //// Registry Commands:

                registerCommand('command.documentDB.discoveryView.addRegistry', addDiscoveryRegistry);

                registerCommandWithTreeNodeUnwrapping(
                    'command.documentDB.discoveryView.removeRegistry',
                    removeDiscoveryRegistry,
                );

                registerCommandWithTreeNodeUnwrapping(
                    'command.documentDB.discoveryView.filterProviderContent',
                    filterProviderContent,
                );

                registerCommandWithTreeNodeUnwrapping(
                    'command.documentDB.discoveryView.addConnectionToConnectionsView',
                    addConnectionFromRegistry,
                );

                registerCommand('command.documentDB.discoveryView.refresh', (context: IActionContext) => {
                    return refreshView(context, Views.DiscoveryView);
                });

                registerCommandWithTreeNodeUnwrapping(
                    'command.documentDB.connectionsView.removeConnection',
                    removeConnection,
                );

                // using registerCommand instead of vscode.commands.registerCommand for better telemetry:
                // https://github.com/microsoft/vscode-azuretools/tree/main/utils#telemetry-and-error-handling

                /**
                 * Here, opening the collection view is done in two ways: one is accessible from the tree view
                 * via a context menu, and the other is accessible programmatically. Both of them
                 * use the same underlying function to open the collection view.
                 *
                 * openCollectionView calls openCollectionViewInternal with no additional parameters.
                 *
                 * It was possible to merge the two commands into one, but it would result in code that is
                 * harder to understand and maintain.
                 */
                registerCommand('command.internal.mongoClusters.containerView.open', openCollectionViewInternal);
                registerCommandWithTreeNodeUnwrapping('command.documentDB.containerView.open', openCollectionView);

                registerCommand('command.internal.mongoClusters.documentView.open', openMongoDocumentView);

                registerCommandWithTreeNodeUnwrapping('command.documentDB.launchShell', launchShell);

                registerCommandWithTreeNodeUnwrapping('command.documentDB.dropCollection', deleteAzureContainer);
                registerCommandWithTreeNodeUnwrapping('command.documentDB.dropDatabase', deleteAzureDatabase);

                registerCommandWithTreeNodeUnwrapping('command.documentDB.createCollection', createMongoCollection);

                registerCommandWithTreeNodeUnwrapping('command.documentDB.createDocument', createMongoDocument);

                registerCommandWithTreeNodeUnwrapping('command.documentDB.importDocuments', importDocuments);

                registerScrapbookCommands();

                /**
                 * Here, exporting documents is done in two ways: one is accessible from the tree view
                 * via a context menu, and the other is accessible programmatically. Both of them
                 * use the same underlying function to export documents.
                 *
                 * mongoClustersExportEntireCollection calls mongoClustersExportQueryResults with no queryText.
                 *
                 * It was possible to merge the two commands into one, but it would result in code that is
                 * harder to understand and maintain.
                 */
                registerCommand('command.internal.mongoClusters.exportDocuments', clustersExportQueryResults);
                registerCommandWithTreeNodeUnwrapping(
                    'command.documentDB.exportDocuments',
                    clustersExportEntireCollection,
                );
                // This is an optional task - if it fails, we don't want to break extension activation,
                // but we should log the error for diagnostics
                try {
                    // Show welcome screen if it hasn't been shown before
                    const welcomeScreenShown = ext.context.globalState.get<boolean>('welcomeScreenShown', false);
                    if (!welcomeScreenShown) {
                        // Update the flag first
                        await ext.context.globalState.update('welcomeScreenShown', true);
                        ext.outputChannel.appendLog('Showing welcome screen...');

                        // Schedule the walkthrough to open after activation completes
                        // This prevents it from blocking the activation process
                        setImmediate(() => {
                            vscode.commands
                                .executeCommand(
                                    'workbench.action.openWalkthrough',
                                    'ms-azuretools.vscode-documentdb#documentdb-welcome',
                                )
                                .then(
                                    // Success handler
                                    () => {
                                        activateContext.telemetry.properties.welcomeScreenShown = 'true';
                                    },
                                    // Error handler
                                    (error) => {
                                        ext.outputChannel.appendLog(
                                            `Welcome screen error: ${error instanceof Error ? error.message : String(error)}`,
                                        );
                                    },
                                );
                        });
                    }
                } catch (error) {
                    // Log the error but don't throw - this is non-critical functionality
                    activateContext.telemetry.properties.welcomeScreenError = 'true';
                    ext.outputChannel.appendLog(
                        `Welcome screen error: ${error instanceof Error ? error.message : String(error)}`,
                    );
                    // Don't rethrow the error - we want activation to continue
                }
            },
        );
    }
}
