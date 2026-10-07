/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it, vi } from 'vitest';

import type * as vscode from 'vscode';
import { improveError } from './improveError';

vi.mock('vscode', async () => ({
    ...(await vi.importActual<typeof vscode>('vscode')),
    CancellationError: class extends Error {},
}));

describe('improveError', () => {
    it('explains a missing executable, including paths with spaces', () => {
        const improved = improveError(new Error('spawn /tools/database client ENOENT'));

        expect(improved).toBeInstanceOf(Error);
        expect(improved).toHaveProperty('message', 'Could not find /tools/database client');
    });

    it.each([new Error('Connection refused'), 'Connection refused'])('preserves unrelated errors: %s', (error) => {
        expect(improveError(error)).toBe(error);
    });
});
