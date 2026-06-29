/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { areAllHostsLocal, canonicalizeTlsException, resolveAllowInvalidCertificates } from './tlsException';

describe('canonicalizeTlsException (TLS exception single-source-of-truth, design §7)', () => {
    it('honors allow-invalid for a local host and strips the param', () => {
        const result = canonicalizeTlsException('mongodb://localhost:10260/?tls=true&tlsAllowInvalidCertificates=true');
        expect(result.disableEmulatorSecurity).toBe(true);
        expect(result.connectionString).not.toContain('tlsAllowInvalidCertificates');
        expect(result.connectionString).toContain('tls=true');
    });

    it('honors allow-invalid for a private (RFC1918) host', () => {
        const result = canonicalizeTlsException('mongodb://192.168.1.5:27017/?tlsAllowInvalidCertificates=true');
        expect(result.disableEmulatorSecurity).toBe(true);
        expect(result.connectionString).not.toContain('tlsAllowInvalidCertificates');
    });

    it('does NOT honor allow-invalid for a public host, but still strips the bypass param', () => {
        const result = canonicalizeTlsException('mongodb://prod.example.com/?tlsAllowInvalidCertificates=true');
        expect(result.disableEmulatorSecurity).toBe(false);
        // The param is stripped so the driver can't silently disable validation for a public host.
        expect(result.connectionString).not.toContain('tlsAllowInvalidCertificates');
    });

    it('does NOT honor allow-invalid for a Unicode-dot homograph of a public host', () => {
        // `example。com` (U+3002) has no ASCII dot but DNS resolves it as the public example.com,
        // so it must NOT be treated as a single-word local host.
        const result = canonicalizeTlsException('mongodb://example\u3002com/?tlsAllowInvalidCertificates=true');
        expect(result.disableEmulatorSecurity).toBe(false);
        expect(result.connectionString).not.toContain('tlsAllowInvalidCertificates');
    });

    it('does NOT honor allow-invalid for a mixed seed list (one public host)', () => {
        const result = canonicalizeTlsException(
            'mongodb://localhost:27017,prod.example.com:27017/?tlsAllowInvalidCertificates=true',
        );
        expect(result.disableEmulatorSecurity).toBe(false);
        expect(result.connectionString).not.toContain('tlsAllowInvalidCertificates');
    });

    it('strips alias bypass params (sslAllowInvalidCertificates, tlsInsecure)', () => {
        const a = canonicalizeTlsException('mongodb://localhost/?sslAllowInvalidCertificates=true');
        expect(a.disableEmulatorSecurity).toBe(true);
        expect(a.connectionString.toLowerCase()).not.toContain('sslallowinvalidcertificates');

        const b = canonicalizeTlsException('mongodb://localhost/?tlsInsecure=true');
        expect(b.disableEmulatorSecurity).toBe(true);
        expect(b.connectionString.toLowerCase()).not.toContain('tlsinsecure');
    });

    it('strips hostname-validation bypass params (tlsAllowInvalidHostnames / ssl alias) for a local host', () => {
        const a = canonicalizeTlsException('mongodb://localhost/?tlsAllowInvalidHostnames=true');
        expect(a.disableEmulatorSecurity).toBe(true);
        expect(a.connectionString.toLowerCase()).not.toContain('allowinvalidhostnames');

        const b = canonicalizeTlsException('mongodb://localhost/?sslAllowInvalidHostnames=true');
        expect(b.disableEmulatorSecurity).toBe(true);
        expect(b.connectionString.toLowerCase()).not.toContain('allowinvalidhostnames');
    });

    it('does NOT honor a hostname-validation bypass for a public host, but still strips it', () => {
        const result = canonicalizeTlsException('mongodb://prod.example.com/?tlsAllowInvalidHostnames=true');
        expect(result.disableEmulatorSecurity).toBe(false);
        expect(result.connectionString.toLowerCase()).not.toContain('allowinvalidhostnames');
    });

    it('does NOT honor a hostname-validation bypass for a mixed seed list, but still strips it', () => {
        const result = canonicalizeTlsException(
            'mongodb://localhost:27017,prod.example.com:27017/?tlsAllowInvalidHostnames=true',
        );
        expect(result.disableEmulatorSecurity).toBe(false);
        expect(result.connectionString.toLowerCase()).not.toContain('allowinvalidhostnames');
    });

    it('is case-insensitive on the hostname-validation bypass key', () => {
        const result = canonicalizeTlsException('mongodb://localhost/?TLSAllowInvalidHostnames=true');
        expect(result.disableEmulatorSecurity).toBe(true);
        expect(result.connectionString.toLowerCase()).not.toContain('allowinvalidhostnames');
    });

    it('honors rejectUnauthorized=false (inverse semantics) for a local host and strips it', () => {
        const result = canonicalizeTlsException('mongodb://localhost/?rejectUnauthorized=false');
        expect(result.disableEmulatorSecurity).toBe(true);
        expect(result.connectionString.toLowerCase()).not.toContain('rejectunauthorized');
    });

    it('does NOT honor rejectUnauthorized=false for a public host, but still strips it', () => {
        const result = canonicalizeTlsException('mongodb://prod.example.com/?rejectUnauthorized=false');
        expect(result.disableEmulatorSecurity).toBe(false);
        expect(result.connectionString.toLowerCase()).not.toContain('rejectunauthorized');
    });

    it('strips rejectUnauthorized=true without requesting a bypass (and validates)', () => {
        const result = canonicalizeTlsException('mongodb://localhost/?rejectUnauthorized=true');
        expect(result.disableEmulatorSecurity).toBe(false);
        expect(result.connectionString.toLowerCase()).not.toContain('rejectunauthorized');
    });

    it('returns false (no exception) when no bypass param is present', () => {
        const result = canonicalizeTlsException('mongodb://localhost:10260/?tls=true');
        expect(result.disableEmulatorSecurity).toBe(false);
        // Nothing to strip → connection string returned unchanged.
        expect(result.connectionString).toBe('mongodb://localhost:10260/?tls=true');
    });

    it('treats a bypass param set to false as no exception (and strips it)', () => {
        const result = canonicalizeTlsException('mongodb://localhost/?tlsAllowInvalidCertificates=false');
        expect(result.disableEmulatorSecurity).toBe(false);
        expect(result.connectionString).not.toContain('tlsAllowInvalidCertificates');
    });

    it('is case-insensitive on the param key', () => {
        const result = canonicalizeTlsException('mongodb://localhost/?TLSAllowInvalidCertificates=true');
        expect(result.disableEmulatorSecurity).toBe(true);
        expect(result.connectionString.toLowerCase()).not.toContain('allowinvalidcertificates');
    });

    it('returns the input unchanged and no exception for an unparseable string', () => {
        const result = canonicalizeTlsException('not-a-connection-string');
        expect(result.disableEmulatorSecurity).toBe(false);
        expect(result.connectionString).toBe('not-a-connection-string');
    });
});

