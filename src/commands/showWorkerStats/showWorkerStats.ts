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
    const evaluators = getPlaygroundEvaluators();
    const shellTerminals = getRegisteredShellTerminals();

    log('[Worker Stats]');
    log(`  Shell sessions: ${String(shellTerminals.length)}`);
    log(`  Playground sessions: ${String(evaluators.size)}`);

    for (const [index, { terminal, info }] of shellTerminals.entries()) {
        log(`  Shell ${String(index + 1)}:`);
        log(`    Terminal: ${terminal.name}`);
        log(`    Cluster: ${info.clusterDisplayName}`);
        log(`    Cluster ID: ${info.clusterId}`);
        log(`    Database: ${info.activeDatabase || '(not available)'}`);
        log(`    Worker state: ${info.workerState}`);
        log(`    Initialized: ${String(info.isInitialized)}`);
        log(`    Evaluating: ${String(info.isEvaluating)}`);
        log(`    Auth method: ${info.authMethod ?? '(not available)'}`);
        log(`    Username: ${info.username ?? '(not available)'}`);
    }

    for (const [index, [clusterId, evaluator]] of Array.from(evaluators).entries()) {
        log(`  Playground ${String(index + 1)}:`);
        log(`    Cluster ID: ${clusterId}`);
        log(`    Worker alive: ${String(evaluator.isAlive)}`);
        log(`    Worker state: ${evaluator.workerState}`);
        log(`    Session ID: ${evaluator.sessionId ?? '(not available)'}`);
        log(`    Eval count (session): ${String(evaluator.sessionEvalCount)}`);
        log(`    Auth method: ${evaluator.sessionAuthMethod ?? '(not available)'}`);
        log(`    Last init duration (ms): ${String(evaluator.lastInitDurationMs)}`);
    }

    ext.outputChannel.show();
}
