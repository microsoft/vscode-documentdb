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

    describe('help command', () => {
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

        it('does not intercept code containing "help" as substring', () => {
            expect(interceptor.tryIntercept('var help = 1')).toBeUndefined();
            expect(interceptor.tryIntercept('helper()')).toBeUndefined();
        });
    });

    describe('exit / quit commands', () => {
        it('intercepts "exit"', () => {
            const result = interceptor.tryIntercept('exit');
            expect(result).toBeDefined();
            expect(result!.type).toBe('exit');
            expect(result!.durationMs).toBe(0);
        });

        it('intercepts "quit"', () => {
            const result = interceptor.tryIntercept('quit');
            expect(result).toBeDefined();
            expect(result!.type).toBe('exit');
            expect(result!.durationMs).toBe(0);
        });

        it('intercepts "exit" with leading/trailing whitespace', () => {
            const result = interceptor.tryIntercept('  exit  ');
            expect(result).toBeDefined();
            expect(result!.type).toBe('exit');
        });

        it('intercepts "quit" with leading/trailing whitespace', () => {
            const result = interceptor.tryIntercept('  quit  ');
            expect(result).toBeDefined();
            expect(result!.type).toBe('exit');
        });

        it('intercepts "exit;" with trailing semicolon', () => {
            const result = interceptor.tryIntercept('exit;');
            expect(result).toBeDefined();
            expect(result!.type).toBe('exit');
        });

        it('intercepts "quit;" with trailing semicolon', () => {
            const result = interceptor.tryIntercept('quit;');
            expect(result).toBeDefined();
            expect(result!.type).toBe('exit');
        });

        it('intercepts "exit()" as exit command', () => {
            const result = interceptor.tryIntercept('exit()');
            expect(result).toBeDefined();
            expect(result!.type).toBe('exit');
        });

        it('intercepts "quit()" as exit command', () => {
            const result = interceptor.tryIntercept('quit()');
            expect(result).toBeDefined();
            expect(result!.type).toBe('exit');
        });

        it('intercepts "exit();" with trailing semicolon', () => {
            const result = interceptor.tryIntercept('exit();');
            expect(result).toBeDefined();
            expect(result!.type).toBe('exit');
        });

        it('intercepts "quit();" with trailing semicolon', () => {
            const result = interceptor.tryIntercept('quit();');
            expect(result).toBeDefined();
            expect(result!.type).toBe('exit');
        });

        it('does not intercept "exitFunction()"', () => {
            expect(interceptor.tryIntercept('exitFunction()')).toBeUndefined();
        });

        it('does not intercept "var exit = 1"', () => {
            expect(interceptor.tryIntercept('var exit = 1')).toBeUndefined();
        });

        it('does not intercept "db.exit"', () => {
            expect(interceptor.tryIntercept('db.exit')).toBeUndefined();
        });

        it('does not intercept "process.exit(0)"', () => {
            expect(interceptor.tryIntercept('process.exit(0)')).toBeUndefined();
        });
    });

    describe('cls / clear commands', () => {
        it('intercepts "cls"', () => {
            const result = interceptor.tryIntercept('cls');
            expect(result).toBeDefined();
            expect(result!.type).toBe('clear');
            expect(result!.durationMs).toBe(0);
        });

        it('intercepts "clear"', () => {
            const result = interceptor.tryIntercept('clear');
            expect(result).toBeDefined();
            expect(result!.type).toBe('clear');
            expect(result!.durationMs).toBe(0);
        });

        it('intercepts "cls" with leading/trailing whitespace', () => {
            const result = interceptor.tryIntercept('  cls  ');
            expect(result).toBeDefined();
            expect(result!.type).toBe('clear');
        });

        it('intercepts "clear" with leading/trailing whitespace', () => {
            const result = interceptor.tryIntercept('  clear  ');
            expect(result).toBeDefined();
            expect(result!.type).toBe('clear');
        });

        it('intercepts "cls;" with trailing semicolon', () => {
            const result = interceptor.tryIntercept('cls;');
            expect(result).toBeDefined();
            expect(result!.type).toBe('clear');
        });

        it('intercepts "clear;" with trailing semicolon', () => {
            const result = interceptor.tryIntercept('clear;');
            expect(result).toBeDefined();
            expect(result!.type).toBe('clear');
        });

        it('does not intercept "clear()"', () => {
            expect(interceptor.tryIntercept('clear()')).toBeUndefined();
        });

        it('does not intercept "cls()"', () => {
            expect(interceptor.tryIntercept('cls()')).toBeUndefined();
        });

        it('does not intercept "clearInterval()"', () => {
            expect(interceptor.tryIntercept('clearInterval()')).toBeUndefined();
        });

        it('does not intercept "clearTimeout(timer)"', () => {
            expect(interceptor.tryIntercept('clearTimeout(timer)')).toBeUndefined();
        });

        it('does not intercept "var clear = true"', () => {
            expect(interceptor.tryIntercept('var clear = true')).toBeUndefined();
        });

        it('does not intercept "db.clear"', () => {
            expect(interceptor.tryIntercept('db.clear')).toBeUndefined();
        });
    });

    describe('non-intercepted input', () => {
        it('does not intercept regular code', () => {
            expect(interceptor.tryIntercept('db.users.find({})')).toBeUndefined();
            expect(interceptor.tryIntercept('show dbs')).toBeUndefined();
            expect(interceptor.tryIntercept('use admin')).toBeUndefined();
        });

        it('does not intercept empty input', () => {
            expect(interceptor.tryIntercept('')).toBeUndefined();
            expect(interceptor.tryIntercept('   ')).toBeUndefined();
        });
    });
});
