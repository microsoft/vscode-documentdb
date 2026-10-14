/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it, vi } from 'vitest';

import * as os from 'os';
import type * as vscode from 'vscode';
import { wrapError } from './wrapError';

vi.mock('vscode', async () => ({
    ...(await vi.importActual<typeof vscode>('vscode')),
    CancellationError: class extends Error {},
}));

describe('wrapError', () => {
    it('returns the supplied error when the other error is absent', () => {
        const error = new Error('Connection failed');

        expect(wrapError(error)).toBe(error);
        expect(wrapError(undefined, error)).toBe(error);
    });

    it('returns an outer string unchanged when the inner error is absent', () => {
        expect(wrapError('Query failed')).toBe('Query failed');
    });

    it('returns an inner string unchanged when the outer error is absent', () => {
        expect(wrapError(undefined, 'Invalid input')).toBe('Invalid input');
    });

    it('appends the inner message while preserving the outer error identity', () => {
        const outer = new TypeError('Query failed');

        expect(wrapError(outer, new Error('Invalid input'))).toBe(outer);
        expect(outer.message).toBe(`Query failed${os.EOL}Invalid input`);
        expect(outer).toBeInstanceOf(TypeError);
    });

    it('combines string errors into an Error', () => {
        const wrapped = wrapError('Query failed', 'Invalid input');

        expect(wrapped).toBeInstanceOf(Error);
        expect(wrapped).toHaveProperty('message', `Query failed${os.EOL}Invalid input`);
    });

    it('combines an outer string and an inner Error into a new Error', () => {
        const inner = new TypeError('Invalid input');
        const wrapped = wrapError('Query failed', inner);

        expect(wrapped).toBeInstanceOf(Error);
        expect(wrapped).not.toBe(inner);
        expect(wrapped).toHaveProperty('message', `Query failed${os.EOL}Invalid input`);
        expect(inner.message).toBe('Invalid input');
    });

    it('appends an inner string while preserving the outer Error identity and type', () => {
        const outer = new TypeError('Query failed');
        const wrapped = wrapError(outer, 'Invalid input');

        expect(wrapped).toBe(outer);
        expect(wrapped).toBeInstanceOf(TypeError);
        expect(wrapped).toHaveProperty('message', `Query failed${os.EOL}Invalid input`);
    });
});
