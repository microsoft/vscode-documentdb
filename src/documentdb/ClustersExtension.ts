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
import { type AzureResourcesExtensionApiWithActivity } from '@microsoft/vscode-azext-utils/activity';
import { type AzExtResourceType, getAzureResourcesExtensionApi } from '@microsoft/vscode-azureresources-api';
import * as vscode from 'vscode';
import { addConnectionFromRegistry } from '../commands/addConnectionFromRegistry/addConnectionFromRegistry';
import { addDiscoveryRegistry } from '../commands/addDiscoveryRegistry/addDiscoveryRegistry';
import { chooseDataMigrationExtension } from '../commands/chooseDataMigrationExtension/chooseDataMigrationExtension';
import { copyItems } from '../commands/connectionsClipboardOperations/copyItems';
import { cutItems } from '../commands/connectionsClipboardOperations/cutItems';
import { pasteItems } from '../commands/connectionsClipboardOperations/pasteItems';
import { copyAzureConnectionString } from '../commands/copyConnectionString/copyConnectionString';
import { createCollection } from '../commands/createCollection/createCollection';
import { createAzureDatabase } from '../commands/createDatabase/createDatabase';
import { createMongoDocument } from '../commands/createDocument/createDocument';
import { createFolder } from '../commands/createFolder/createFolder';
import { deleteCollection } from '../commands/deleteCollection/deleteCollection';
import { deleteAzureDatabase } from '../commands/deleteDatabase/deleteDatabase';
import { deleteFolder } from '../commands/deleteFolder/deleteFolder';
import { filterProviderContent } from '../commands/discoveryService.filterProviderContent/filterProviderContent';
import { manageCredentials } from '../commands/discoveryService.manageCredentials/manageCredentials';
import { exportEntireCollection, exportQueryResults } from '../commands/exportDocuments/exportDocuments';
import { openHelpAndFeedbackUrl } from '../commands/helpAndFeedback.openUrl/openUrl';
import { importDocuments } from '../commands/importDocuments/importDocuments';
import { dropIndex } from '../commands/index.dropIndex/dropIndex';
import { hideIndex } from '../commands/index.hideIndex/hideIndex';
import { unhideIndex } from '../commands/index.unhideIndex/unhideIndex';
import { launchShell } from '../commands/launchShell/launchShell';
import { learnMoreAboutServiceProvider } from '../commands/learnMoreAboutServiceProvider/learnMoreAboutServiceProvider';
import { newConnection } from '../commands/newConnection/newConnection';
import { newLocalConnection } from '../commands/newLocalConnection/newLocalConnection';
import { openCollectionView, openCollectionViewInternal } from '../commands/openCollectionView/openCollectionView';
import { openDocumentView } from '../commands/openDocument/openDocument';
import { refreshTreeElement } from '../commands/refreshTreeElement/refreshTreeElement';
import { refreshView } from '../commands/refreshView/refreshView';
import { removeConnection } from '../commands/removeConnection/removeConnection';
import { removeDiscoveryRegistry } from '../commands/removeDiscoveryRegistry/removeDiscoveryRegistry';
import { renameConnection } from '../commands/renameConnection/renameConnection';
import { renameFolder } from '../commands/renameFolder/renameFolder';
import { retryAuthentication } from '../commands/retryAuthentication/retryAuthentication';
import { revealView } from '../commands/revealView/revealView';
import { updateConnectionString } from '../commands/updateConnectionString/updateConnectionString';
import { updateCredentials } from '../commands/updateCredentials/updateCredentials';
import { isVCoreAndRURolloutEnabled } from '../extension';
import { ext } from '../extensionVariables';
import { AzureMongoRUDiscoveryProvider } from '../plugins/service-azure-mongo-ru/AzureMongoRUDiscoveryProvider';
import { AzureDiscoveryProvider } from '../plugins/service-azure-mongo-vcore/AzureDiscoveryProvider';
import { AzureVMDiscoveryProvider } from '../plugins/service-azure-vm/AzureVMDiscoveryProvider';
import { DiscoveryService } from '../services/discoveryServices';
import { VCoreBranchDataProvider } from '../tree/azure-resources-view/documentdb/VCoreBranchDataProvider';
import { RUBranchDataProvider } from '../tree/azure-resources-view/mongo-ru/RUBranchDataProvider';
import { ClustersWorkspaceBranchDataProvider } from '../tree/azure-workspace-view/ClustersWorkbenchBranchDataProvider';
import { DocumentDbWorkspaceResourceProvider } from '../tree/azure-workspace-view/DocumentDbWorkspaceResourceProvider';
import { ConnectionsBranchDataProvider } from '../tree/connections-view/ConnectionsBranchDataProvider';
import { DiscoveryBranchDataProvider } from '../tree/discovery-view/DiscoveryBranchDataProvider';
import { HelpAndFeedbackBranchDataProvider } from '../tree/help-and-feedback-view/HelpAndFeedbackBranchDataProvider';
import {
    registerCommandWithModalErrors,
    registerCommandWithTreeNodeUnwrappingAndModalErrors,
} from '../utils/commandErrorHandling';
import { withCommandCorrelation, withTreeNodeCommandCorrelation } from '../utils/commandTelemetry';
import { registerScrapbookCommands } from './scrapbook/registerScrapbookCommands';
import { Views } from './Views';

