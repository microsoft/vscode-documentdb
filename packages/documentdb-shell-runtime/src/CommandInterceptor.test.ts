/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CommandInterceptor } from './CommandInterceptor';

describe('CommandInterceptor', () => {
    let interceptor: CommandInterceptor;

    beforeEach(() => {
        interceptor = new CommandInterceptor();
    });

    describe('tryIntercept', () => {
        it('intercepts "help"', () => {
            const result = interceptor.tryIntercept('help');
            expect(result).toBeDefined();
            expect(result!.type).toBe('Help');
            expect(result!.durationMs).toBe(0);
        });

        it('intercepts "help()"', () => {
            const result = interceptor.tryIntercept('help()');
            expect(result).toBeDefined();
            expect(result!.type).toBe('Help');
        });

        it('intercepts "help" with leading/trailing whitespace', () => {
            const result = interceptor.tryIntercept('  help  ');
            expect(result).toBeDefined();
            expect(result!.type).toBe('Help');
        });

        it('intercepts "help()" with leading/trailing whitespace', () => {
            const result = interceptor.tryIntercept('  help()  ');
            expect(result).toBeDefined();
            expect(result!.type).toBe('Help');
        });

        it('intercepts help with empty tagged template literal', () => {
            const result = interceptor.tryIntercept('help``');
            expect(result).toBeDefined();
            expect(result!.type).toBe('Help');
            expect(result!.durationMs).toBe(0);
        });

        it('intercepts help with non-empty tagged template literal', () => {
            const result = interceptor.tryIntercept('help`some content`');
            expect(result).toBeDefined();
            expect(result!.type).toBe('Help');
        });

        it('intercepts help with tagged template literal with whitespace before backtick', () => {
            const result = interceptor.tryIntercept('help `text`');
            expect(result).toBeDefined();
            expect(result!.type).toBe('Help');
        });

        it('intercepts help tagged template literal with leading/trailing whitespace', () => {
            const result = interceptor.tryIntercept('  help``  ');
            expect(result).toBeDefined();
            expect(result!.type).toBe('Help');
        });

        it('does not intercept "help(arg)"', () => {
            const result = interceptor.tryIntercept('help("collections")');
            expect(result).toBeUndefined();
        });

        it('does not intercept regular code', () => {
            expect(interceptor.tryIntercept('db.users.find({})')).toBeUndefined();
            expect(interceptor.tryIntercept('show dbs')).toBeUndefined();
            expect(interceptor.tryIntercept('use admin')).toBeUndefined();
        });

        it('does not intercept code containing "help" as substring', () => {
            expect(interceptor.tryIntercept('var help = 1')).toBeUndefined();
            expect(interceptor.tryIntercept('helper()')).toBeUndefined();
        });

        it('does not intercept empty input', () => {
            expect(interceptor.tryIntercept('')).toBeUndefined();
            expect(interceptor.tryIntercept('   ')).toBeUndefined();
        });
    });
});
