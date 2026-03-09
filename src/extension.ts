/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import { registerAzureUtilsExtensionVariables } from '@microsoft/vscode-azext-azureutils';
import {
    apiUtils,
    callWithTelemetryAndErrorHandling,
    createApiProvider,
    createAzExtLogOutputChannel,
    registerErrorHandler,
    registerUIExtensionVariables,
    TreeElementStateManager,
    type IActionContext,
} from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { ClustersExtension } from './documentdb/ClustersExtension';
import { ext } from './extensionVariables';
import { globalUriHandler } from './vscodeUriHandler';
// Import the DocumentDB Extension API interfaces
import { type AzureResourcesExtensionApi } from '@microsoft/vscode-azureresources-api';
import { type DocumentDBExtensionApi, type DocumentDBExtensionApiV030 } from '../api/src';
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

    // Report enabled experimental settings at launch
    void callWithTelemetryAndErrorHandling('experimentalFeaturesStatus', async (telemetryContext: IActionContext) => {
        telemetryContext.telemetry.properties.isActivationEvent = 'true';
        telemetryContext.errorHandling.suppressDisplay = true;
        telemetryContext.errorHandling.rethrow = false;

        const enableAIQueryGeneration = vscode.workspace
            .getConfiguration()
            .get<boolean>(ext.settingsKeys.enableAIQueryGeneration, false)
            .toString();

        telemetryContext.telemetry.properties.enableAIQueryGeneration = enableAIQueryGeneration;
    });

    // Create the DocumentDB Extension API v0.2.0
    const documentDBApiV2: DocumentDBExtensionApi = {
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

    // Create the DocumentDB Extension API v0.3.0
    const documentDBApiV3: DocumentDBExtensionApiV030 = {
        apiVersion: '0.3.0',
        migration: {
            registerProvider: (context: vscode.ExtensionContext, provider) => {
                const extensionId = context.extension.id;
                MigrationService.registerProviderWithContext(extensionId, provider);

                ext.outputChannel.appendLine(
                    vscode.l10n.t(
                        'API v0.3.0: Registered new migration provider: "{providerId}" - "{providerLabel}" from extension "{extensionId}"',
                        {
                            providerId: provider.id,
                            providerLabel: provider.label,
                            extensionId: extensionId,
                        },
                    ),
                );
            },
        },
    };

    // Return DocumentDB Extension API provider supporting multiple versions
    return {
        ...createApiProvider([documentDBApiV2, documentDBApiV3]),
    };
}

// this method is called when your extension is deactivated
export function deactivateInternal(_context: vscode.ExtensionContext): void {
    // NOOP
}

/**
 * Checks if DocumentDB and RU support is to be activated in this extension.
 * This introduces changes to the behavior of the extension.
 *
 * This function is used to determine whether the DocumentDB and RU features should be enabled in this extension.
 *
 * The result of this function depends on the version of the Azure Resources extension.
 * When a new version of the Azure Resources extension is released with the `AzureCosmosDbForMongoDbRu` and `MongoClusters`
 * resource types, this function will return true.
 *
 * @returns True if DocumentDB and RU features are enabled, false | undefined otherwise.
 */
export async function isVCoreAndRURolloutEnabled(): Promise<boolean | undefined> {
    return callWithTelemetryAndErrorHandling('isVCoreAndRURolloutEnabled', async (context: IActionContext) => {
        // Suppress error display and don't rethrow - this is feature detection that should fail gracefully
        context.errorHandling.suppressDisplay = true;
        context.errorHandling.rethrow = false;
        context.telemetry.properties.isActivationEvent = 'true';

        const azureResourcesExtensionApi = await apiUtils.getAzureExtensionApi<
            AzureResourcesExtensionApi & { isDocumentDbExtensionSupportEnabled: () => boolean }
        >(ext.context, 'ms-azuretools.vscode-azureresourcegroups', '3.0.0');

        // Check if the feature is enabled via the API function
        if (typeof azureResourcesExtensionApi.isDocumentDbExtensionSupportEnabled === 'function') {
            const isEnabled = azureResourcesExtensionApi.isDocumentDbExtensionSupportEnabled();
            context.telemetry.properties.vCoreAndRURolloutEnabled = String(isEnabled);
            context.telemetry.properties.apiMethodAvailable = 'true';
            return isEnabled;
        }

        // If the function doesn't exist, assume DISABLED
        context.telemetry.properties.vCoreAndRURolloutEnabled = 'false';
        context.telemetry.properties.apiMethodAvailable = 'false';
        ext.outputChannel.appendLog(
            'Expected Azure Resources API v3.0.0 is not available; DocumentDB and RU support remains inactive.',
        );
        return false;
    });
}
