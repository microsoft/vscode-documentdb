/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as os from 'os';
import * as vscode from 'vscode';
import { ext } from '../../extensionVariables';
import { DiscoveryService } from '../../services/discoveryServices';
import { MigrationService } from '../../services/migrationServices';

/**
 * Shows a modal About dialog with extension and environment details.
 */
export async function showAbout(context: IActionContext): Promise<void> {
    context.telemetry.properties.source = 'helpAndFeedbackView';

    const packageJSON = ext.context.extension.packageJSON as { version: string; displayName: string };

    const extensionVersion = packageJSON.version;
    const extensionName = packageJSON.displayName;
    const vscodeVersion = vscode.version;
    const nodeVersion = process.version;
    const osInfo = `${os.type()} ${os.arch()} ${os.release()}`;
    const extensionMode = (() => {
        switch (ext.context.extensionMode) {
            case vscode.ExtensionMode.Production:
                return vscode.l10n.t('Production');
            case vscode.ExtensionMode.Development:
                return vscode.l10n.t('Development');
            case vscode.ExtensionMode.Test:
            default:
                return vscode.l10n.t('Test');
        }
    })();

    // List registered migration providers
    const migrationProviders = MigrationService.listProviders();
    const migrationProviderNames =
        migrationProviders.length > 0
            ? '\n' + migrationProviders.map((p) => `  • ${p.label}`).join('\n')
            : `\n  • ${vscode.l10n.t('None')}`;

    // List registered discovery plugins
    const discoveryProviders = DiscoveryService.listProviders();
    const discoveryProviderNames =
        discoveryProviders.length > 0
            ? '\n' + discoveryProviders.map((p) => `  • ${p.label}`).join('\n')
            : `\n  • ${vscode.l10n.t('None')}`;

    const details = [
        vscode.l10n.t('{0}: v{1}', extensionName, extensionVersion),
        vscode.l10n.t('Mode: {0}', extensionMode),
        '',
        vscode.l10n.t('VS Code: v{0}', vscodeVersion),
        vscode.l10n.t('Node.js: {0}', nodeVersion),
        vscode.l10n.t('OS: {0}', osInfo),
        '',
        vscode.l10n.t('Migration Providers: {0}', migrationProviderNames),
        vscode.l10n.t('Discovery Plugins: {0}', discoveryProviderNames),
    ].join('\n');

    const copyAction = vscode.l10n.t('Copy');
    const result = await vscode.window.showInformationMessage(details, { modal: true }, copyAction);

    if (result === copyAction) {
        await vscode.env.clipboard.writeText(details);
    }
}
