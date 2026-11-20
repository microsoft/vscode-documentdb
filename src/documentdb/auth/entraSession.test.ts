/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, it, vi } from 'vitest';
import { getEntraSession } from './entraSession';

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('vscode', () => ({ authentication: { getSession } }));

it.each([
    ['interactive', { createIfNone: true }],
    ['silent', { silent: true }],
    ['forceNew', { forceNewSession: true }],
] as const)('uses the explicit provider, scopes and account in %s mode', async (mode, expectedOptions) => {
    const account = { id: 'account-id', label: 'account-label' };
    const session = { id: 'session-id', accessToken: 'dummy', account, scopes: [] };
    getSession.mockResolvedValueOnce(session);
    await expect(
        getEntraSession({
            providerId: 'pinned-provider',
            resource: mode === 'forceNew' ? 'https://resource.example/.default' : 'https://resource.example',
            tenantId: 'tenant-id',
            mode,
            account,
        }),
    ).resolves.toBe(session);
    expect(getSession).toHaveBeenLastCalledWith(
        'pinned-provider',
        ['https://resource.example/.default', 'VSCODE_TENANT:tenant-id'],
        { ...expectedOptions, account },
    );
});
