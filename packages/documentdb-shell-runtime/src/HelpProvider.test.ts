/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { HelpProvider } from './HelpProvider';

describe('HelpProvider', () => {
    let helpProvider: HelpProvider;

    beforeEach(() => {
        helpProvider = new HelpProvider();
    });

    describe('getHelpText', () => {
        it('returns non-empty help text', () => {
            const text = helpProvider.getHelpText();
            expect(text).toBeTruthy();
            expect(text.length).toBeGreaterThan(100);
        });

        it('includes DocumentDB Shell header', () => {
            const text = helpProvider.getHelpText();
            expect(text).toContain('DocumentDB Shell');
        });

        it('includes collection access commands', () => {
            const text = helpProvider.getHelpText();
            expect(text).toContain('db.getCollection');
        });

        it('includes query commands', () => {
            const text = helpProvider.getHelpText();
            expect(text).toContain('.find(');
            expect(text).toContain('.findOne(');
            expect(text).toContain('.aggregate(');
        });

        it('includes write commands', () => {
            const text = helpProvider.getHelpText();
            expect(text).toContain('.insertOne(');
            expect(text).toContain('.updateOne(');
            expect(text).toContain('.deleteOne(');
        });

        it('includes cursor modifiers', () => {
            const text = helpProvider.getHelpText();
            expect(text).toContain('.limit(');
            expect(text).toContain('.skip(');
            expect(text).toContain('.sort(');
        });

        it('includes database commands', () => {
            const text = helpProvider.getHelpText();
            expect(text).toContain('show dbs');
            expect(text).toContain('show collections');
        });

        it('includes BSON constructors', () => {
            const text = helpProvider.getHelpText();
            expect(text).toContain('ObjectId');
            expect(text).toContain('ISODate');
            expect(text).toContain('NumberDecimal');
        });

        it('uses platform-appropriate modifier key', () => {
            const text = helpProvider.getHelpText();
            const expectedKey = process.platform === 'darwin' ? '⌘' : 'Ctrl';
            expect(text).toContain(expectedKey);
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

    describe('getHelpResult', () => {
        it('returns result with type Help', () => {
            const result = helpProvider.getHelpResult();
            expect(result.type).toBe('Help');
        });

        it('returns result with durationMs 0', () => {
            const result = helpProvider.getHelpResult();
            expect(result.durationMs).toBe(0);
        });

        it('returns result with help text as printable value', () => {
            const result = helpProvider.getHelpResult();
            expect(result.printable).toBe(helpProvider.getHelpText());
        });
    });
});
