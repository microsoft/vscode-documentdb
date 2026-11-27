/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { beforeEach, expect, it, vi } from 'vitest';
import { PlaygroundEvaluator } from '../../documentdb/playground/PlaygroundEvaluator';
import { getRegisteredShellTerminals } from '../../documentdb/shell/ShellTerminalLinkProvider';
import { ext } from '../../extensionVariables';
import { getPlaygroundEvaluators } from '../playground/executePlaygroundCode';
import { showWorkerStats } from './showWorkerStats';

vi.mock('../../documentdb/shell/ShellTerminalLinkProvider', () => ({
    getRegisteredShellTerminals: vi.fn(),
}));

vi.mock('../playground/executePlaygroundCode', () => ({
    getPlaygroundEvaluators: vi.fn(),
}));

vi.mock('../../documentdb/playground/WorkerSessionManager', () => ({
    WorkerSessionManager: vi.fn().mockImplementation(function () {
        return {
            get workerState(): string {
                return 'idle';
            },
            get isAlive(): boolean {
                return false;
            },
            get workerClusterId(): string | undefined {
                return undefined;
            },
        };
    }),
}));

vi.mock('../../extensionVariables', () => ({
    ext: { outputChannel: { appendLog: vi.fn(), show: vi.fn() } },
}));

beforeEach(() => {
    vi.mocked(getRegisteredShellTerminals).mockReset();
    vi.mocked(getPlaygroundEvaluators).mockReset();
    vi.mocked(ext.outputChannel.appendLog).mockReset();
    vi.mocked(ext.outputChannel.show).mockReset();
    vi.mocked(getRegisteredShellTerminals).mockReturnValue([]);
    vi.mocked(getPlaygroundEvaluators).mockReturnValue(new Map());
});

it('prints explicit zero counts and shared record headings', (): void => {
    showWorkerStats({} as IActionContext);

    const output = vi.mocked(ext.outputChannel.appendLog).mock.calls.map(([line]) => line);
    expect(output).toEqual(['[Worker Stats]', '  Shell sessions: 0', '  Playground sessions: 0']);
});

it('distinguishes shell and playground worker state from missing session values', (): void => {
    vi.mocked(getRegisteredShellTerminals).mockReturnValueOnce([
        {
            terminal: { name: 'DocumentDB Shell' } as ReturnType<typeof getRegisteredShellTerminals>[number]['terminal'],
            info: {
                clusterId: 'shell-cluster',
                clusterDisplayName: 'Shell Cluster',
                activeDatabase: 'test',
                isInitialized: false,
                isEvaluating: false,
                workerState: 'spawning',
                authMethod: undefined,
                username: undefined,
            },
        },
    ]);
    const evaluator = new PlaygroundEvaluator();
    vi.spyOn(evaluator, 'workerState', 'get').mockReturnValue('idle');
    vi.spyOn(evaluator, 'isAlive', 'get').mockReturnValue(false);
    vi.mocked(getPlaygroundEvaluators).mockReturnValueOnce(
        new Map([['playground-cluster', evaluator]]),
    );

    showWorkerStats({} as IActionContext);

    const output = vi.mocked(ext.outputChannel.appendLog).mock.calls.map(([line]) => line);
    expect(output).toEqual(
        expect.arrayContaining([
            '  Shell sessions: 1',
            '  Playground sessions: 1',
            '  Shell 1:',
            '    Initialized: false',
            '    Worker state: spawning',
            '    Auth method: (not available)',
            '    Username: (not available)',
            '  Playground 1:',
            '    Worker alive: false',
            '    Worker state: idle',
            '    Session ID: (not available)',
            '    Last init duration (ms): 0',
        ]),
    );
});

it('does not print identifying or credential values that are not worker fields', (): void => {
    const shell = {
        terminal: { name: 'Safe terminal' } as ReturnType<typeof getRegisteredShellTerminals>[number]['terminal'],
        info: {
            clusterId: 'visible-cluster-id',
            clusterDisplayName: 'Visible Cluster',
            activeDatabase: 'test',
            isInitialized: true,
            isEvaluating: false,
            workerState: 'ready' as const,
            authMethod: 'NativeAuth' as const,
            username: 'existing-username',
            connectionString: 'mongodb://user:password@example.test/',
            accessToken: 'secret-access-token',
        },
    };
    vi.mocked(getRegisteredShellTerminals).mockReturnValueOnce([shell]);

    showWorkerStats({} as IActionContext);

    const output = vi.mocked(ext.outputChannel.appendLog).mock.calls.flat().join('\n');
    expect(output).toContain('Username: existing-username');
    expect(output).not.toContain('password');
    expect(output).not.toContain('secret-access-token');
    expect(output).not.toContain('mongodb://');
});
