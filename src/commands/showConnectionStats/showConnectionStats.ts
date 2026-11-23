/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { ClustersClient } from '../../documentdb/ClustersClient';
import { ext } from '../../extensionVariables';

export function showConnectionStats(_context: IActionContext): void {
    const snapshot = ClustersClient.getDiagnosticsSnapshot();
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
