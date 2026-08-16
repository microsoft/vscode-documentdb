/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The PR #867 harness scenarios, expressed as **typed** fixtures.
 *
 * #867 declared these states as untyped object literals inside a hand-written
 * HTML page, and named the risk against itself: fixtures drift into describing
 * states the product can no longer produce. This file is the structural fix —
 * the same states, checked against the production router at compile time.
 *
 * Two of #867's original fixtures would **not** compile today, which is the
 * point rather than a footnote:
 *
 *   * `message` was a plain English sentence (`'Docker CLI was not found…'`).
 *     It is now a {@link QuickStartMessage} — a localization key plus data — so
 *     the harness would have kept rendering hard-coded English that the product
 *     had stopped emitting.
 *   * `StageEvent` never had the `error` field those fixtures set, and
 *     `status.state` moved from a bare string to {@link InstanceState}.
 *
 * None of that is detectable by reading the harness, and none of it makes a
 * screenshot look wrong. It is only caught by typing the fixtures.
 */

import { createFakeTransport, type Scenario } from '@microsoft/vscode-ext-webview/testing';
import { connectTrpc, type VsCodeLinkResponseMessage } from '@microsoft/vscode-ext-webview/webview';
import {
    type DockerDiagnosedReadiness,
    InstanceState,
    QUICK_START_PORT,
} from '../../../services/localQuickStart/quickStartTypes';
import { type AppRouter } from '../../_integration/appRouter';

type MessageListener = (event: MessageEvent) => void;
const messageListeners = new Set<MessageListener>();

function deliver(message: VsCodeLinkResponseMessage): void {
    for (const listener of [...messageListeners]) {
        listener({ data: message } as MessageEvent);
    }
}

beforeEach(() => {
    messageListeners.clear();
    Object.assign(globalThis, {
        window: {
            addEventListener: (type: string, listener: MessageListener) => {
                if (type === 'message') {
                    messageListeners.add(listener);
                }
            },
            removeEventListener: (_type: string, listener: MessageListener) => {
                messageListeners.delete(listener);
            },
        },
    });
});

afterEach(() => {
    messageListeners.clear();
    Reflect.deleteProperty(globalThis, 'window');
});

/** #867's `docker-missing-windows`: Windows host with no Docker CLI on PATH. */
const cliMissingWindows: DockerDiagnosedReadiness = {
    outcome: 'diagnosed',
    environment: 'windows',
    endpointKind: 'namedPipe',
    provider: 'unknown',
    providerEvidence: 'none',
    executionTarget: 'local',
    failureKind: 'cliMissing',
    canContinueAnyway: false,
    checkedAtMs: 1,
    cliInstalled: false,
    daemonReachable: false,
};

function connect(scenario: Scenario<AppRouter>) {
    const transport = createFakeTransport<AppRouter>({ scenario, deliver });
    const { client } = connectTrpc<AppRouter>(transport);
    return { transport, client };
}

describe('Local Quick Start harness scenarios (typed)', () => {
    it('reaches the "Docker missing" state with no Docker, no daemon and no container', async () => {
        const { client } = connect({
            'localQuickStart.getDockerStatus': {
                result: {
                    readiness: cliMissingWindows,
                    status: { state: InstanceState.NotInstalled },
                    busy: false,
                    canReuseExistingData: false,
                    suggestedPort: QUICK_START_PORT,
                },
            },
        });

        const status = await client.localQuickStart.getDockerStatus.query();

        expect(status.readiness.outcome).toBe('diagnosed');
        expect(status.readiness).toMatchObject({ failureKind: 'cliMissing', cliInstalled: false });
    });

    it('streams the full provisioning sequence to a successful finish', async () => {
        // #867's `success` scenario. Each event is one subscription message, and the
        // stream is closed by the transport exactly as the host closes it.
        const { client } = connect({
            'localQuickStart.startQuickStart': {
                stream: [
                    { stage: 'checking', status: 'done' },
                    { stage: 'pulling', status: 'done' },
                    { stage: 'creating', status: 'done' },
                    { stage: 'starting', status: 'done' },
                    { stage: 'waiting', status: 'done', boundPort: QUICK_START_PORT },
                ],
            },
        });

        const seen: string[] = [];
        await new Promise<void>((resolve, reject) => {
            client.localQuickStart.startQuickStart.subscribe(
                {},
                {
                    onData: (event) => seen.push(`${event.stage}:${event.status}`),
                    onComplete: () => resolve(),
                    onError: (error) => reject(new Error(error.message)),
                },
            );
        });

        expect(seen).toEqual(['checking:done', 'pulling:done', 'creating:done', 'starting:done', 'waiting:done']);
    });

    it('reaches the "port already in use" failure without binding a port', async () => {
        // #867's `failed-port-in-use`. Against a real daemon this needs a genuinely
        // occupied socket; here it is one fixture, and the message is a localization
        // key rather than the English sentence the original fixture hard-coded.
        const { client } = connect({
            'localQuickStart.startQuickStart': {
                stream: [{ stage: 'checking', status: 'error', message: { key: 'portInUse', port: 12345 } }],
            },
        });

        const seen: { stage: string; status: string; key?: string }[] = [];
        await new Promise<void>((resolve, reject) => {
            client.localQuickStart.startQuickStart.subscribe(
                {},
                {
                    onData: (event) => seen.push({ stage: event.stage, status: event.status, key: event.message?.key }),
                    onComplete: () => resolve(),
                    onError: (error) => reject(new Error(error.message)),
                },
            );
        });

        expect(seen).toEqual([{ stage: 'checking', status: 'error', key: 'portInUse' }]);
    });

    it('reaches the readiness-timeout state, which leaves the container running', async () => {
        // #867's `failed-timeout`. `timedOut` is what makes the panel offer
        // "Wait longer" instead of a hard failure - an edge state that is
        // essentially unreachable on demand against a real backend.
        const { client } = connect({
            'localQuickStart.startQuickStart': {
                stream: [
                    { stage: 'checking', status: 'done' },
                    {
                        stage: 'waiting',
                        status: 'error',
                        timedOut: true,
                        message: { key: 'readinessTimeout', environment: 'windows' },
                    },
                ],
            },
        });

        const terminal: { timedOut?: boolean; key?: string }[] = [];
        await new Promise<void>((resolve, reject) => {
            client.localQuickStart.startQuickStart.subscribe(
                {},
                {
                    onData: (event) => {
                        if (event.status === 'error') {
                            terminal.push({ timedOut: event.timedOut, key: event.message?.key });
                        }
                    },
                    onComplete: () => resolve(),
                    onError: (error) => reject(new Error(error.message)),
                },
            );
        });

        expect(terminal).toEqual([{ timedOut: true, key: 'readinessTimeout' }]);
    });

    it('records the install-button call without leaving the page', async () => {
        // The #867 assertion that motivated `window.__harnessCalls`: the Windows
        // install button opens the Docker Desktop page. Asserted at the boundary
        // the UI tries to cross, rather than by watching for a navigation.
        const { transport, client } = connect({ 'common.openUrl': { result: true } });

        await client.common.openUrl.mutate({ url: 'https://www.docker.com/products/docker-desktop/' });

        expect(transport.callsTo('common.openUrl')).toEqual([
            {
                path: 'common.openUrl',
                type: 'mutation',
                input: { url: 'https://www.docker.com/products/docker-desktop/' },
            },
        ]);
    });
});
