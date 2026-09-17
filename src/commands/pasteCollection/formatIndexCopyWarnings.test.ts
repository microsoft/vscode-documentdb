/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { formatIndexCopyWarnings } from './formatIndexCopyWarnings';

describe('formatIndexCopyWarnings', () => {
    it('names unique and TTL indexes in separate warnings', () => {
        expect(formatIndexCopyWarnings(['email_1', 'tenant_1'], ['expiresAt_1'])).toEqual([
            '⚠️ Unique indexes ("email_1", "tenant_1") may reject copied documents that conflict with existing values or generated IDs.',
            '⚠️ TTL indexes ("expiresAt_1") may delete expired documents while the copy is running.',
        ]);
    });

    it('returns no warnings when neither option is present', () => {
        expect(formatIndexCopyWarnings([], [])).toEqual([]);
    });
});