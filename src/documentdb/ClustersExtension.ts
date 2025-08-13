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
import { chooseDataMigrationExtension } from '../commands/chooseDataMigrationExtension/chooseDataMigrationExtension';
import { copyAzureConnectionString } from '../commands/copyConnectionString/copyConnectionString';
import { createCollection } from '../commands/createCollection/createCollection';
import { createAzureDatabase } from '../commands/createDatabase/createDatabase';
import { createMongoDocument } from '../commands/createDocument/createDocument';
import { deleteCollection } from '../commands/deleteCollection/deleteCollection';
import { deleteAzureDatabase } from '../commands/deleteDatabase/deleteDatabase';
import { exportEntireCollection, exportQueryResults } from '../commands/exportDocuments/exportDocuments';
import { filterProviderContent } from '../commands/filterProviderContent/filterProviderContent';
import { importDocuments } from '../commands/importDocuments/importDocuments';
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
import { retryAuthentication } from '../commands/retryAuthentication/retryAuthentication';
import { updateConnectionString } from '../commands/updateConnectionString/updateConnectionString';
import { updateCredentials } from '../commands/updateCredentials/updateCredentials';
import { ext } from '../extensionVariables';
import { AzureVMDiscoveryProvider } from '../plugins/service-azure-vm/AzureVMDiscoveryProvider';
import { AzureDiscoveryProvider } from '../plugins/service-azure/AzureDiscoveryProvider';
import { DiscoveryService } from '../services/discoveryServices';
import { TaskReportingService } from '../services/taskReportingService';
import { TaskService } from '../services/taskService';
import { DemoTask } from '../services/tasks/DemoTask';
import { MongoVCoreBranchDataProvider } from '../tree/azure-resources-view/documentdb/mongo-vcore/MongoVCoreBranchDataProvider';
import { ConnectionsBranchDataProvider } from '../tree/connections-view/ConnectionsBranchDataProvider';
import { DiscoveryBranchDataProvider } from '../tree/discovery-view/DiscoveryBranchDataProvider';
import { WorkspaceResourceType } from '../tree/workspace-api/SharedWorkspaceResourceProvider';
import { ClustersWorkspaceBranchDataProvider } from '../tree/workspace-view/documentdb/ClustersWorkbenchBranchDataProvider';
import {
    registerCommandWithModalErrors,
    registerCommandWithTreeNodeUnwrappingAndModalErrors,
} from '../utils/commandErrorHandling';
import { enableMongoVCoreSupport, enableWorkspaceSupport } from './activationConditions';
import { registerScrapbookCommands } from './scrapbook/registerScrapbookCommands';

export class ClustersExtension implements vscode.Disposable {
    dispose(): Promise<void> {
        return Promise.resolve();
    }

    registerDiscoveryServices(_activateContext: IActionContext) {
        DiscoveryService.registerProvider(new AzureDiscoveryProvider());
        DiscoveryService.registerProvider(new AzureVMDiscoveryProvider());
    }

