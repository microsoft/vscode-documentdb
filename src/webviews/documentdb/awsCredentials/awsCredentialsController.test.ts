/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type AwsCredentialsWebviewConfig } from './awsCredentialsController';
import { type RouterContext } from './awsCredentialsRouter';

interface CapturedOptions {
    context: RouterContext;
    config: AwsCredentialsWebviewConfig;
    webviewName: string;
    panelViewType: string;
}

let mockOptions: CapturedOptions;
let mockOnDisposed: () => void;
const mockDispose = vi.hoisted(() => vi.fn());
const mockCleanup = vi.hoisted(() => vi.fn());
const mockListCredentials = vi.hoisted(() => vi.fn());

vi.mock('vscode', () => ({
    l10n: { t: (message: string): string => message },
    Uri: { joinPath: (...parts: string[]): string => parts.join('\\') },
}));
vi.mock('../../../extensionVariables', () => ({ ext: { context: { extensionUri: 'extension' } } }));
vi.mock('../../../plugins/service-aws-documentdb/discovery/AwsDiscoveryService', () => ({
    awsDiscoveryService: { listCredentials: (): unknown => mockListCredentials() },
}));
vi.mock('./awsCredentialsRouter', () => ({
    disposeAwsCredentialState: (...args: unknown[]): unknown => mockCleanup(...args),
}));
vi.mock('../../_integration/openAppWebview', () => ({
    openAppWebview: (options: CapturedOptions): unknown => {
        mockOptions = options;
        return {
            dispose: mockDispose,
            onDisposed: (callback: () => void): void => {
                mockOnDisposed = callback;
            },
        };
    },
}));

import { openAwsCredentialsWebview } from './awsCredentialsController';

beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
});
afterEach(() => {
    vi.useRealTimers();
});

describe('openAwsCredentialsWebview', () => {
    it('rejects an update for a removed entry rather than opening an invalid edit wizard', async () => {
        mockListCredentials.mockResolvedValue([]);
        await expect(openAwsCredentialsWebview({ credentialId: 'removed' })).rejects.toThrow('no longer exists');
    });

    it('opens the registered panel and resolves false on dismissal, cleaning staged state', async () => {
        const result = openAwsCredentialsWebview();
        expect(mockOptions.webviewName).toBe('awsCredentials');
        expect(mockOptions.panelViewType).toBe('vscode-documentdb-aws-credentials');
        expect(mockOptions.config.mode).toBe('add');
        mockOnDisposed();
        await expect(result).resolves.toBe(false);
        expect(mockCleanup).toHaveBeenCalledWith(mockOptions.context.credentialState);
    });

    it('resolves as soon as persistence succeeds without closing the success screen', async () => {
        const result = openAwsCredentialsWebview();
        mockOptions.context.credentialState.credentialsStored = true;
        mockOptions.context.onCredentialPersisted();
        await expect(result).resolves.toBe(true);
        expect(mockDispose).not.toHaveBeenCalled();
        mockOptions.context.onCredentialsStored();
        vi.runAllTimers();
        expect(mockDispose).toHaveBeenCalledTimes(1);
        expect(mockCleanup).toHaveBeenCalled();
    });

    it('returns true if a successful panel is closed instead of pressing Close', async () => {
        const result = openAwsCredentialsWebview();
        mockOptions.context.credentialState.credentialsStored = true;
        mockOnDisposed();
        await expect(result).resolves.toBe(true);
    });

    it('whitelists public configuration rather than serializing credential objects', async () => {
        const credential = {
            id: 'entry',
            label: 'Work',
            authMethod: 'profile' as const,
            regions: ['us-west-2'],
            accountId: '123456789012',
            arn: 'arn:aws:iam::123456789012:role/test',
            profile: 'work',
            secretAccessKey: 'must-not-serialize',
            sessionToken: 'must-not-serialize-token',
        };
        const result = openAwsCredentialsWebview({ credential });
        expect(mockOptions.config).toMatchObject({ mode: 'edit', profile: 'work', regions: ['us-west-2'] });
        expect(mockOptions.context.credentialId).toBe('entry');
        expect(JSON.stringify(mockOptions.config)).not.toContain('must-not-serialize');
        expect(JSON.stringify(mockOptions.config)).not.toContain('arn:aws');
        mockOptions.context.onCancelled();
        vi.runAllTimers();
        await expect(result).resolves.toBe(false);
    });
});
