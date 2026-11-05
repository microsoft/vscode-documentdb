/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createPrivateKey, generateKeyPairSync, randomBytes, sign, X509Certificate } from 'node:crypto';
import { isIP } from 'node:net';

interface CertificateOptions {
    readonly subjectCN: string;
    readonly issuer?: { readonly cert: string; readonly key: string };
    readonly isCA?: boolean;
    readonly dnsNames?: readonly string[];
    readonly ipAddresses?: readonly string[];
    readonly notBefore: Date;
    readonly notAfter: Date;
}

function der(tag: number, ...contents: readonly Uint8Array[]): Buffer {
    const body = Buffer.concat(contents);
    const bytes: number[] = [];
    for (let remaining = body.length; remaining > 0; remaining >>>= 8) {
        bytes.unshift(remaining & 255);
    }
    const length = body.length < 128 ? [body.length] : [128 | bytes.length, ...bytes];
    return Buffer.concat([Buffer.from([tag, ...length]), body]);
}

function sequence(...contents: readonly Uint8Array[]): Buffer {
    return der(0x30, ...contents);
}

function oid(value: string): Buffer {
    const components = value.split('.').map(Number);
    const bytes = [components[0] * 40 + components[1]];
    for (const component of components.slice(2)) {
        const encoded = [component & 127];
        for (let remaining = component >>> 7; remaining > 0; remaining >>>= 7) {
            encoded.unshift(128 | (remaining & 127));
        }
        bytes.push(...encoded);
    }
    return der(6, Buffer.from(bytes));
}

function name(commonName: string): Buffer {
    return sequence(der(0x31, sequence(oid('2.5.4.3'), der(0x0c, Buffer.from(commonName)))));
}

function time(date: Date): Buffer {
    const iso = date.toISOString().replace(/[-:]/g, '').replace('T', '').slice(0, 14) + 'Z';
    const utc = date.getUTCFullYear() >= 1950 && date.getUTCFullYear() < 2050;
    return der(utc ? 0x17 : 0x18, Buffer.from(utc ? iso.slice(2) : iso));
}

function ipBytes(address: string): Buffer {
    const family = isIP(address);
    if (family === 4) {
        return Buffer.from(address.split('.').map(Number));
    }
    if (family !== 6) {
        throw new Error('Invalid test certificate IP address');
    }
    let normalized = address;
    if (address.includes('.')) {
        const lastColon = address.lastIndexOf(':');
        const v4 = ipBytes(address.slice(lastColon + 1));
        normalized =
            address.slice(0, lastColon + 1) + v4.readUInt16BE(0).toString(16) + ':' + v4.readUInt16BE(2).toString(16);
    }
    const halves = normalized.split('::');
    const left = halves[0] ? halves[0].split(':') : [];
    const right = halves[1] ? halves[1].split(':') : [];
    const groups =
        halves.length === 1 ? left : [...left, ...Array<string>(8 - left.length - right.length).fill('0'), ...right];
    const bytes = Buffer.alloc(16);
    groups.forEach((group, index): void => {
        bytes.writeUInt16BE(Number.parseInt(group, 16), index * 2);
    });
    return bytes;
}

export function createCertificate(options: CertificateOptions): { cert: string; key: string } {
    const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const signatureAlgorithm = sequence(oid('1.2.840.10045.4.3.2'));
    const issuerCN = options.issuer
        ? new X509Certificate(options.issuer.cert).toLegacyObject().subject.CN
        : options.subjectCN;
    if (typeof issuerCN !== 'string') {
        throw new Error('Test issuer must have a common name');
    }
    const extensions = [
        sequence(
            oid('2.5.29.19'),
            der(1, Buffer.from([255])),
            der(4, sequence(...(options.isCA ? [der(1, Buffer.from([255]))] : []))),
        ),
    ];
    const subjectAltNames = [
        ...(options.dnsNames ?? []).map((dnsName): Buffer => der(0x82, Buffer.from(dnsName, 'ascii'))),
        ...(options.ipAddresses ?? []).map((ip): Buffer => der(0x87, ipBytes(ip))),
    ];
    if (subjectAltNames.length > 0) {
        extensions.push(sequence(oid('2.5.29.17'), der(4, sequence(...subjectAltNames))));
    }
    const serial = randomBytes(16);
    serial[0] |= 0x80;
    const tbs = sequence(
        der(0xa0, der(2, Buffer.from([2]))),
        der(2, Buffer.concat([Buffer.from([0]), serial])),
        signatureAlgorithm,
        name(issuerCN),
        sequence(time(options.notBefore), time(options.notAfter)),
        name(options.subjectCN),
        publicKey.export({ type: 'spki', format: 'der' }),
        der(0xa3, sequence(...extensions)),
    );
    const issuerKey = options.issuer ? createPrivateKey(options.issuer.key) : privateKey;
    const signature = sign('sha256', tbs, issuerKey);
    const certificate = sequence(tbs, signatureAlgorithm, der(3, Buffer.from([0]), signature));
    const base64 = certificate
        .toString('base64')
        .match(/.{1,64}/g)
        ?.join('\n');
    return {
        cert: `-----BEGIN CERTIFICATE-----\n${base64}\n-----END CERTIFICATE-----\n`,
        key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    };
}