describe('areAllHostsLocal (host-gating a TLS exception decided elsewhere)', () => {
    it('is true when every host is local/private', () => {
        expect(areAllHostsLocal('mongodb://localhost:10260/')).toBe(true);
        expect(areAllHostsLocal('mongodb://192.168.1.5:27017,10.0.0.1:27017/')).toBe(true);
    });

    it('is false when any host is public (mixed seed list)', () => {
        expect(areAllHostsLocal('mongodb://localhost:27017,prod.example.com:27017/')).toBe(false);
    });

    it('is false for a public host', () => {
        expect(areAllHostsLocal('mongodb://cluster0.mongodb.net/')).toBe(false);
    });

    it('is false for a Unicode-dot homograph of a public host', () => {
        expect(areAllHostsLocal('mongodb://example\u3002com/')).toBe(false);
    });

    it('is false for an unparseable string', () => {
        expect(areAllHostsLocal('not-a-connection-string')).toBe(false);
    });
});

describe('resolveAllowInvalidCertificates (hybrid runtime policy: honor the flag only for local hosts)', () => {
    it('returns true for a local/private host with the exception flag set', () => {
        expect(resolveAllowInvalidCertificates(true, 'mongodb://localhost:10260/')).toBe(true);
        expect(resolveAllowInvalidCertificates(true, 'mongodb://192.168.1.5:27017/')).toBe(true);
    });

    it('returns undefined for a local host without the flag', () => {
        expect(resolveAllowInvalidCertificates(false, 'mongodb://localhost:10260/')).toBeUndefined();
        expect(resolveAllowInvalidCertificates(undefined, 'mongodb://localhost:10260/')).toBeUndefined();
    });

    it('returns undefined (NOT false) for a public host even when the orphaned flag is set', () => {
        // Staying silent (undefined) — never forcing `false` — lets the driver still honor an
        // explicit `tlsAllowInvalidCertificates=true` URL param, while a BARE orphaned flag on a
        // public host is not activated.
        expect(resolveAllowInvalidCertificates(true, 'mongodb://cluster0.mongodb.net/')).toBeUndefined();
        expect(resolveAllowInvalidCertificates(true, 'mongodb://prod.example.com/')).toBeUndefined();
    });

    it('returns undefined for a mixed seed list with a public host even when the flag is set', () => {
        expect(
            resolveAllowInvalidCertificates(true, 'mongodb://localhost:27017,prod.example.com:27017/'),
        ).toBeUndefined();
    });

    it('returns undefined for a Unicode-dot homograph of a public host with the flag set', () => {
        expect(resolveAllowInvalidCertificates(true, 'mongodb://example\u3002com/')).toBeUndefined();
    });

    it('returns undefined for an unparseable connection string (fail closed: no allow-invalid)', () => {
        expect(resolveAllowInvalidCertificates(true, 'not-a-connection-string')).toBeUndefined();
    });
});
