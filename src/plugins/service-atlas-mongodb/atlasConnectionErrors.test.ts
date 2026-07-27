/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isAtlasTlsHandshakeRejection } from './atlasConnectionErrors';
import { buildAtlasNetworkAccessUrl } from './atlasDeepLinks';

describe('isAtlasTlsHandshakeRejection', () => {
    it('recognises the OpenSSL text Atlas produces for a non-allowlisted client IP', () => {
        // Verbatim from a live run: the user had just typed a username and password, but Atlas
        // tore the handshake down before either was sent.
        const error = new Error(
            '00B92AFAC07A0000:error:0A000438:SSL routines:ssl3_read_bytes:tlsv1 alert internal error:' +
                '../deps/openssl/openssl/ssl/record/rec_layer_s3.c:918:SSL alert number 80',
        );

        expect(isAtlasTlsHandshakeRejection(error)).toBe(true);
    });

    it('accepts a non-Error value', () => {
        expect(isAtlasTlsHandshakeRejection('tlsv1 alert internal error')).toBe(true);
    });

    it('leaves a genuine authentication failure alone', () => {
        expect(isAtlasTlsHandshakeRejection(new Error('bad auth : Authentication failed.'))).toBe(false);
    });

    it('leaves an unrelated TLS problem alone', () => {
        expect(isAtlasTlsHandshakeRejection(new Error('self-signed certificate in certificate chain'))).toBe(false);
    });
});

describe('buildAtlasNetworkAccessUrl', () => {
    it('points at the project IP access list', () => {
        expect(buildAtlasNetworkAccessUrl('64b1f0c9e4b0a12345678901')).toBe(
            'https://cloud.mongodb.com/v2/64b1f0c9e4b0a12345678901#/security/network/accessList',
        );
    });
});
