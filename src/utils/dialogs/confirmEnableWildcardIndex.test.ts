/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const mockShowWarningMessage = jest.fn();

jest.mock('vscode', () => ({
    window: {
        showWarningMessage: (...args: unknown[]) => mockShowWarningMessage(...args),
    },
}));

jest.mock('@vscode/l10n', () => ({
    t: (message: string, ...args: unknown[]): string =>
        args.reduce<string>((result, value, index) => result.replace(`{${index}}`, String(value)), message),
}));

import { confirmEnableWildcardIndex } from './confirmEnableWildcardIndex';

const details = {
    fields: [
        { field: 'name', type: 'asc' as const },
        { field: 'metadata.category', type: 'text' as const },
    ],
    clearUnique: true,
    clearSparse: true,
    clearTtl: true,
    retainName: true,
    retainPartialFilter: true,
    retainCollation: true,
};

describe('confirmEnableWildcardIndex', () => {
    beforeEach(() => {
        mockShowWarningMessage.mockReset();
    });

    it('shows exact impact in an extension-host native modal and confirms the action', async () => {
        mockShowWarningMessage.mockResolvedValue('Enable wildcard');

        await expect(confirmEnableWildcardIndex(details)).resolves.toBe(true);
        expect(mockShowWarningMessage).toHaveBeenCalledWith(
            'Enable wildcard index?',
            expect.objectContaining({ modal: true, detail: expect.any(String) }),
            'Enable wildcard',
        );
        const options = mockShowWarningMessage.mock.calls[0][1] as { detail: string; modal: boolean };
        expect(options.detail).toContain('name (Ascending)');
        expect(options.detail).toContain('metadata.category (Text)');
        expect(options.detail).toContain('Unique');
        expect(options.detail).toContain('Sparse');
        expect(options.detail).toContain('TTL');
        expect(options.detail).toContain('Custom index name');
        expect(options.detail).toContain('Partial filter expression');
        expect(options.detail).toContain('Collation');
    });

    it.each([undefined, 'Cancel'])('returns false for dismissal result %s', async (result) => {
        mockShowWarningMessage.mockResolvedValue(result);
        await expect(confirmEnableWildcardIndex(details)).resolves.toBe(false);
    });
});
