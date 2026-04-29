/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { UserCancelledError, type IActionContext, type IAzureQuickPickItem } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { ext } from '../../../extensionVariables';
import { DISCOVERY_PROVIDER_ID, type KubeconfigSourceRecord } from '../config';
import { describeDefaultKubeconfigPath, getContexts, loadKubeConfig } from '../kubernetesClient';
import { addDefaultSource, addFileSource, addInlineSource } from '../sources/sourceStore';

type AddBranch = 'default' | 'file' | 'inline';

/**
 * Prompts the user to add a new kubeconfig source (file or pasted YAML).
 *
 * Validates the kubeconfig before persisting it; aborts cleanly if the user
 * cancels or the kubeconfig contains zero contexts.
 */
export async function addKubeconfigSource(context: IActionContext): Promise<KubeconfigSourceRecord | undefined> {
    context.telemetry.properties.discoveryProviderId = DISCOVERY_PROVIDER_ID;
    context.telemetry.properties.kubeconfigSourceAction = 'add';

    const branch = await pickBranch(context);
    if (branch === undefined) {
        throw new UserCancelledError();
    }

    if (branch === 'file') {
        return await addFileBranch(context);
    }

    if (branch === 'inline') {
        return await addInlineBranch(context);
    }

    return await addDefaultBranch(context);
}

async function addDefaultBranch(context: IActionContext): Promise<KubeconfigSourceRecord | undefined> {
    // Validate before persisting; loadKubeConfig() with no arg uses the platform default.
    try {
        const kubeConfig = await loadKubeConfig();
        if (getContexts(kubeConfig).length === 0) {
            context.telemetry.properties.kubeconfigSourceResult = 'noContexts';
            void vscode.window.showWarningMessage(
                vscode.l10n.t(
                    'No Kubernetes contexts were found in the default kubeconfig (KUBECONFIG env or ~/.kube/config). The source will still be added so you can wire it up later.',
                ),
            );
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const stack = error instanceof Error && error.stack ? error.stack : message;
        ext.outputChannel.error(`[KubernetesDiscovery] Default kubeconfig load/validate failed: ${stack}`);
        context.telemetry.properties.kubeconfigSourceResult = 'invalidDefault';
        void vscode.window.showWarningMessage(
            vscode.l10n.t(
                'Default kubeconfig could not be loaded: {0}. The source will still be added so you can fix the underlying file later.',
                message,
            ),
        );
    }

    const record = await addDefaultSource();
    context.telemetry.properties.kubeconfigSourceResult =
        context.telemetry.properties.kubeconfigSourceResult ?? 'added';
    void vscode.window.showInformationMessage(vscode.l10n.t('Added kubeconfig source "{0}".', record.label));
    ext.outputChannel.appendLine(vscode.l10n.t('Added kubeconfig source "{0}".', record.label));
    return record;
}

async function pickBranch(context: IActionContext): Promise<AddBranch | undefined> {
    const defaultPath = describeDefaultKubeconfigPath();
    const picks: IAzureQuickPickItem<AddBranch>[] = [
        {
            label: vscode.l10n.t('Default kubeconfig ({0})', defaultPath),
            description: vscode.l10n.t('Uses KUBECONFIG env var or {0}', defaultPath),
            data: 'default',
        },
        {
            label: vscode.l10n.t('Add custom kubeconfig file…'),
            description: vscode.l10n.t('Browse for a kubeconfig file on disk'),
            data: 'file',
        },
        {
            label: vscode.l10n.t('Paste kubeconfig YAML from clipboard'),
            description: vscode.l10n.t('Reads the current clipboard text and stores it in VS Code Secret Storage'),
            data: 'inline',
        },
    ];

    try {
        const selected = await context.ui.showQuickPick(picks, {
            placeHolder: vscode.l10n.t('Add a kubeconfig source'),
            suppressPersistence: true,
        });
        context.telemetry.properties.kubeconfigSourceKind = selected.data;
        return selected.data;
    } catch (error) {
        if (error instanceof UserCancelledError) {
            return undefined;
        }
        throw error;
    }
}

async function addFileBranch(context: IActionContext): Promise<KubeconfigSourceRecord | undefined> {
    const fileUri = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        title: vscode.l10n.t('Select kubeconfig file'),
        filters: {
            // eslint-disable-next-line @typescript-eslint/naming-convention
            'Kubeconfig files': ['yaml', 'yml', 'conf', 'config', '*'],
        },
    });

    if (!fileUri || fileUri.length === 0) {
        throw new UserCancelledError();
    }

    const absolutePath = fileUri[0].fsPath;

    // Validate before persisting.
    try {
        const kubeConfig = await loadKubeConfig(absolutePath);
        if (getContexts(kubeConfig).length === 0) {
            context.telemetry.properties.kubeconfigSourceResult = 'noContexts';
            void vscode.window.showErrorMessage(
                vscode.l10n.t('No Kubernetes contexts were found in "{0}".', absolutePath),
            );
            throw new UserCancelledError();
        }
    } catch (error) {
        if (error instanceof UserCancelledError) {
            throw error;
        }
        const message = error instanceof Error ? error.message : String(error);
        const stack = error instanceof Error && error.stack ? error.stack : message;
        ext.outputChannel.error(`[KubernetesDiscovery] File kubeconfig load/validate failed: ${stack}`);
        context.telemetry.properties.kubeconfigSourceResult = 'invalidFile';
        void vscode.window.showErrorMessage(vscode.l10n.t('Failed to load kubeconfig: {0}', message));
        throw new UserCancelledError();
    }

    const record = await addFileSource(absolutePath);
    context.telemetry.properties.kubeconfigSourceResult = 'added';
    void vscode.window.showInformationMessage(vscode.l10n.t('Added kubeconfig source "{0}".', record.label));
    ext.outputChannel.appendLine(vscode.l10n.t('Added kubeconfig source "{0}".', record.label));
    return record;
}

