/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type Check, type CheckOutcome, type RunContext } from '@documentdb-js/connection-diagnostics';
// eslint-disable-next-line import/no-internal-modules -- Package metadata is a public entry point, not a driver implementation module.
import driverMetadata from 'mongodb/package.json' with { type: 'json' };
import { prerelease } from 'semver';
import * as vscode from 'vscode';
import { describeEntraSignInEnvironment } from '../../documentdb/auth/documentdbTokenResource';
import { getSrvFallbackMode } from '../../documentdb/srv/prepareDriverConnectionString';
import { ext } from '../../extensionVariables';
import { detectDockerHostEnvironment } from '../../services/localQuickStart/DockerReadinessService';
import { type FindingCode } from '../types';

export type DiagnosticsRemoteKind = 'local' | 'wsl' | 'ssh' | 'devContainer' | 'codespaces' | 'otherRemote';

export function getDiagnosticsRemoteKind(): DiagnosticsRemoteKind {
    const environment = detectDockerHostEnvironment(process.platform, vscode.env.remoteName, process.env);
    switch (environment) {
        case 'wsl':
        case 'ssh':
        case 'devContainer':
        case 'codespaces':
        case 'otherRemote':
            return environment;
        default:
            return 'local';
    }
}

interface ExtensionMetadata {
    readonly extensionVersion: string;
    readonly extensionChannel: 'stable' | 'preRelease' | 'dev';
}

export function getExtensionMetadata(): ExtensionMetadata {
    const metadata: unknown = ext.context.extension.packageJSON;
    const version =
        typeof metadata === 'object' &&
        metadata !== null &&
        'version' in metadata &&
        typeof metadata.version === 'string'
            ? metadata.version
            : 'unknown';
    const preview =
        typeof metadata === 'object' && metadata !== null && 'preview' in metadata && metadata.preview === true;
    if (ext.context.extensionMode === vscode.ExtensionMode.Development) {
        return { extensionVersion: version, extensionChannel: 'dev' };
    }
    return {
        extensionVersion: version,
        extensionChannel: preview || prerelease(version) !== null ? 'preRelease' : 'stable',
    };
}

function driverVersion(): string {
    const metadata: unknown = driverMetadata;
    return typeof metadata === 'object' &&
        metadata !== null &&
        'version' in metadata &&
        typeof metadata.version === 'string'
        ? metadata.version
        : 'unknown';
}

export function createExtensionEnvironmentCheck(): Check<RunContext, FindingCode> {
    return {
        id: 'extensionEnvironment',
        scope: 'run',
        async run(): Promise<CheckOutcome<FindingCode>> {
            const remoteKind = getDiagnosticsRemoteKind();
            const proxy = vscode.workspace.getConfiguration('http').get<unknown>('proxy');
            return {
                status: 'pass',
                facts: {
                    ...getExtensionMetadata(),
                    vscodeVersion: vscode.version,
                    electronVersion: process.versions.electron ?? null,
                    remoteKind,
                    driverVersion: driverVersion(),
                    srvFallbackMode: getSrvFallbackMode(),
                    vscodeProxyConfigured: typeof proxy === 'string' && proxy.trim().length > 0,
                    entraSignInEnvironment: describeEntraSignInEnvironment(),
                },
                findings:
                    remoteKind === 'local'
                        ? []
                        : [
                              {
                                  code: 'env.remoteExtensionHost',
                                  severity: 'info',
                                  data: { remoteKind },
                                  detail: {
                                      language: 'en',
                                      text: `Database checks run on the remote extension host (${remoteKind}), not on the local computer.`,
                                  },
                              },
                          ],
            };
        },
    };
}
