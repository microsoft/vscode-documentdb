/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    type DockerDiagnosedReadiness,
    type DockerReadiness,
    type DockerReadyReadiness,
    type DockerStatusResult,
    InstanceState,
} from '../../../services/localQuickStart/quickStartTypes';
import { pollDockerReadiness } from './dockerReadinessPolling';

function status(readiness: DockerReadiness): DockerStatusResult {
    return {
        readiness,
        status: { state: InstanceState.NotInstalled },
        busy: false,
        willReuse: false,
    };
}

function waitingReadiness(): DockerDiagnosedReadiness {
    return {
        outcome: 'diagnosed',
        environment: 'windows',
        endpointKind: 'namedPipe',
        provider: 'dockerDesktop',
        providerEvidence: 'installedApplication',
        executionTarget: 'local',
        failureKind: 'daemonUnavailable',
        canContinueAnyway: false,
        checkedAtMs: 1,
        cliInstalled: true,
        daemonReachable: false,
    };
}

function readyReadiness(): DockerReadyReadiness {
    return {
        ...waitingReadiness(),
        outcome: 'ready',
        failureKind: undefined,
        canContinueAnyway: false,
        daemonReachable: true,
    };
}

describe('pollDockerReadiness', () => {
    it('runs sequential probes with backoff and suppresses echoes after the first poll', async () => {
        const suppressions: boolean[] = [];
        let concurrent = 0;
        let maxConcurrent = 0;
        const query = jest.fn(async (suppressCommandEcho: boolean): Promise<DockerStatusResult> => {
            suppressions.push(suppressCommandEcho);
            concurrent++;
            maxConcurrent = Math.max(maxConcurrent, concurrent);
            const result = query.mock.calls.length === 1 ? status(waitingReadiness()) : status(readyReadiness());
            concurrent--;
            return result;
        });

        await expect(
            pollDockerReadiness({
                signal: new AbortController().signal,
                query,
                onResult: jest.fn(),
                wait: async () => undefined,
            }),
        ).resolves.toBe('ready');
        expect(suppressions).toEqual([false, true]);
        expect(maxConcurrent).toBe(1);
    });

    it('stops without another probe when cancelled during backoff', async () => {
        const controller = new AbortController();
        const query = jest.fn();

        await expect(
            pollDockerReadiness({
                signal: controller.signal,
                query,
                onResult: jest.fn(),
                wait: async () => controller.abort(),
            }),
        ).resolves.toBe('cancelled');
        expect(query).not.toHaveBeenCalled();
    });

    it('drops a result when cancellation occurs during an active query', async () => {
        const controller = new AbortController();
        const onResult = jest.fn();

        await expect(
            pollDockerReadiness({
                signal: controller.signal,
                query: async () => {
                    controller.abort();
                    return status(readyReadiness());
                },
                onResult,
                wait: async () => undefined,
            }),
        ).resolves.toBe('cancelled');
        expect(onResult).not.toHaveBeenCalled();
    });

    it('stops polling when a diagnosed non-transient failure appears', async () => {
        const permissionDenied: DockerReadiness = {
            ...waitingReadiness(),
            failureKind: 'permissionDenied',
        };

        await expect(
            pollDockerReadiness({
                signal: new AbortController().signal,
                query: async () => status(permissionDenied),
                onResult: jest.fn(),
                wait: async () => undefined,
            }),
        ).resolves.toBe('stopped');
    });

    it('ends at the shared wait deadline', async () => {
        let now = 0;
        const query = jest.fn(async () => status(waitingReadiness()));

        await expect(
            pollDockerReadiness({
                signal: new AbortController().signal,
                query,
                onResult: jest.fn(),
                deadlineMs: 2_500,
                now: () => now,
                wait: async (durationMs) => {
                    now += durationMs;
                },
            }),
        ).resolves.toBe('deadline');
        expect(query).toHaveBeenCalledTimes(2);
    });
});