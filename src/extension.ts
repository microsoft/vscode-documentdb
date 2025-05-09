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

export async function activateInternal(
    context: vscode.ExtensionContext,
    perfStats: { loadStartTime: number; loadEndTime: number },
): Promise<apiUtils.AzureExtensionApiProvider> {
    ext.context = context;
    ext.isBundle = !!process.env.IS_BUNDLE;

    // getAzureResourcesExtensionApi provides a way to get the Azure Resources extension's API V2
    // and is used to work with the tree view structure, as an improved alternative to the
    // AzureResourceGraph API V1 provided by the getResourceGroupsApi call above.
    // TreeElementStateManager is needed here too
    ext.state = new TreeElementStateManager();

    ext.outputChannel = createAzExtLogOutputChannel('DocumentDB VS Code Extension');
    context.subscriptions.push(ext.outputChannel);
    registerUIExtensionVariables(ext);
    registerAzureUtilsExtensionVariables(ext);

    if (vscode.l10n.uri) {
        l10n.config({
            contents: vscode.l10n.bundle ?? {},
        });
    }

    await callWithTelemetryAndErrorHandling('cosmosDB.activate', async (activateContext: IActionContext) => {
        activateContext.telemetry.properties.isActivationEvent = 'true';
        activateContext.telemetry.measurements.mainFileLoad = (perfStats.loadEndTime - perfStats.loadStartTime) / 1000;

        ext.secretStorage = context.secrets;

        // init and activate mongodb RU and vCore support (branch data provider, commands, ...)
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

    // TODO: we still don't know for sure if this is needed
    //  If it is, we need to implement the logic to get the correct API version
    return createApiProvider([
        <AzureExtensionApi>{
            findTreeItem: () => undefined,
            pickTreeItem: () => undefined,
            revealTreeItem: () => undefined,
            apiVersion: '1.2.0',
        },
    ]);
}

// this method is called when your extension is deactivated
export function deactivateInternal(_context: vscode.ExtensionContext): void {
    // NOOP
}
