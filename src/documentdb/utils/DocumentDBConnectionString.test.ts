/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DocumentDBConnectionString } from './DocumentDBConnectionString';

describe('DocumentDBConnectionString', () => {
    describe('password handling with special characters', () => {
        const testPasswords = [
            { name: 'simple password', password: 'simple' },
            { name: 'password with spaces', password: 'with space' },
            { name: 'password with common special characters', password: 'password!@#$%' },
            { name: 'password with URL-significant characters', password: 'user:pass@host' },
            { name: 'complex password with multiple special characters', password: 'p@$#$w0rd!&*()' },
            { name: 'password with percent encoding', password: 'pass%20word' },
            { name: 'password with equals sign', password: 'password=123' },
            { name: 'password with ampersand', password: 'pass&word' },
            { name: 'password with question mark', password: 'pass?word' },
            { name: 'password with hash', password: 'pass#word' },
            { name: 'password with plus sign', password: 'pass+word' },
            { name: 'password that is just "crazy"', password: 'SuperSecurePassword123!@@##++{}%$ ..//~`~' },
        ];

        testPasswords.forEach(({ name, password }) => {
            it(`should handle ${name} correctly`, () => {
                // Test setting and getting password
                const connectionString = new DocumentDBConnectionString('mongodb://user:temp@localhost:27017/test');
                connectionString.password = password;

                // Verify the password is retrieved correctly
                expect(connectionString.password).toBe(password);

                // Convert to string format
                const connectionStringText = connectionString.toString();
                expect(connectionStringText).toContain('mongodb://');

                // Create a new instance from that string and verify password is still correct
                const newConnectionString = new DocumentDBConnectionString(connectionStringText);
                expect(newConnectionString.password).toBe(password);
            });
        });
    });

    describe('encoding and decoding', () => {
        it('should properly encode passwords when set', () => {
            const connectionString = new DocumentDBConnectionString('mongodb://localhost:27017/test');
            const password = 'p#$s:word@host';
            connectionString.password = password;

            // The password should be retrievable in its original form
            expect(connectionString.password).toBe(password);

            // The connection string should contain the encoded version
            const connectionStringText = connectionString.toString();
            expect(connectionStringText).toContain(encodeURIComponent(password));
            expect(connectionStringText).not.toContain(password); // Raw password should not appear
        });

        it('should handle pre-encoded passwords in connection strings', () => {
            const originalPassword = 'p#$s:word@host';
            const encodedPassword = encodeURIComponent(originalPassword);
            const connectionString = new DocumentDBConnectionString(
                `mongodb://user:${encodedPassword}@localhost:27017/test`,
            );

            expect(connectionString.password).toBe(originalPassword);
        });

        it('should handle double-encoded passwords gracefully', () => {
            const originalPassword = 'p#$s:word@host';
            const doubleEncoded = encodeURIComponent(encodeURIComponent(originalPassword));
            const connectionString = new DocumentDBConnectionString(
                `mongodb://user:${doubleEncoded}@localhost:27017/test`,
            );

            // Should decode once to get the single-encoded version
            expect(connectionString.password).toBe(encodeURIComponent(originalPassword));
        });
    });

    describe('edge cases', () => {
        it('should handle empty password', () => {
            const connectionString = new DocumentDBConnectionString('mongodb://user:pass@localhost:27017/test');
            connectionString.password = '';

            expect(connectionString.password).toBe('');

            // The connection string should not contain any password
            const connectionStringText = connectionString.toString();
            expect(connectionStringText).toContain('mongodb://user@localhost:27017/test');
        });

        it('should maintain other connection string properties', () => {
            const connectionString = new DocumentDBConnectionString(
                'mongodb://user:pass@localhost:27017/testdb?ssl=true',
            );
            connectionString.password = 'newpass:word@host';

            expect(connectionString.username).toBe('user');
            expect(connectionString.hosts).toEqual(['localhost:27017']);
            expect(connectionString.searchParams.get('ssl')).toBe('true');
        });
    });

    describe('toString() behavior', () => {
        it('should generate valid connection strings with encoded passwords', () => {
            const connectionString = new DocumentDBConnectionString('mongodb://localhost:27017/test');
            connectionString.username = 'user';
            connectionString.password = 'pass:word@host';

            const result = connectionString.toString();
            expect(result).toContain('mongodb://');
            expect(result).toContain('user');
            expect(result).toContain(encodeURIComponent('pass:word@host'));
            expect(result).not.toContain('pass:word@host'); // Raw password should not appear
        });

        it('should be parseable by standard MongoDB drivers', () => {
            const connectionString = new DocumentDBConnectionString('mongodb://localhost:27017/test');
            connectionString.username = 'user';
            connectionString.password = 'p@$#$w0rd!&*()';

            const connectionStringText = connectionString.toString();

            // Should be parseable by another instance
            const parsedConnectionString = new DocumentDBConnectionString(connectionStringText);
            expect(parsedConnectionString.username).toBe('user');
            expect(parsedConnectionString.password).toBe('p@$#$w0rd!&*()');
        });
    });

    describe('compatibility with base ConnectionString', () => {
        it('should produce the same output as the base class for the same input', async () => {
            // Import the base ConnectionString class
            const { ConnectionString } = await import('mongodb-connection-string-url');

            // Create instances of both classes with the same input
            const baseString = 'mongodb://user:pass@localhost:27017/test?ssl=true';
            const baseConnectionString = new ConnectionString(baseString);
            const documentDBConnectionString = new DocumentDBConnectionString(baseString);

            // Verify they both parse the connection string identically
            expect(documentDBConnectionString.username).toBe(baseConnectionString.username);
            expect(documentDBConnectionString.hosts).toEqual(baseConnectionString.hosts);
            expect(documentDBConnectionString.pathname).toBe(baseConnectionString.pathname);
            expect(documentDBConnectionString.searchParams.get('ssl')).toBe(
                baseConnectionString.searchParams.get('ssl'),
            );

            // Verify toString produces compatible output (after our encoding handling)
            const baseOutput = baseConnectionString.toString();
            const documentDBOutput = documentDBConnectionString.toString();

            // URLs should be functionally equivalent even if password encoding differs
            const baseUrl = new URL(baseOutput);
            const documentDBUrl = new URL(documentDBOutput);

            expect(baseUrl.protocol).toBe(documentDBUrl.protocol);
            expect(baseUrl.hostname).toBe(documentDBUrl.hostname);
            expect(baseUrl.port).toBe(documentDBUrl.port);
            expect(baseUrl.pathname).toBe(documentDBUrl.pathname);
            expect(baseUrl.search).toBe(documentDBUrl.search);
        });
    });
});
