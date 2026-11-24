/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { readdirSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

interface PackageBoundary {
    root: string;
    vscodePresentation: boolean;
}

const packages: PackageBoundary[] = [
    { root: path.resolve(__dirname, '../../../packages/vscode-ext-tasks/src'), vscodePresentation: true },
    { root: path.resolve(__dirname, '../../../packages/vscode-ext-tasks-data-transfer/src'), vscodePresentation: false },
];

function packageSources(root: string): string[] {
    return readdirSync(root, { recursive: true, encoding: 'utf8' })
        .map((file) => file.split(path.sep).join('/'))
        .filter((file) => file.endsWith('.ts') && !/\.test\.tsx?$/.test(file));
}

function violations(boundary: PackageBoundary, file: string): string[] {
    const source = readFileSync(path.join(boundary.root, file), 'utf8');
    const found: string[] = [];
    if (/\bl10n\.t\s*\(/.test(source)) {
        found.push('calls l10n.t');
    }
    for (const [, specifier] of source.matchAll(/from\s+'([^']+)'/g)) {
        if (
            specifier === '@microsoft/vscode-azext-utils' ||
            (specifier === 'vscode' && !(boundary.vscodePresentation && file.startsWith('vscode/')))
        ) {
            found.push(`imports ${specifier}`);
        }
        if (specifier.startsWith('.')) {
            const relative = path.relative(
                boundary.root,
                path.resolve(path.dirname(path.join(boundary.root, file)), specifier),
            );
            if (relative.startsWith('..')) {
                found.push(`imports ${specifier}`);
            }
        }
    }
    return found;
}

describe('Task Service package boundary', () => {
    it('keeps extension glue and localization out of the packages', () => {
        expect(packageSources(packages[0].root)).toContain('vscode/taskProgressReportingService.ts');
        expect(packageSources(packages[1].root)).toContain('data-api/readers/BaseDocumentReader.ts');
        expect(packageSources(packages[1].root)).toContain('tasks/copy-and-paste/CopyPasteCollectionTask.ts');

        const offending = packages.flatMap((boundary) =>
            packageSources(boundary.root).flatMap((file) =>
                violations(boundary, file).map(
                    (violation) => `${path.basename(path.dirname(boundary.root))}/${file}: ${violation}`,
                ),
            ),
        );
        expect(offending).toEqual([]);
    });
});
