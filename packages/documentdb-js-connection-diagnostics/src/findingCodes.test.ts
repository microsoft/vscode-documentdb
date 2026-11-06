/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, expectTypeOf, it } from 'vitest';

import { builtInFindingCodes, isBuiltInFindingCode, skipReasons } from './index.js';

import { type BuiltInFindingCode, type Finding } from './index.js';

describe('builtInFindingCodes', (): void => {
    it('contains no duplicates', (): void => {
        expect(new Set(builtInFindingCodes).size).toBe(builtInFindingCodes.length);
    });

    it('uses the public finding code format', (): void => {
        for (const code of builtInFindingCodes) {
            expect(code).toMatch(/^[a-z]+\.[a-zA-Z]+$/);
        }
    });

    it('excludes extension-owned finding codes', (): void => {
        for (const code of builtInFindingCodes) {
            expect(code).not.toMatch(/^(auth|access)\./);
        }
        expect(builtInFindingCodes).not.toContain('env.remoteExtensionHost');
        expect(builtInFindingCodes).not.toContain('cs.credentialsMissing');
        expect(builtInFindingCodes).not.toContain('hello.advertisedMembersUnreachable');
    });
});

describe('isBuiltInFindingCode', (): void => {
    it.each(builtInFindingCodes)('recognizes %s', (code): void => {
        expect(isBuiltInFindingCode(code)).toBe(true);
    });

    it.each([
        '',
        'unknown.code',
        'tcp.Refused',
        'tcp.refused.extra',
        'auth.failed',
        'access.listDatabasesDenied',
        'env.remoteExtensionHost',
        'cs.credentialsMissing',
        'hello.advertisedMembersUnreachable',
    ])('rejects %j', (code): void => {
        expect(isBuiltInFindingCode(code)).toBe(false);
    });
});

describe('skipReasons', (): void => {
    it('contains exactly the five public skip reasons', (): void => {
        expect(skipReasons).toEqual([
            'notApplicable',
            'inputUnavailable',
            'dependencyFailed',
            'dependencySkipped',
            'runTimeoutExceeded',
        ]);
    });
});

describe('Finding', (): void => {
    it('requires an English detail', (): void => {
        expectTypeOf<Finding<BuiltInFindingCode>['detail']>().toEqualTypeOf<{
            readonly language: 'en';
            readonly text: string;
        }>();
    });
});
