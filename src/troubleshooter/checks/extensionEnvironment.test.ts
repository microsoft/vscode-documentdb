/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type RunContext } from '@documentdb-js/connectivity-troubleshooter';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { createExtensionEnvironmentCheck } from './extensionEnvironment';

const metadata = vi.hoisted(() => ({ version: '1.2.3', preview: false, mode: 1 }));
vi.mock('../../extensionVariables', () => ({
    ext: {
        context: {
            get extensionMode(): number {
                return metadata.mode;
            },
            extension: {
                get packageJSON(): { version: string; preview: boolean } {
                    return metadata;
                },
            },
        },
    },
}));
vi.mock('../../documentdb/auth/documentdbTokenResource', () => ({
    describeEntraSignInEnvironment: vi.fn(() => ({ configuredCloud: 'AzureCloud', authProvider: 'microsoft' })),
}));

describe('extensionEnvironment check', (): void => {
    beforeEach((): void => {
        metadata.version = '1.2.3';
        metadata.preview = false;
        metadata.mode = vscode.ExtensionMode.Production;
        Object.defineProperty(vscode.env, 'remoteName', { value: undefined, configurable: true });
        vi.stubEnv('WSL_DISTRO_NAME', '');
        vi.stubEnv('WSL_INTEROP', '');
        vi.stubEnv('DOCUMENTDB_DISABLE_SRV_FALLBACK', '');
        vi.stubEnv('DOCUMENTDB_DEBUG_FORCE_SRV_FALLBACK', '');
        vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
            get: vi.fn().mockReturnValue(''),
        } as unknown as vscode.WorkspaceConfiguration);
    });
    afterEach((): void => {
        vi.unstubAllEnvs();
        vi.restoreAllMocks();
    });

    it.each([
        [undefined, 'local'],
        ['wsl', 'wsl'],
        ['ssh-remote', 'ssh'],
        ['dev-container', 'devContainer'],
        ['codespaces', 'codespaces'],
        ['new-remote-provider', 'otherRemote'],
    ] as const)('maps remote %s to %s without a host identifier', async (remoteName, expected): Promise<void> => {
        Object.defineProperty(vscode.env, 'remoteName', { value: remoteName, configurable: true });
        const check = createExtensionEnvironmentCheck();
        const result = await check.run({} as RunContext, new AbortController().signal);
        expect(check.id).toBe('extensionEnvironment');
        expect(result.status).toBe('pass');
        expect(result.facts).toMatchObject({
            extensionVersion: '1.2.3',
            extensionChannel: 'stable',
            remoteKind: expected,
            vscodeVersion: vscode.version,
            electronVersion: process.versions.electron ?? null,
            driverVersion: expect.stringMatching(/^\d+\.\d+\.\d+/),
            srvFallbackMode: 'auto',
            vscodeProxyConfigured: false,
            entraSignInEnvironment: { configuredCloud: 'AzureCloud', authProvider: 'microsoft' },
        });
        if (expected === 'local') {
            expect(result.findings).toEqual([]);
        } else {
            expect(result.findings).toEqual([
                expect.objectContaining({
                    code: 'env.remoteExtensionHost',
                    severity: 'info',
                    data: { remoteKind: expected },
                }),
            ]);
        }
    });

    it('recognizes WSL environment variables without a VS Code remote name on Linux', async (): Promise<void> => {
        if (process.platform !== 'linux') {
            return;
        }
        vi.stubEnv('WSL_DISTRO_NAME', 'private-distro-name');
        const result = await createExtensionEnvironmentCheck().run({} as RunContext, new AbortController().signal);
        expect(result.facts.remoteKind).toBe('wsl');
        expect(JSON.stringify(result)).not.toContain('private-distro-name');
    });

    it.each([
        ['', false],
        ['  ', false],
        ['https://proxy-user:proxy-password@proxy.example/', true],
    ])('records proxy presence only', async (proxy, expected): Promise<void> => {
        vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
            get: vi.fn().mockReturnValue(proxy),
        } as unknown as vscode.WorkspaceConfiguration);
        const result = await createExtensionEnvironmentCheck().run({} as RunContext, new AbortController().signal);
        expect(vscode.workspace.getConfiguration).toHaveBeenCalledWith('http');
        expect(result.facts.vscodeProxyConfigured).toBe(expected);
        expect(JSON.stringify(result)).not.toMatch(/proxy-user|proxy-password|proxy.example/);
    });

    it.each([
        [false, '1.2.3', false, 'stable'],
        [false, '1.2.3-preview', false, 'preRelease'],
        [false, '1.2.3', true, 'preRelease'],
        [true, '1.2.3-preview', true, 'dev'],
    ] as const)(
        'classifies dev=%s version=%s preview=%s as %s',
        async (dev, version, preview, channel): Promise<void> => {
            metadata.mode = dev ? vscode.ExtensionMode.Development : vscode.ExtensionMode.Production;
            metadata.version = version;
            metadata.preview = preview;
            const result = await createExtensionEnvironmentCheck().run({} as RunContext, new AbortController().signal);
            expect(result.facts.extensionChannel).toBe(channel);
        },
    );
});
