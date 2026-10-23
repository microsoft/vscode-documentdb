/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Writes HTML with a plain-text alternative through the webview's async clipboard API. The host's
 * `vscode.env.clipboard` is text-only, so rich content must be written here. Returns `false` when
 * the API is unavailable or the write is refused, so the caller can fall back to plain text.
 */
export async function writeHtmlToClipboard(html: string, plainText: string): Promise<boolean> {
    if (typeof ClipboardItem === 'undefined' || typeof navigator.clipboard?.write !== 'function') {
        return false;
    }
    try {
        await navigator.clipboard.write([
            new ClipboardItem({
                'text/html': new Blob([html], { type: 'text/html' }),
                'text/plain': new Blob([plainText], { type: 'text/plain' }),
            }),
        ]);
        return true;
    } catch {
        return false;
    }
}
