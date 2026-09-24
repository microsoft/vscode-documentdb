/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { parseError } from '@microsoft/vscode-azext-utils';
import * as os from 'os';
import { wrapError } from './wrapError';

describe('wrapError', () => {
    it('returns a lone outer string as is', () => {
        expect(wrapError('Outer error')).toBe('Outer error');
    });

    it('returns a lone outer error as an error', () => {
        const wrapped = wrapError(new Error('Outer error'));

        expect(wrapped).toBeInstanceOf(Error);
        expect(parseError(wrapped).message).toBe('Outer error');
    });

    it('returns a lone inner string as is', () => {
        expect(wrapError(undefined, 'Inner error')).toBe('Inner error');
    });

    it.each([
        ['outer string, inner string', 'Outer error.', 'Inner error.'],
        ['outer error, inner string', new Error('Outer error.'), 'Inner error.'],
        ['outer error, inner error', new Error('Outer error.'), new Error('Inner error.')],
        ['outer string, inner error', 'Outer error.', new Error('Inner error.')],
    ])('joins %s on separate lines', (_name, outer, inner) => {
        const wrapped = wrapError(outer, inner);

        expect(wrapped).toBeInstanceOf(Error);
        expect(parseError(wrapped).message).toBe(`Outer error.${os.EOL}Inner error.`);
    });
});
