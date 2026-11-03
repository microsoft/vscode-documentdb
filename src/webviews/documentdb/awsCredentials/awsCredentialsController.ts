/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { API } from '../../../DocumentDBExperiences';
import { ext } from '../../../extensionVariables';
import { awsDiscoveryService } from '../../../plugins/service-aws-documentdb/discovery/AwsDiscoveryService';
import { type AwsAuthMethod, type AwsCredentialRecord } from '../../../plugins/service-aws-documentdb/types';
import { openAppWebview } from '../../_integration/openAppWebview';
import { disposeAwsCredentialState, type AwsCredentialPanelState, type RouterContext } from './awsCredentialsRouter';

export interface AwsCredentialsWebviewConfig {
    readonly mode: 'add' | 'edit';
    readonly authMethod?: AwsAuthMethod;
    readonly label?: string;
    readonly regions?: string[];
    readonly profile?: string;
    readonly startUrl?: string;
    readonly ssoRegion?: string;
}

export interface OpenAwsCredentialsOptions {
    readonly credentialId?: string;
    readonly credential?: AwsCredentialRecord;
    readonly journeyCorrelationId?: string;
}

export async function openAwsCredentialsWebview(options: OpenAwsCredentialsOptions = {}): Promise<boolean> {
    const credential =
        options.credential ??
        (options.credentialId
            ? (await awsDiscoveryService.listCredentials()).find((record) => record.id === options.credentialId)
            : undefined);
    if (options.credentialId && (!credential || credential.id !== options.credentialId)) {
        throw new Error(
            vscode.l10n.t('This AWS credential no longer exists. Refresh the credential list and try again.'),
        );
    }
    return new Promise<boolean>((resolve) => {
        let settled = false;
        const state: AwsCredentialPanelState = {
            credentialsStored: false,
            submitting: false,
            ssoGeneration: 0,
            lifetime: new AbortController(),
            ssoFlows: new Set(),
        };
        const finish = (result: boolean): void => {
            if (!settled) {
                settled = true;
                resolve(result);
            }
        };
        const close = (): void => {
            finish(state.credentialsStored);
            disposeAwsCredentialState(state);
            setTimeout(() => controller.dispose(), 0);
        };
        const credentialId = options.credentialId ?? credential?.id;
        const context: RouterContext = {
            dbExperience: API.DocumentDB,
            webviewName: 'awsCredentials',
            credentialId,
            journeyCorrelationId: options.journeyCorrelationId,
            credentialState: state,
            onCredentialPersisted: () => finish(true),
            onCredentialsStored: close,
            onCancelled: close,
        };
        const controller = openAppWebview<AwsCredentialsWebviewConfig>({
            title: credentialId ? vscode.l10n.t('Update AWS Credentials') : vscode.l10n.t('Add an AWS Credential'),
            webviewName: 'awsCredentials',
            panelViewType: 'vscode-documentdb-aws-credentials',
            config: {
                mode: credentialId ? 'edit' : 'add',
                authMethod: credential?.authMethod,
                label: credential?.label,
                regions: credential?.regions,
                profile: credential?.profile,
                startUrl: credential?.startUrl,
                ssoRegion: credential?.ssoRegion,
            },
            context,
            icon: {
                light: vscode.Uri.joinPath(
                    ext.context.extensionUri,
                    'resources',
                    'icons',
                    'vscode-documentdb-icon-light-themes.svg',
                ),
                dark: vscode.Uri.joinPath(
                    ext.context.extensionUri,
                    'resources',
                    'icons',
                    'vscode-documentdb-icon-dark-themes.svg',
                ),
            },
        });
        controller.onDisposed(() => {
            disposeAwsCredentialState(state);
            finish(state.credentialsStored);
        });
    });
}
