/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { execFileSync } from 'node:child_process';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('package entry points', () => {
    it('loads the built core in Node without a VS Code host', () => {
        const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
        const output = execFileSync(
            process.execPath,
            [
                '--input-type=module',
                '-e',
                "import { createTaskService } from '@microsoft/vscode-ext-tasks'; console.log(createTaskService().listTasks().length)",
            ],
            { cwd: packageRoot, encoding: 'utf8' },
        );
        expect(output.trim()).toBe('0');
    });

    it('exposes VS Code helpers through the presentation subpath', async () => {
        const presentation = await import('@microsoft/vscode-ext-tasks/vscode');
        expect(presentation.createTaskProgressReportingService).toBeTypeOf('function');
        expect(presentation.checkCanProceedAndInformUser).toBeTypeOf('function');
        expect(presentation.attachTaskLifecycleLogger).toBeTypeOf('function');
    });
});
