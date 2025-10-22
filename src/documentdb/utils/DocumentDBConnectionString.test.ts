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

    describe('constructor with special characters in query parameters', () => {
        it('should parse connection string with @ in appName parameter', () => {
            // This is the exact case from the issue - the base class would fail to parse this
            const uri =
                'mongodb://myaccount.a-host.local:10255/?ssl=true&replicaSet=globaldb&retrywrites=false&maxIdleTimeMS=120000&appName=@myaccount@';

            const connStr = new DocumentDBConnectionString(uri);

            expect(connStr.hosts).toEqual(['myaccount.a-host.local:10255']);
            expect(connStr.username).toBe('');
            expect(connStr.password).toBe('');
            expect(connStr.searchParams.get('ssl')).toBe('true');
            expect(connStr.searchParams.get('replicaSet')).toBe('globaldb');
            expect(connStr.searchParams.get('retrywrites')).toBe('false');
            expect(connStr.searchParams.get('maxIdleTimeMS')).toBe('120000');
            // URLSearchParams.get() returns decoded values
            expect(connStr.searchParams.get('appName')).toBe('@myaccount@');
        });

        it('should parse connection string with multiple @ in different parameters', () => {
            const uri = 'mongodb://host.example.com:27017/?appName=@user@&tag=@prod@';

            const connStr = new DocumentDBConnectionString(uri);

            expect(connStr.hosts).toEqual(['host.example.com:27017']);
            expect(connStr.username).toBe('');
            expect(connStr.password).toBe('');
            // URLSearchParams.get() returns decoded values
            expect(connStr.searchParams.get('appName')).toBe('@user@');
            expect(connStr.searchParams.get('tag')).toBe('@prod@');
        });

        it('should parse connection string with # in query parameters', () => {
            // Note: # is a fragment identifier in URLs, so anything after # is considered a fragment, not a query param
            // We encode # to %23 to include it in query parameter values
            const uri = 'mongodb://host.example.com:27017/?tag=prod%23123&appName=app%231';

            const connStr = new DocumentDBConnectionString(uri);

            expect(connStr.hosts).toEqual(['host.example.com:27017']);
            // URLSearchParams.get() returns decoded values
            expect(connStr.searchParams.get('tag')).toBe('prod#123');
            expect(connStr.searchParams.get('appName')).toBe('app#1');
        });

        it('should parse connection string with [] in query parameters', () => {
            const uri = 'mongodb://host.example.com:27017/?tag=[prod]&filter=[active]';

            const connStr = new DocumentDBConnectionString(uri);

            expect(connStr.hosts).toEqual(['host.example.com:27017']);
            // URLSearchParams.get() returns decoded values
            expect(connStr.searchParams.get('tag')).toBe('[prod]');
            expect(connStr.searchParams.get('filter')).toBe('[active]');
        });

        it('should handle connection string without query parameters', () => {
            const uri = 'mongodb://host.example.com:27017/database';

            const connStr = new DocumentDBConnectionString(uri);

            expect(connStr.hosts).toEqual(['host.example.com:27017']);
            expect(connStr.pathname).toBe('/database');
            expect(connStr.username).toBe('');
            expect(connStr.password).toBe('');
        });

        it('should handle connection string with query parameters but no special characters', () => {
            const uri = 'mongodb://host.example.com:27017/?ssl=true&replicaSet=rs0';

            const connStr = new DocumentDBConnectionString(uri);

            expect(connStr.hosts).toEqual(['host.example.com:27017']);
            expect(connStr.searchParams.get('ssl')).toBe('true');
            expect(connStr.searchParams.get('replicaSet')).toBe('rs0');
        });

        it('should handle normal connection strings without issues', () => {
            // Ensure regular, well-formed connection strings work correctly
            const uri = 'mongodb://localhost:27017/mydb?ssl=true&authSource=admin';

            const connStr = new DocumentDBConnectionString(uri);

            expect(connStr.hosts).toEqual(['localhost:27017']);
            expect(connStr.pathname).toBe('/mydb');
            expect(connStr.searchParams.get('ssl')).toBe('true');
            expect(connStr.searchParams.get('authSource')).toBe('admin');
        });

        it('should handle parameters without values', () => {
            const uri = 'mongodb://host.example.com:27017/?ssl&replicaSet=rs0';

            const connStr = new DocumentDBConnectionString(uri);

            expect(connStr.hosts).toEqual(['host.example.com:27017']);
            expect(connStr.searchParams.has('ssl')).toBe(true);
            expect(connStr.searchParams.get('replicaSet')).toBe('rs0');
        });
    });

    describe('constructor with credentials and special characters in query parameters', () => {
        it('should parse connection string with credentials and @ in query parameters', () => {
            const uri = 'mongodb://user:pass@host.example.com:27017/?appName=@myapp@';

            const connStr = new DocumentDBConnectionString(uri);

            expect(connStr.hosts).toEqual(['host.example.com:27017']);
            expect(connStr.username).toBe('user');
            expect(connStr.password).toBe('pass');
            // URLSearchParams.get() returns decoded values
            expect(connStr.searchParams.get('appName')).toBe('@myapp@');
        });

        it('should handle credentials with special characters and @ in query parameters', () => {
            const uri = 'mongodb://host.example.com:27017/?appName=@app@';
            const connStr = new DocumentDBConnectionString(uri);

            // Set username and password using setters
            connStr.username = 'user@domain';
            connStr.password = 'p@ss!word#123';

            expect(connStr.username).toBe('user@domain');
            expect(connStr.password).toBe('p@ss!word#123');
            // URLSearchParams.get() returns decoded values
            expect(connStr.searchParams.get('appName')).toBe('@app@');
        });

        it('should encode and decode username with special characters', () => {
            const uri = 'mongodb://host.example.com:27017/';
            const connStr = new DocumentDBConnectionString(uri);

            // Test various special characters in username
            const testUsername = 'user@domain.com';
            connStr.username = testUsername;

            expect(connStr.username).toBe(testUsername);
        });

        it('should encode and decode password with special characters', () => {
            const uri = 'mongodb://host.example.com:27017/';
            const connStr = new DocumentDBConnectionString(uri);

            // Test various special characters in password
            const testPassword = 'p@ss:w/ord?#[]';
            connStr.password = testPassword;

            expect(connStr.password).toBe(testPassword);
        });
    });

    describe('username setter and getter', () => {
        it('should properly encode and decode username', () => {
            const uri = 'mongodb://host.example.com:27017/';
            const connStr = new DocumentDBConnectionString(uri);

            const username = 'user@domain.com';
            connStr.username = username;

            expect(connStr.username).toBe(username);
        });

        it('should handle empty username', () => {
            const uri = 'mongodb://host.example.com:27017/';
            const connStr = new DocumentDBConnectionString(uri);

            connStr.username = '';

            expect(connStr.username).toBe('');
        });

        it('should handle username with special characters', () => {
            const uri = 'mongodb://host.example.com:27017/';
            const connStr = new DocumentDBConnectionString(uri);

            const username = 'user+tag@domain.com';
            connStr.username = username;

            expect(connStr.username).toBe(username);
        });

        it('should preserve username through toString and re-parsing', () => {
            const uri = 'mongodb://initialuser@host.example.com:27017/';
            const connStr = new DocumentDBConnectionString(uri);

            const newUsername = 'user@domain.com';
            connStr.username = newUsername;
            connStr.password = 'somePassword';

            const connectionStringText = connStr.toString();
            const reparsed = new DocumentDBConnectionString(connectionStringText);

            expect(reparsed.username).toBe(newUsername);
        });
    });

    describe('validateUsername', () => {
        it('should validate normal usernames', () => {
            expect(DocumentDBConnectionString.validateUsername('user')).toBe(true);
            expect(DocumentDBConnectionString.validateUsername('user123')).toBe(true);
        });

        it('should validate usernames with special characters', () => {
            expect(DocumentDBConnectionString.validateUsername('user@domain')).toBe(true);
            expect(DocumentDBConnectionString.validateUsername('user+tag')).toBe(true);
        });

        it('should validate empty username', () => {
            expect(DocumentDBConnectionString.validateUsername('')).toBe(true);
        });
    });

    describe('real-world Azure Cosmos DB connection strings', () => {
        it('should parse Azure Cosmos DB for MongoDB RU connection string', () => {
            const uri =
                'mongodb://myaccount.a-host.local:10255/?ssl=true&replicaSet=globaldb&retrywrites=false&maxIdleTimeMS=120000&appName=@myaccount@';

            const connStr = new DocumentDBConnectionString(uri);

            expect(connStr.hosts).toEqual(['myaccount.a-host.local:10255']);
            expect(connStr.searchParams.get('ssl')).toBe('true');
            expect(connStr.searchParams.get('replicaSet')).toBe('globaldb');
            expect(connStr.searchParams.get('retrywrites')).toBe('false');
        });

        it('should parse Azure Cosmos DB connection string with credentials', () => {
            const uri = 'mongodb://myaccount.a-host.local:10255/?ssl=true&appName=@myaccount@';
            const connStr = new DocumentDBConnectionString(uri);

            // Simulate adding credentials after construction
            connStr.username = 'myaccount';
            connStr.password = 'someComplexKey123==';

            expect(connStr.username).toBe('myaccount');
            expect(connStr.password).toBe('someComplexKey123==');
            expect(connStr.hosts).toEqual(['myaccount.a-host.local:10255']);
            expect(connStr.searchParams.get('ssl')).toBe('true');
        });

        it('should handle MongoDB Atlas-style connection strings', () => {
            const uri = 'mongodb://cluster0.mongodb.net:27017/?retryWrites=true&w=majority&appName=myapp';

            const connStr = new DocumentDBConnectionString(uri);

            expect(connStr.hosts).toEqual(['cluster0.mongodb.net:27017']);
            expect(connStr.searchParams.get('retryWrites')).toBe('true');
            expect(connStr.searchParams.get('w')).toBe('majority');
            expect(connStr.searchParams.get('appName')).toBe('myapp');
        });

        it('should handle connection string with database name and special chars in params', () => {
            const uri = 'mongodb://host.example.com:27017/mydb?authSource=admin&appName=@myapp@';

            const connStr = new DocumentDBConnectionString(uri);

            expect(connStr.hosts).toEqual(['host.example.com:27017']);
            expect(connStr.pathname).toBe('/mydb');
            expect(connStr.searchParams.get('authSource')).toBe('admin');
            // URLSearchParams.get() returns decoded values
            expect(connStr.searchParams.get('appName')).toBe('@myapp@');
        });
    });

    describe('edge cases with special characters in query parameters', () => {
        it('should handle connection string with only @ in one parameter', () => {
            const uri = 'mongodb://host.example.com:27017/?tag=@';

            const connStr = new DocumentDBConnectionString(uri);

            // URLSearchParams.get() returns decoded values
            expect(connStr.searchParams.get('tag')).toBe('@');
        });

        it('should handle connection string with already encoded parameters', () => {
            const uri = 'mongodb://host.example.com:27017/?appName=%40user%40';

            const connStr = new DocumentDBConnectionString(uri);

            // URLSearchParams.get() returns decoded values
            expect(connStr.searchParams.get('appName')).toBe('@user@');
        });

        it('should handle multiple hosts', () => {
            const uri = 'mongodb://host1:27017,host2:27017,host3:27017/?appName=@app@';

            const connStr = new DocumentDBConnectionString(uri);

            expect(connStr.hosts).toEqual(['host1:27017', 'host2:27017', 'host3:27017']);
            // URLSearchParams.get() returns decoded values
            expect(connStr.searchParams.get('appName')).toBe('@app@');
        });

        it('should handle SRV connection strings with special chars in params', () => {
            const uri = 'mongodb+srv://cluster.mongodb.net/?appName=@myapp@';

            const connStr = new DocumentDBConnectionString(uri);

            expect(connStr.isSRV).toBe(true);
            // URLSearchParams.get() returns decoded values
            expect(connStr.searchParams.get('appName')).toBe('@myapp@');
        });

        it('should handle mixed special characters in parameters', () => {
            const uri = 'mongodb://host.example.com:27017/?tag1=@user@&tag2=[prod]&tag3=test#1';

            const connStr = new DocumentDBConnectionString(uri);

            // URLSearchParams.get() returns decoded values
            expect(connStr.searchParams.get('tag1')).toBe('@user@');
            expect(connStr.searchParams.get('tag2')).toBe('[prod]');
            expect(connStr.searchParams.get('tag3')).toBe('test#1');
        });
    });
});
