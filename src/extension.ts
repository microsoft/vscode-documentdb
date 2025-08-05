/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import { registerAzureUtilsExtensionVariables } from '@microsoft/vscode-azext-azureutils';
import {
    callWithTelemetryAndErrorHandling,
    createApiProvider,
    createAzExtLogOutputChannel,
    registerErrorHandler,
    registerUIExtensionVariables,
    TreeElementStateManager,
    type apiUtils,
    type AzureExtensionApi,
    type IActionContext,
} from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { ClustersExtension } from './documentdb/ClustersExtension';
import { ext } from './extensionVariables';
import { globalUriHandler } from './vscodeUriHandler';
// Import the DocumentDB Extension API interfaces
import { type DocumentDBExtensionApi } from '../api/src';
import { MigrationService } from './services/migrationServices';

export async function activateInternal(
    context: vscode.ExtensionContext,
    perfStats: { loadStartTime: number; loadEndTime: number },
): Promise<apiUtils.AzureExtensionApiProvider | DocumentDBExtensionApi> {
    ext.context = context;
    ext.isBundle = !!process.env.IS_BUNDLE;

    // getAzureResourcesExtensionApi provides a way to get the Azure Resources extension's API V2
    // and is used to work with the tree view structure, as an improved alternative to the
    // AzureResourceGraph API V1 provided by the getResourceGroupsApi call above.
    // TreeElementStateManager is needed here too
    ext.state = new TreeElementStateManager();

    ext.outputChannel = createAzExtLogOutputChannel('DocumentDB for VS Code');
    context.subscriptions.push(ext.outputChannel);
    registerUIExtensionVariables(ext);
    registerAzureUtilsExtensionVariables(ext);

    if (vscode.l10n.uri) {
        l10n.config({
            contents: vscode.l10n.bundle ?? {},
        });
    }

    await callWithTelemetryAndErrorHandling('activate', async (activateContext: IActionContext) => {
        activateContext.telemetry.properties.isActivationEvent = 'true';
        activateContext.telemetry.measurements.mainFileLoad = (perfStats.loadEndTime - perfStats.loadStartTime) / 1000;

        ext.secretStorage = context.secrets;

        const clustersSupport: ClustersExtension = new ClustersExtension();
        context.subscriptions.push(clustersSupport); // to be disposed when extension is deactivated.
        await clustersSupport.activateClustersSupport();

        context.subscriptions.push(
            vscode.window.registerUriHandler({
                handleUri: globalUriHandler,
            }),
        );

        // Suppress "Report an Issue" button for all errors in favor of the command
        registerErrorHandler((c) => (c.errorHandling.suppressReportIssue = true));
        //registerReportIssueCommand('azureDatabases.reportIssue');
    });

    // Create the DocumentDB Extension API
    const documentDBApi: DocumentDBExtensionApi = {
        apiVersion: '0.2.0',
        migration: {
            registerProvider: (provider) => {
                MigrationService.registerProvider(provider);

                ext.outputChannel.appendLine(
                    vscode.l10n.t('API: Registered new migration provider: "{providerId}" - "{providerLabel}"', {
                        providerId: provider.id,
                        providerLabel: provider.label,
                    }),
                );
            },
        },
    };

    context.subscriptions.push(
        vscode.commands.registerCommand(
            'vscode-documentdb.command.internal.api.registerClientExtension',
            (clientExtensionId: string) => {
                try {
                    MigrationService.registerClientExtension(clientExtensionId);
                    return true;
                } catch (error) {
                    console.error('Failed to register client:', error);
                    return false;
                }
            },
        ),
    );

    // Return both the DocumentDB API and Azure Extension API
    return {
        ...documentDBApi,
        ...createApiProvider([
            <AzureExtensionApi>{
                findTreeItem: () => undefined,
                pickTreeItem: () => undefined,
                revealTreeItem: () => undefined,
                apiVersion: '1.2.0',
            },
        ]),
    };
}

// this method is called when your extension is deactivated
export function deactivateInternal(_context: vscode.ExtensionContext): void {
    // NOOP
}
