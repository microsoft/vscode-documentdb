/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { UserCancelledError, type IActionContext } from '@microsoft/vscode-azext-utils';
import { randomUUID } from 'crypto';
import * as vscode from 'vscode';
import { Views } from '../../../documentdb/Views';
import { ext } from '../../../extensionVariables';
import { type TreeElement } from '../../../tree/TreeElement';
import { openAwsCredentialsWebview } from '../../../webviews/documentdb/awsCredentials/awsCredentialsController';
import { errorName } from '../auth/errors';
import { AWS_DISCOVERY_PROVIDER_ID } from '../config';
import { awsDiscoveryService } from '../discovery/AwsDiscoveryService';
import { type AwsCredentialRecord } from '../types';

interface CredentialChoice extends vscode.QuickPickItem {
    readonly credential?: AwsCredentialRecord;
    readonly action?: 'add' | 'exit';
}

interface ActionChoice extends vscode.QuickPickItem {
    readonly action: 'update' | 'reauthenticate' | 'retry' | 'remove' | 'back' | 'exit';
}

function refreshDiscoveryTree(node?: TreeElement): void {
    const nodeId = node?.id ?? `${Views.DiscoveryView}/${AWS_DISCOVERY_PROVIDER_ID}`;
    ext.discoveryBranchDataProvider.resetNodeErrorState(nodeId);
    if (node) {
        ext.discoveryBranchDataProvider.refresh(node);
    } else {
        ext.discoveryBranchDataProvider.refresh();
    }
}

function correlationId(context: IActionContext): string {
    const existing = context.telemetry.properties.journeyCorrelationId;
    const id = typeof existing === 'string' ? existing : randomUUID();
    context.telemetry.properties.journeyCorrelationId = id;
    return id;
}

export async function addAwsCredential(context: IActionContext, node?: TreeElement): Promise<boolean> {
    const stored = await openAwsCredentialsWebview({ journeyCorrelationId: correlationId(context) });
    if (stored) {
        refreshDiscoveryTree(node);
    }
    return stored;
}

export async function configureAwsCredentials(context: IActionContext, node?: TreeElement): Promise<boolean> {
    const journeyCorrelationId = correlationId(context);
    let changed = false;
    try {
        while (true) {
            const credentials = await awsDiscoveryService.listCredentials();
            const choices: CredentialChoice[] = [
                ...credentials.map(
                    (credential): CredentialChoice => ({
                        label: credential.label,
                        description: credential.accountId,
                        detail: `${credential.authMethod} · ${credential.regions.join(', ')}`,
                        iconPath: new vscode.ThemeIcon('key'),
                        credential,
                    }),
                ),
                { label: vscode.l10n.t('Add a credential…'), iconPath: new vscode.ThemeIcon('add'), action: 'add' },
                { label: vscode.l10n.t('Exit'), iconPath: new vscode.ThemeIcon('close'), action: 'exit' },
            ];
            const selection = await context.ui.showQuickPick(choices, {
                stepName: 'selectAwsCredential',
                placeHolder: vscode.l10n.t('AWS credentials used for service discovery'),
                matchOnDescription: true,
                suppressPersistence: true,
            });
            if (selection.action === 'exit') {
                return changed;
            }
            if (selection.action === 'add') {
                if (await addAwsCredential(context, node)) {
                    return true;
                }
                continue;
            }
            const credential = selection.credential;
            if (!credential) {
                continue;
            }
            const actions: ActionChoice[] = [
                {
                    label: vscode.l10n.t('Retry'),
                    detail: vscode.l10n.t(
                        'Refresh discovery for this entry after changing AWS permissions or renewing a profile session.',
                    ),
                    iconPath: new vscode.ThemeIcon('refresh'),
                    action: 'retry',
                },
                {
                    label: vscode.l10n.t('Update credentials…'),
                    detail: vscode.l10n.t(
                        'Update the credential and its regions. The previous credential is kept unless verification succeeds.',
                    ),
                    iconPath: new vscode.ThemeIcon('key'),
                    action: 'update',
                },
                {
                    label: vscode.l10n.t('Sign in again…'),
                    detail: vscode.l10n.t(
                        'Reauthenticate this entry, including browser sign-in or profile MFA when needed.',
                    ),
                    iconPath: new vscode.ThemeIcon('sign-in'),
                    action: 'reauthenticate',
                },
                {
                    label: vscode.l10n.t('Remove credential'),
                    detail: vscode.l10n.t(
                        'Remove this entry locally. Saved database connections and AWS-side credentials are not deleted.',
                    ),
                    iconPath: new vscode.ThemeIcon('trash'),
                    action: 'remove',
                },
                { label: vscode.l10n.t('Back'), iconPath: new vscode.ThemeIcon('arrow-left'), action: 'back' },
                { label: vscode.l10n.t('Exit'), iconPath: new vscode.ThemeIcon('close'), action: 'exit' },
            ];
            const selectionAction = await context.ui.showQuickPick(actions, {
                stepName: 'awsCredentialAction',
                placeHolder: vscode.l10n.t('Manage {0}', credential.label),
                suppressPersistence: true,
            });
            context.telemetry.properties.awsCredentialAction = selectionAction.action;
            switch (selectionAction.action) {
                case 'exit':
                    return changed;
                case 'back':
                    continue;
                case 'update':
                case 'reauthenticate':
                    if (
                        await openAwsCredentialsWebview({
                            credentialId: credential.id,
                            credential,
                            journeyCorrelationId,
                        })
                    ) {
                        changed = true;
                        refreshDiscoveryTree(node);
                    }
                    break;
                case 'retry': {
                    const snapshot = await vscode.window.withProgress(
                        {
                            location: vscode.ProgressLocation.Notification,
                            title: vscode.l10n.t('Retrying {0}…', credential.label),
                        },
                        async () => awsDiscoveryService.retryCredentialDiscovery(credential.id),
                    );
                    changed = true;
                    const failures = snapshot.errors.filter((error) => error.credentialId === credential.id);
                    if (failures.length > 0) {
                        await vscode.window.showWarningMessage(
                            vscode.l10n.t('AWS discovery still needs attention: {0}', failures[0].message),
                        );
                    } else {
                        await vscode.window.showInformationMessage(
                            vscode.l10n.t('AWS discovery refreshed for {0}.', credential.label),
                        );
                    }
                    refreshDiscoveryTree(node);
                    break;
                }
                case 'remove': {
                    const remove = vscode.l10n.t('Remove');
                    const confirmation = await vscode.window.showWarningMessage(
                        vscode.l10n.t('Are you sure?'),
                        {
                            modal: true,
                            detail: vscode.l10n.t(
                                'Remove {0} from VS Code? This does not revoke AWS access or remove saved database connections.',
                                credential.label,
                            ),
                        },
                        remove,
                    );
                    if (confirmation === remove) {
                        await awsDiscoveryService.removeCredential(credential.id);
                        changed = true;
                        refreshDiscoveryTree(node);
                    }
                    break;
                }
            }
        }
    } catch (error) {
        if (!(error instanceof UserCancelledError) && errorName(error) !== 'AbortError') {
            throw error;
        }
        return changed;
    }
}
