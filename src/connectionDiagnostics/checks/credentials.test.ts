/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type RunContext } from '@documentdb-js/connection-diagnostics';
import { describe, expect, it } from 'vitest';
import { AuthMethodId } from '../../documentdb/auth/AuthMethod';
import { type DiagnosticsSetup } from '../input';
import { createCredentialsCheck } from './credentials';

describe('credentials check', (): void => {
    it.each(['accessDenied', 'notFound'] as const)(
        'allows network checks and records the bounded Kubernetes Secret %s issue',
        async (reason): Promise<void> => {
            const result = await createCredentialsCheck(
                (): DiagnosticsSetup => ({
                    input: { connectionString: 'mongodb://private.example/' },
                    credentialState: 'passwordMissing',
                    chosenAuthMethod: AuthMethodId.NativeAuth,
                    passwordReadIssue: { source: 'kubernetes', reason },
                    connectionProperties: undefined,
                    transientCredentials: undefined,
                }),
            ).run({} as RunContext, new AbortController().signal);
            expect(result.status).toBe('pass');
            expect(result.facts).toEqual({ authMethod: AuthMethodId.NativeAuth, credentialState: 'passwordMissing' });
            expect(result.findings).toEqual([
                expect.objectContaining({
                    code: 'cs.credentialsMissing',
                    data: {
                        missing: 'password',
                        authMethod: AuthMethodId.NativeAuth,
                        passwordSource: 'kubernetes',
                        passwordReadIssue: reason,
                    },
                }),
            ]);
        },
    );

    it.each([
        ['available', AuthMethodId.NativeAuth, undefined],
        ['available', AuthMethodId.NoAuth, undefined],
        ['noMethod', undefined, 'method'],
        ['passwordMissing', AuthMethodId.NativeAuth, 'password'],
    ] as const)(
        'always passes for %s (%s), recording only safe method and state',
        async (credentialState, chosenAuthMethod, missing): Promise<void> => {
            const setup: DiagnosticsSetup = {
                input: { connectionString: 'mongodb://secret-user:secret-password@host/' },
                credentialState,
                chosenAuthMethod,
                connectionProperties: undefined,
                transientCredentials: undefined,
            };
            const check = createCredentialsCheck((): DiagnosticsSetup => setup);
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
