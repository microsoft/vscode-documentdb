/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
    l10n: { t: (message: string): string => message },
    CancellationTokenSource: class {
        public token = {};
        public cancel(): void {}
        public dispose(): void {}
    },
    window: { showInputBox: (...args: unknown[]): unknown => inputBox(...args) },
}));
vi.mock('@aws-sdk/credential-providers', () => ({
    fromIni: (options: unknown): unknown => fromIniMock(options),
}));
vi.mock('fs/promises', () => ({ readFile: (...args: unknown[]): unknown => readFileMock(...args) }));

import { listAwsProfiles, profileProvider } from './profiles';

const inputBox = vi.hoisted(() => vi.fn());
const fromIniMock = vi.hoisted(() => vi.fn());
const readFileMock = vi.hoisted(() => vi.fn());

describe('AWS profile resolution', () => {
    beforeEach(() => {
        inputBox.mockReset();
        fromIniMock.mockReset();
        readFileMock.mockReset();
    });

    it('rejects passive MFA without invoking UI', async () => {
        profileProvider('role', 'us-east-1', false);
        const options = fromIniMock.mock.calls[0][0] as { mfaCodeProvider: () => Promise<string> };
        await expect(options.mfaCodeProvider()).rejects.toMatchObject({ name: 'AwsInteractionRequiredError' });
        expect(inputBox).not.toHaveBeenCalled();
    });

    it('permits a foreground MFA prompt only on explicit verification', async () => {
        inputBox.mockResolvedValue('123456');
        profileProvider('role', 'us-east-1', true);
        const options = fromIniMock.mock.calls[0][0] as { mfaCodeProvider: () => Promise<string> };
        expect(await options.mfaCodeProvider()).toBe('123456');
        expect(inputBox).toHaveBeenCalledTimes(1);
    });

    it('never prompts after cancellation', async () => {
        const controller = new AbortController();
        profileProvider('role', 'us-east-1', true, controller.signal);
        controller.abort();
        const options = fromIniMock.mock.calls[0][0] as { mfaCodeProvider: () => Promise<string> };
        await expect(options.mfaCodeProvider()).rejects.toMatchObject({ name: 'AbortError' });
        expect(inputBox).not.toHaveBeenCalled();
    });

    it('merges profile metadata and SSO sessions without exposing file credentials', async () => {
        readFileMock.mockResolvedValueOnce(`
[profile work]
sso_session = company
sso_account_id = 123456789012
sso_role_name = ReadOnly
[sso-session company]
sso_start_url = https://example.awsapps.com/start
sso_region = us-east-1
[profile role]
role_arn = arn:aws:iam::123456789012:role/Reader
source_profile = keys
`).mockResolvedValueOnce(`
[keys]
aws_access_key_id = secret-id
aws_secret_access_key = secret-value
`);
        const profiles = await listAwsProfiles();
        expect(profiles).toContainEqual({
            name: 'work',
            kind: 'SSO',
            startUrl: 'https://example.awsapps.com/start',
            ssoRegion: 'us-east-1',
            accountId: '123456789012',
            roleName: 'ReadOnly',
        });
        expect(profiles.map((profile) => profile.name)).toEqual(['keys', 'role', 'work']);
        expect(JSON.stringify(profiles)).not.toContain('secret-');
    });

    it('parses indented profile and SSO session assignments', async () => {
        readFileMock
            .mockResolvedValueOnce(
                `
[profile work]
  sso_session = company
  sso_account_id = 123456789012
  sso_role_name = ReadOnly
[sso-session company]
  sso_start_url = https://example.awsapps.com/start
  sso_region = us-east-1
`,
            )
            .mockResolvedValueOnce('');

        await expect(listAwsProfiles()).resolves.toContainEqual({
            name: 'work',
            kind: 'SSO',
            startUrl: 'https://example.awsapps.com/start',
            ssoRegion: 'us-east-1',
            accountId: '123456789012',
            roleName: 'ReadOnly',
        });
    });
});
