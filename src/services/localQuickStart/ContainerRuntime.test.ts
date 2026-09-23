/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    ShellStreamCommandRunnerFactory,
    type ShellStreamCommandRunnerOptions,
} from '@microsoft/vscode-container-client';
import * as vscode from 'vscode';
import { ContainerRuntime, disposeQuickStartOutputChannel } from './ContainerRuntime';

jest.mock('@microsoft/vscode-container-client', () => ({
    ...jest.requireActual('@microsoft/vscode-container-client'),
    ShellStreamCommandRunnerFactory: jest.fn(),
}));

const PASSWORD = 'hunter2-generated-password';
// `docker container inspect` output: the container env carries the credentials.
const STDOUT_WITH_ENV = JSON.stringify({ Config: { Env: ['USERNAME=admin', `PASSWORD=${PASSWORD}`] } });

describe('ContainerRuntime output channel', () => {
    let lines: string[];
    let stdout: string;
    let parsed: unknown[];

    beforeEach(() => {
        lines = [];
        stdout = STDOUT_WITH_ENV;
        parsed = [];
        disposeQuickStartOutputChannel();
        jest.spyOn(vscode.window, 'createOutputChannel').mockReturnValue({
            appendLine: (line: string) => lines.push(line),
            dispose: () => undefined,
        } as unknown as vscode.LogOutputChannel);
        jest.mocked(ShellStreamCommandRunnerFactory).mockImplementation(
            (options: ShellStreamCommandRunnerOptions) =>
                ({
                    getCommandRunner: () => async () => {
                        options.onCommand?.('docker …');
                        options.stdOutPipe?.end(stdout + '\n');
                        return parsed;
                    },
                }) as unknown as ShellStreamCommandRunnerFactory<ShellStreamCommandRunnerOptions>,
        );
    });

    afterEach(() => {
        disposeQuickStartOutputChannel();
        jest.restoreAllMocks();
    });

    it.each([
        ['inspectContainer', () => ContainerRuntime.inspectContainer('c1')],
        ['listByLabel', () => ContainerRuntime.listByLabel({ label: 'x' })],
    ])('%s never echoes the container env to the channel', async (_name, run) => {
        await run();
        await new Promise((resolve) => setImmediate(resolve));

        expect(lines).toContain('$ docker …');
        expect(lines.join('\n')).not.toContain(PASSWORD);
    });

    it('logs a one-line summary in place of parsed stdout', async () => {
        const ports = [{ containerPort: 10260, hostPort: 10261, hostIp: '127.0.0.1' }];
        // Real inspect output prefixes the name with a slash; ps doesn't.
        parsed = [{ name: '/vscode-documentdb-local', status: 'running', ports }];
        await ContainerRuntime.inspectContainer('c1');
        parsed = [{ name: 'vscode-documentdb-local', state: 'running', ports }];
        await ContainerRuntime.listByLabel({ label: 'x' });
        parsed = [];
        await ContainerRuntime.inspectContainer('c2');
        await ContainerRuntime.listByLabel({ label: 'x' });

        expect(lines.filter((line) => line.startsWith('['))).toEqual([
            '[inspect] vscode-documentdb-local: running, 127.0.0.1:10261->10260',
            '[ps] vscode-documentdb-local: running, 127.0.0.1:10261->10260',
            '[inspect] c2: not found',
            '[ps] no matching containers',
        ]);
    });

    it('still echoes stdout for commands whose output is not parsed', async () => {
        stdout = 'c1';
        await ContainerRuntime.removeContainer('c1');
        await new Promise((resolve) => setImmediate(resolve));

        expect(lines).toContain('c1');
    });
});
