/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { formatUrlForLogging, isSupportedExternalUrl } from './openUrl';

describe('isSupportedExternalUrl', () => {
    it.each(['https://example.com', 'http://localhost:3000/path'])('accepts %s', (value) => {
        expect(isSupportedExternalUrl(value)).toBe(true);
    });

    it.each(['example.com', 'not a URL', 'ftp://example.com', 'javascript:alert(1)'])('rejects %s', (value) => {
        expect(isSupportedExternalUrl(value)).toBe(false);
    });
});

describe('formatUrlForLogging', () => {
    it('redacts credentials, query values, and fragments', () => {
        const result = formatUrlForLogging(
            'https://alice:password@example.com/path?token=secret&tag=one&tag=two#private-fragment',
        );

        expect(result).toBe('https://example.com/path?token=<redacted>&tag=<redacted>&tag=<redacted>#<redacted>');
    });

    it('preserves URLs without private components', () => {
        expect(formatUrlForLogging('https://example.com/docs/page')).toBe('https://example.com/docs/page');
    });

    it('encodes query parameter names before logging', () => {
        expect(formatUrlForLogging('https://example.com/?private%20key=secret')).toBe(
            'https://example.com/?private%20key=<redacted>',
        );
    });
});
