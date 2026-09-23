/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    describePasswordEncodingProblem,
    getCredentialValidation,
    getPasswordEncodingState,
    needsPasswordEncodingCheck,
} from './credentialValidation';

const PASSWORD = 'Passw0rd!x';
const custom = (username: string, password: string) =>
    getCredentialValidation({ useCustomCredentials: true, username, password });
const usernameError = (username: string) => custom(username, PASSWORD);
const passwordError = (password: string) => custom('devuser', password);

// Every rejected value below made the real documentdb-local image (0.117.0) fail after the wizard
// accepted it: the container exited, logins timed out, or queries failed after setup succeeded.
describe('getCredentialValidation', () => {
    it('ignores stale field values once credentials are auto-generated again', () => {
        expect(
            getCredentialValidation({ useCustomCredentials: false, username: 'a'.repeat(129), password: '' }),
        ).toBeUndefined();
        expect(
            getCredentialValidation({ useCustomCredentials: false, username: 'documentdb', password: ' x ' }),
        ).toBeUndefined();
    });

    it('accepts both blank or both filled', () => {
        expect(custom('', '')).toBeUndefined();
        expect(custom('devuser', PASSWORD)).toBeUndefined();
    });

    it('requires both a username and a password', () => {
        expect(custom('devuser', '')?.field).toBe('credentials');
        expect(custom('', PASSWORD)?.field).toBe('credentials');
    });

    it("reports a filled field's own problem before asking for the other field", () => {
        expect(custom('pgadmin', '')?.field).toBe('username');
        expect(custom('', ' x')?.field).toBe('password');
    });

    it('reports the username before the password', () => {
        expect(custom('my user', ' x')?.field).toBe('username');
    });

    describe('username', () => {
        it('accepts names the image handles', () => {
            for (const name of [
                "o'brien",
                "abc'",
                'abc-',
                'dq"uote',
                'at@col:sl/pc%',
                'x!#$&()*+;<>?[]^{|}~',
                'josé',
                'emoji😀',
                'mypg',
                'PUBLIC',
                'current_user',
                'a'.repeat(63),
                '用'.repeat(21),
            ]) {
                expect(usernameError(name)).toBeUndefined();
            }
        });

        it('rejects names longer than 63 bytes', () => {
            expect(usernameError('a'.repeat(64))).toEqual({
                field: 'username',
                message: 'Username must be 63 characters or fewer.',
            });
            // 32 characters, 64 bytes.
            expect(usernameError('é'.repeat(32))?.message).toBe(
                'Username must be 63 bytes or fewer. Accented and non-Latin characters take 2 to 4 bytes each.',
            );
            expect(usernameError('用'.repeat(21) + 'a')?.field).toBe('username');
        });

        it('rejects whitespace anywhere', () => {
            for (const name of ['my user', ' devuser', 'devuser ', 'nb\u00a0sp']) {
                expect(usernameError(name)?.message).toBe('Username must not contain spaces.');
            }
        });

        it('rejects control characters and line breaks', () => {
            for (const name of ['ad\tmin', 'ad\nmin', 'ad\u0085min', 'ad\u2028min', 'dev\ud800']) {
                expect(usernameError(name)?.message).toBe('Username must not contain control characters.');
            }
        });

        it('rejects characters that break the connection string or SCRAM', () => {
            for (const name of ['back\\slash', 'eq=ual', 'com,ma']) {
                expect(usernameError(name)?.message).toBe(
                    'Username must not contain a backslash (\\), equals sign (=), or comma (,).',
                );
            }
        });

        it('rejects a leading apostrophe or hyphen', () => {
            for (const name of ["'lead", '-lead']) {
                expect(usernameError(name)?.message).toBe(
                    "Username must not start with an apostrophe (') or a hyphen (-).",
                );
            }
        });

        it('rejects reserved prefixes in any letter case', () => {
            expect(usernameError('documentdb')?.message).toBe(
                'Usernames starting with “documentdb” are reserved by DocumentDB. Pick a different one.',
            );
            expect(usernameError('DocumentDB_Admin')?.message).toContain('“documentdb”');
            expect(usernameError('pgadmin')?.message).toContain('“pg”');
            expect(usernameError('Citus1')?.message).toContain('“citus”');
            expect(usernameError('internal_role_x')?.message).toContain('“internal_role”');
        });

        it('rejects role names PostgreSQL reserves', () => {
            expect(usernameError('public')?.message).toBe('The username “public” is reserved. Pick a different one.');
            expect(usernameError('none')?.field).toBe('username');
        });
    });

    describe('password', () => {
        it('accepts passwords the image handles', () => {
            for (const password of [
                'correct horse battery',
                'a"b\'c',
                'a/b@c:d%e#f?g&h',
                '$HOME`id`$(id)',
                'pässwörd',
                'abc',
                'a-b',
                'x'.repeat(256),
            ]) {
                expect(passwordError(password)).toBeUndefined();
            }
        });

        it('rejects surrounding whitespace instead of trimming it', () => {
            for (const password of ['  abc  ', ' abc', 'abc ', 'abc\u00a0']) {
                expect(passwordError(password)?.message).toBe('Password must not start or end with a space.');
            }
        });

        // A space typed between the words of a passphrase is trailing only until the next word.
        it('marks only a trailing space as possibly mid-typing', () => {
            expect(passwordError('correct horse ')?.transient).toBe(true);
            expect(passwordError(' correct horse')?.transient).toBeUndefined();
        });

        it('rejects control characters and line breaks', () => {
            for (const password of ['abcd\tefgh', 'ab\u0085cd', 'ab\u2028cd', 'ab\u2029cd']) {
                expect(passwordError(password)?.message).toBe('Password must not contain control characters.');
            }
        });

        it('rejects a backslash and a leading hyphen', () => {
            expect(passwordError('a\\nb')?.message).toBe('Password must not contain a backslash (\\).');
            expect(passwordError('-Passw0rd')?.message).toBe('Password must not start with a hyphen (-).');
        });

        it('rejects passwords longer than 256 characters', () => {
            expect(passwordError('x'.repeat(257))?.message).toBe('Password must be 256 characters or fewer.');
        });
    });
});

