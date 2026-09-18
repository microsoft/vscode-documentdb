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
    readonly commands: readonly { readonly command: string; readonly title: string }[];
    readonly menus: {
        readonly 'view/item/context': readonly MenuContribution[];
        readonly commandPalette: readonly MenuContribution[];
    };
}

describe('remove connection command contributions', () => {
    let contributes: PackageContributions;

    beforeAll(() => {
        const packageJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../package.json'), 'utf8')) as {
            contributes: PackageContributions;
        };
        contributes = packageJson.contributes;
    });

    it.each([
        [
            'vscode-documentdb.command.connectionsView.removeConnection',
            'Delete Connection…',
            '!listMultiSelection',
        ],
        [
            'vscode-documentdb.command.connectionsView.removeSelectedConnections',
            'Delete Selected Connections…',
            'listMultiSelection',
        ],
    ])('declares and gates %s', (command, title, selectionGate) => {
        expect(contributes.commands).toContainEqual(expect.objectContaining({ command, title }));
        const menuEntry = contributes.menus['view/item/context'].find((entry) => entry.command === command);
        expect(menuEntry?.when).toContain('treeitem_documentdbcluster');
        expect(menuEntry?.when).toMatch(new RegExp(`&& ${selectionGate.replace('!', '\\!')}$`));
        expect(contributes.menus.commandPalette).toContainEqual(expect.objectContaining({ command, when: 'never' }));
    });
});