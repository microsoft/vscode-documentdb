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
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { accessDataMigrationServices } from '../commands/accessDataMigrationServices/accessDataMigrationServices';
import { addConnectionFromRegistry } from '../commands/addConnectionFromRegistry/addConnectionFromRegistry';
import { addDiscoveryRegistry } from '../commands/addDiscoveryRegistry/addDiscoveryRegistry';
import { createFolder, createSubfolder } from '../commands/connections-view/createFolder/createFolder';
import { deleteFolder } from '../commands/connections-view/deleteFolder/deleteFolder';
import { moveItems } from '../commands/connections-view/moveItems/moveItems';
import { newConnectionInFolder } from '../commands/connections-view/newConnectionInFolder/newConnectionInFolder';
import { renameConnection } from '../commands/connections-view/renameConnection/renameConnection';
import { renameFolder } from '../commands/connections-view/renameFolder/renameFolder';
import { copyCollection } from '../commands/copyCollection/copyCollection';
import { copyAzureConnectionString } from '../commands/copyConnectionString/copyConnectionString';
import { copyReference } from '../commands/copyReference/copyReference';
import { createCollection } from '../commands/createCollection/createCollection';
import { createAzureDatabase } from '../commands/createDatabase/createDatabase';
import { createMongoDocument } from '../commands/createDocument/createDocument';
import { deleteCollection } from '../commands/deleteCollection/deleteCollection';
import { deleteAzureDatabase } from '../commands/deleteDatabase/deleteDatabase';
import { filterProviderContent } from '../commands/discoveryService.filterProviderContent/filterProviderContent';
import { manageCredentials } from '../commands/discoveryService.manageCredentials/manageCredentials';
import { exportEntireCollection, exportQueryResults } from '../commands/exportDocuments/exportDocuments';
import { openHelpAndFeedbackUrl } from '../commands/helpAndFeedback.openUrl/openUrl';
import { importDocuments } from '../commands/importDocuments/importDocuments';
import { dropIndex } from '../commands/index.dropIndex/dropIndex';
import { hideIndex } from '../commands/index.hideIndex/hideIndex';
import { unhideIndex } from '../commands/index.unhideIndex/unhideIndex';
import { learnMoreAboutServiceProvider } from '../commands/learnMoreAboutServiceProvider/learnMoreAboutServiceProvider';
import { newConnection } from '../commands/newConnection/newConnection';
import { newLocalConnection } from '../commands/newLocalConnection/newLocalConnection';
import { openCollectionView, openCollectionViewInternal } from '../commands/openCollectionView/openCollectionView';
import { openDocumentView } from '../commands/openDocument/openDocument';
import {
    openInteractiveShell,
    openInteractiveShellWithInput,
} from '../commands/openInteractiveShell/openInteractiveShell';
import { pasteCollection } from '../commands/pasteCollection/pasteCollection';
import { showConnectionInfo } from '../commands/playground/connectDatabase';
import { disposeEvaluators, shutdownOrphanedEvaluators } from '../commands/playground/executePlaygroundCode';
import { newPlayground, newPlaygroundWithContent } from '../commands/playground/newPlayground';
import { playgroundOpenQueryInCollectionView } from '../commands/playground/playgroundOpenInCollectionView';
import { playgroundOpenQueryInShell } from '../commands/playground/playgroundOpenInShell';
import { runAll } from '../commands/playground/runAll';
import { runSelected } from '../commands/playground/runSelected';
import { scanCollectionSchema } from '../commands/playground/scanCollectionSchema';
import { refreshTreeElement } from '../commands/refreshTreeElement/refreshTreeElement';
import { refreshView } from '../commands/refreshView/refreshView';
import { removeConnection } from '../commands/removeConnection/removeConnection';
import { removeDiscoveryRegistry } from '../commands/removeDiscoveryRegistry/removeDiscoveryRegistry';
import { retryAuthentication } from '../commands/retryAuthentication/retryAuthentication';
import { revealView } from '../commands/revealView/revealView';
import { clearSchemaCache } from '../commands/schemaStore/clearSchemaCache';
import { showSchemaStoreStats } from '../commands/schemaStore/showSchemaStoreStats';
import { showWorkerStats } from '../commands/showWorkerStats/showWorkerStats';
import { updateConnectionString } from '../commands/updateConnectionString/updateConnectionString';
import { updateCredentials } from '../commands/updateCredentials/updateCredentials';
import { doubleClickDebounceDelay } from '../constants';
import { isVCoreAndRURolloutEnabled } from '../extension';
import { ext } from '../extensionVariables';
import { AzureMongoRUDiscoveryProvider } from '../plugins/service-azure-mongo-ru/AzureMongoRUDiscoveryProvider';
import { AzureDiscoveryProvider } from '../plugins/service-azure-mongo-vcore/AzureDiscoveryProvider';
import { AzureVMDiscoveryProvider } from '../plugins/service-azure-vm/AzureVMDiscoveryProvider';
import { DiscoveryService } from '../services/discoveryServices';
import { maybeShowReleaseNotesNotification } from '../services/releaseNotesNotification';
import { DemoTask } from '../services/taskService/tasks/DemoTask';
import { TaskService } from '../services/taskService/taskService';
import { TaskProgressReportingService } from '../services/taskService/UI/taskProgressReportingService';
import { VCoreBranchDataProvider } from '../tree/azure-resources-view/documentdb/VCoreBranchDataProvider';
import { RUBranchDataProvider } from '../tree/azure-resources-view/mongo-ru/RUBranchDataProvider';
import { ClustersWorkspaceBranchDataProvider } from '../tree/azure-workspace-view/ClustersWorkbenchBranchDataProvider';
import { DocumentDbWorkspaceResourceProvider } from '../tree/azure-workspace-view/DocumentDbWorkspaceResourceProvider';
import { ConnectionsBranchDataProvider } from '../tree/connections-view/ConnectionsBranchDataProvider';
import { DiscoveryBranchDataProvider } from '../tree/discovery-view/DiscoveryBranchDataProvider';
import { type ClusterItemBase } from '../tree/documentdb/ClusterItemBase';
import { type CollectionItem } from '../tree/documentdb/CollectionItem';
import { type DatabaseItem } from '../tree/documentdb/DatabaseItem';
import { HelpAndFeedbackBranchDataProvider } from '../tree/help-and-feedback-view/HelpAndFeedbackBranchDataProvider';
import {
    registerCommandWithModalErrors,
    registerCommandWithTreeNodeUnwrappingAndModalErrors,
} from '../utils/commandErrorHandling';
import { withCommandCorrelation, withTreeNodeCommandCorrelation } from '../utils/commandTelemetry';
import { registerDoubleClickCommand } from '../utils/registerDoubleClickCommand';
import { PLAYGROUND_FILE_EXTENSION, PLAYGROUND_LANGUAGE_ID, PlaygroundCommandIds } from './playground/constants';
import { PlaygroundBlockHighlighter } from './playground/PlaygroundBlockHighlighter';
import { PlaygroundCodeLensProvider } from './playground/PlaygroundCodeLensProvider';
import { PlaygroundService } from './playground/PlaygroundService';
import { CollectionNameCache } from './query-language/playground-completions/CollectionNameCache';
import { PlaygroundCompletionItemProvider } from './query-language/playground-completions/PlaygroundCompletionItemProvider';
import { PlaygroundHoverProvider } from './query-language/playground-completions/PlaygroundHoverProvider';
import { PlaygroundSnippetSessionManager } from './query-language/playground-completions/PlaygroundSnippetSessionManager';
import { ShellCommandIds } from './shell/constants';
import { ShellTerminalLinkProvider } from './shell/ShellTerminalLinkProvider';
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

        ext.connectionsTreeView = vscode.window.createTreeView(Views.ConnectionsView, {
            canSelectMany: true,
            showCollapseAll: true,
            treeDataProvider: ext.connectionsBranchDataProvider,
        });
        ext.context.subscriptions.push(ext.connectionsTreeView);

        // Show release notes notification when the Connections View becomes visible
        ext.context.subscriptions.push(
            ext.connectionsTreeView.onDidChangeVisibility((e) => {
                if (e.visible) {
                    void maybeShowReleaseNotesNotification();
                }
            }),
        );
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

                // Initialize TaskService and TaskProgressReportingService
                TaskProgressReportingService.attach(TaskService);

                // Initialize PlaygroundService (connection state + StatusBarItem)
                const playgroundService = PlaygroundService.getInstance();
                ext.context.subscriptions.push(playgroundService);

                // Register evaluator disposal for clean worker shutdown on deactivation
                ext.context.subscriptions.push({ dispose: disposeEvaluators });

                // Shut down playground workers when their last document closes
                ext.context.subscriptions.push(
                    playgroundService.onDidChangeState(() => {
                        shutdownOrphanedEvaluators();
                    }),
                );

                // Shut down the query playground worker when the last .documentdb.js editor closes
                ext.context.subscriptions.push(
                    vscode.window.tabGroups.onDidChangeTabs((event) => {
                        // Only react when tabs are closed
                        if (event.closed.length === 0) {
                            return;
                        }

                        // Check if any closed tab was a query playground
                        const closedPlayground = event.closed.some((tab) => {
                            const input = tab.input;
                            return (
                                input instanceof vscode.TabInputText &&
                                input.uri.path.endsWith(PLAYGROUND_FILE_EXTENSION)
                            );
                        });

                        if (!closedPlayground) {
                            return;
                        }

                        // Shut down evaluators whose cluster has no remaining playgrounds
                        shutdownOrphanedEvaluators();
                    }),
                );

                // Register CodeLens provider for query playground files
                const codeLensProvider = new PlaygroundCodeLensProvider();
                ext.context.subscriptions.push(codeLensProvider);
                ext.context.subscriptions.push(
                    vscode.languages.registerCodeLensProvider({ language: PLAYGROUND_LANGUAGE_ID }, codeLensProvider),
                );

                // Register block highlighter for query playground files
                const blockHighlighter = new PlaygroundBlockHighlighter(ext.context.extensionPath);
                ext.context.subscriptions.push(blockHighlighter);

                // Register completion provider for query playground files (Layer 2).
                // Provides query operators, field names, collection names, and BSON
                // constructors that the TypeScript service (Layer 1) doesn't know about.
                ext.context.subscriptions.push(CollectionNameCache.getInstance());
                ext.context.subscriptions.push(PlaygroundCompletionItemProvider.register());

                // Register hover provider for query playground files.
                // Provides inline docs for query operators, BSON constructors,
                // and field names. Method hovers are handled by Layer 1 (TS Plugin).
                ext.context.subscriptions.push(PlaygroundHoverProvider.register());

                // Cancel snippet sessions when delimiter characters are typed in playground files.
                // Mirrors the collection view's cancelSnippetSession behavior so that typing
                // `,`, `}`, or `]` exits the tab-stop instead of leaving a "ghost selection".
                ext.context.subscriptions.push(PlaygroundSnippetSessionManager.register());

                // Ensure the TypeScript extension recognizes our plugin and restarts
                // its TS server to load it. The TS extension may have started before our
                // extension was discovered, so its TS server might not include our plugin.
                // We restart it once when the first query playground file is opened.
                let tsRestarted = false;

                const ensureTsRestart = async (): Promise<void> => {
                    if (tsRestarted) {
                        return;
                    }
                    tsRestarted = true;
                    try {
                        // TODO: Remove this runtime stub once the TS plugin is published
                        // as a standalone npm package with its own release pipeline.
                        // The official VS Code docs say TS server plugins should be normal
                        // npm `dependencies`. Our plugin is currently bundled inline by
                        // webpack, and vsce hardcodes `ignore: 'node_modules/**'` in its
                        // file collection, so the stub can't ship in the VSIX. We create
                        // it at runtime instead (same pattern as Vue/Volar).
                        // Tracked by: https://github.com/microsoft/vscode-documentdb/issues/548
                        const stubDir = path.join(
                            ext.context.extensionPath,
                            'node_modules',
                            'documentdb-playground-ts-plugin',
                        );
                        const stubEntry = path.join(stubDir, 'index.js');
                        if (!fs.existsSync(stubEntry)) {
                            fs.mkdirSync(stubDir, { recursive: true });
                            // Point to the bundled plugin at the extension root
                            fs.writeFileSync(stubEntry, 'module.exports = require("../../playgroundTsPlugin.js");\n');
                        }

                        const tsExt = vscode.extensions.getExtension('vscode.typescript-language-features');
                        if (tsExt) {
                            if (!tsExt.isActive) {
                                await tsExt.activate();
                            }
                            // Wait a moment for the TS server to fully initialize before
                            // restarting it. Without this delay, the restart command can
                            // arrive while the server is still starting, causing a crash.
                            await new Promise((resolve) => setTimeout(resolve, 2000));
                            // Restart the TS server so it picks up our plugin from
                            // contributes.typescriptServerPlugins. Without this, the server
                            // may have started before our extension was loaded and won't
                            // have our plugin in --globalPlugins.
                            await vscode.commands.executeCommand('typescript.restartTsServer');
                        }
                    } catch (error) {
                        const message = error instanceof Error ? error.message : String(error);
                        ext.outputChannel.debug(`[Playground] TS server restart failed: ${message}`);
                    }
                };

                ext.context.subscriptions.push(
                    vscode.workspace.onDidOpenTextDocument((doc) => {
                        if (doc.languageId === PLAYGROUND_LANGUAGE_ID) {
                            void ensureTsRestart();
                        }
                    }),
                );

                // If a query playground file was already open before the extension activated
                // (e.g., restored by hot-exit), the onDidOpenTextDocument event will not
                // fire. Check existing documents to cover that path.
                const hasPlaygroundOpen = vscode.workspace.textDocuments.some(
                    (doc) => doc.languageId === PLAYGROUND_LANGUAGE_ID,
                );
                if (hasPlaygroundOpen) {
                    void ensureTsRestart();
                }

                //// Playground Commands:

                registerCommandWithTreeNodeUnwrapping(
                    PlaygroundCommandIds.new,
                    withTreeNodeCommandCorrelation(newPlayground),
                );

                // Inline button variant — same handler, different activationSource
                registerCommandWithTreeNodeUnwrapping(
                    'vscode-documentdb.command.playground.new.inline',
                    withTreeNodeCommandCorrelation((context, node) => {
                        context.telemetry.properties.activationSource = 'treeNodeInline';
                        return newPlayground(context, node as DatabaseItem | CollectionItem);
                    }),
                );

                registerCommand(PlaygroundCommandIds.newWithContent, withCommandCorrelation(newPlaygroundWithContent));

                registerCommand(PlaygroundCommandIds.showConnectionInfo, withCommandCorrelation(showConnectionInfo));

                registerCommand(PlaygroundCommandIds.runAll, withCommandCorrelation(runAll));

                registerCommand(PlaygroundCommandIds.runSelected, withCommandCorrelation(runSelected));

                // Register scan schema command (triggered by "Discover Fields" completion item)
                registerCommand(
                    PlaygroundCommandIds.scanCollectionSchema,
                    withCommandCorrelation(scanCollectionSchema),
                );

                // Playground → Collection View / Shell navigation
                registerCommand(
                    PlaygroundCommandIds.openQueryInCollectionView,
                    withCommandCorrelation(playgroundOpenQueryInCollectionView),
                );
                registerCommand(
                    PlaygroundCommandIds.openQueryInShell,
                    withCommandCorrelation(playgroundOpenQueryInShell),
                );

                // Internal: telemetry for completion acceptance (playground + collection view)
                const VALID_COMPLETION_CATEGORIES = new Set([
                    'field',
                    'operator',
                    'bsonConstructor',
                    'typeSuggestion',
                    'jsGlobal',
                    'collectionName',
                    'other',
                ]);
                registerCommand(
                    'vscode-documentdb.command.internal.completionAccepted',
                    (context: IActionContext, category?: string, source?: string) => {
                        context.telemetry.properties.completionCategory =
                            category && VALID_COMPLETION_CATEGORIES.has(category) ? category : 'unknown';
                        context.telemetry.properties.completionSource = source ?? 'unknown';
                    },
                );

                registerCommand('vscode-documentdb.command.clearSchemaCache', withCommandCorrelation(clearSchemaCache));

                registerCommand(
                    'vscode-documentdb.command.showSchemaStoreStats',
                    withCommandCorrelation(showSchemaStoreStats),
                );

                registerCommand('vscode-documentdb.command.showWorkerStats', withCommandCorrelation(showWorkerStats));

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
                    'vscode-documentdb.command.accessDataMigrationServices',
                    withTreeNodeCommandCorrelation(accessDataMigrationServices),
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
                    'vscode-documentdb.command.connectionsView.createSubfolder',
                    withTreeNodeCommandCorrelation(createSubfolder),
                );

                registerCommandWithTreeNodeUnwrappingAndModalErrors(
                    'vscode-documentdb.command.connectionsView.newConnectionInFolder',
                    withTreeNodeCommandCorrelation(newConnectionInFolder),
                );

                registerCommandWithTreeNodeUnwrapping(
                    'vscode-documentdb.command.connectionsView.renameFolder',
                    withTreeNodeCommandCorrelation(renameFolder),
                );

                registerCommandWithTreeNodeUnwrapping(
                    'vscode-documentdb.command.connectionsView.deleteFolder',
                    withTreeNodeCommandCorrelation(deleteFolder),
                );

                //// Move Operations:

                registerCommand(
                    'vscode-documentdb.command.connectionsView.moveItems',
                    withCommandCorrelation(moveItems),
                );

                registerCommandWithTreeNodeUnwrapping('vscode-documentdb.command.copyCollection', copyCollection);
                registerCommandWithTreeNodeUnwrapping('vscode-documentdb.command.pasteCollection', pasteCollection);

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
                registerDoubleClickCommand(
                    'vscode-documentdb.command.internal.containerView.openFromTree',
                    withCommandCorrelation(openCollectionViewInternal),
                    doubleClickDebounceDelay,
                );
                registerCommandWithTreeNodeUnwrapping(
                    'vscode-documentdb.command.containerView.open',
                    withTreeNodeCommandCorrelation(openCollectionView),
                );

                // Inline button variant — same handler, different activationSource
                registerCommandWithTreeNodeUnwrapping(
                    'vscode-documentdb.command.containerView.open.inline',
                    withTreeNodeCommandCorrelation((context, node) => {
                        context.telemetry.properties.activationSource = 'treeNodeInline';
                        return openCollectionView(context, node as CollectionItem);
                    }),
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
                    ShellCommandIds.open,
                    withTreeNodeCommandCorrelation(openInteractiveShell),
                );

                // Inline button variant — same handler, different activationSource
                registerCommandWithTreeNodeUnwrapping(
                    ShellCommandIds.openInline,
                    withTreeNodeCommandCorrelation((context, node) => {
                        context.telemetry.properties.activationSource = 'treeNodeInline';
                        return openInteractiveShell(context, node as ClusterItemBase | DatabaseItem | CollectionItem);
                    }),
                );

                registerCommand(ShellCommandIds.openWithInput, withCommandCorrelation(openInteractiveShellWithInput));

                // Register the terminal link provider for "Open in Collection View" action lines
                ext.context.subscriptions.push(
                    vscode.window.registerTerminalLinkProvider(new ShellTerminalLinkProvider()),
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
                    'vscode-documentdb.command.copyReference',
                    withTreeNodeCommandCorrelation(copyReference),
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
