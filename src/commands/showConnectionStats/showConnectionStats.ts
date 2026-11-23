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
        return 'unknown';
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
    ext.outputChannel.appendLog(`[Connection Stats] Extension-host cache entries: ${String(snapshot.length)}`);
    ext.outputChannel.appendLog(
        'Each cached client can own multiple sockets. Socket counts are not tracked here. For Shell and Playground, use Show Worker Stats.',
    );
    for (const [index, { client, pending, held, lastFailedStartupId }] of snapshot.entries()) {
        ext.outputChannel.appendLog(`  Connection ${String(index + 1)}:`);
        ext.outputChannel.appendLog(
            client
                ? `    Client: ${client.state} generation=${String(client.generation)} ageMs=${String(client.ageMs)} auth=${client.authMethod ?? 'unknown'} startup=${client.startupId ?? 'none'} socketTrace=${String(client.socketTrace)}`
                : '    Client: none',
        );
        if (client?.authMethod === AuthMethodId.MicrosoftEntraID) {
            ext.outputChannel.appendLog(
                `    lastEntraTokenExpiresAt=${formatEntraExpiry(client.lastEntraTokenExpiresAt, now)}`,
            );
        }
        if (pending) {
            ext.outputChannel.appendLog(
                `    Pending: ${pending.superseded ? 'superseded' : 'current'} startup=${pending.startupId}`,
            );
        }
        if (held) {
            ext.outputChannel.appendLog(`    Held: ${held}`);
        }
        if (lastFailedStartupId) {
            ext.outputChannel.appendLog(`    Last failed startup: ${lastFailedStartupId}`);
        }
    }
    ext.outputChannel.show();
}
