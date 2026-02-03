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

    describe('duplicate query parameter keys', () => {
        it('should preserve duplicate readPreference parameters', () => {
            const uri = 'mongodb://host.example.com:27017/?readPreference=secondary&readPreference=primary';

            const connStr = new DocumentDBConnectionString(uri);

            expect(connStr.hosts).toEqual(['host.example.com:27017']);
            // URLSearchParams.getAll() returns all values for a key
            const readPreferences = connStr.searchParams.getAll('readPreference');
            expect(readPreferences).toEqual(['secondary', 'primary']);
        });

        it('should preserve duplicate tag parameters', () => {
            const uri = 'mongodb://host.example.com:27017/?tag=prod&tag=us-east&tag=critical';

            const connStr = new DocumentDBConnectionString(uri);

            const tags = connStr.searchParams.getAll('tag');
            expect(tags).toEqual(['prod', 'us-east', 'critical']);
        });

        it('should preserve duplicate parameters with special characters', () => {
            const uri = 'mongodb://host.example.com:27017/?appName=@app1@&appName=@app2@&ssl=true';

            const connStr = new DocumentDBConnectionString(uri);

            const appNames = connStr.searchParams.getAll('appName');
            expect(appNames).toEqual(['@app1@', '@app2@']);
            expect(connStr.searchParams.get('ssl')).toBe('true');
        });

        it('should maintain order of duplicate parameters', () => {
            const uri = 'mongodb://host.example.com:27017/?a=1&b=2&a=3&c=4&a=5';

            const connStr = new DocumentDBConnectionString(uri);

            const aValues = connStr.searchParams.getAll('a');
            expect(aValues).toEqual(['1', '3', '5']);
            expect(connStr.searchParams.get('b')).toBe('2');
            expect(connStr.searchParams.get('c')).toBe('4');
        });

        it('should handle duplicate parameters in toString and re-parsing', () => {
            const uri = 'mongodb://user:pass@host.example.com:27017/?tag=prod&tag=critical';

            const connStr = new DocumentDBConnectionString(uri);
            const connStrText = connStr.toString();

            // Re-parse the connection string
            const reparsed = new DocumentDBConnectionString(connStrText);
            const tags = reparsed.searchParams.getAll('tag');

            // Should preserve all tag values
            expect(tags).toEqual(['prod', 'critical']);
        });

        it('should handle mixed duplicate and unique parameters', () => {
            const uri = 'mongodb://host.example.com:27017/?ssl=true&tag=prod&tag=us-east&replicaSet=rs0&tag=critical';

            const connStr = new DocumentDBConnectionString(uri);

            expect(connStr.searchParams.get('ssl')).toBe('true');
            expect(connStr.searchParams.get('replicaSet')).toBe('rs0');

            const tags = connStr.searchParams.getAll('tag');
            expect(tags).toEqual(['prod', 'us-east', 'critical']);
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
            // Note: # must be encoded as %23, otherwise it's treated as a URL fragment
            const uri = 'mongodb://host.example.com:27017/?tag1=@user@&tag2=[prod]&tag3=test%231';

            const connStr = new DocumentDBConnectionString(uri);

            // URLSearchParams.get() returns decoded values
            expect(connStr.searchParams.get('tag1')).toBe('@user@');
            expect(connStr.searchParams.get('tag2')).toBe('[prod]');
            expect(connStr.searchParams.get('tag3')).toBe('test#1');
        });
    });

    describe('deduplicateQueryParameters', () => {
        it('should remove exact duplicate key=value pairs', () => {
            const uri = 'mongodb://host.example.com:27017/?ssl=true&ssl=true&appName=app';

            const connStr = new DocumentDBConnectionString(uri);
            const deduplicated = connStr.deduplicateQueryParameters();

            expect(deduplicated).toBe('mongodb://host.example.com:27017/?ssl=true&appName=app');
        });

        it('should preserve different values for the same key', () => {
            // Some MongoDB parameters legitimately allow multiple values
            const uri = 'mongodb://host.example.com:27017/?readPreferenceTags=dc:east&readPreferenceTags=dc:west';

            const connStr = new DocumentDBConnectionString(uri);
            const deduplicated = connStr.deduplicateQueryParameters();

            // Both values should be preserved since they are different
            expect(deduplicated).toContain('readPreferenceTags=dc%3Aeast');
            expect(deduplicated).toContain('readPreferenceTags=dc%3Awest');
        });

        it('should handle connection string without query parameters', () => {
            const uri = 'mongodb://host.example.com:27017/database';

            const connStr = new DocumentDBConnectionString(uri);
            const deduplicated = connStr.deduplicateQueryParameters();

            expect(deduplicated).toBe('mongodb://host.example.com:27017/database');
        });

        it('should handle multiple duplicates of the same parameter', () => {
            const uri = 'mongodb://host.example.com:27017/?ssl=true&ssl=true&ssl=true&appName=app&appName=app';

            const connStr = new DocumentDBConnectionString(uri);
            const deduplicated = connStr.deduplicateQueryParameters();

            expect(deduplicated).toBe('mongodb://host.example.com:27017/?ssl=true&appName=app');
        });

        it('should preserve special characters in values when deduplicating', () => {
            const uri = 'mongodb://host.example.com:27017/?appName=@user@&appName=@user@&ssl=true';

            const connStr = new DocumentDBConnectionString(uri);
            const deduplicated = connStr.deduplicateQueryParameters();

            // Should have only one appName with encoded @ characters
            expect(deduplicated).toBe('mongodb://host.example.com:27017/?appName=%40user%40&ssl=true');
        });

        it('should work correctly after multiple parse/serialize cycles', () => {
            const original = 'mongodb://host.example.com:27017/?ssl=true&appName=@user@';

            // First cycle
            const parsed1 = new DocumentDBConnectionString(original);
            const str1 = parsed1.deduplicateQueryParameters();

            // Second cycle
            const parsed2 = new DocumentDBConnectionString(str1);
            const str2 = parsed2.deduplicateQueryParameters();

            // Third cycle
            const parsed3 = new DocumentDBConnectionString(str2);
            const str3 = parsed3.deduplicateQueryParameters();

            // All should be identical - no parameter doubling
            expect(str1).toBe(str2);
            expect(str2).toBe(str3);

            // Verify the values are still correct
            expect(parsed3.searchParams.get('ssl')).toBe('true');
            expect(parsed3.searchParams.get('appName')).toBe('@user@');
        });

        it('should keep only the last value for non-whitelisted parameters with different values', () => {
            // Per MongoDB spec, non-whitelisted parameters follow "last value wins" behavior
            const uri = 'mongodb://host.example.com:27017/?appName=app1&appName=app2&ssl=false&ssl=true';

            const connStr = new DocumentDBConnectionString(uri);
            const deduplicated = connStr.deduplicateQueryParameters();

            // Should only keep the last value for each parameter
            expect(deduplicated).toBe('mongodb://host.example.com:27017/?appName=app2&ssl=true');
        });

        it('should preserve all unique values for readPreferenceTags but last value only for other params', () => {
            // Mixed case: readPreferenceTags (whitelisted) + appName (not whitelisted)
            const uri =
                'mongodb://host.example.com:27017/?readPreferenceTags=dc:ny&readPreferenceTags=dc:la&appName=app1&appName=app2';

            const connStr = new DocumentDBConnectionString(uri);
            const deduplicated = connStr.deduplicateQueryParameters();

            // readPreferenceTags should preserve both unique values
            expect(deduplicated).toContain('readPreferenceTags=dc%3Any');
            expect(deduplicated).toContain('readPreferenceTags=dc%3Ala');
            // appName should only keep the last value
            expect(deduplicated).toContain('appName=app2');
            expect(deduplicated).not.toContain('appName=app1');
        });

        it('should handle readPreferenceTags with exact duplicates correctly', () => {
            // readPreferenceTags with duplicate values should remove the duplicate
            const uri =
                'mongodb://host.example.com:27017/?readPreferenceTags=dc:ny&readPreferenceTags=dc:ny&readPreferenceTags=dc:la';

            const connStr = new DocumentDBConnectionString(uri);
            const deduplicated = connStr.deduplicateQueryParameters();

            // Should have only unique values, in order
            const params = new URLSearchParams(deduplicated.split('?')[1]);
            const tagValues = params.getAll('readPreferenceTags');
            expect(tagValues).toEqual(['dc:ny', 'dc:la']);
        });
    });

    describe('hasDuplicateParameters', () => {
        it('should return true when there are duplicate parameters', () => {
            const uri = 'mongodb://host.example.com:27017/?ssl=true&ssl=true';

            const connStr = new DocumentDBConnectionString(uri);

            expect(connStr.hasDuplicateParameters()).toBe(true);
        });

        it('should return false when there are no duplicate parameters', () => {
            const uri = 'mongodb://host.example.com:27017/?ssl=true&appName=app';

            const connStr = new DocumentDBConnectionString(uri);

            expect(connStr.hasDuplicateParameters()).toBe(false);
        });

        it('should return false when same key has different values', () => {
            const uri = 'mongodb://host.example.com:27017/?tag=prod&tag=dev';

            const connStr = new DocumentDBConnectionString(uri);

            // Different values for same key is not considered a duplicate
            expect(connStr.hasDuplicateParameters()).toBe(false);
        });

        it('should return false for connection string without query parameters', () => {
            const uri = 'mongodb://host.example.com:27017/database';

            const connStr = new DocumentDBConnectionString(uri);

            expect(connStr.hasDuplicateParameters()).toBe(false);
        });
    });

    describe('normalize static method', () => {
        it('should normalize a connection string with duplicates', () => {
            const uri = 'mongodb://host.example.com:27017/?ssl=true&ssl=true&appName=app';

            const normalized = DocumentDBConnectionString.normalize(uri);

            expect(normalized).toBe('mongodb://host.example.com:27017/?ssl=true&appName=app');
        });

        it('should return original string if parsing fails', () => {
            const invalidUri = 'not-a-valid-connection-string';

            const normalized = DocumentDBConnectionString.normalize(invalidUri);

            expect(normalized).toBe(invalidUri);
        });

        it('should return empty string for empty input', () => {
            expect(DocumentDBConnectionString.normalize('')).toBe('');
        });

        it('should handle credentials correctly during normalization', () => {
            const uri = 'mongodb://user:pass@host.example.com:27017/?ssl=true&ssl=true';

            const normalized = DocumentDBConnectionString.normalize(uri);

            // Should preserve credentials and remove duplicates
            expect(normalized).toContain('user');
            expect(normalized).toContain('pass');
            expect(normalized).not.toMatch(/ssl=true.*ssl=true/);
        });
    });

    describe('real-world Cosmos DB RU connection string with appName containing @', () => {
        // This is the exact format used by Azure Cosmos DB for MongoDB RU connections
        const cosmosRUConnectionString =
            'mongodb://auername:weirdpassword@a-server.somewhere.com:10255/?ssl=true&replicaSet=globaldb&retrywrites=false&maxIdleTimeMS=120000&appName=@anapphere@';

        it('should parse the connection string correctly', () => {
            const connStr = new DocumentDBConnectionString(cosmosRUConnectionString);

            expect(connStr.username).toBe('auername');
            expect(connStr.password).toBe('weirdpassword');
            expect(connStr.hosts).toEqual(['a-server.somewhere.com:10255']);
            expect(connStr.searchParams.get('ssl')).toBe('true');
            expect(connStr.searchParams.get('replicaSet')).toBe('globaldb');
            expect(connStr.searchParams.get('retrywrites')).toBe('false');
            expect(connStr.searchParams.get('maxIdleTimeMS')).toBe('120000');
            expect(connStr.searchParams.get('appName')).toBe('@anapphere@');
        });

        it('should survive parse/serialize roundtrip', () => {
            const connStr = new DocumentDBConnectionString(cosmosRUConnectionString);
            const serialized = connStr.toString();

            const reparsed = new DocumentDBConnectionString(serialized);

            expect(reparsed.username).toBe('auername');
            expect(reparsed.password).toBe('weirdpassword');
            expect(reparsed.hosts).toEqual(['a-server.somewhere.com:10255']);
            expect(reparsed.searchParams.get('ssl')).toBe('true');
            expect(reparsed.searchParams.get('replicaSet')).toBe('globaldb');
            expect(reparsed.searchParams.get('appName')).toBe('@anapphere@');
        });

        it('should survive multiple parse/serialize cycles without parameter doubling', () => {
            let currentString = cosmosRUConnectionString;

            // Simulate 5 migrations/saves
            for (let i = 0; i < 5; i++) {
                const parsed = new DocumentDBConnectionString(currentString);
                currentString = parsed.deduplicateQueryParameters();
            }

            const finalParsed = new DocumentDBConnectionString(currentString);

            // All parameters should appear exactly once
            expect(finalParsed.searchParams.getAll('ssl')).toHaveLength(1);
            expect(finalParsed.searchParams.getAll('replicaSet')).toHaveLength(1);
            expect(finalParsed.searchParams.getAll('retrywrites')).toHaveLength(1);
            expect(finalParsed.searchParams.getAll('maxIdleTimeMS')).toHaveLength(1);
            expect(finalParsed.searchParams.getAll('appName')).toHaveLength(1);

            // Values should be correct
            expect(finalParsed.username).toBe('auername');
            expect(finalParsed.password).toBe('weirdpassword');
            expect(finalParsed.searchParams.get('appName')).toBe('@anapphere@');
        });

        it('should work correctly when clearing credentials (v1 to v2 migration pattern)', () => {
            const connStr = new DocumentDBConnectionString(cosmosRUConnectionString);

            // Extract credentials (like v1 to v2 migration does)
            const username = connStr.username;
            const password = connStr.password;

            // Clear credentials
            connStr.username = '';
            connStr.password = '';

            // Get normalized connection string
            const normalizedCS = connStr.deduplicateQueryParameters();

            // Verify credentials were extracted correctly
            expect(username).toBe('auername');
            expect(password).toBe('weirdpassword');

            // Verify connection string without credentials is valid
            const reparsed = new DocumentDBConnectionString(normalizedCS);
            expect(reparsed.username).toBe('');
            expect(reparsed.password).toBe('');
            expect(reparsed.hosts).toEqual(['a-server.somewhere.com:10255']);
            expect(reparsed.searchParams.get('appName')).toBe('@anapphere@');
            expect(reparsed.searchParams.get('ssl')).toBe('true');
        });

        it('should not have duplicate parameters', () => {
            const connStr = new DocumentDBConnectionString(cosmosRUConnectionString);

            expect(connStr.hasDuplicateParameters()).toBe(false);
        });
    });
});
