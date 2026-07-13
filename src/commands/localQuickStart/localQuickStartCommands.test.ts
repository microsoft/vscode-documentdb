/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AuthMethodId } from '../../documentdb/auth/AuthMethod';
import { buildQuickStartCopyCredentials } from './localQuickStartCommands';

// UX review #7: the Quick Start "Copy Connection String" reuses the shared copy flow, which treats
// credentials.connectionString as a PASSWORD-FREE base (the password lives only in nativeAuthConfig).
// The Quick Start metadata string embeds the password, so the helper must strip it — otherwise
// "copy without password" would leak the password.
describe('buildQuickStartCopyCredentials (UX review #7)', () => {
    it('strips the embedded password from the base and carries it in nativeAuthConfig', () => {
        const credentials = buildQuickStartCopyCredentials(
            'mongodb://admin:s3cr3tPass@localhost:10260/?tls=true&tlsAllowInvalidCertificates=true',
            'admin',
        );

        expect(credentials).toBeDefined();
        // The base string handed to the shared copy flow must not contain the password.
        expect(credentials?.connectionString).not.toContain('s3cr3tPass');
        // The password is carried separately so the with-password branch can add it back.
        expect(credentials?.nativeAuthConfig?.connectionPassword).toBe('s3cr3tPass');
        expect(credentials?.nativeAuthConfig?.connectionUser).toBe('admin');
        expect(credentials?.selectedAuthMethod).toBe(AuthMethodId.NativeAuth);
    });

    it('handles a password-free connection string (no prompt path)', () => {
        const credentials = buildQuickStartCopyCredentials('mongodb://localhost:10260/?tls=true', 'admin');

        expect(credentials?.connectionString).not.toContain('@'); // no userinfo embedded
        expect(credentials?.nativeAuthConfig?.connectionPassword).toBe('');
    });

    it('fails closed (returns undefined) when the connection string cannot be parsed', () => {
        expect(buildQuickStartCopyCredentials('not a valid connection string', 'admin')).toBeUndefined();
    });
});
