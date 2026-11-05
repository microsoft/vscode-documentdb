/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { UserCancelledError } from '@microsoft/vscode-azext-utils';
import { X509Certificate } from 'crypto';
import { readFile } from 'fs/promises';
import { isAbsolute } from 'path';
import * as vscode from 'vscode';
import { DocumentDBConnectionString } from '../../../documentdb/utils/DocumentDBConnectionString';
import { ext } from '../../../extensionVariables';
import { awsClusterSuffix, isAwsClusterConnectable } from '../models/AwsClusterModel';
import { type AwsCluster } from '../types';

const CA_PATHS_KEY = 'aws-documentdb-discovery.caPaths';

export async function validateAwsCertificate(path: string): Promise<void> {
    if (!isAbsolute(path)) {
        throw new Error(vscode.l10n.t('Select an absolute CA bundle path on the extension host.'));
    }
    const content = await readFile(path, 'utf8');
    const certificates = content.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g);
    if (!certificates?.length) {
        throw new Error(vscode.l10n.t('The selected file does not contain PEM certificates.'));
    }
    for (const certificate of certificates) {
        new X509Certificate(certificate);
    }
}

export async function selectAwsCertificate(resource: AwsCluster, replace = false): Promise<string> {
    const key = awsClusterSuffix(resource);
    const saved = ext.context.globalState.get<Record<string, string>>(CA_PATHS_KEY, {});
    if (saved[key] && !replace) {
        try {
            await validateAwsCertificate(saved[key]);
            return saved[key];
        } catch {
            ext.outputChannel.warn('The saved AWS CA bundle is unavailable or invalid; requesting a replacement.');
            await vscode.window.showWarningMessage(
                vscode.l10n.t('The saved AWS CA bundle is unavailable or invalid. Select a replacement file.'),
            );
        }
    }
    const selected = await vscode.window.showOpenDialog({
        title: vscode.l10n.t('Select the AWS CA bundle on the extension host'),
        canSelectMany: false,
        canSelectFiles: true,
        canSelectFolders: false,
        filters: { [vscode.l10n.t('PEM certificates')]: ['pem', 'crt'] },
    });
    if (!selected?.[0]) {
        throw new UserCancelledError();
    }
    const path = selected[0].fsPath;
    await validateAwsCertificate(path);
    const latest = ext.context.globalState.get<Record<string, string>>(CA_PATHS_KEY, {});
    await ext.context.globalState.update(CA_PATHS_KEY, { ...latest, [key]: path });
    return path;
}

export function buildAwsConnectionString(resource: AwsCluster, caPath: string): string {
    if (!isAwsClusterConnectable(resource)) {
        throw new Error(
            vscode.l10n.t('This AWS cluster is not available or has no endpoint. Refresh after it is ready.'),
        );
    }
    if (!resource.endpoint || !/^[a-zA-Z0-9.-]+$/.test(resource.endpoint)) {
        throw new Error(vscode.l10n.t('AWS returned an invalid cluster endpoint.'));
    }
    if (!Number.isInteger(resource.port) || resource.port < 1 || resource.port > 65535) {
        throw new Error(vscode.l10n.t('AWS returned an invalid cluster port.'));
    }
    const connection = new DocumentDBConnectionString(`mongodb://${resource.endpoint}:${resource.port}/`);
    connection.searchParams.set('authSource', 'admin');
    connection.searchParams.set('tls', 'true');
    connection.searchParams.set('tlsCAFile', caPath);
    connection.searchParams.set('replicaSet', 'rs0');
    connection.searchParams.set('readPreference', 'secondaryPreferred');
    connection.searchParams.set('retryWrites', 'false');
    return connection.toString();
}

export async function prepareAwsConnection(resource: AwsCluster): Promise<string> {
    if (!isAwsClusterConnectable(resource)) {
        throw new Error(vscode.l10n.t('This AWS cluster is not ready to connect. Refresh after it becomes available.'));
    }
    return buildAwsConnectionString(resource, await selectAwsCertificate(resource));
}
