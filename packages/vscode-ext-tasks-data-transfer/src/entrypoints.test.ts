/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Task } from '@microsoft/vscode-ext-tasks';
import { CopyPasteCollectionTask } from '@microsoft/vscode-ext-tasks-data-transfer/copy-collection';
import { execFileSync } from 'node:child_process';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('package entry points', () => {
    it('loads the built engine and copy task in Node without a VS Code host', () => {
        const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
        const output = execFileSync(
            process.execPath,
            [
                '--input-type=module',
                '-e',
                "import { BaseDocumentReader } from '@microsoft/vscode-ext-tasks-data-transfer'; " +
                    "import { CopyPasteCollectionTask } from '@microsoft/vscode-ext-tasks-data-transfer/copy-collection'; " +
                    "console.log(typeof BaseDocumentReader, typeof CopyPasteCollectionTask)",
            ],
            { cwd: packageRoot, encoding: 'utf8' },
        );
        expect(output.trim()).toBe('function function');
    });

    it('uses the consumer task peer for the copy task', () => {
        expect(CopyPasteCollectionTask.prototype).toBeInstanceOf(Task);
    });
});