    registerConnectionsTree(_activateContext: IActionContext): void {
        ext.connectionsBranchDataProvider = new ConnectionsBranchDataProvider();

        ext.connectionsTreeView = vscode.window.createTreeView(Views.ConnectionsView, {
            canSelectMany: true,
            showCollapseAll: true,
            treeDataProvider: ext.connectionsBranchDataProvider,
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

    async activateClustersSupport(): Promise<void> {
        await callWithTelemetryAndErrorHandling(
            'clustersExtension.activate',
            async (activateContext: IActionContext) => {
                activateContext.telemetry.properties.isActivationEvent = 'true';

                // TODO: Implement https://github.com/microsoft/vscode-documentdb/issues/30
                // for staged hand-over from Azure Databases to this DocumentDB extension

                // eslint-disable-next-line no-constant-condition, no-constant-binary-expression
                if (false && enableMongoVCoreSupport()) {
                    // on purpose, transition is still in progress
                    activateContext.telemetry.properties.enabledVCore = 'true';

                    ext.mongoVCoreBranchDataProvider = new MongoVCoreBranchDataProvider();
                    ext.rgApiV2.resources.registerAzureResourceBranchDataProvider(
                        AzExtResourceType.MongoClusters,
                        ext.mongoVCoreBranchDataProvider,
                    );
                }

                // eslint-disable-next-line no-constant-condition, no-constant-binary-expression
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

                // Initialize TaskService and TaskReportingService
                TaskReportingService.attach(TaskService);

                //// General Commands:

                registerCommandWithTreeNodeUnwrapping('vscode-documentdb.command.refresh', refreshTreeElement);

                registerCommandWithTreeNodeUnwrapping('vscode-documentdb.command.createDatabase', createAzureDatabase);
                registerCommandWithTreeNodeUnwrapping(
                    'vscode-documentdb.command.copyConnectionString',
                    copyAzureConnectionString,
                );

                //// Connections View Commands:
                registerCommandWithModalErrors(
                    'vscode-documentdb.command.connectionsView.newConnection',
                    newConnection,
                );

                registerCommandWithTreeNodeUnwrapping(
                    'vscode-documentdb.command.connectionsView.updateCredentials',
                    updateCredentials,
                );

                registerCommandWithTreeNodeUnwrapping(
                    'vscode-documentdb.command.connectionsView.updateConnectionString',
                    updateConnectionString,
                );

                registerCommandWithTreeNodeUnwrappingAndModalErrors(
                    'vscode-documentdb.command.connectionsView.newEmulatorConnection',
                    newLocalConnection,
                );

                registerCommand('vscode-documentdb.command.connectionsView.refresh', (context: IActionContext) => {
                    return refreshView(context, Views.ConnectionsView);
                });

                registerCommandWithTreeNodeUnwrapping(
                    'vscode-documentdb.command.chooseDataMigrationExtension',
                    chooseDataMigrationExtension,
                );

                //// Registry Commands:

                registerCommand('vscode-documentdb.command.discoveryView.addRegistry', addDiscoveryRegistry);

                registerCommandWithTreeNodeUnwrapping(
                    'vscode-documentdb.command.discoveryView.removeRegistry',
                    removeDiscoveryRegistry,
                );

                registerCommandWithTreeNodeUnwrapping(
                    'vscode-documentdb.command.discoveryView.filterProviderContent',
                    filterProviderContent,
                );

                registerCommandWithTreeNodeUnwrapping(
                    'vscode-documentdb.command.discoveryView.learnMoreAboutProvider',
                    learnMoreAboutServiceProvider,
                );

                registerCommandWithTreeNodeUnwrappingAndModalErrors(
                    'vscode-documentdb.command.discoveryView.addConnectionToConnectionsView',
                    addConnectionFromRegistry,
                );

                registerCommand('vscode-documentdb.command.discoveryView.refresh', (context: IActionContext) => {
                    return refreshView(context, Views.DiscoveryView);
                });

                registerCommandWithTreeNodeUnwrapping(
                    'vscode-documentdb.command.connectionsView.removeConnection',
                    removeConnection,
                );

                registerCommandWithTreeNodeUnwrapping(
                    'vscode-documentdb.command.connectionsView.renameConnection',
                    renameConnection,
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
                registerCommand('vscode-documentdb.command.internal.containerView.open', openCollectionViewInternal);
                registerCommandWithTreeNodeUnwrapping(
                    'vscode-documentdb.command.containerView.open',
                    openCollectionView,
                );

                registerCommand('vscode-documentdb.command.internal.documentView.open', openDocumentView);

                registerCommandWithTreeNodeUnwrapping('vscode-documentdb.command.internal.retry', retryAuthentication);

                registerCommandWithTreeNodeUnwrapping('vscode-documentdb.command.launchShell', launchShell);

                registerCommandWithTreeNodeUnwrapping('vscode-documentdb.command.dropCollection', deleteCollection);
                registerCommandWithTreeNodeUnwrapping('vscode-documentdb.command.dropDatabase', deleteAzureDatabase);

                registerCommandWithTreeNodeUnwrapping('vscode-documentdb.command.createCollection', createCollection);

                registerCommandWithTreeNodeUnwrapping('vscode-documentdb.command.createDocument', createMongoDocument);

                registerCommandWithTreeNodeUnwrapping('vscode-documentdb.command.importDocuments', importDocuments);

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
                registerCommand('vscode-documentdb.command.internal.exportDocuments', exportQueryResults);
                registerCommandWithTreeNodeUnwrapping(
                    'vscode-documentdb.command.exportDocuments',
                    exportEntireCollection,
                );

                // Testing command for DemoTask
                registerCommand('vscode-documentdb.command.testing.startDemoTask', async (_context: IActionContext) => {
                    const failureOptions = [
                        {
                            label: vscode.l10n.t('$(check) Success'),
                            description: vscode.l10n.t('Task will complete successfully'),
                            shouldFail: false,
                        },
                        {
                            label: vscode.l10n.t('$(error) Failure'),
                            description: vscode.l10n.t('Task will fail at a random step for testing'),
                            shouldFail: true,
                        },
                    ];

                    const selectedOption = await vscode.window.showQuickPick(failureOptions, {
                        title: vscode.l10n.t('Demo Task Configuration'),
                        placeHolder: vscode.l10n.t('Choose whether the task should succeed or fail'),
                    });

                    if (!selectedOption) {
                        return; // User cancelled
                    }

                    const task = new DemoTask(vscode.l10n.t('Demo Task {0}', Date.now()), selectedOption.shouldFail);
                    TaskService.registerTask(task);
                    void task.start();
                });

                // This is an optional task - if it fails, we don't want to break extension activation,
                // but we should log the error for diagnostics
                try {
                    // Show welcome screen if it hasn't been shown before
                    const welcomeScreenShown = ext.context.globalState.get<boolean>('welcomeScreenShown_v0_2_0', false);
                    if (!welcomeScreenShown) {
                        // Update the flag first
                        await ext.context.globalState.update('welcomeScreenShown_v0_2_0', true);
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
