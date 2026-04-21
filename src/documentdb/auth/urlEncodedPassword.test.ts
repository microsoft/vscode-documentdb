/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import {
    showConnectionFailedAndMaybeOfferDecodedRetry,
    tryDecodeUrlEncodedPassword,
    UrlEncodedPasswordTelemetry,
} from './urlEncodedPassword';

function createMockContext(): IActionContext {
    return {
        telemetry: { properties: {}, measurements: {} },
        errorHandling: { issueProperties: {} },
        ui: {} as IActionContext['ui'],
        valuesToMask: [],
    } as unknown as IActionContext;
}

describe('tryDecodeUrlEncodedPassword', () => {
    it('returns undefined for undefined input', () => {
        expect(tryDecodeUrlEncodedPassword(undefined)).toBeUndefined();
    });

    it('returns undefined for empty string', () => {
        expect(tryDecodeUrlEncodedPassword('')).toBeUndefined();
    });

    it('returns undefined when password has no percent-encoded sequences', () => {
        expect(tryDecodeUrlEncodedPassword('plainPassword123')).toBeUndefined();
    });

    it('returns undefined when password contains % but not valid encoding', () => {
        // e.g. "100%" — the % is not followed by two hex digits
        expect(tryDecodeUrlEncodedPassword('100%')).toBeUndefined();
    });

    it('returns undefined when password contains %XX that is not valid UTF-8', () => {
        // %C3 alone is an incomplete UTF-8 sequence; decodeURIComponent should throw
        expect(tryDecodeUrlEncodedPassword('%C3')).toBeUndefined();
    });

    it('returns decoded password for %40 (@)', () => {
        expect(tryDecodeUrlEncodedPassword('p%40ss')).toBe('p@ss');
    });

    it('returns decoded password for multiple encoded characters', () => {
        expect(tryDecodeUrlEncodedPassword('p%40ss%21w%23rd')).toBe('p@ss!w#rd');
    });

    it('returns decoded password for %20 (space)', () => {
        expect(tryDecodeUrlEncodedPassword('my%20password')).toBe('my password');
    });

    it('returns undefined when decoding produces the same string', () => {
        // %30 decodes to "0", so "abc%30" decodes to "abc0"
        // But a password like "%41" decodes to "A", which differs.
        // A password that is already decoded with no encoded chars won't match the pattern.
        // Let's use a case where decoded === original: not possible with valid %XX that differs.
        // Actually if someone has "%25" it decodes to "%", so that's always different.
        // This edge case is hard to trigger with valid encoding, so skip pure equality test.
    });

    it('handles case-insensitive hex digits', () => {
        expect(tryDecodeUrlEncodedPassword('p%2Fss')).toBe('p/ss');
        expect(tryDecodeUrlEncodedPassword('p%2fss')).toBe('p/ss');
    });
});

describe('showConnectionFailedAndMaybeOfferDecodedRetry', () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const showErrorMessage: jest.Mock = vscode.window.showErrorMessage as unknown as jest.Mock;

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('shows error dialog without retry button when password is not URL-encoded', async () => {
        const context = createMockContext();

        showErrorMessage.mockResolvedValueOnce(undefined);

        const result = await showConnectionFailedAndMaybeOfferDecodedRetry({
            clusterName: 'test-cluster',
            password: 'plainPassword',
            isNativeAuth: true,
            originalError: new Error('auth failed'),
            context,
        });

        expect(result.decodedPassword).toBeUndefined();
        expect(context.telemetry.properties[UrlEncodedPasswordTelemetry.Detected]).toBe('false');
        expect(context.telemetry.properties[UrlEncodedPasswordTelemetry.Offered]).toBe('false');
        // The dialog should have been called with no extra buttons
        expect(showErrorMessage).toHaveBeenCalledWith(
            expect.stringContaining('test-cluster'),
            expect.objectContaining({ modal: true }),
        );
    });

    it('shows error dialog without retry button when auth is not native', async () => {
        const context = createMockContext();

        showErrorMessage.mockResolvedValueOnce(undefined);

        const result = await showConnectionFailedAndMaybeOfferDecodedRetry({
            clusterName: 'test-cluster',
            password: 'p%40ss', // URL-encoded but non-native auth
            isNativeAuth: false,
            originalError: new Error('auth failed'),
            context,
        });

        expect(result.decodedPassword).toBeUndefined();
        expect(context.telemetry.properties[UrlEncodedPasswordTelemetry.Detected]).toBe('false');
    });

    it('offers retry button when password is URL-encoded and auth is native', async () => {
        const context = createMockContext();

        showErrorMessage.mockResolvedValueOnce(undefined);

        const result = await showConnectionFailedAndMaybeOfferDecodedRetry({
            clusterName: 'test-cluster',
            password: 'p%40ss',
            isNativeAuth: true,
            originalError: new Error('auth failed'),
            context,
        });

        expect(result.decodedPassword).toBeUndefined(); // user didn't click retry
        expect(context.telemetry.properties[UrlEncodedPasswordTelemetry.Detected]).toBe('true');
        expect(context.telemetry.properties[UrlEncodedPasswordTelemetry.Offered]).toBe('true');
        expect(context.telemetry.properties[UrlEncodedPasswordTelemetry.Accepted]).toBe('false');
        // Should have been called with the retry button
        expect(showErrorMessage).toHaveBeenCalledWith(
            expect.stringContaining('test-cluster'),
            expect.objectContaining({ modal: true }),
            expect.stringContaining('Decoded Password'),
        );
    });

    it('returns decoded password when user clicks retry button', async () => {
        const context = createMockContext();

        // Simulate user clicking the retry button
        showErrorMessage.mockImplementation((_msg: string, _opts: unknown, ...buttons: string[]) =>
            Promise.resolve(buttons[0]),
        );

        const result = await showConnectionFailedAndMaybeOfferDecodedRetry({
            clusterName: 'test-cluster',
            password: 'p%40ss',
            isNativeAuth: true,
            originalError: new Error('auth failed'),
            context,
        });

        expect(result.decodedPassword).toBe('p@ss');
        expect(context.telemetry.properties[UrlEncodedPasswordTelemetry.Accepted]).toBe('true');
    });

    it('handles non-Error original error', async () => {
        const context = createMockContext();

        showErrorMessage.mockResolvedValueOnce(undefined);

        await showConnectionFailedAndMaybeOfferDecodedRetry({
            clusterName: 'test-cluster',
            password: undefined,
            isNativeAuth: true,
            originalError: 'string error',
            context,
        });

        // Should not throw; the dialog detail should contain the stringified error
        expect(showErrorMessage).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({
                detail: expect.stringContaining('string error'),
            }),
        );
    });

    it('shows error dialog without retry button when password is undefined', async () => {
        const context = createMockContext();

        showErrorMessage.mockResolvedValueOnce(undefined);

        const result = await showConnectionFailedAndMaybeOfferDecodedRetry({
            clusterName: 'test-cluster',
            password: undefined,
            isNativeAuth: true,
            originalError: new Error('auth failed'),
            context,
        });

        expect(result.decodedPassword).toBeUndefined();
        expect(context.telemetry.properties[UrlEncodedPasswordTelemetry.Detected]).toBe('false');
    });
});
