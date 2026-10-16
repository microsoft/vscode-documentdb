/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { getRegisteredShellTerminals } from '../../documentdb/shell/ShellTerminalLinkProvider';
import { ext } from '../../extensionVariables';
import { getPlaygroundEvaluators } from '../playground/executePlaygroundCode';

/**
 * Command handler: Show worker thread statistics in the output channel.
 * Displays all playground workers (one per cluster) and all active interactive shell sessions.
 */
export function showWorkerStats(_context: IActionContext): void {
    const log = (msg: string): void => ext.outputChannel.appendLog(msg);

    log('──────────────────────────────────────');
    log('[Worker Task Manager] Worker Stats');
    log('──────────────────────────────────────');

    // ── Playground Workers ───────────────────────────────────────────────
    log('');
    log('  Playground Workers:');

    const evaluators = getPlaygroundEvaluators();
    if (evaluators.size === 0) {
        log('    (no playground workers — no playground run yet)');
    } else {
        log(`    Active workers: ${String(evaluators.size)}`);
        for (const [clusterId, evaluator] of evaluators) {
            log(`    ─ Cluster: ${clusterId}`);
            log(`      Status: ${evaluator.isAlive ? 'alive' : 'not running'}`);
            log(`      Worker state: ${evaluator.workerState}`);
            log(`      Session ID: ${evaluator.sessionId ?? '(none)'}`);
            log(`      Eval count (session): ${String(evaluator.sessionEvalCount)}`);
            log(`      Auth method: ${evaluator.sessionAuthMethod ?? '(none)'}`);
            log(`      Last init duration: ${String(evaluator.lastInitDurationMs)}ms`);
        }
    }
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
            log(`      Cluster: ${info.clusterDisplayName} (${info.clusterId})`);
            log(`      Database: ${info.activeDatabase}`);
            log(`      Initialized: ${String(info.isInitialized)}`);
            log(`      Worker state: ${info.workerState}`);
            log(`      Evaluating: ${String(info.isEvaluating)}`);
            log(`      Auth method: ${info.authMethod ?? '(not yet initialized)'}`);
            log(`      Username: ${info.username ?? '(n/a)'}`);
        }
    }

    log('');
    log('──────────────────────────────────────');

    ext.outputChannel.show();
}
