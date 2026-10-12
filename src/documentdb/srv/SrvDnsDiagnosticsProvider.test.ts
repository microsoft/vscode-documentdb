/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { UserCancelledError } from '@microsoft/vscode-azext-utils';
import { Links } from '../../constants';
import { SrvDnsDiagnosticsProvider } from './SrvDnsDiagnosticsProvider';

jest.mock('@microsoft/vscode-azext-utils', () => ({
    callWithTelemetryAndErrorHandling: jest.fn(),
    UserCancelledError: class UserCancelledError extends Error {},
}));

const HOSTNAME = 'x.example.com';

function nodeError(code: string, syscall = 'querySrv', message = `querySrv ${code} _mongodb._tcp.${HOSTNAME}`): Error {
    return Object.assign(new Error(message), { code, syscall });
}

describe('SrvDnsDiagnosticsProvider', () => {
    const provider = new SrvDnsDiagnosticsProvider();

    it.each([
        ['Node-style EBADRESP', nodeError('EBADRESP'), 'the DNS reply could not be read'],
        ['worker-relayed EFORMERR', new Error(`querySrv EFORMERR _mongodb._tcp.${HOSTNAME}`), 'could not be read'],
        ['Node-style ECONNREFUSED', nodeError('ECONNREFUSED'), 'the DNS server refused the query'],
    ])('explains a %s error without the host', async (_name, error, expected): Promise<void> => {
        const result = await provider.explain({ clusterId: 'c1', error });
        expect(result).toContain(expected);
        expect(result).toContain(Links.SrvDnsTroubleshooting);
        expect(result).not.toContain(HOSTNAME);
    });

    it.each([
        ['querySrv ENOTFOUND', nodeError('ENOTFOUND')],
        ['a TCP refusal', nodeError('ECONNREFUSED', 'connect', 'connect ECONNREFUSED 10.0.0.5:10260')],
        ['EBADRESP without querySrv', Object.assign(new Error('DNS reply could not be read'), { code: 'EBADRESP' })],
        ['an unrelated error', new Error('bad auth')],
        ['a non-Error value', `querySrv EBADRESP _mongodb._tcp.${HOSTNAME}`],
        ['a cancellation', Object.assign(new UserCancelledError(), { code: 'EBADRESP', syscall: 'querySrv' })],
    ])('does not translate %s', async (_name, error): Promise<void> => {
        await expect(provider.explain({ clusterId: 'c1', error })).resolves.toBeUndefined();
    });
});
