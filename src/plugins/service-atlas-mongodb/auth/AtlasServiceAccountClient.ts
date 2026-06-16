/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ATLAS_SERVICE_ACCOUNT_TOKEN_URL } from '../config';

/**
 * Token response from Atlas Service Account OAuth2 client_credentials flow.
 */
export interface AtlasServiceAccountTokenResponse {
    readonly access_token: string;
    readonly token_type: string;
    readonly expires_in: number;
}

/**
 * Fetches an access token using the OAuth2 client_credentials grant.
 * Atlas Service Accounts use client_id + client_secret for machine-to-machine auth.
 *
 * @param clientId - The Service Account client ID
 * @param clientSecret - The Service Account client secret
 * @returns Token response with access_token and expires_in
 */
export async function fetchServiceAccountToken(
    clientId: string,
    clientSecret: string,
): Promise<AtlasServiceAccountTokenResponse> {
    const body = new URLSearchParams({
        grant_type: 'client_credentials',
    });

    // Atlas requires client credentials in the Authorization header (HTTP Basic)
    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

    const response = await fetch(ATLAS_SERVICE_ACCOUNT_TOKEN_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Authorization: `Basic ${credentials}`,
            Accept: 'application/json',
            'Cache-Control': 'no-cache',
        },
        body: body.toString(),
    });

    if (!response.ok) {
        let errorDetail = `${response.status}`;
        try {
            const errorBody = (await response.json()) as {
                error?: string;
                error_description?: string;
                errorCode?: string;
            };
            errorDetail = errorBody.error ?? errorBody.errorCode ?? errorDetail;
            if (errorBody.error_description) {
                errorDetail += `: ${errorBody.error_description}`;
            }
        } catch {
            // Ignore JSON parse errors for error body
        }
        throw new Error(vscode.l10n.t('Failed to authenticate Service Account: {0}', errorDetail));
    }

    return (await response.json()) as AtlasServiceAccountTokenResponse;
}