async function addInlineBranch(context: IActionContext): Promise<KubeconfigSourceRecord | undefined> {
    const clipboardText = (await vscode.env.clipboard.readText()).trim();
    if (clipboardText.length === 0) {
        context.telemetry.properties.kubeconfigSourceResult = 'emptyClipboard';
        void vscode.window.showWarningMessage(
            vscode.l10n.t('Clipboard does not contain kubeconfig YAML. Copy it first and try again.'),
        );
        throw new UserCancelledError();
    }

    // Validate the YAML before persisting.
    try {
        const kubeConfig = await loadKubeConfig(undefined, clipboardText);
        if (getContexts(kubeConfig).length === 0) {
            context.telemetry.properties.kubeconfigSourceResult = 'noContexts';
            void vscode.window.showErrorMessage(vscode.l10n.t('No Kubernetes contexts were found in the pasted YAML.'));
            throw new UserCancelledError();
        }
    } catch (error) {
        if (error instanceof UserCancelledError) {
            throw error;
        }
        const message = error instanceof Error ? error.message : String(error);
        const stack = error instanceof Error && error.stack ? error.stack : message;
        ext.outputChannel.error(`[KubernetesDiscovery] Inline kubeconfig load/validate failed: ${stack}`);
        context.telemetry.properties.kubeconfigSourceResult = 'invalidYaml';
        void vscode.window.showErrorMessage(vscode.l10n.t('Failed to parse pasted kubeconfig YAML: {0}', message));
        throw new UserCancelledError();
    }

    const record = await addInlineSource(clipboardText);
    context.telemetry.properties.kubeconfigSourceResult = 'added';
    void vscode.window.showInformationMessage(vscode.l10n.t('Added kubeconfig source "{0}".', record.label));
    ext.outputChannel.appendLine(vscode.l10n.t('Added kubeconfig source "{0}".', record.label));
    return record;
}
