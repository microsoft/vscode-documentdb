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
import { runDockerCommand, type DockerCommandOptions } from './dockerCommand';

jest.mock('@microsoft/vscode-container-client', () => ({
    ...jest.requireActual('@microsoft/vscode-container-client'),
    ShellStreamCommandRunnerFactory: jest.fn(),
}));
jest.mock('./dockerCommand', () => ({
    ...jest.requireActual('./dockerCommand'),
    runDockerCommand: jest.fn(),
}));

const PASSWORD = 'hunter2-generated-password';
// `docker container inspect` output: the container env carries the credentials.
const STDOUT_WITH_ENV = JSON.stringify({ Config: { Env: ['USERNAME=admin', `PASSWORD=${PASSWORD}`] } });

describe('ContainerRuntime output channel', () => {
    let lines: string[];
    let stdout: string;

    beforeEach(() => {
        lines = [];
        stdout = STDOUT_WITH_ENV;
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
                        return [];
                    },
                }) as unknown as ShellStreamCommandRunnerFactory<ShellStreamCommandRunnerOptions>,
        );
        jest.mocked(runDockerCommand).mockImplementation(async (_command, options: DockerCommandOptions) => {
            options.onCommand?.('docker …');
            options.stdOutPipe?.end(stdout + '\n');
            return undefined;
        });
    });

    afterEach(() => {
        disposeQuickStartOutputChannel();
        jest.restoreAllMocks();
    });

    it('never echoes inspect stdout, which carries the container env', async () => {
        await ContainerRuntime.inspectContainer('c1');
        await new Promise((resolve) => setImmediate(resolve));

        expect(lines).toContain('$ docker …');
        expect(lines.join('\n')).not.toContain(PASSWORD);
    });

    it.each([
        ['listByLabel', () => ContainerRuntime.listByLabel({ label: 'x' })],
        ['removeContainer', () => ContainerRuntime.removeContainer('c1')],
    ])('%s still echoes its stdout', async (_name, run) => {
        stdout = 'c1';
        await run();
        await new Promise((resolve) => setImmediate(resolve));

        expect(lines).toContain('c1');
    });
});
