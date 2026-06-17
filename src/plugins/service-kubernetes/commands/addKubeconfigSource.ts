/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { UserCancelledError, type IActionContext, type IAzureQuickPickItem } from '@microsoft/vscode-azext-utils';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { ext } from '../../../extensionVariables';
import { DISCOVERY_PROVIDER_ID, type KubeconfigSourceRecord } from '../config';
import { describeDefaultKubeconfigPath, getContexts, loadKubeConfig, resolveKubeconfigPath } from '../kubernetesClient';
import { tryAddDefaultSource, tryAddFileSource, tryAddInlineSource } from '../sources/sourceStore';

type AddBranch = 'default' | 'file' | 'inline';

/**
 * Reports the result of an add-source attempt to the user.
 *
 * Mirrors the "Save to DocumentDB Connections" UX: when the source already
 * exists we don't pretend a new one was created. Instead we surface a modal
 * message explaining that the existing source was selected in the view (the
 * caller reveals + selects it via {@link revealAddedKubeconfigSource}), so the
 * user understands why no new node appeared. A genuinely new source still gets
 * the lightweight confirmation toast.
 */
function notifyKubeconfigSourceAdded(
    context: IActionContext,
    record: KubeconfigSourceRecord,
    created: boolean,
    alreadyExistsMessage: string,
): void {
    if (created) {
        context.telemetry.properties.kubeconfigSourceResult = 'added';
        void vscode.window.showInformationMessage(vscode.l10n.t('Added kubeconfig source "{0}".', record.label));
        ext.outputChannel.appendLine(vscode.l10n.t('Added kubeconfig source "{0}".', record.label));
        return;
    }

    context.telemetry.properties.kubeconfigSourceResult = 'duplicate';
    void vscode.window.showInformationMessage(alreadyExistsMessage, {
        modal: true,
        detail: vscode.l10n.t(
            'The existing source has been selected in the Services view.\n\nSelected source name:\n"{0}"',
            record.label,
        ),
    });
    ext.outputChannel.appendLine(
        vscode.l10n.t('Kubeconfig source "{0}" already exists; selected the existing one.', record.label),
    );
}

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

    let record: KubeconfigSourceRecord | undefined;
    if (branch === 'file') {
        record = await addFileBranch(context);
    } else if (branch === 'inline') {
        record = await addInlineBranch(context);
    } else {
        record = await addDefaultBranch(context);
    }

    if (record) {
        await revealAddedKubeconfigSource(record);
    }

    return record;
}

async function addDefaultBranch(context: IActionContext): Promise<KubeconfigSourceRecord | undefined> {
    const defaultPath = describeDefaultKubeconfigPath();

    // Validate before persisting; loadKubeConfig() with no arg uses the platform default.
    try {
        const kubeConfig = await loadKubeConfig();
        if (getContexts(kubeConfig).length === 0) {
            context.telemetry.properties.kubeconfigSourceResult = 'noContexts';
            void vscode.window.showErrorMessage(
                vscode.l10n.t(
                    'No Kubernetes contexts were found in your default kubeconfig ({0}). Fix the kubeconfig and try again.',
                    defaultPath,
                ),
                { modal: true },
            );
            throw new UserCancelledError();
        }
    } catch (error) {
        if (error instanceof UserCancelledError) {
            throw error;
        }

        const message = error instanceof Error ? error.message : String(error);
        const stack = error instanceof Error && error.stack ? error.stack : message;
        ext.outputChannel.error(`[KubernetesDiscovery] Default kubeconfig load/validate failed: ${stack}`);
        context.telemetry.properties.kubeconfigSourceResult = 'invalidDefault';
        void vscode.window.showErrorMessage(
            vscode.l10n.t(
                'Your default kubeconfig ({0}) could not be loaded: {1}. Fix the kubeconfig and try again.',
                defaultPath,
                message,
            ),
            { modal: true },
        );
        throw new UserCancelledError();
    }

    const { record, created } = await tryAddDefaultSource();
    notifyKubeconfigSourceAdded(context, record, created, vscode.l10n.t('A default kubeconfig source already exists.'));
    return record;
}

