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
// What `docker container inspect` / `docker ps` print: the container env carries the credentials.
const STDOUT_WITH_ENV = JSON.stringify({ Config: { Env: ['USERNAME=admin', `PASSWORD=${PASSWORD}`] } });

describe('ContainerRuntime output channel', () => {
    let lines: string[];

    beforeEach(() => {
        lines = [];
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
                        options.stdOutPipe?.end(STDOUT_WITH_ENV + '\n');
                        return [];
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

    it('still echoes stdout for commands whose output is not parsed', async () => {
        await ContainerRuntime.removeContainer('c1');
        await new Promise((resolve) => setImmediate(resolve));

        expect(lines).toContain(STDOUT_WITH_ENV);
    });
});
