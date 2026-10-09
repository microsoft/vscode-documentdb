/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { transformSync } from '@swc/core';
import { readFileSync } from 'fs';
import { join } from 'path';
import { runInNewContext } from 'vm';
import * as vscode from 'vscode';
import { Links } from '../../constants';
import { ext } from '../../extensionVariables';
import {
    resetSrvFallbackPreviewNoticeForTests,
    SHOW_SRV_FALLBACK_PREVIEW_NOTICE,
    showSrvFallbackPreviewNotice,
} from './srvFallbackPreviewNotice';

import { type SrvResolutionReport } from '@documentdb-js/srv-resolver';
import type * as PreviewNotice from './srvFallbackPreviewNotice';

jest.mock('vscode', () => ({
    l10n: {
        t: jest.fn((message: string, ...args: readonly unknown[]): string =>
            message.replace(/\{(\d+)\}/g, (_match: string, index: string): string => String(args[Number(index)])),
        ),
    },
    window: { showInformationMessage: jest.fn() },
    env: { clipboard: { writeText: jest.fn() }, openExternal: jest.fn() },
    Uri: { parse: jest.fn((value: string): { value: string } => ({ value })) },
    version: '1.104.0',
}));
jest.mock('../../extensionVariables', () => ({
    ext: { context: { extension: { packageJSON: { version: '0.11.1-preview' } } } },
}));

const host = 'preview.example.com';
const report: SrvResolutionReport = {
    srvHost: host,
    srvServiceName: 'mongodb',
    path: 'fallback',
    outcome: 'succeeded',
    nodeErrorCode: 'EBADRESP',
    fallbackOutcome: 'succeeded',
    fallbackTransport: 'tcp',
    targetCompressed: true,
    txtSource: 'fallback',
    txtOptionsApplied: ['replicaSet', 'authSource'],
    tlsAdded: true,
    dnsServers: ['192.168.1.1:53', '10.0.0.1'],
    fallbackServersTried: 1,
    srvTargetCount: 2,
    nodeProbeDurationMs: 4,
    fallbackDurationMs: 10,
    forcedFallback: false,
    aresVersion: '1.34.8',
    nodeRuntimeVersion: '22.0.0',
};

type PreviewMessage = (
    message: string,
    options: vscode.MessageOptions,
    ...buttons: string[]
) => Thenable<string | undefined>;
const showInformationMessage = jest.mocked<PreviewMessage>(vscode.window.showInformationMessage);

function shownDetail(): string {
    const options = showInformationMessage.mock.calls[0][1];
    return options.detail ?? '';
}

async function flushNotice(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
}