async function pickBranch(context: IActionContext): Promise<AddBranch | undefined> {
    const defaultPath = describeDefaultKubeconfigPath();
    const picks: IAzureQuickPickItem<AddBranch>[] = [
        {
            label: vscode.l10n.t('Default kubeconfig'),
            detail: vscode.l10n.t('Uses the KUBECONFIG environment variable, or {0}', defaultPath),
            iconPath: new vscode.ThemeIcon('home'),
            data: 'default',
        },
        {
            label: vscode.l10n.t('Kubeconfig file…'),
            detail: vscode.l10n.t('Browse for a kubeconfig YAML file on disk'),
            iconPath: new vscode.ThemeIcon('folder-opened'),
            data: 'file',
        },
        {
            label: vscode.l10n.t('Paste kubeconfig YAML…'),
            detail: vscode.l10n.t('Reads clipboard content and saves it as a kubeconfig source'),
            iconPath: new vscode.ThemeIcon('clippy'),
            data: 'inline',
        },
    ];

    try {
        const selected = await context.ui.showQuickPick(picks, {
            placeHolder: vscode.l10n.t('Select kubeconfig source'),
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
        defaultUri: getKubeconfigFileDialogDefaultUri(),
        title: vscode.l10n.t('Select kubeconfig file'),
        filters: {
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
                { modal: true },
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
        void vscode.window.showErrorMessage(vscode.l10n.t('Failed to load kubeconfig: {0}', message), { modal: true });
        throw new UserCancelledError();
    }

    const { record, created } = await tryAddFileSource(absolutePath);
    notifyKubeconfigSourceAdded(
        context,
        record,
        created,
        vscode.l10n.t('A kubeconfig source for this file already exists.'),
    );
    return record;
}

function getKubeconfigFileDialogDefaultUri(): vscode.Uri {
    const resolvedKubeconfigPath = resolveKubeconfigPath();
    if (fs.existsSync(resolvedKubeconfigPath)) {
        return vscode.Uri.file(resolvedKubeconfigPath);
    }

    const kubeconfigDirectory = path.dirname(resolvedKubeconfigPath);
    if (fs.existsSync(kubeconfigDirectory)) {
        return vscode.Uri.file(kubeconfigDirectory);
    }

    return vscode.Uri.file(os.homedir());
}

async function addInlineBranch(context: IActionContext): Promise<KubeconfigSourceRecord | undefined> {
    // Modal confirmation before reading the clipboard.
    const confirmLabel = vscode.l10n.t('Continue');
    const previewLabel = vscode.l10n.t('Preview Clipboard');
    const confirmation = await vscode.window.showWarningMessage(
        vscode.l10n.t(
            'The contents of your clipboard will be read and stored as a kubeconfig source in VS Code Secret Storage. Make sure you have the correct content copied before continuing.',
        ),
        { modal: true },
        confirmLabel,
        previewLabel,
    );

    if (confirmation === previewLabel) {
        // Open clipboard contents in an untitled editor for review without storing anything.
        const clipboardPreview = (await vscode.env.clipboard.readText()).trim();
        const doc = await vscode.workspace.openTextDocument({ content: clipboardPreview, language: 'yaml' });
        await vscode.window.showTextDocument(doc, { preview: true });
        context.telemetry.properties.kubeconfigSourceResult = 'previewed';
        throw new UserCancelledError();
    }

    if (confirmation !== confirmLabel) {
        throw new UserCancelledError();
    }

    const clipboardText = (await vscode.env.clipboard.readText()).trim();
    if (clipboardText.length === 0) {
        context.telemetry.properties.kubeconfigSourceResult = 'emptyClipboard';
        void vscode.window.showErrorMessage(
            vscode.l10n.t('Clipboard does not contain kubeconfig YAML. Copy it first and try again.'),
            { modal: true },
        );
        throw new UserCancelledError();
    }

    // Validate the YAML before persisting.
    try {
        const kubeConfig = await loadKubeConfig(undefined, clipboardText);
        if (getContexts(kubeConfig).length === 0) {
            context.telemetry.properties.kubeconfigSourceResult = 'noContexts';
            void vscode.window.showErrorMessage(
                vscode.l10n.t('No Kubernetes contexts were found in the pasted YAML.'),
                { modal: true },
            );
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
        void vscode.window.showErrorMessage(vscode.l10n.t('Failed to parse pasted kubeconfig YAML: {0}', message), {
            modal: true,
        });
        throw new UserCancelledError();
    }

    const { record, created } = await tryAddInlineSource(clipboardText);
    notifyKubeconfigSourceAdded(
        context,
        record,
        created,
        vscode.l10n.t('A kubeconfig source with identical YAML already exists.'),
    );
    return record;
}

async function revealAddedKubeconfigSource(record: KubeconfigSourceRecord): Promise<void> {
    const { refreshKubernetesRoot, revealKubernetesSource } = await import('./refreshKubernetesRoot');
    refreshKubernetesRoot();
    try {
        await revealKubernetesSource(record.id);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ext.outputChannel.warn(
            `[KubernetesDiscovery] Failed to reveal kubeconfig source "${record.label}": ${message}`,
        );
    }
}
