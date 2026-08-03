/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type DockerFailureKind, type DockerStatusResult } from '../../../services/localQuickStart/quickStartTypes';

export const DOCKER_START_WAIT_DEADLINE_MS = 90_000;
const POLL_BACKOFF_MS: ReadonlyArray<number> = [1_000, 2_000, 3_000, 5_000];

export type DockerPollingOutcome = 'ready' | 'stopped' | 'deadline' | 'cancelled';

export interface DockerReadinessPollingOptions {
    readonly signal: AbortSignal;
    readonly query: (suppressCommandEcho: boolean) => Promise<DockerStatusResult>;
    readonly onResult: (result: DockerStatusResult) => void;
    readonly deadlineMs?: number;
    readonly now?: () => number;
    readonly wait?: (durationMs: number, signal: AbortSignal) => Promise<void>;
}

function waitFor(durationMs: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
        if (signal.aborted) {
            resolve();
            return;
        }
        const finish = (): void => {
            clearTimeout(timer);
            signal.removeEventListener('abort', finish);
            resolve();
        };
        const timer = setTimeout(finish, durationMs);
        signal.addEventListener('abort', finish, { once: true });
    });
}

function shouldContinuePolling(failureKind: DockerFailureKind | undefined): boolean {
    switch (failureKind) {
        case 'daemonUnavailable':
        case 'daemonStarting':
        case 'probeTimedOut':
        case 'unknown':
            return true;
        case 'cliMissing':
        case 'permissionDenied':
        case 'contextUnavailable':
        case 'endpointUnreachable':
        case 'unsupportedHost':
        case 'windowsContainers':
        case undefined:
            return false;
    }
}

export async function pollDockerReadiness(options: DockerReadinessPollingOptions): Promise<DockerPollingOutcome> {
    const now = options.now ?? Date.now;
    const wait = options.wait ?? waitFor;
    const deadlineMs = options.deadlineMs ?? DOCKER_START_WAIT_DEADLINE_MS;
    const startedAt = now();
    let attempt = 0;

    while (now() - startedAt < deadlineMs) {
        const remainingMs = deadlineMs - (now() - startedAt);
        const delayMs = Math.min(POLL_BACKOFF_MS[Math.min(attempt, POLL_BACKOFF_MS.length - 1)], remainingMs);
        await wait(delayMs, options.signal);
        if (options.signal.aborted) {
            return 'cancelled';
        }

        const result = await options.query(attempt > 0);
        if (options.signal.aborted) {
            return 'cancelled';
        }
        options.onResult(result);
        if (result.readiness.outcome === 'ready') {
            return 'ready';
        }
        if (!shouldContinuePolling(result.readiness.failureKind)) {
            return 'stopped';
        }
        attempt++;
    }

    return options.signal.aborted ? 'cancelled' : 'deadline';
}
