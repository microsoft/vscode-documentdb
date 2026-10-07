/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setEnvironmentVariables } from './setEnvironmentVariables';

describe('setEnvironmentVariables', () => {
    const originalEnvironment = process.env;

    beforeEach(() => {
        process.env = { ...process.env, DOCUMENTDB_TEST_EXISTING: 'original' };
    });

    afterEach(() => {
        process.env = originalEnvironment;
        vi.restoreAllMocks();
    });

    it('temporarily replaces an existing value and restores it on disposal', () => {
        const disposable = setEnvironmentVariables({ DOCUMENTDB_TEST_EXISTING: 'temporary' });

        expect(process.env.DOCUMENTDB_TEST_EXISTING).toBe('temporary');
        disposable.dispose();
        expect(process.env.DOCUMENTDB_TEST_EXISTING).toBe('original');
    });

    it('removes variables that were originally unset rather than storing the string undefined', () => {
        delete process.env.DOCUMENTDB_TEST_UNSET;
        const disposable = setEnvironmentVariables({ DOCUMENTDB_TEST_UNSET: 'temporary' });

        expect(process.env.DOCUMENTDB_TEST_UNSET).toBe('temporary');
        disposable.dispose();
        expect(process.env).not.toHaveProperty('DOCUMENTDB_TEST_UNSET');
    });
});
