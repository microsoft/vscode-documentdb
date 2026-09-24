/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getClusterVersions, parseDocumentDbEngineVersion } from './formatUtils';

describe('parseDocumentDbEngineVersion', () => {
    it.each([
        ['0.117-0;0.117.0', '0.117.0'],
        ['0.117.0', '0.117.0'],
        ['0.118-1', '0.118-1'],
        [' ; 0.117-0 ; 0.117.0 ; ', '0.117.0'],
        ['0.117-0;0.118.0', '0.118.0'],
        ['0.117-0;0.118.0-rc.1', '0.118.0-rc.1'],
        [undefined, undefined],
        ['', undefined],
        [' ; ; ', undefined],
        ['unknown', undefined],
        ['[object Object]', undefined],
        ['0.117-0;unknown', undefined],
        ['unknown;0.117.0', undefined],
        ['0.117.0;0.118.0', undefined],
        ['0.117-0;0.118-1', undefined],
        ['0.117-0;0.117.0;12.1-1', undefined],
    ])('parses %p as %p', (raw, expected) => {
        expect(parseDocumentDbEngineVersion(raw)).toBe(expected);
    });
});

describe('getClusterVersions', () => {
    it('distinguishes the engine from the API version', () => {
        expect(
            getClusterVersions({
                topology_hello_internal_documentdb_versions: '0.117-0;0.117.0',
                serverInfo_version: ' 7.0.0 ',
            }),
        ).toEqual({ engine: '0.117.0', api: '7.0.0', server: undefined });
    });

    it.each([undefined, '', ' ', 'unknown', '7.0.0;8.0.0', '[object Object]'])(
        'omits an unclear API version %p independently of the engine',
        (serverInfo_version) => {
            expect(
                getClusterVersions({
                    topology_hello_internal_documentdb_versions: '0.117.0',
                    serverInfo_version,
                }),
            ).toEqual({ engine: '0.117.0', api: undefined, server: undefined });
        },
    );

    it('retains the API when the reported engine version is ambiguous', () => {
        expect(
            getClusterVersions({
                topology_hello_internal_documentdb_versions: '0.117.0;0.118.0',
                serverInfo_version: '7.0.0',
            }),
        ).toEqual({ engine: undefined, api: '7.0.0', server: undefined });
    });

    it('preserves server wording without evidence of a separate DocumentDB engine', () => {
        expect(getClusterVersions({ serverInfo_version: '8.0.11' })).toEqual({
            engine: undefined,
            api: undefined,
            server: '8.0.11',
        });
    });

    it('omits versions when neither is known', () => {
        expect(getClusterVersions({})).toEqual({ engine: undefined, api: undefined, server: undefined });
    });
});
