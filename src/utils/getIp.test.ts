/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type sendRequestWithTimeout } from '@microsoft/vscode-azext-azureutils';
import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { getPublicIpv4, isIpInRanges } from './getIp';

vi.mock('@microsoft/vscode-azext-azureutils', () => ({
    sendRequestWithTimeout: (...args: Parameters<typeof sendRequestWithTimeout>): Promise<{ bodyAsText?: string }> =>
        request(...args),
}));

const context: IActionContext = {
    telemetry: { properties: {}, measurements: {} },
    errorHandling: { issueProperties: {} },
    valuesToMask: [],
    ui: {
        onDidFinishPrompt: vi.fn(),
        showQuickPick: vi.fn(),
        showInputBox: vi.fn(),
        showWarningMessage: vi.fn(),
        showOpenDialog: vi.fn(),
        showWorkspaceFolderPick: vi.fn(),
    },
};
const request = vi.fn<(...args: Parameters<typeof sendRequestWithTimeout>) => Promise<{ bodyAsText?: string }>>();

describe('getIp', () => {
    beforeEach(() => {
        request.mockReset();
    });

    it.each([
        ['10.0.0.9', false],
        ['10.0.0.10', true],
        ['10.0.0.15', true],
        ['10.0.0.20', true],
        ['10.0.0.21', false],
    ])('checks inclusive range boundaries for %s', (ip, expected) => {
        expect(isIpInRanges(ip, [{ startIpAddress: '10.0.0.10', endIpAddress: '10.0.0.20' }])).toBe(expected);
        expect(isIpInRanges(ip, [])).toBe(false);
    });

    it('returns the first valid IPv4 response without using the fallback', async () => {
        request.mockResolvedValueOnce({ bodyAsText: '203.0.113.7' });

        await expect(getPublicIpv4(context)).resolves.toBe('203.0.113.7');
        expect(request).toHaveBeenCalledTimes(1);
        expect(request).toHaveBeenCalledWith(
            context,
            { method: 'GET', url: 'https://api.ipify.org/' },
            5000,
            undefined,
        );
    });

    it.each(['not an IP', '2001:db8::1', undefined])('falls back after an invalid response: %s', async (bodyAsText) => {
        request.mockResolvedValueOnce({ bodyAsText }).mockResolvedValueOnce({ bodyAsText: '203.0.113.8' });

        await expect(getPublicIpv4(context)).resolves.toBe('203.0.113.8');
        expect(request).toHaveBeenLastCalledWith(
            context,
            { method: 'GET', url: 'https://ipv4.icanhazip.com/' },
            5000,
            undefined,
        );
    });

    it('rethrows the last failure after both services fail', async () => {
        const lastError = new Error('Fallback unavailable');
        request.mockRejectedValueOnce(new Error('Primary unavailable')).mockRejectedValueOnce(lastError);

        await expect(getPublicIpv4(context)).rejects.toBe(lastError);
        expect(request).toHaveBeenCalledTimes(2);
    });
});
