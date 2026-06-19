/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as crypto from 'crypto';

/**
 * Parameters parsed from a WWW-Authenticate: Digest header.
 */
interface DigestChallenge {
    realm: string;
    nonce: string;
    qop?: string;
    opaque?: string;
    algorithm?: string;
}

/**
 * Parses a WWW-Authenticate: Digest challenge header.
 */
export function parseDigestChallenge(header: string): DigestChallenge {
    const params: Record<string, string> = {};
    const regex = /(\w+)=(?:"([^"]*)"|([^\s,]+))/g;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(header)) !== null) {
        params[match[1]] = match[2] ?? match[3];
    }

    return {
        realm: params['realm'] ?? '',
        nonce: params['nonce'] ?? '',
        qop: params['qop'],
        opaque: params['opaque'],
        algorithm: params['algorithm'],
    };
}

/**
 * Computes an HTTP Digest Authentication header value.
 */
export function computeDigestHeader(
    method: string,
    uri: string,
    username: string,
    password: string,
    challenge: DigestChallenge,
    nc: number,
): string {
    const algorithm = challenge.algorithm ?? 'MD5';
    const cnonce = crypto.randomBytes(8).toString('hex');
    const ncHex = nc.toString(16).padStart(8, '0');

    function resolveHashAlgorithm(digestAlgorithm: string): string {
        const normalized = digestAlgorithm.trim().toUpperCase();
        if (normalized === 'SHA-256' || normalized === 'SHA-256-SESS') {
            return 'sha256';
        }
        if (normalized === 'SHA-512-256' || normalized === 'SHA-512-256-SESS') {
            return 'sha512-256';
        }
        return 'md5';
    }

    const hashAlgorithm = resolveHashAlgorithm(algorithm);

    function digest(data: string): string {
        return crypto.createHash(hashAlgorithm).update(data).digest('hex');
    }

    const ha1 = digest(`${username}:${challenge.realm}:${password}`);
    const ha2 = digest(`${method}:${uri}`);

    let response: string;
    if (challenge.qop === 'auth' || challenge.qop?.includes('auth')) {
        response = digest(`${ha1}:${challenge.nonce}:${ncHex}:${cnonce}:auth:${ha2}`);
    } else {
        response = digest(`${ha1}:${challenge.nonce}:${ha2}`);
    }

    let header = `Digest username="${username}", realm="${challenge.realm}", nonce="${challenge.nonce}", uri="${uri}", response="${response}", algorithm=${algorithm}`;

    if (challenge.qop) {
        header += `, qop=auth, nc=${ncHex}, cnonce="${cnonce}"`;
    }
    if (challenge.opaque) {
        header += `, opaque="${challenge.opaque}"`;
    }

    return header;
}
