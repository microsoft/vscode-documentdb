/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DocumentDBConnectionString } from '../../documentdb/utils/DocumentDBConnectionString';
import { composeConnectionString, generateCredentials, generateToken } from './quickStartCredentials';

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
});
