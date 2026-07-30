/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

export function isSupportedExternalUrl(value: string): boolean {
    try {
        const protocol = new URL(value).protocol;
        return protocol === 'http:' || protocol === 'https:';
    } catch {
        return false;
    }
}

export function formatUrlForLogging(value: string): string {
    const url = new URL(value);
    const redactedQuery = [...url.searchParams.keys()].map((key) => `${encodeURIComponent(key)}=<redacted>`).join('&');

    return `${url.origin}${url.pathname}${redactedQuery ? `?${redactedQuery}` : ''}${url.hash ? '#<redacted>' : ''}`;
}

export async function openUrl(url: string): Promise<void> {
    // Using this functionality is blocked by https://github.com/Microsoft/vscode/issues/85930
    await vscode.env.openExternal(vscode.Uri.parse(url));
}
