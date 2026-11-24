/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { readdirSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Decision 0006: code that moves into the packages never calls `vscode.l10n.t` and never reaches
 * extension modules (`ext`, `extensionVariables`, the `extension/` glue, anything outside this
 * folder, or the files below). Only `extension/**` and the files below, which stay in `src/` at
 * plan step 5.2, may.
 */
const stayInExtension: Readonly<Record<string, string>> = {
    'data-api/readers/DocumentDbDocumentReader.ts': 'DocumentDB adapter; stays in src/ (decision 0005)',
    'data-api/writers/DocumentDbStreamingWriter.ts': 'DocumentDB adapter; stays in src/ (decision 0005)',
    'data-api/indexes/DocumentDbCollectionIndexCopier.ts': 'DocumentDB adapter; stays in src/ (decision 0005)',
    'data-api/indexes/createIndexCopier.ts': 'Factory for the DocumentDB index copier; stays in src/ (decision 0005)',
    'tasks/copy-indexes/CopyIndexesTask.ts': 'DocumentDB index copy task; stays in src/ (decision 0005)',
    'tasks/DemoTask.ts': 'Extension demo task built on the extension glue; not in the step 5.2 move list',
};

const root = __dirname;

function packageBoundSources(): string[] {
    return readdirSync(root, { recursive: true, encoding: 'utf8' })
        .map((file) => file.split(path.sep).join('/'))
        .filter((file) => file.endsWith('.ts') && !/\.test\.tsx?$/.test(file) && !file.startsWith('extension/'))
        .filter((file) => !(file in stayInExtension));
}

function violations(file: string): string[] {
    const source = readFileSync(path.join(root, file), 'utf8');
    const found: string[] = [];
    if (/\bl10n\.t\s*\(/.test(source)) {
        found.push('calls l10n.t');
    }
    for (const [, specifier] of source.matchAll(/from\s+'([^']+)'/g)) {
        if (!specifier.startsWith('.')) {
            continue;
        }
        const relative = path
            .relative(root, path.resolve(path.dirname(path.join(root, file)), specifier))
            .split(path.sep)
            .join('/');
        const staysInExtension = `${relative}.ts` in stayInExtension || `${relative}/index.ts` in stayInExtension;
        if (relative.startsWith('..') || relative.split('/')[0] === 'extension' || staysInExtension) {
            found.push(`imports ${specifier}`);
        }
    }
    return found;
}

describe('Task Service package boundary', () => {
    it('package-bound files do not call l10n.t or import extension modules', () => {
        const sources = packageBoundSources();
        expect(sources).toContain('UI/taskProgressReportingService.ts');
        expect(sources).toContain('resourceUsageHelper.ts');

        const offending = sources.flatMap((file) => violations(file).map((violation) => `${file}: ${violation}`));

        expect(offending).toEqual([]);
        // A stale entry would silently exempt a file that is later re-created.
        for (const file of Object.keys(stayInExtension)) {
            expect(() => readFileSync(path.join(root, file))).not.toThrow();
        }
    });
});
