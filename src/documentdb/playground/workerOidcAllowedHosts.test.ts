/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getWorkerOidcAllowedHosts } from './workerOidcAllowedHosts';

describe('worker OIDC allowed hosts', (): void => {
    it('prefers the host-provided original allowlist over the rewritten connection string', (): void => {
        const oidcAllowedHosts = Object.freeze(['*.azure.us']);
        const result = getWorkerOidcAllowedHosts({
            connectionString: 'mongodb://resolved.azure.com:27017',
            oidcAllowedHosts,
        });
        expect(result).toEqual(['*.azure.us']);
        expect(result).not.toBe(oidcAllowedHosts);
        result.push('another-host');
        expect(oidcAllowedHosts).toEqual(['*.azure.us']);
    });

    it('does not replace an explicitly empty allowlist', (): void => {
        expect(getWorkerOidcAllowedHosts({
            connectionString: 'mongodb://resolved.azure.com:27017',
            oidcAllowedHosts: [],
        })).toEqual([]);
    });

    it('supports older init messages without a host-provided allowlist', (): void => {
        expect(getWorkerOidcAllowedHosts({
            connectionString: 'mongodb+srv://cluster.mongocluster.cosmos.azure.cn',
        })).toEqual(['*.azure.cn']);
    });
});
