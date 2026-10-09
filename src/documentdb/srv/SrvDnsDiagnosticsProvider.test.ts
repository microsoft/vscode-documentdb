/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { UserCancelledError } from '@microsoft/vscode-azext-utils';
import { Links } from '../../constants';
import { ConnectionDiagnosticsService } from '../../services/connectionDiagnosticsService';
import { SrvDnsDiagnosticsProvider } from './SrvDnsDiagnosticsProvider';

jest.mock('@microsoft/vscode-azext-utils', () => ({
    callWithTelemetryAndErrorHandling: jest.fn(),
    UserCancelledError: class UserCancelledError extends Error {},
}));

const HOSTNAME = 'x.example.com';
const DNS_REPLY_EXPLANATION =
    'The SRV record for this connection could not be resolved: the DNS reply could not be read. This often happens with home routers and some VPN or corporate DNS servers. Use a non-SRV `mongodb://` connection string, or a different DNS server.';
const DNS_REFUSAL_EXPLANATION =
    "The SRV record for this connection could not be resolved: the DNS server refused the query. Check your network's DNS settings, or use a non-SRV `mongodb://` connection string.";
const cases = [
    { code: 'EBADRESP', explanation: DNS_REPLY_EXPLANATION },
    { code: 'EFORMERR', explanation: DNS_REPLY_EXPLANATION },
    { code: 'ECONNREFUSED', explanation: DNS_REFUSAL_EXPLANATION },
];

