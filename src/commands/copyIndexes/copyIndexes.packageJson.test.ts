/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';

interface MenuContribution {
    readonly command: string;
    readonly when?: string;
}

interface PackageContributions {
    readonly commands: readonly { readonly command: string }[];
    readonly menus: {
        readonly 'view/item/context': readonly MenuContribution[];
        readonly commandPalette: readonly MenuContribution[];
    };
}

describe('index copy command contributions', () => {
    let contributes: PackageContributions;

    beforeAll(() => {
        const packageJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../package.json'), 'utf8')) as {
            contributes: PackageContributions;
        };
        contributes = packageJson.contributes;
    });

    it('declares all dedicated index copy commands', () => {
        const commands = contributes.commands.map((entry) => entry.command);
        expect(commands).toEqual(
            expect.arrayContaining([
                'vscode-documentdb.command.copyIndex',
                'vscode-documentdb.command.copySelectedIndexes',
                'vscode-documentdb.command.copyIndexes',
                'vscode-documentdb.command.pasteIndexes',
            ]),
        );
    });

    it('shows Copy Index only for a single copyable selection', () => {
        const entry = contributes.menus['view/item/context'].find(
            (candidate) => candidate.command === 'vscode-documentdb.command.copyIndex',
        );

        expect(entry?.when).toContain('state_copyable');
        expect(entry?.when).toContain('treeitem_index');
        expect(entry?.when).toContain('!listMultiSelection');
    });

    it('shows Copy Selected Indexes for a multi-selection even when the context item is not copyable', () => {
        const entry = contributes.menus['view/item/context'].find(
            (candidate) => candidate.command === 'vscode-documentdb.command.copySelectedIndexes',
        );

        expect(entry?.when).not.toContain('state_copyable');
        expect(entry?.when).toContain('treeitem_index');
        expect(entry?.when).toMatch(/&& listMultiSelection$/);
    });

    it('gates Paste Indexes on the buffer service context key', () => {
        const entry = contributes.menus['view/item/context'].find(
            (candidate) => candidate.command === 'vscode-documentdb.command.pasteIndexes',
        );

        expect(entry?.when).toContain('documentdb.hasCopiedIndexes');
        expect(entry?.when).toContain('treeitem_indexes');
    });

    it.each([
        'vscode-documentdb.command.copyIndex',
        'vscode-documentdb.command.copySelectedIndexes',
        'vscode-documentdb.command.copyIndexes',
        'vscode-documentdb.command.pasteIndexes',
        'vscode-documentdb.command.copyCollection',
        'vscode-documentdb.command.pasteCollection',
    ])('hides %s from the command palette', (command) => {
        expect(contributes.menus.commandPalette).toContainEqual(expect.objectContaining({ command, when: 'never' }));
    });
});
