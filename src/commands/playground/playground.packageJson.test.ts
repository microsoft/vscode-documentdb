/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeAll, describe, expect, it } from 'vitest';

import * as fs from 'fs';
import * as path from 'path';

interface MenuContribution {
    readonly command: string;
    readonly when: string;
    readonly group?: string;
}

interface CommandContribution {
    readonly command: string;
    readonly title: string;
    readonly icon?: string;
}

interface KeybindingContribution {
    readonly command: string;
    readonly key: string;
    readonly mac: string;
    readonly when: string;
    readonly args?: { readonly screenReaderMode: boolean };
}

interface ConfigurationContribution {
    readonly title: string;
    readonly properties: Record<
        string,
        {
            readonly type: string;
            readonly default: unknown;
            readonly enum?: readonly string[];
            readonly description: string;
            readonly enumDescriptions?: readonly string[];
        }
    >;
}

interface PackageContributions {
    readonly commands: readonly CommandContribution[];
    readonly keybindings: readonly KeybindingContribution[];
    readonly configuration: readonly ConfigurationContribution[];
    readonly menus: {
        readonly 'editor/context': readonly MenuContribution[];
        readonly 'editor/title': readonly MenuContribution[];
        readonly commandPalette: readonly MenuContribution[];
    };
}

describe('query playground command contributions', () => {
    let contributes: PackageContributions;

    beforeAll(() => {
        const packageJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../package.json'), 'utf8')) as {
            contributes: PackageContributions;
        };
        contributes = packageJson.contributes;
    });

    it('contributes keyboard-reachable Open Block commands with their icons', () => {
        expect(contributes.commands).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    command: 'vscode-documentdb.command.playground.openQueryInShell',
                    title: '%playground.openBlockInShell%',
                    icon: '$(terminal)',
                }),
                expect.objectContaining({
                    command: 'vscode-documentdb.command.playground.openQueryInCollectionView',
                    title: '%playground.openBlockInCollectionView%',
                    icon: '$(screen-full)',
                }),
            ]),
        );
    });

    it.each(['vscode-documentdb.command.playground.runAll', 'vscode-documentdb.command.playground.runSelected'])(
        'exposes %s in the palette for playground editors',
        (command) => {
            expect(contributes.menus.commandPalette).toContainEqual(
                expect.objectContaining({ command, when: "editorLangId == 'documentdb-playground'" }),
            );
        },
    );

    it.each([
        'vscode-documentdb.command.playground.openQueryInShell',
        'vscode-documentdb.command.playground.openQueryInCollectionView',
    ])('gates %s on connection and current-block code in every menu', (command) => {
        for (const menu of [
            contributes.menus.commandPalette,
            contributes.menus['editor/title'],
            contributes.menus['editor/context'],
        ]) {
            const entry = menu.find((candidate) => candidate.command === command);
            expect(entry?.when).toContain("editorLangId == 'documentdb-playground'");
            expect(entry?.when).toContain('documentdbPlaygroundConnected');
            expect(entry?.when).toContain('documentdbPlaygroundBlockHasCode');
        }
    });

    it('puts only connection and Run All actions inline in the editor title', () => {
        expect(contributes.menus['editor/title'].filter((entry) => entry.group?.startsWith('navigation'))).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    command: 'vscode-documentdb.command.playground.connect',
                    group: 'navigation@1',
                    when: expect.stringContaining('!documentdbPlaygroundConnected') as string,
                }),
                expect.objectContaining({
                    command: 'vscode-documentdb.command.playground.showConnectionInfo',
                    group: 'navigation@1',
                    when: expect.stringContaining('documentdbPlaygroundConnected') as string,
                }),
                expect.objectContaining({
                    command: 'vscode-documentdb.command.playground.runAll',
                    group: 'navigation@2',
                }),
            ]),
        );
        expect(
            contributes.menus['editor/title'].filter((entry) =>
                [
                    'vscode-documentdb.command.playground.runSelected',
                    'vscode-documentdb.command.playground.openQueryInShell',
                    'vscode-documentdb.command.playground.openQueryInCollectionView',
                ].includes(entry.command),
            ),
        ).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ group: '2_playground@1' }),
                expect.objectContaining({ group: '2_playground@2' }),
                expect.objectContaining({ group: '2_playground@3' }),
            ]),
        );
    });

    it('uses state-specific connection commands in the palette', () => {
        expect(contributes.menus.commandPalette).toContainEqual(
            expect.objectContaining({
                command: 'vscode-documentdb.command.playground.connect',
                when: "editorLangId == 'documentdb-playground' && !documentdbPlaygroundConnected",
            }),
        );
        expect(contributes.menus.commandPalette).toContainEqual(
            expect.objectContaining({
                command: 'vscode-documentdb.command.playground.showConnectionInfo',
                when: "editorLangId == 'documentdb-playground' && documentdbPlaygroundConnected",
            }),
        );
    });

    it.each([
        [
            'editor/context',
            'vscode-documentdb.command.playground.runSelected',
            "editorLangId == 'documentdb-playground'",
        ],
        ['editor/title', 'vscode-documentdb.command.playground.runSelected', "editorLangId == 'documentdb-playground'"],
    ])('contributes Run Block to %s for playground editors', (menu, command, when) => {
        const entries = contributes.menus[menu as 'editor/context' | 'editor/title'];
        expect(entries).toContainEqual(expect.objectContaining({ command, when }));
    });

    it('gates each inline editor-title action on the accepted state', () => {
        const title = contributes.menus['editor/title'];
        expect(title).toContainEqual(
            expect.objectContaining({
                command: 'vscode-documentdb.command.playground.runAll',
                when: "editorLangId == 'documentdb-playground'",
                group: 'navigation@2',
            }),
        );
        expect(title).toContainEqual(
            expect.objectContaining({
                command: 'vscode-documentdb.command.playground.connect',
                when: "editorLangId == 'documentdb-playground' && !documentdbPlaygroundConnected",
                group: 'navigation@1',
            }),
        );
        expect(title).toContainEqual(
            expect.objectContaining({
                command: 'vscode-documentdb.command.playground.showConnectionInfo',
                when: "editorLangId == 'documentdb-playground' && documentdbPlaygroundConnected",
                group: 'navigation@1',
            }),
        );
    });

    it('preserves the original shortcuts and appends their screen-reader variants without new combinations', () => {
        const originals = [
            {
                command: 'vscode-documentdb.command.playground.runAll',
                key: 'ctrl+shift+enter',
                mac: 'cmd+shift+enter',
                when: "editorLangId == 'documentdb-playground' && editorTextFocus",
            },
            {
                command: 'vscode-documentdb.command.playground.runSelected',
                key: 'ctrl+enter',
                mac: 'cmd+enter',
                when: "editorLangId == 'documentdb-playground' && editorTextFocus",
            },
        ];
        expect(contributes.keybindings).toEqual([
            ...originals,
            ...originals.map((entry) => ({
                ...entry,
                when: `${entry.when} && accessibilityModeEnabled`,
                args: { screenReaderMode: true },
            })),
        ]);
    });

    it('contributes the after-run setting and all localized enum descriptions in Query Playground', () => {
        const settings = contributes.configuration.find((entry) => entry.title === 'Query Playground');
        expect(settings?.properties['documentDB.playground.afterRun']).toMatchObject({
            type: 'string',
            default: 'auto',
            enum: ['auto', 'stay', 'focusResult', 'notify'],
            description: '%playground.afterRun.description%',
            enumDescriptions: [
                '%playground.afterRun.auto%',
                '%playground.afterRun.stay%',
                '%playground.afterRun.focusResult%',
                '%playground.afterRun.notify%',
            ],
        });
        const localized = JSON.parse(
            fs.readFileSync(path.resolve(__dirname, '../../../package.nls.json'), 'utf8'),
        ) as Record<string, string>;
        for (const key of settings?.properties['documentDB.playground.afterRun'].enumDescriptions ?? []) {
            expect(localized[key.slice(1, -1)]).toBeTruthy();
        }
    });

    it.each([
        ['focusResult', "editorLangId == 'documentdb-playground'", 'Query Playground: Focus Result'],
        ['focusPlayground', "resourceScheme == 'documentdb-playground-result'", 'Query Playground: Focus Playground'],
    ])('contributes the localized %s palette command without a shortcut', (id, when, title) => {
        const command = `vscode-documentdb.command.playground.${id}`;
        expect(contributes.commands).toContainEqual(expect.objectContaining({ command, title: `%playground.${id}%` }));
        expect(contributes.menus.commandPalette).toContainEqual({ command, when });
        expect(contributes.keybindings.some((entry) => entry.command === command)).toBe(false);
        const localized = JSON.parse(
            fs.readFileSync(path.resolve(__dirname, '../../../package.nls.json'), 'utf8'),
        ) as Record<string, string>;
        expect(localized[`playground.${id}`]).toBe(title);
    });
});
