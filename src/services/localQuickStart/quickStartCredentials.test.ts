/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DocumentDBConnectionString } from '../../documentdb/utils/DocumentDBConnectionString';
import {
    composeConnectionString,
    generateCredentials,
    generateToken,
    getPasswordEncodingProblem,
    secretVariants,
} from './quickStartCredentials';

const ALNUM = /^[A-Za-z0-9]+$/;

describe('quickStartCredentials (Quick Start D6)', () => {
    describe('generateToken', () => {
        it('produces a token of the requested length from the URL-safe alphabet', () => {
            const token = generateToken(24);
            expect(token).toHaveLength(24);
            expect(token).toMatch(ALNUM);
        });

        it('returns empty for non-positive lengths', () => {
            expect(generateToken(0)).toBe('');
            expect(generateToken(-5)).toBe('');
        });

        it('is effectively random across calls', () => {
            expect(generateToken(24)).not.toBe(generateToken(24));
        });
    });

    describe('generateCredentials', () => {
        it('generates URL-safe username and password', () => {
            const { username, password } = generateCredentials();
            expect(username).toMatch(ALNUM);
            expect(password).toMatch(ALNUM);
            expect(password.length).toBeGreaterThanOrEqual(24);
        });

        it('never produces an all-digit username', () => {
            for (let i = 0; i < 50; i++) {
                expect(/^\d+$/.test(generateCredentials().username)).toBe(false);
            }
        });
    });

    describe('composeConnectionString', () => {
        it('targets localhost on the given port with TLS-allow-invalid', () => {
            const cs = composeConnectionString('admin', 'pw', 10260);
            expect(cs).toContain('localhost:10260');
            expect(cs).toContain('tls=true');
            expect(cs).toContain('tlsAllowInvalidCertificates=true');
        });

        it('percent-encodes credentials that contain URI-significant characters', () => {
            // belt-and-suspenders: even if a password somehow contains special chars,
            // the connection string must round-trip correctly (design §8.1).
            const password = 'p@ss:w/rd?#[]';
            const cs = composeConnectionString('user', password, 10260);
            expect(cs).not.toContain(password);
            const parsed = new DocumentDBConnectionString(cs);
            expect(parsed.password).toBe(password);
            expect(parsed.username).toBe('user');
        });

        it('round-trips generated credentials', () => {
            const { username, password } = generateCredentials();
            const parsed = new DocumentDBConnectionString(composeConnectionString(username, password));
            expect(parsed.username).toBe(username);
            expect(parsed.password).toBe(password);
        });
    });

    describe('getPasswordEncodingProblem', () => {
        it('accepts passwords SASLprep can map', () => {
            for (const password of ['Str0ng!Pass', 'pässwörd1', 'pass\u00adword1', 'a\u00a0b12345', '\ufb01nance12']) {
                expect(getPasswordEncodingProblem(password)).toBeUndefined();
            }
        });

        // The driver throws these before connecting, so setup used to wait out the readiness timeout.
        it('flags characters SASLprep rejects', () => {
            expect(getPasswordEncodingProblem('pass😀word')).toBe('unsupportedCharacter');
            expect(getPasswordEncodingProblem('₹rupee123')).toBe('unsupportedCharacter');
        });

        it('flags a password that maps to nothing', () => {
            expect(getPasswordEncodingProblem('\u00ad\u00ad')).toBe('unsupportedCharacter');
        });

        it('flags mixed right-to-left and left-to-right text', () => {
            expect(getPasswordEncodingProblem('abcمرحبا123')).toBe('rightToLeft');
        });
    });

    describe('secretVariants', () => {
        it('adds the percent-encoded form of a custom password (L6)', () => {
            const password = 'p@ss:w/rd#';
            const variants = secretVariants(password);
            expect(variants).toContain(password);
            expect(variants).toContain(encodeURIComponent(password));
        });

        it('emits a URL-safe password only once (raw === encoded)', () => {
            const { password } = generateCredentials();
            expect(secretVariants(password)).toEqual([password]);
        });

        it('skips empty secrets', () => {
            expect(secretVariants('', undefined as unknown as string)).toEqual([]);
        });
    });
});
