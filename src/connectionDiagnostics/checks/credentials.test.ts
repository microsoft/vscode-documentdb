/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type RunContext } from '@documentdb-js/connection-diagnostics';
import { describe, expect, it } from 'vitest';
import { AuthMethodId } from '../../documentdb/auth/AuthMethod';
import { type TroubleshooterSetup } from '../input';
import { createCredentialsCheck } from './credentials';

describe('credentials check', (): void => {
    it.each([
        ['available', AuthMethodId.NativeAuth, undefined],
        ['available', AuthMethodId.NoAuth, undefined],
        ['noMethod', undefined, 'method'],
        ['passwordMissing', AuthMethodId.NativeAuth, 'password'],
    ] as const)(
        'always passes for %s (%s), recording only safe method and state',
        async (credentialState, chosenAuthMethod, missing): Promise<void> => {
            const setup: TroubleshooterSetup = {
                input: { connectionString: 'mongodb://secret-user:secret-password@host/' },
                credentialState,
                chosenAuthMethod,
                connectionProperties: undefined,
                transientCredentials: undefined,
            };
            const check = createCredentialsCheck((): TroubleshooterSetup => setup);
            expect(check.id).toBe('credentials');
            expect(check.dependsOn).toEqual(['connectionString']);
            const result = await check.run({} as RunContext, new AbortController().signal);
            expect(result.status).toBe('pass');
            expect(result.facts).toEqual({ authMethod: chosenAuthMethod ?? null, credentialState });
            if (missing) {
                expect(result.findings).toEqual([
                    expect.objectContaining({
                        code: 'cs.credentialsMissing',
                        severity: 'info',
                        data: { missing, ...(chosenAuthMethod ? { authMethod: chosenAuthMethod } : {}) },
                        detail: { language: 'en', text: expect.any(String) },
                    }),
                ]);
            } else {
                expect(result.findings).toEqual([]);
            }
            expect(JSON.stringify(result)).not.toMatch(/secret-user|secret-password/);
        },
    );
});