describe('srvFallbackPreviewNotice', (): void => {
    beforeEach((): void => {
        jest.clearAllMocks();
        resetSrvFallbackPreviewNoticeForTests();
        showInformationMessage.mockReset().mockResolvedValue(undefined);
        jest.mocked(vscode.env.clipboard.writeText).mockReset().mockResolvedValue(undefined);
        jest.mocked(vscode.env.openExternal).mockReset().mockResolvedValue(true);
    });

    afterEach((): void => {
        jest.restoreAllMocks();
    });

    it('shows a successful fallback as a modal with the preview title and explanatory detail', (): void => {
        expect(SHOW_SRV_FALLBACK_PREVIEW_NOTICE).toBe(true);
        showSrvFallbackPreviewNotice(report, 'extension');
        expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
            `Developer Preview: DNS workaround applied for ${host}`,
            { modal: true, detail: expect.any(String) },
            'Copy Details',
            'Open Troubleshooting Guide',
        );
        expect(shownDetail()).toBe(
            "VS Code's built-in DNS resolver could not read the SRV record for this connection (EBADRESP, c-ares 1.34.8). This is a known issue with some routers and VPN or corporate DNS servers.\n\n" +
                'The extension resolved the host names itself, using the same DNS servers your system is configured with (192.168.1.1:53, 10.0.0.1), and found 2 servers (over TCP).\n\n' +
                'Your saved connection string is unchanged: the resolved server list is used only for this connection, kept in memory, and looked up again on every new connection.\n\n' +
                'This notice is part of a developer preview. Please share your feedback; "Copy Details" copies a summary without credentials.',
        );
    });

    it.each([
        { path: 'node', outcome: 'succeeded' },
        { path: 'nodeErrorPassthrough', outcome: 'succeeded' },
        { path: 'fallback', outcome: 'failed' },
        { path: 'fallback', outcome: 'cancelled' },
    ] as const)('does not show for $path / $outcome', ({ path, outcome }): void => {
        showSrvFallbackPreviewNotice({ ...report, path, outcome }, 'extension');
        expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
    });

    it('deduplicates by lower-cased host, but not across hosts', (): void => {
        showSrvFallbackPreviewNotice(report, 'extension');
        showSrvFallbackPreviewNotice({ ...report, srvHost: host.toUpperCase() }, 'extension');
        showSrvFallbackPreviewNotice({ ...report, srvHost: 'other.example.com' }, 'extension');
        expect(vscode.window.showInformationMessage).toHaveBeenCalledTimes(2);
    });

    it.each(['shell', 'playground'] as const)('shows nothing for the %s surface', (surface): void => {
        showSrvFallbackPreviewNotice(report, surface);
        expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
        showSrvFallbackPreviewNotice(report, 'extension');
        expect(vscode.window.showInformationMessage).toHaveBeenCalledTimes(1);
    });

    it('allows the test-only reset to simulate a new window', (): void => {
        showSrvFallbackPreviewNotice(report, 'extension');
        resetSrvFallbackPreviewNoticeForTests();
        showSrvFallbackPreviewNotice(report, 'extension');
        expect(vscode.window.showInformationMessage).toHaveBeenCalledTimes(2);
    });

    it('shows nothing in a build with the preview gate set to false', (): void => {
        // SWC exports const bindings as immutable getters, so exercise the actual disabled-build source.
        const enabledSource = readFileSync(join(__dirname, 'srvFallbackPreviewNotice.ts'), 'utf8');
        const gate = 'export const SHOW_SRV_FALLBACK_PREVIEW_NOTICE = true;';
        expect(enabledSource).toContain(gate);
        const disabledSource = enabledSource.replace(gate, 'export const SHOW_SRV_FALLBACK_PREVIEW_NOTICE = false;');
        const disabledExports = {} as typeof PreviewNotice;
        const compiled = transformSync(disabledSource, {
            jsc: { parser: { syntax: 'typescript' }, target: 'es2021' },
            module: { type: 'commonjs' },
        });
        runInNewContext(compiled.code, {
            exports: disabledExports,
            require: (name: string): unknown => {
                switch (name) {
                    case 'vscode':
                        return vscode;
                    case '../../constants':
                        return { Links };
                    case '../../extensionVariables':
                        return { ext };
                    default:
                        throw new Error(`Unexpected import: ${name}`);
                }
            },
        });
        expect(disabledExports.SHOW_SRV_FALLBACK_PREVIEW_NOTICE).toBe(false);
        disabledExports.showSrvFallbackPreviewNotice(report, 'extension');
        expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
        expect(vscode.l10n.t).not.toHaveBeenCalled();
    });

    it('upper-cases UDP', (): void => {
        showSrvFallbackPreviewNotice({ ...report, fallbackTransport: 'udp' }, 'extension');
        expect(shownDetail()).toContain('over UDP');
    });

    it('explains the force environment variable without claiming the Node probe failed', (): void => {
        showSrvFallbackPreviewNotice({ ...report, forcedFallback: true, nodeErrorCode: 'none' }, 'extension');
        expect(shownDetail()).toContain(
            'The DNS workaround was forced by the DOCUMENTDB_DEBUG_FORCE_SRV_FALLBACK environment variable (c-ares 1.34.8).',
        );
        expect(shownDetail()).not.toContain('could not read');
        expect(shownDetail()).not.toContain('(none,');
        expect(shownDetail()).not.toContain('known issue');
    });

    it('copies only allowlisted diagnostics, without credentials, connection strings or resolved hosts', async (): Promise<void> => {
        const timestamp = '2026-10-09T15:25:38.577Z';
        jest.spyOn(Date.prototype, 'toISOString').mockReturnValue(timestamp);
        const connectionString = `mongodb+srv://previewUser:previewPassword@${host}/`;
        const resolvedTargetHosts = ['target-one.example.com', 'target-two.example.com'];
        const credentialFixture = { ...report, connectionString, resolvedTargetHosts };
        showInformationMessage.mockResolvedValue('Copy Details');
        showSrvFallbackPreviewNotice(credentialFixture, 'extension');
        await flushNotice();

        expect(vscode.env.clipboard.writeText).toHaveBeenCalledTimes(1);
        const summary = jest.mocked(vscode.env.clipboard.writeText).mock.calls[0][0];
        expect(summary).toBe(
            [
                'DocumentDB SRV DNS fallback (Developer Preview)',
                'Extension version: 0.11.1-preview',
                'VS Code version: 1.104.0',
                `Platform: ${process.platform}`,
                'Node.js version: 22.0.0',
                'c-ares version: 1.34.8',
                'Surface: extension (tree)',
                `SRV host: ${host}`,
                'Node DNS error code: EBADRESP',
                'DNS servers: 192.168.1.1:53, 10.0.0.1',
                'Transport: TCP',
                'SRV target count: 2',
                'Target compressed: true',
                'Node probe duration (ms): 4',
                'Fallback duration (ms): 10',
                'Forced fallback: false',
                `Timestamp (UTC): ${timestamp}`,
            ].join('\n'),
        );
        for (const secret of [
            'previewUser',
            'previewPassword',
            'previewUser:previewPassword',
            connectionString,
            ...resolvedTargetHosts,
        ]) {
            expect(summary).not.toContain(secret);
            expect(shownDetail()).not.toContain(secret);
        }
        expect(summary).not.toContain('mongodb://');
        expect(summary).not.toContain('mongodb+srv://');
        expect(vscode.env.openExternal).not.toHaveBeenCalled();
    });

    it('opens the troubleshooting guide when selected', async (): Promise<void> => {
        showInformationMessage.mockResolvedValue('Open Troubleshooting Guide');
        showSrvFallbackPreviewNotice(report, 'extension');
        await flushNotice();
        expect(vscode.Uri.parse).toHaveBeenCalledWith(Links.SrvDnsTroubleshooting);
        expect(vscode.env.openExternal).toHaveBeenCalledWith(jest.mocked(vscode.Uri.parse).mock.results[0].value);
        expect(vscode.env.clipboard.writeText).not.toHaveBeenCalled();
    });

    it('does nothing when the dialog is dismissed', async (): Promise<void> => {
        showSrvFallbackPreviewNotice(report, 'extension');
        await flushNotice();
        expect(vscode.env.clipboard.writeText).not.toHaveBeenCalled();
        expect(vscode.env.openExternal).not.toHaveBeenCalled();
    });

    it('ignores failures while building the notice without suppressing a later attempt', (): void => {
        jest.mocked(vscode.l10n.t).mockImplementationOnce((): never => {
            throw new Error('localization unavailable');
        });
        expect((): void => showSrvFallbackPreviewNotice(report, 'extension')).not.toThrow();
        expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
        showSrvFallbackPreviewNotice(report, 'extension');
        expect(vscode.window.showInformationMessage).toHaveBeenCalledTimes(1);
    });

    it('ignores synchronous show failures without suppressing a later attempt', (): void => {
        showInformationMessage.mockImplementationOnce((): never => {
            throw new Error('UI unavailable');
        });
        expect((): void => showSrvFallbackPreviewNotice(report, 'extension')).not.toThrow();
        showSrvFallbackPreviewNotice(report, 'extension');
        expect(vscode.window.showInformationMessage).toHaveBeenCalledTimes(2);
    });

    it('ignores a rejected dialog promise', async (): Promise<void> => {
        showInformationMessage.mockRejectedValue(new Error('UI rejected'));
        expect((): void => showSrvFallbackPreviewNotice(report, 'extension')).not.toThrow();
        await flushNotice();
    });

    it.each(['Copy Details', 'Open Troubleshooting Guide'])(
        'ignores a rejected %s action',
        async (selection): Promise<void> => {
            showInformationMessage.mockResolvedValue(selection);
            jest.mocked(vscode.env.clipboard.writeText).mockRejectedValue(new Error('clipboard unavailable'));
            jest.mocked(vscode.env.openExternal).mockRejectedValue(new Error('browser unavailable'));
            showSrvFallbackPreviewNotice(report, 'extension');
            await flushNotice();
        },
    );
});
