/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { AuthMethodId } from '../../documentdb/auth/AuthMethodId';
import { ClustersClient } from '../../documentdb/ClustersClient';
import { ext } from '../../extensionVariables';

function formatEntraExpiry(expiresAt: string | undefined, now: number): string {
    if (expiresAt === undefined) {
        return '(not available)';
    }

    const remainingMs = Date.parse(expiresAt) - now;
    if (remainingMs <= 0) {
        return `${expiresAt} (expired)`;
    }

    const seconds = Math.ceil(remainingMs / 1000);
    const remaining = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
        .map((part) => String(part).padStart(2, '0'))
        .join(':');
    return `${expiresAt} (in ${remaining})`;
}

export function showConnectionStats(_context: IActionContext): void {
    const snapshot = ClustersClient.getDiagnosticsSnapshot();
    const now = Date.now();
    ext.outputChannel.appendLog('[Connection Stats]');
    ext.outputChannel.appendLog(`  Entries: ${String(snapshot.length)}`);
    ext.outputChannel.appendLog('  Source: Extension host');
    ext.outputChannel.appendLog(
        '  Socket counts: (not available); each cached client can own multiple sockets. For Shell and Playground, use Show Worker Stats.',
    );
    for (const [index, { client, pending, held, lastFailedStartupId }] of snapshot.entries()) {
        ext.outputChannel.appendLog(`  Connection ${String(index + 1)}:`);
        ext.outputChannel.appendLog(`    Client state: ${client?.state ?? '(not available)'}`);
        if (client) {
            ext.outputChannel.appendLog(`    Generation: ${String(client.generation)}`);
            ext.outputChannel.appendLog(`    Age (ms): ${String(client.ageMs)}`);
            ext.outputChannel.appendLog(`    Auth method: ${client.authMethod ?? '(not available)'}`);
            ext.outputChannel.appendLog(`    Startup ID: ${client.startupId ?? '(not available)'}`);
            ext.outputChannel.appendLog(`    Socket trace: ${String(client.socketTrace)}`);
        }
        if (client?.authMethod === AuthMethodId.MicrosoftEntraID) {
            ext.outputChannel.appendLog(
                `    Last Entra token expires at: ${formatEntraExpiry(client.lastEntraTokenExpiresAt, now)}`,
            );
        }
        if (pending) {
            ext.outputChannel.appendLog(`    Pending state: ${pending.superseded ? 'superseded' : 'current'}`);
            ext.outputChannel.appendLog(`    Pending startup ID: ${pending.startupId}`);
        }
        if (held) {
            ext.outputChannel.appendLog(`    Held reason: ${held}`);
        }
        if (lastFailedStartupId) {
            ext.outputChannel.appendLog(`    Last failed startup ID: ${lastFailedStartupId}`);
        }
    }
    ext.outputChannel.show();
}