export class ClustersExtension implements vscode.Disposable {
    dispose(): Promise<void> {
        return Promise.resolve();
    }

    registerDiscoveryServices(_activateContext: IActionContext) {
        DiscoveryService.registerProvider(new AzureDiscoveryProvider());
        DiscoveryService.registerProvider(new AzureMongoRUDiscoveryProvider());
        DiscoveryService.registerProvider(new AzureVMDiscoveryProvider());
    }

    registerConnectionsTree(_activateContext: IActionContext): void {
        ext.connectionsBranchDataProvider = new ConnectionsBranchDataProvider();

        // Import drag-and-drop controller
        const { ConnectionsDragAndDropController } = require('../tree/connections-view/ConnectionsDragAndDropController');
        const dragAndDropController = new ConnectionsDragAndDropController();

        ext.connectionsTreeView = vscode.window.createTreeView(Views.ConnectionsView, {
            canSelectMany: true,
            showCollapseAll: true,
            treeDataProvider: ext.connectionsBranchDataProvider,
            dragAndDropController: dragAndDropController,
        });
        ext.context.subscriptions.push(ext.connectionsTreeView);
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

    registerHelpAndFeedbackTree(_activateContext: IActionContext): void {
        ext.helpAndFeedbackBranchDataProvider = new HelpAndFeedbackBranchDataProvider();

        const treeView = vscode.window.createTreeView(Views.HelpAndFeedbackView, {
            treeDataProvider: ext.helpAndFeedbackBranchDataProvider,
        });

        ext.context.subscriptions.push(treeView);
    }

    async registerAzureResourcesIntegration(activateContext: IActionContext): Promise<void> {
        // Dynamic registration so this file compiles when the enum members aren't present
        // This is how we detect whether the update to Azure Resources has been deployed

        const isRolloutEnabled = await isVCoreAndRURolloutEnabled();
        activateContext.telemetry.properties.activatingAzureResourcesIntegration = isRolloutEnabled ? 'true' : 'false';

        if (!isRolloutEnabled) {
            return;
        }

        ext.rgApiV2 = (await getAzureResourcesExtensionApi(
            ext.context,
            '2.0.0',
        )) as AzureResourcesExtensionApiWithActivity;

        const documentDbResourceType = 'AzureDocumentDb' as unknown as AzExtResourceType;
        ext.azureResourcesVCoreBranchDataProvider = new VCoreBranchDataProvider();
        ext.rgApiV2.resources.registerAzureResourceBranchDataProvider(
            documentDbResourceType,
            ext.azureResourcesVCoreBranchDataProvider,
        );

        const ruResourceType = 'AzureCosmosDbForMongoDbRu' as unknown as AzExtResourceType;
        ext.azureResourcesRUBranchDataProvider = new RUBranchDataProvider();
        ext.rgApiV2.resources.registerAzureResourceBranchDataProvider(
            ruResourceType,
            ext.azureResourcesRUBranchDataProvider,
        );

        ext.azureResourcesWorkspaceResourceProvider = new DocumentDbWorkspaceResourceProvider();
        ext.rgApiV2.resources.registerWorkspaceResourceProvider(ext.azureResourcesWorkspaceResourceProvider);

        ext.azureResourcesWorkspaceBranchDataProvider = new ClustersWorkspaceBranchDataProvider();
        ext.rgApiV2.resources.registerWorkspaceResourceBranchDataProvider(
            'vscode.documentdb.workspace.documentdb-accounts-resourceType',
            ext.azureResourcesWorkspaceBranchDataProvider,
        );
    }

    async activateClustersSupport(): Promise<void> {
        await callWithTelemetryAndErrorHandling(
            'clustersExtension.activate',
            async (activateContext: IActionContext) => {
                activateContext.telemetry.properties.isActivationEvent = 'true';

                await this.registerAzureResourcesIntegration(activateContext);
                this.registerDiscoveryServices(activateContext);
                this.registerConnectionsTree(activateContext);
                this.registerDiscoveryTree(activateContext);
                this.registerHelpAndFeedbackTree(activateContext);

                //// General Commands:

                registerCommandWithTreeNodeUnwrapping(
                    'vscode-documentdb.command.refresh',
                    withTreeNodeCommandCorrelation(refreshTreeElement),
                );

                registerCommandWithTreeNodeUnwrapping(
                    'vscode-documentdb.command.createDatabase',
                    withTreeNodeCommandCorrelation(createAzureDatabase),
                );
                registerCommandWithTreeNodeUnwrapping(
                    'vscode-documentdb.command.copyConnectionString',
                    withTreeNodeCommandCorrelation(copyAzureConnectionString),
                );

                //// Connections View Commands:
                registerCommandWithModalErrors(
                    'vscode-documentdb.command.connectionsView.newConnection',
                    withCommandCorrelation(newConnection),
                );

                registerCommandWithTreeNodeUnwrapping(
                    'vscode-documentdb.command.connectionsView.updateCredentials',
                    withTreeNodeCommandCorrelation(updateCredentials),
                );

                registerCommandWithTreeNodeUnwrapping(
                    'vscode-documentdb.command.connectionsView.updateConnectionString',
                    withTreeNodeCommandCorrelation(updateConnectionString),
                );

                registerCommandWithTreeNodeUnwrappingAndModalErrors(
                    'vscode-documentdb.command.connectionsView.newEmulatorConnection',
                    withTreeNodeCommandCorrelation(newLocalConnection),
                );

                registerCommand(
                    'vscode-documentdb.command.connectionsView.refresh',
                    withCommandCorrelation((context: IActionContext) => {
                        return refreshView(context, Views.ConnectionsView);
                    }),
                );

                registerCommandWithTreeNodeUnwrapping(
                    'vscode-documentdb.command.chooseDataMigrationExtension',
                    withTreeNodeCommandCorrelation(chooseDataMigrationExtension),
                );

                //// Registry Commands:

                registerCommand(
                    'vscode-documentdb.command.discoveryView.addRegistry',
                    withCommandCorrelation(addDiscoveryRegistry),
                );

                registerCommandWithTreeNodeUnwrapping(
                    'vscode-documentdb.command.discoveryView.removeRegistry',
                    withTreeNodeCommandCorrelation(removeDiscoveryRegistry),
                );

                registerCommandWithTreeNodeUnwrapping(
                    'vscode-documentdb.command.discoveryView.filterProviderContent',
                    withTreeNodeCommandCorrelation(filterProviderContent),
                );

                registerCommandWithTreeNodeUnwrapping(
                    'vscode-documentdb.command.discoveryView.manageCredentials',
                    withTreeNodeCommandCorrelation(manageCredentials),
                );

                registerCommandWithTreeNodeUnwrapping(
                    'vscode-documentdb.command.discoveryView.learnMoreAboutProvider',
                    withTreeNodeCommandCorrelation(learnMoreAboutServiceProvider),
                );

                registerCommandWithTreeNodeUnwrappingAndModalErrors(
                    'vscode-documentdb.command.discoveryView.addConnectionToConnectionsView',
                    withTreeNodeCommandCorrelation(addConnectionFromRegistry),
                );

                registerCommandWithTreeNodeUnwrappingAndModalErrors(
                    'vscode-documentdb.command.azureResourcesView.addConnectionToConnectionsView',
                    withTreeNodeCommandCorrelation(addConnectionFromRegistry),
                );

                registerCommand(
                    'vscode-documentdb.command.discoveryView.refresh',
                    withCommandCorrelation((context: IActionContext) => {
                        return refreshView(context, Views.DiscoveryView);
                    }),
                );

                registerCommandWithTreeNodeUnwrapping(
                    'vscode-documentdb.command.connectionsView.removeConnection',
                    withTreeNodeCommandCorrelation(removeConnection),
                );

                registerCommandWithTreeNodeUnwrapping(
                    'vscode-documentdb.command.connectionsView.renameConnection',
                    withTreeNodeCommandCorrelation(renameConnection),
                );

                //// Folder Management Commands:

                registerCommandWithModalErrors(
                    'vscode-documentdb.command.connectionsView.createFolder',
                    withCommandCorrelation(createFolder),
                );

                registerCommandWithTreeNodeUnwrapping(
                    'vscode-documentdb.command.connectionsView.renameFolder',
                    withTreeNodeCommandCorrelation(renameFolder),
                );

                registerCommandWithTreeNodeUnwrapping(
                    'vscode-documentdb.command.connectionsView.deleteFolder',
                    withTreeNodeCommandCorrelation(deleteFolder),
                );

                //// Clipboard Operations:

                registerCommand(
                    'vscode-documentdb.command.connectionsView.cutItems',
                    withCommandCorrelation(cutItems),
                );

                registerCommand(
                    'vscode-documentdb.command.connectionsView.copyItems',
                    withCommandCorrelation(copyItems),
                );

                registerCommandWithTreeNodeUnwrapping(
                    'vscode-documentdb.command.connectionsView.pasteItems',
                    withTreeNodeCommandCorrelation(pasteItems),
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
                registerCommand(
                    'vscode-documentdb.command.internal.containerView.open',
                    withCommandCorrelation(openCollectionViewInternal),
                );
                registerCommandWithTreeNodeUnwrapping(
                    'vscode-documentdb.command.containerView.open',
                    withTreeNodeCommandCorrelation(openCollectionView),
                );

                registerCommand(
                    'vscode-documentdb.command.internal.documentView.open',
                    withCommandCorrelation(openDocumentView),
                );

                registerCommand(
                    'vscode-documentdb.command.internal.helpAndFeedback.openUrl',
                    withCommandCorrelation(openHelpAndFeedbackUrl),
                );

                registerCommandWithTreeNodeUnwrapping(
                    'vscode-documentdb.command.internal.retry',
                    withTreeNodeCommandCorrelation(retryAuthentication),
                );
                registerCommandWithTreeNodeUnwrapping(
                    'vscode-documentdb.command.internal.revealView',
                    withTreeNodeCommandCorrelation(revealView),
                );

                registerCommandWithTreeNodeUnwrapping(
                    'vscode-documentdb.command.launchShell',
                    withTreeNodeCommandCorrelation(launchShell),
                );

                registerCommandWithTreeNodeUnwrapping(
                    'vscode-documentdb.command.dropCollection',
                    withTreeNodeCommandCorrelation(deleteCollection),
                );
                registerCommandWithTreeNodeUnwrapping(
                    'vscode-documentdb.command.dropDatabase',
                    withTreeNodeCommandCorrelation(deleteAzureDatabase),
                );

                registerCommandWithTreeNodeUnwrapping(
                    'vscode-documentdb.command.hideIndex',
                    withTreeNodeCommandCorrelation(hideIndex),
                );
                registerCommandWithTreeNodeUnwrapping(
                    'vscode-documentdb.command.unhideIndex',
                    withTreeNodeCommandCorrelation(unhideIndex),
                );
                registerCommandWithTreeNodeUnwrapping(
                    'vscode-documentdb.command.dropIndex',
                    withTreeNodeCommandCorrelation(dropIndex),
                );

                registerCommandWithTreeNodeUnwrapping(
                    'vscode-documentdb.command.createCollection',
                    withTreeNodeCommandCorrelation(createCollection),
                );

                registerCommandWithTreeNodeUnwrapping(
                    'vscode-documentdb.command.createDocument',
                    withTreeNodeCommandCorrelation(createMongoDocument),
                );

                registerCommandWithTreeNodeUnwrapping(
                    'vscode-documentdb.command.importDocuments',
                    withTreeNodeCommandCorrelation(importDocuments),
                );

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
                registerCommand(
                    'vscode-documentdb.command.internal.exportDocuments',
                    withCommandCorrelation(exportQueryResults),
                );
                registerCommandWithTreeNodeUnwrapping(
                    'vscode-documentdb.command.exportDocuments',
                    withTreeNodeCommandCorrelation(exportEntireCollection),
                );
                // This is an optional task - if it fails, we don't want to break extension activation,
                // but we should log the error for diagnostics
                try {
                    // Show welcome screen if it hasn't been shown before
                    const welcomeScreenShown = ext.context.globalState.get<boolean>('welcomeScreenShown_v0_4_0', false);
                    if (!welcomeScreenShown) {
                        // Update the flag first
                        await ext.context.globalState.update('welcomeScreenShown_v0_4_0', true);
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
