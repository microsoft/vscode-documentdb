/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getCredentialValidation } from './credentialValidation';

const custom = (username: string, password: string) =>
    getCredentialValidation({ useCustomCredentials: true, username, password });

describe('getCredentialValidation', () => {
    it('ignores stale field values once credentials are auto-generated again', () => {
        expect(getCredentialValidation({ useCustomCredentials: false, username: 'admin', password: 'short' })).toBe(
            undefined,
        );
        expect(getCredentialValidation({ useCustomCredentials: false, username: 'admin', password: '' })).toBe(
            undefined,
        );
    });

    it('accepts both blank or both filled with a long enough password', () => {
        expect(custom('', '')).toBeUndefined();
        expect(custom('admin', 'abcdefgh')).toBeUndefined();
        expect(custom(' admin ', ' abcdefgh ')).toBeUndefined();
    });

    it('requires both a username and a password', () => {
        expect(custom('admin', '')?.field).toBe('credentials');
        expect(custom('', 'abcdefgh')?.field).toBe('credentials');
    });

    it('rejects a password shorter than 8 characters after trimming', () => {
        expect(custom('admin', 'e')).toEqual({ field: 'password', message: 'Password must be at least 8 characters.' });
        expect(custom('admin', '  abcdefg  ')?.field).toBe('password');
    });

    it('rejects over-long values and control characters', () => {
        expect(custom('a'.repeat(129), 'abcdefgh')?.field).toBe('username');
        expect(custom('admin', 'a'.repeat(257))?.field).toBe('password');
        expect(custom('ad\nmin', 'abcdefgh')?.field).toBe('username');
        expect(custom('admin', 'abcd\tefgh')?.field).toBe('password');
    });
});
