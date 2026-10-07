/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ContainerClient from '@microsoft/vscode-container-client';
import {
    ShellStreamCommandRunnerFactory,
    type ShellStreamCommandRunnerOptions,
} from '@microsoft/vscode-container-client';
import * as vscode from 'vscode';
import { ContainerRuntime, disposeQuickStartOutputChannel } from './ContainerRuntime';
import type * as DockerCommand from './dockerCommand';
import { runDockerCommand, type DockerCommandOptions } from './dockerCommand';

vi.mock('@microsoft/vscode-container-client', async () => ({
    ...(await vi.importActual<typeof ContainerClient>('@microsoft/vscode-container-client')),
    ShellStreamCommandRunnerFactory: vi.fn(),
}));
vi.mock('./dockerCommand', async () => ({
    ...(await vi.importActual<typeof DockerCommand>('./dockerCommand')),
    runDockerCommand: vi.fn(),
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
        vi.spyOn(vscode.window, 'createOutputChannel').mockReturnValue({
            appendLine: (line: string) => lines.push(line),
            dispose: () => undefined,
        } as unknown as vscode.LogOutputChannel);
        vi.mocked(ShellStreamCommandRunnerFactory).mockImplementation(function (
            options: ShellStreamCommandRunnerOptions,
        ) {
            return {
                getCommandRunner: () => async () => {
                    options.onCommand?.('docker …');
                    options.stdOutPipe?.end(stdout + '\n');
                    return [];
                },
            } as unknown as ShellStreamCommandRunnerFactory<ShellStreamCommandRunnerOptions>;
        });
        vi.mocked(runDockerCommand).mockImplementation(async (_command, options: DockerCommandOptions) => {
            options.onCommand?.('docker …');
            options.stdOutPipe?.end(stdout + '\n');
            return undefined;
        });
    });

    afterEach(() => {
        disposeQuickStartOutputChannel();
        vi.restoreAllMocks();
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
