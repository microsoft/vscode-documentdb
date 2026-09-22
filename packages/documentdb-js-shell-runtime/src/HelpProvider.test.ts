/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { HelpProvider } from './HelpProvider';

describe('HelpProvider', () => {
    describe('playground surface (default)', () => {
        let helpProvider: HelpProvider;

        beforeEach(() => {
            helpProvider = new HelpProvider(); // defaults to 'playground'
        });

        it('returns non-empty help text', () => {
            const text = helpProvider.getHelpText();
            expect(text).toBeTruthy();
            expect(text.length).toBeGreaterThan(100);
        });

        it('includes Playground header', () => {
            const text = helpProvider.getHelpText();
            expect(text).toContain('Query Playground');
        });

        it('includes shared sections', () => {
            const text = helpProvider.getHelpText();
            expect(text).toContain('db.getCollection');
            expect(text).toContain('.find(');
            expect(text).toContain('.insertOne(');
            expect(text).toContain('.limit(');
            expect(text).toContain('show dbs');
            expect(text).toContain('ObjectId');
        });

        it('includes keyboard shortcuts', () => {
            const text = helpProvider.getHelpText();
            const expectedKey = process.platform === 'darwin' ? '⌘' : 'Ctrl';
            expect(text).toContain(expectedKey);
            expect(text).toContain('Run current block');
            expect(text).toContain('Run entire file');
        });

        it('includes playground-specific tips', () => {
            const text = helpProvider.getHelpText();
            expect(text).toContain('Separate code blocks with blank lines');
            expect(text).toContain('not between separate runs');
        });

        it('includes console output section', () => {
            const text = helpProvider.getHelpText();
            expect(text).toContain('Playground Output');
        });

        it('does NOT include shell commands section', () => {
            const text = helpProvider.getHelpText();
            expect(text).not.toContain('exit / quit');
            expect(text).not.toContain('cls / clear');
        });

        it('does NOT include use <db>', () => {
            const text = helpProvider.getHelpText();
            expect(text).not.toContain('use <db>');
        });

        it('does not include commands like show profile', () => {
            const text = helpProvider.getHelpText();
            expect(text).not.toContain('show profile');
        });

        it('does not include adminCommand', () => {
            const text = helpProvider.getHelpText();
            expect(text).not.toContain('adminCommand');
        });
    });

    describe('shell surface', () => {
        let helpProvider: HelpProvider;

        beforeEach(() => {
            helpProvider = new HelpProvider('shell');
        });

        it('includes DocumentDB Shell header', () => {
            const text = helpProvider.getHelpText();
            expect(text).toContain('DocumentDB Shell');
        });

        it('uses compact format with section headers', () => {
            const text = helpProvider.getHelpText();
            expect(text).toContain('# Query');
            expect(text).toContain('# Write');
            expect(text).toContain('# Shell');
        });

        it('includes query commands with short db.<coll> notation', () => {
            const text = helpProvider.getHelpText();
            expect(text).toContain('db.<coll>.find');
            expect(text).toContain('db.<coll>.aggregate');
        });

        it('includes write commands', () => {
            const text = helpProvider.getHelpText();
            expect(text).toContain('db.<coll>.insertOne');
            expect(text).toContain('db.<coll>.updateOne');
            expect(text).toContain('db.<coll>.deleteOne');
        });

        it('includes shell commands', () => {
            const text = helpProvider.getHelpText();
            expect(text).toContain('exit / quit');
            expect(text).toContain('cls / clear');
        });

        it('includes use <db> in database section', () => {
            const text = helpProvider.getHelpText();
            expect(text).toContain('use <db>');
        });

        it('includes shell tips', () => {
            const text = helpProvider.getHelpText();
            expect(text).toContain('Variables persist');
            expect(text).toContain('console.log()');
        });

        it('advertises color and help annotation settings as terminal link markers', () => {
            const text = helpProvider.getHelpText();
            expect(text).toContain('  Select an option to open it in VS Code Settings:');
            expect(text).toContain('  1. ⚙ [colorSupport] Toggle syntax and output colors.');
            expect(text).toContain('      Manual access: search Settings for documentDB.shell.display.colorSupport');
            expect(text).toContain('  2. ⚙ [inlineHints] Toggle 🛈 descriptions, counts, and previews.');
            expect(text).toContain('      Manual access: search Settings for documentDB.shell.display.inlineHints');
            expect(text).not.toContain('autocompletion');
        });

        it('does NOT include keyboard shortcuts', () => {
            const text = helpProvider.getHelpText();
            expect(text).not.toContain('Run current block');
            expect(text).not.toContain('Run entire file');
        });

        it('does NOT include playground-specific content', () => {
            const text = helpProvider.getHelpText();
            expect(text).not.toContain('Separate code blocks with blank lines');
            expect(text).not.toContain('Playground Output');
        });

        describe('width-aware layout', () => {
            function longestLine(text: string): number {
                return Math.max(...text.split('\n').map((l) => l.length));
            }

            it('fits within the requested width', () => {
                for (const columns of [40, 50, 60, 80, 120]) {
                    const text = helpProvider.getHelpText(columns);
                    expect(longestLine(text)).toBeLessThanOrEqual(columns);
                }
            });

            it('sizes the command column to the widest command, not a fixed 40', () => {
                const text = helpProvider.getHelpText(80);
                const findLine = text.split('\n').find((l) => l.includes('db.<coll>.find({})'));

                // Widest command is 'db.<coll>.updateOne({}, {$set:{}})' (34 columns),
                // so the description starts at column 2 + 34 + 2 = 38.
                expect(findLine).toBe('  db.<coll>.find({})' + ' '.repeat(18) + 'Find documents');
            });

            it('stacks entries when there is no room for a description column', () => {
                const text = helpProvider.getHelpText(40);
                const lines = text.split('\n');
                const commandIndex = lines.findIndex((l) => l === '  db.<coll>.find({})');

                expect(commandIndex).toBeGreaterThan(-1);
                expect(lines[commandIndex + 1]).toBe('    Find documents');
            });

            it('wraps the tip line rather than letting the terminal soft-wrap it', () => {
                const text = helpProvider.getHelpText(40);
                const tipLines = text
                    .split('\n')
                    .filter((l) => l.includes('Variables persist') || l.includes('inline'));

                expect(tipLines.length).toBeGreaterThan(1);
                for (const line of tipLines) {
                    expect(line.startsWith('  ')).toBe(true);
                }
            });

            it('defaults to 80 columns when no width is supplied', () => {
                expect(helpProvider.getHelpText()).toBe(helpProvider.getHelpText(80));
            });
        });
    });

    describe('getHelpResult', () => {
        it('returns result with type Help', () => {
            const result = new HelpProvider().getHelpResult();
            expect(result.type).toBe('Help');
        });

        it('returns result with durationMs 0', () => {
            const result = new HelpProvider().getHelpResult();
            expect(result.durationMs).toBe(0);
        });

        it('returns result with help text as printable value', () => {
            const provider = new HelpProvider('shell');
            const result = provider.getHelpResult();
            expect(result.printable).toBe(provider.getHelpText());
        });
    });
});
