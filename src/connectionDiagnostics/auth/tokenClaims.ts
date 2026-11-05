/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { parseTokenResource } from '../../documentdb/auth/entraScopes';

/** The largest decoded JWT payload that is inspected (design 4.9.3). */
export const MAX_TOKEN_PAYLOAD_BYTES = 64 * 1024;

/** The public client ID that VS Code's Microsoft authentication provider signs in with. */
const VSCODE_CLIENT_ID = 'aebc6443-996d-45c2-90f0-388ff96faa56';

export type TokenIssuerCloud = 'public' | 'usgov' | 'china' | 'other';

/** Known Microsoft Entra ID issuer hosts. Anything else is `other`. */
const ISSUER_CLOUD_BY_HOST: ReadonlyMap<string, TokenIssuerCloud> = new Map([
    ['login.microsoftonline.com', 'public'],
    ['sts.windows.net', 'public'],
    ['login.microsoftonline.us', 'usgov'],
    ['sts.microsoftonline.us', 'usgov'],
    ['login.chinacloudapi.cn', 'china'],
    ['sts.chinacloudapi.cn', 'china'],
]);

const BASE64URL_SEGMENT = /^[A-Za-z0-9_-]+$/;
const OPTIONAL_BASE64URL_SEGMENT = /^[A-Za-z0-9_-]*$/;
const URI_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

export type TokenClaimSummary =
    | {
          readonly available: false;
          readonly reason: 'notJwt' | 'tooLarge' | 'malformed';
      }
    | {
          readonly available: true;
          readonly audience: 'match' | 'different' | 'notComparable';
          readonly issuerCloud: TokenIssuerCloud;
          readonly tokenVersion: '1.0' | '2.0' | 'unknown';
          readonly clientCategory: 'vscode' | 'managedIdentity' | 'other';
          readonly tenantPresent: boolean;
          readonly tenantMatch: 'match' | 'different' | 'notConfigured';
          /** Negative when the token has already expired; never clamped. `null` without an `exp` claim. */
          readonly expiresInSeconds: number | null;
          readonly expired: boolean | null;
      };

/**
 * Decodes an access token's payload locally and keeps only an allowlisted summary. These are
 * unverified hints, not a signature check. The token, its signature and every claim value outside
 * the summary are dropped before this function returns.
 *
 * @param now Wall-clock time in milliseconds since the epoch.
 */
export function summarizeTokenClaims(
    accessToken: string,
    expected: { readonly requestedResource: string; readonly configuredTenantId?: string },
    now: number,
): TokenClaimSummary {
    const segments = accessToken.split('.');
    if (
        segments.length !== 3 ||
        !BASE64URL_SEGMENT.test(segments[0]) ||
        !BASE64URL_SEGMENT.test(segments[1]) ||
        !OPTIONAL_BASE64URL_SEGMENT.test(segments[2])
    ) {
        return { available: false, reason: 'notJwt' };
    }
    const payload = segments[1];
    // Checked on the encoded length, so an oversized payload is never decoded.
    if (Math.floor((payload.length * 3) / 4) > MAX_TOKEN_PAYLOAD_BYTES) {
        return { available: false, reason: 'tooLarge' };
    }

    let claims: unknown;
    try {
        claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    } catch {
        return { available: false, reason: 'malformed' };
    }
    if (!claims || typeof claims !== 'object' || Array.isArray(claims)) {
        return { available: false, reason: 'malformed' };
    }

    const { aud, iss, ver, appid, azp, tid, exp, idtyp, xms_mirid } = claims as Record<string, unknown>;
    const configuredTenantId = expected.configuredTenantId?.trim();
    const hasExpiry = typeof exp === 'number' && Number.isFinite(exp);
    let tenantMatch: 'match' | 'different' | 'notConfigured' = 'notConfigured';
    if (configuredTenantId) {
        tenantMatch =
            typeof tid === 'string' && tid.toLowerCase() === configuredTenantId.toLowerCase() ? 'match' : 'different';
    }
    return {
        available: true,
        audience: compareAudience(aud, expected.requestedResource),
        issuerCloud: issuerCloud(iss),
        tokenVersion: ver === '1.0' || ver === '2.0' ? ver : 'unknown',
        clientCategory: clientCategory(azp ?? appid, idtyp, xms_mirid),
        tenantPresent: typeof tid === 'string' && tid.length > 0,
        tenantMatch,
        expiresInSeconds: hasExpiry ? Math.round(exp - now / 1000) : null,
        expired: hasExpiry ? exp * 1000 <= now : null,
    };
}

function compareAudience(aud: unknown, requestedResource: string): 'match' | 'different' | 'notComparable' {
    // A GUID (an application ID) or any other value that is not a resource URI cannot be compared.
    const audience = typeof aud === 'string' ? normalizeResource(aud) : undefined;
    const requested = normalizeResource(requestedResource);
    if (audience === undefined || requested === undefined) {
        return 'notComparable';
    }
    return audience === requested ? 'match' : 'different';
}

function normalizeResource(value: string): string | undefined {
    const trimmed = value.trim();
    if (!URI_SCHEME.test(trimmed)) {
        return undefined;
    }
    return parseTokenResource(trimmed) ?? trimmed.replace(/\/+$/, '').toLowerCase();
}

function issuerCloud(iss: unknown): TokenIssuerCloud {
    if (typeof iss !== 'string') {
        return 'other';
    }
    try {
        const url = new URL(iss);
        if (url.protocol !== 'https:' || url.username || url.password || url.port) {
            return 'other';
        }
        return ISSUER_CLOUD_BY_HOST.get(url.hostname.toLowerCase()) ?? 'other';
    } catch {
        return 'other';
    }
}

function clientCategory(
    clientId: unknown,
    idtyp: unknown,
    managedIdentityResourceId: unknown,
): 'vscode' | 'managedIdentity' | 'other' {
    if (typeof clientId === 'string' && clientId.toLowerCase() === VSCODE_CLIENT_ID) {
        return 'vscode';
    }
    // Managed identity tokens are app-only tokens that carry the identity's resource ID.
    if (
        typeof managedIdentityResourceId === 'string' &&
        managedIdentityResourceId.length > 0 &&
        (idtyp === undefined || idtyp === 'app')
    ) {
        return 'managedIdentity';
    }
    return 'other';
}
