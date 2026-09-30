/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isIpInRanges } from './getIp';

describe('isIpInRanges', () => {
    const ip = '12.34.56.78';

    it.each([
        ['at the start of a range', '12.34.56.78', '12.34.56.80'],
        ['at the end of a range', '12.34.56.76', '12.34.56.78'],
        ['inside a range', '12.34.56.76', '12.34.56.80'],
    ])('includes an ip %s', (_name, startIpAddress, endIpAddress) => {
        expect(isIpInRanges(ip, [{ startIpAddress, endIpAddress }])).toBe(true);
    });

    it.each([
        ['before a range', '12.34.56.80', '12.34.56.80'],
        ['after a range', '12.34.56.76', '12.34.56.76'],
    ])('excludes an ip %s', (_name, startIpAddress, endIpAddress) => {
        expect(isIpInRanges(ip, [{ startIpAddress, endIpAddress }])).toBe(false);
    });
});
