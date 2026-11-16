/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { X509Certificate } from 'node:crypto';
import { checkServerIdentity } from 'node:tls';
import { describe, expect, it } from 'vitest';

import { createCertificate } from './certificates.js';

describe('generated test certificates', (): void => {
    it('produces verifiable X.509 v3 CA and leaf certificates with DNS and IP SANs', (): void => {
        const validity = { notBefore: new Date('2020-01-01Z'), notAfter: new Date('2051-01-01Z') };
        const ca = createCertificate({ subjectCN: 'Test CA', isCA: true, ...validity });
        const leaf = createCertificate({
            subjectCN: 'db.test',
            issuer: ca,
            dnsNames: ['db.test'],
            ipAddresses: ['127.0.0.1', '::1'],
            ...validity,
        });
        const root = new X509Certificate(ca.cert);
        const cert = new X509Certificate(leaf.cert);
        expect(root.ca).toBe(true);
        expect(root.verify(root.publicKey)).toBe(true);
        expect(cert.verify(root.publicKey)).toBe(true);
        expect(cert.ca).toBe(false);
        expect(checkServerIdentity('db.test', cert.toLegacyObject())).toBeUndefined();
        expect(checkServerIdentity('127.0.0.1', cert.toLegacyObject())).toBeUndefined();
        expect(checkServerIdentity('::1', cert.toLegacyObject())).toBeUndefined();
        expect(cert.validFrom).toContain('2020');
        expect(cert.validTo).toContain('2051');
    });
});