describe('SrvDnsDiagnosticsProvider', () => {
    const provider = new SrvDnsDiagnosticsProvider();

    it.each(cases)('explains a Node-style querySrv $code error', async ({ code, explanation }): Promise<void> => {
        const message = `querySrv ${code} _mongodb._tcp.${HOSTNAME}`;
        const error = Object.freeze(Object.assign(new Error(message), { code, syscall: 'querySrv' }));

        const result = await provider.explain({ clusterId: 'c1', error });

        expect(result).toBe(`${explanation} See ${Links.SrvDnsTroubleshooting} for troubleshooting.`);
        expect(result).not.toContain(HOSTNAME);
        expect(result).not.toContain(message);
        expect(result).not.toContain('\n');
        expect(error.message).toBe(message);
        expect(error.code).toBe(code);
        expect(error.syscall).toBe('querySrv');
    });

    it.each(cases)('explains a worker-relayed querySrv $code error', async ({ code, explanation }): Promise<void> => {
        const message = `querySrv ${code} _mongodb._tcp.${HOSTNAME}`;
        const error = new Error(message);

        const result = await provider.explain({ clusterId: 'c1', error });

        expect(result).toBe(`${explanation} See ${Links.SrvDnsTroubleshooting} for troubleshooting.`);
        expect(result).not.toContain(HOSTNAME);
        expect(result).not.toContain(message);
    });

    it('accepts syscall evidence without a querySrv message prefix', async (): Promise<void> => {
        const error = Object.assign(new Error('DNS resolution failed'), { code: 'EBADRESP', syscall: 'querySrv' });

        await expect(provider.explain({ clusterId: 'c1', error })).resolves.toBe(
            `${DNS_REPLY_EXPLANATION} See ${Links.SrvDnsTroubleshooting} for troubleshooting.`,
        );
    });

    it('uses the code property in preference to the message code', async (): Promise<void> => {
        const error = Object.assign(new Error(`querySrv EBADRESP _mongodb._tcp.${HOSTNAME}`), {
            code: 'ECONNREFUSED',
            syscall: 'querySrv',
        });

        await expect(provider.explain({ clusterId: 'c1', error })).resolves.toBe(
            `${DNS_REFUSAL_EXPLANATION} See ${Links.SrvDnsTroubleshooting} for troubleshooting.`,
        );
    });

    it.each(['ENOTFOUND', 'ETIMEOUT', 'EOTHER'])('does not translate querySrv %s', async (code): Promise<void> => {
        const message = `querySrv ${code} _mongodb._tcp.${HOSTNAME}`;
        for (const error of [new Error(message), Object.assign(new Error(message), { code, syscall: 'querySrv' })]) {
            await expect(provider.explain({ clusterId: 'c1', error })).resolves.toBeUndefined();
        }
    });

    it('does not fall back to the message when an unsupported code property is present', async (): Promise<void> => {
        const error = Object.assign(new Error(`querySrv EBADRESP _mongodb._tcp.${HOSTNAME}`), {
            code: 'ENOTFOUND',
            syscall: 'querySrv',
        });

        await expect(provider.explain({ clusterId: 'c1', error })).resolves.toBeUndefined();
    });

    it('does not translate unrelated errors', async (): Promise<void> => {
        await expect(provider.explain({ clusterId: 'c1', error: new Error('bad auth') })).resolves.toBeUndefined();
    });

    it('does not translate an ordinary TCP refusal', async (): Promise<void> => {
        const error = Object.assign(new Error('connect ECONNREFUSED 10.0.0.5:10260'), {
            code: 'ECONNREFUSED',
            syscall: 'connect',
        });

        await expect(provider.explain({ clusterId: 'c1', error })).resolves.toBeUndefined();
    });

    it('does not translate EBADRESP without querySrv evidence', async (): Promise<void> => {
        const error = Object.assign(new Error('DNS reply could not be read'), { code: 'EBADRESP' });

        await expect(provider.explain({ clusterId: 'c1', error })).resolves.toBeUndefined();
    });

    it('requires the querySrv message signature at the start', async (): Promise<void> => {
        await expect(
            provider.explain({ clusterId: 'c1', error: new Error(`Failed: querySrv EBADRESP _mongodb._tcp.${HOSTNAME}`) }),
        ).resolves.toBeUndefined();
    });

    it('rejects unrelated errors before reading their code', async (): Promise<void> => {
        const error = new Error('connect ECONNREFUSED 10.0.0.5:10260');
        const getCode = jest.fn((): never => {
            throw new Error('code must not be read');
        });
        Object.defineProperty(error, 'code', { get: getCode });

        await expect(provider.explain({ clusterId: 'c1', error })).resolves.toBeUndefined();
        expect(getCode).not.toHaveBeenCalled();
    });

    it('does not translate cancellation even with querySrv evidence', async (): Promise<void> => {
        const error = Object.assign(new UserCancelledError(), { code: 'EBADRESP', syscall: 'querySrv' });
        error.message = `querySrv EBADRESP _mongodb._tcp.${HOSTNAME}`;

        await expect(provider.explain({ clusterId: 'c1', error })).resolves.toBeUndefined();
    });

    it.each([
        undefined,
        null,
        42,
        `querySrv EBADRESP _mongodb._tcp.${HOSTNAME}`,
        { code: 'EBADRESP', syscall: 'querySrv', message: `querySrv EBADRESP _mongodb._tcp.${HOSTNAME}` },
    ])('does not translate a non-Error value: %p', async (error): Promise<void> => {
        await expect(provider.explain({ clusterId: 'c1', error })).resolves.toBeUndefined();
    });

    it('returns the same neutral text when the fallback is disabled', async (): Promise<void> => {
        const original = process.env.DOCUMENTDB_DISABLE_SRV_FALLBACK;
        const error = new Error(`querySrv EBADRESP _mongodb._tcp.${HOSTNAME}`);
        try {
            delete process.env.DOCUMENTDB_DISABLE_SRV_FALLBACK;
            const enabled = await provider.explain({ clusterId: 'c1', error });
            process.env.DOCUMENTDB_DISABLE_SRV_FALLBACK = '1';
            const disabled = await provider.explain({ clusterId: 'c1', error });

            expect(disabled).toBe(enabled);
            expect(disabled).toBe(`${DNS_REPLY_EXPLANATION} See ${Links.SrvDnsTroubleshooting} for troubleshooting.`);
            expect(disabled).not.toContain('fallback');
            expect(disabled).not.toContain(HOSTNAME);
            expect(disabled).not.toContain(error.message);
        } finally {
            if (original === undefined) {
                delete process.env.DOCUMENTDB_DISABLE_SRV_FALLBACK;
            } else {
                process.env.DOCUMENTDB_DISABLE_SRV_FALLBACK = original;
            }
        }
    });

    it('returns the srv-dns identity through the diagnostics registry', async (): Promise<void> => {
        ConnectionDiagnosticsService.resetForTests();
        try {
            ConnectionDiagnosticsService.registerProvider(provider);

            await expect(
                ConnectionDiagnosticsService.explain({
                    clusterId: 'c1',
                    error: new Error(`querySrv EBADRESP _mongodb._tcp.${HOSTNAME}`),
                }),
            ).resolves.toEqual({
                providerId: 'srv-dns',
                message: `${DNS_REPLY_EXPLANATION} See ${Links.SrvDnsTroubleshooting} for troubleshooting.`,
            });
        } finally {
            ConnectionDiagnosticsService.resetForTests();
        }
    });
});