describe('needsPasswordEncodingCheck', () => {
    it('skips printable ASCII, which always passes SASLprep', () => {
        expect(needsPasswordEncodingCheck('Passw0rd! ~')).toBe(false);
    });

    it('checks anything else', () => {
        expect(needsPasswordEncodingCheck('pass😀word')).toBe(true);
        expect(needsPasswordEncodingCheck('pässwörd')).toBe(true);
    });
});

describe('getPasswordEncodingState', () => {
    const state = (password: string, lastCheck?: { password: string; result: 'ok' | 'unsupportedCharacter' }) =>
        getPasswordEncodingState({ useCustomCredentials: true, password, lastCheck });

    it('needs no check for printable ASCII or auto-generated credentials', () => {
        expect(state('Passw0rd')).toBe('ok');
        expect(
            getPasswordEncodingState({
                useCustomCredentials: false,
                password: 'pass😀',
                lastCheck: { password: 'pass😀', result: 'unsupportedCharacter' },
            }),
        ).toBe('ok');
    });

    it('uses the verdict for the current password', () => {
        expect(state('pass😀', { password: 'pass😀', result: 'unsupportedCharacter' })).toBe('unsupportedCharacter');
    });

    // Start stays disabled until the host has checked what is in the field now.
    it('never applies a verdict for an earlier password', () => {
        expect(state('pässwörd', { password: 'pässwör', result: 'ok' })).toBe('checking');
        expect(state('pässwörd')).toBe('checking');
    });
});

describe('describePasswordEncodingProblem', () => {
    it('points at the password field', () => {
        expect(describePasswordEncodingProblem('unsupportedCharacter').field).toBe('password');
        expect(describePasswordEncodingProblem('rightToLeft').message).toContain('right-to-left');
    });
});
