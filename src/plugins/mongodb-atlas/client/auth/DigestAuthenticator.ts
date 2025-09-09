/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createHash, randomBytes } from 'crypto';
import { type DigestCredentials, AtlasAuthenticationError } from '../types';

/**
 * HTTP Digest Authentication for MongoDB Atlas API Keys
 */
export class DigestAuthenticator {
    constructor(private readonly credentials: DigestCredentials) {}

    /**
     * Add HTTP Digest authorization header to request headers
     * Note: This requires a 401 challenge from the server first to get nonce, realm, etc.
     */
    public async addAuthHeaders(
        headers: Record<string, string>,
        method: string,
        uri: string,
        challengeHeader?: string,
    ): Promise<Record<string, string>> {
        if (!challengeHeader) {
            // For first request, just add basic auth header
            // Server will respond with 401 and WWW-Authenticate header containing digest challenge
            return {
                ...headers,
                Authorization: this.createBasicAuthHeader(),
            };
        }

        const digestAuth = this.createDigestAuthHeader(method, uri, challengeHeader);
        return {
            ...headers,
            Authorization: digestAuth,
        };
    }

    /**
     * Parse digest challenge from WWW-Authenticate header and create response
     */
    public createDigestAuthHeader(method: string, uri: string, challengeHeader: string): string {
        const challenge = this.parseDigestChallenge(challengeHeader);
        
        if (!challenge.realm || !challenge.nonce) {
            throw new AtlasAuthenticationError('Invalid digest challenge: missing realm or nonce');
        }

        const nc = '00000001';
        const cnonce = this.generateCnonce();
        const qop = challenge.qop || 'auth';

        // Calculate digest response
        const ha1 = this.calculateHA1(challenge.realm);
        const ha2 = this.calculateHA2(method, uri, qop);
        const response = this.calculateResponse(ha1, challenge.nonce, nc, cnonce, qop, ha2);

        // Build authorization header
        const authHeader = [
            `username="${this.credentials.publicKey}"`,
            `realm="${challenge.realm}"`,
            `nonce="${challenge.nonce}"`,
            `uri="${uri}"`,
            `algorithm="MD5"`,
            `response="${response}"`,
            `nc=${nc}`,
            `cnonce="${cnonce}"`,
            `qop=${qop}`,
        ].join(', ');

        return `Digest ${authHeader}`;
    }

    private createBasicAuthHeader(): string {
        const credentials = `${this.credentials.publicKey}:${this.credentials.privateKey}`;
        const encoded = Buffer.from(credentials).toString('base64');
        return `Basic ${encoded}`;
    }

    private parseDigestChallenge(challengeHeader: string): Record<string, string> {
        const challenge: Record<string, string> = {};
        
        // Remove "Digest " prefix and parse key=value pairs
        const digestPart = challengeHeader.replace(/^Digest\s+/, '');
        const regex = /(\w+)=("([^"]+)"|([^,\s]+))/g;
        
        let match;
        while ((match = regex.exec(digestPart)) !== null) {
            const key = match[1];
            const value = match[3] || match[4]; // quoted or unquoted value
            challenge[key] = value;
        }
        
        return challenge;
    }

    private generateCnonce(): string {
        return randomBytes(16).toString('hex');
    }

    private calculateHA1(realm: string): string {
        const a1 = `${this.credentials.publicKey}:${realm}:${this.credentials.privateKey}`;
        return createHash('md5').update(a1).digest('hex');
    }

    private calculateHA2(method: string, uri: string, qop: string): string {
        let a2: string;
        
        if (qop === 'auth-int') {
            // For auth-int, we'd need the entity body hash, but Atlas typically uses 'auth'
            a2 = `${method}:${uri}:${createHash('md5').update('').digest('hex')}`;
        } else {
            a2 = `${method}:${uri}`;
        }
        
        return createHash('md5').update(a2).digest('hex');
    }

    private calculateResponse(
        ha1: string,
        nonce: string,
        nc: string,
        cnonce: string,
        qop: string,
        ha2: string,
    ): string {
        const responseStr = `${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`;
        return createHash('md5').update(responseStr).digest('hex');
    }
}