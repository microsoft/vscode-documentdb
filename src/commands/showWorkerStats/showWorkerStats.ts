/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { PlaygroundService } from '../../documentdb/playground/PlaygroundService';
import { getRegisteredShellTerminals } from '../../documentdb/shell/ShellTerminalLinkProvider';
import { ext } from '../../extensionVariables';
import { getPlaygroundEvaluator } from '../playground/executePlaygroundCode';

/**
 * Command handler: Show worker thread statistics in the output channel.
 * Displays playground worker state and all active interactive shell sessions.
 */
export function showWorkerStats(_context: IActionContext): void {
    const log = (msg: string): void => ext.outputChannel.appendLog(msg);

    log('──────────────────────────────────────');
    log('[Worker Task Manager] Worker Stats');
    log('──────────────────────────────────────');

    // ── Playground Worker ────────────────────────────────────────────────
    log('');
    log('  Playground Worker:');

    const evaluator = getPlaygroundEvaluator();
    if (!evaluator) {
        log('    Status: not created (no playground run yet)');
    } else {
        log(`    Status: ${evaluator.isAlive ? 'alive' : 'not running'}`);
        log(`    Worker state: ${evaluator.workerState}`);
        log(`    Cluster ID: ${evaluator.workerClusterId ?? '(none)'}`);
        log(`    Session ID: ${evaluator.sessionId ?? '(none)'}`);
        log(`    Eval count (session): ${String(evaluator.sessionEvalCount)}`);
        log(`    Auth method: ${evaluator.sessionAuthMethod ?? '(none)'}`);
        log(`    Last init duration: ${String(evaluator.lastInitDurationMs)}ms`);
    }

    const playgroundService = PlaygroundService.getInstance();
    log(`    Playground connected: ${String(playgroundService.isConnected())}`);
    log(`    Playground executing: ${String(playgroundService.isExecuting)}`);

    // ── Interactive Shell Workers ────────────────────────────────────────
    log('');
    log('  Interactive Shell Workers:');

    const shellTerminals = getRegisteredShellTerminals();
    if (shellTerminals.length === 0) {
        log('    (no active shell sessions)');
    } else {
        log(`    Active sessions: ${String(shellTerminals.length)}`);
        for (const { terminal, info } of shellTerminals) {
            log(`    ─ Terminal: "${terminal.name}"`);
            log(`      Cluster ID: ${info.clusterId}`);
        }
    }

    log('');
    log('──────────────────────────────────────');

    ext.outputChannel.show();
}
