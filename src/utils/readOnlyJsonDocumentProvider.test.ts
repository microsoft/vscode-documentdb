/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const mockOpenTextDocument = jest.fn();
const mockShowTextDocument = jest.fn();

jest.mock('vscode', () => ({
    Uri: {
        from: jest.fn((parts: { scheme: string; authority: string; path: string; query: string }) => ({
            ...parts,
            toString: () => `${parts.scheme}://${parts.authority}${parts.path}?${parts.query}`,
        })),
    },
    workspace: {
        openTextDocument: (...args: unknown[]) => mockOpenTextDocument(...args),
    },
    window: {
        showTextDocument: (...args: unknown[]) => mockShowTextDocument(...args),
    },
}));

import type * as vscode from 'vscode';
import { READ_ONLY_JSON_SCHEME, readOnlyJsonDocumentProvider } from './readOnlyJsonDocumentProvider';

describe('readOnlyJsonDocumentProvider', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        readOnlyJsonDocumentProvider.dispose();
        mockOpenTextDocument.mockImplementation(async (uri: vscode.Uri) => ({ uri }));
        mockShowTextDocument.mockResolvedValue(undefined);
    });

    it('opens JSON content using a read-only virtual document URI', async () => {
        const content = '{\n    "name": "sample"\n}';

        await readOnlyJsonDocumentProvider.openDocument('Sample Definition', content);

        const uri = mockOpenTextDocument.mock.calls[0][0] as vscode.Uri;
        expect(uri.scheme).toBe(READ_ONLY_JSON_SCHEME);
        expect(uri.path).toBe('/Sample Definition.json');
        expect(readOnlyJsonDocumentProvider.provideTextDocumentContent(uri)).toBe(content);
        expect(mockShowTextDocument).toHaveBeenCalledWith(expect.objectContaining({ uri }));
    });

    it('releases stored content when its document closes', async () => {
        await readOnlyJsonDocumentProvider.openDocument('Raw Output', '{}');
        const uri = mockOpenTextDocument.mock.calls[0][0] as vscode.Uri;

        readOnlyJsonDocumentProvider.releaseDocument(uri);

        expect(readOnlyJsonDocumentProvider.provideTextDocumentContent(uri)).toBe('');
    });

    it('releases stored content when opening the document fails', async () => {
        mockOpenTextDocument.mockRejectedValueOnce(new Error('open failed'));

        await expect(readOnlyJsonDocumentProvider.openDocument('Raw Output', '{}')).rejects.toThrow('open failed');

        const uri = mockOpenTextDocument.mock.calls[0][0] as vscode.Uri;
        expect(readOnlyJsonDocumentProvider.provideTextDocumentContent(uri)).toBe('');
    });
});
