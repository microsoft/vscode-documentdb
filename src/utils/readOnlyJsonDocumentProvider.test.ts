/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import {
    READ_ONLY_JSON_SCHEME,
    ReadOnlyJsonDocumentProvider,
    readOnlyJsonDocumentProvider,
    registerReadOnlyJsonDocumentProvider,
} from './readOnlyJsonDocumentProvider';

const mockOpenTextDocument = vi.spyOn(vscode.workspace, 'openTextDocument');
const mockShowTextDocument = vi.spyOn(vscode.window, 'showTextDocument');
const mockExecuteCommand = vi.spyOn(vscode.commands, 'executeCommand');

function previewTab(label: string, viewType = 'mainThreadWebview-markdown.preview'): vscode.Tab {
    return { label, input: { viewType } } as vscode.Tab;
}

function textTab(uri: vscode.Uri): vscode.Tab {
    return { label: uri.path, input: { uri } } as vscode.Tab;
}

interface Registered {
    readonly onClose: (document: vscode.TextDocument) => void;
    /** Replaces the open tabs and fires the tab-change event, as VS Code does. */
    readonly changeTabs: (tabs: readonly vscode.Tab[]) => void;
    readonly registration: vscode.Disposable;
}

function register(): Registered {
    vi.spyOn(vscode.workspace, 'registerTextDocumentContentProvider').mockReturnValue({ dispose: vi.fn() });
    const closeRegistration = vi.spyOn(vscode.workspace, 'onDidCloseTextDocument').mockReturnValue({
        dispose: vi.fn(),
    });
    const tabGroups = vscode.window.tabGroups;
    const tabRegistration = vi.spyOn(tabGroups, 'onDidChangeTabs').mockReturnValue({ dispose: vi.fn() });
    const registration = registerReadOnlyJsonDocumentProvider();
    const onTabsChanged = tabRegistration.mock.calls[0]?.[0];
    return {
        onClose: closeRegistration.mock.calls[0][0],
        changeTabs: (tabs): void => {
            Object.defineProperty(tabGroups, 'all', {
                value: [{ tabs } as unknown as vscode.TabGroup],
                configurable: true,
            });
            onTabsChanged?.({ opened: [], closed: [], changed: [] });
        },
        registration,
    };
}

describe('readOnlyJsonDocumentProvider', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        readOnlyJsonDocumentProvider.dispose();
        mockOpenTextDocument.mockImplementation(
            async (uri): Promise<vscode.TextDocument> => ({ uri }) as vscode.TextDocument,
        );
        mockShowTextDocument.mockResolvedValue({} as vscode.TextEditor);
        mockExecuteCommand.mockResolvedValue(undefined);
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

    describe('Markdown documents', () => {
        it.each([
            ['Diagnostics', '/Diagnostics.md'],
            ['Diagnostics.md', '/Diagnostics.md'],
            ['Diagnostics.MD', '/Diagnostics.MD'],
            ['Folder/Report\\Details', '/Folder-Report-Details.md'],
        ])('opens %s in the built-in Markdown preview', async (title, path) => {
            const content = '# Connection diagnostics';

            const uri = await readOnlyJsonDocumentProvider.openMarkdownDocument(title, content);

            expect(uri.scheme).toBe(READ_ONLY_JSON_SCHEME);
            expect(uri.authority).toBe('view');
            expect(uri.path).toBe(path);
            expect(uri.query).toMatch(/^id=\d+$/);
            expect(readOnlyJsonDocumentProvider.provideTextDocumentContent(uri)).toBe(content);
            expect(mockExecuteCommand).toHaveBeenCalledWith('markdown.showPreview', uri);
            expect(mockOpenTextDocument).not.toHaveBeenCalled();
            expect(mockShowTextDocument).not.toHaveBeenCalled();
        });

        it('fires onDidChange with the updated URI and retains content until its last tab closes', async () => {
            const provider = new ReadOnlyJsonDocumentProvider();
            const changed = vi.fn();
            const listener = provider.onDidChange(changed);
            const uri = await provider.openMarkdownDocument('Live report', '# Full report');
            provider.releaseUnshownMarkdownDocuments([previewTab('Preview Live report.md')]);
            provider.releaseDocument(uri);

            expect(provider.updateMarkdownDocument(uri, '# Redacted report')).toBe(true);
            expect(changed).toHaveBeenCalledExactlyOnceWith(uri);
            expect(provider.provideTextDocumentContent(uri)).toBe('# Redacted report');
            provider.releaseUnshownMarkdownDocuments([textTab(uri)]);
            expect(provider.provideTextDocumentContent(uri)).toBe('# Redacted report');
            provider.releaseUnshownMarkdownDocuments([]);
            expect(provider.provideTextDocumentContent(uri)).toBe('');
            expect(provider.updateMarkdownDocument(uri, '# Must not resurrect')).toBe(false);
            expect(changed).toHaveBeenCalledTimes(1);
            listener.dispose();
            provider.dispose();
        });

        it('falls back to the text editor when the preview command fails', async () => {
            mockExecuteCommand.mockRejectedValueOnce(new Error('preview unavailable'));

            const uri = await readOnlyJsonDocumentProvider.openMarkdownDocument('Diagnostics', '# Report');

            expect(mockOpenTextDocument).toHaveBeenCalledWith(uri);
            expect(mockShowTextDocument).toHaveBeenCalledWith(expect.objectContaining({ uri }));
            expect(readOnlyJsonDocumentProvider.provideTextDocumentContent(uri)).toBe('# Report');
        });

        it('releases content when the preview and opening the fallback document both fail', async () => {
            mockExecuteCommand.mockRejectedValueOnce(new Error('preview unavailable'));
            const error = new Error('open failed');
            mockOpenTextDocument.mockRejectedValueOnce(error);

            await expect(readOnlyJsonDocumentProvider.openMarkdownDocument('Diagnostics', '# Report')).rejects.toBe(
                error,
            );

            const uri = mockExecuteCommand.mock.calls[0][1] as vscode.Uri;
            expect(readOnlyJsonDocumentProvider.provideTextDocumentContent(uri)).toBe('');
        });

        it('releases content when the preview and showing the fallback editor both fail', async () => {
            mockExecuteCommand.mockRejectedValueOnce(new Error('preview unavailable'));
            const error = new Error('show failed');
            mockShowTextDocument.mockRejectedValueOnce(error);

            await expect(readOnlyJsonDocumentProvider.openMarkdownDocument('Diagnostics', '# Report')).rejects.toBe(
                error,
            );

            const uri = mockExecuteCommand.mock.calls[0][1] as vscode.Uri;
            expect(readOnlyJsonDocumentProvider.provideTextDocumentContent(uri)).toBe('');
        });

        it('releases JSON, but not Markdown, content through the shared document-close hook', async () => {
            const { onClose, registration } = register();
            const markdownUri = await readOnlyJsonDocumentProvider.openMarkdownDocument('Diagnostics', '# Report');
            await readOnlyJsonDocumentProvider.openDocument('Diagnostics', '{}');
            const jsonUri = mockOpenTextDocument.mock.calls[0][0] as vscode.Uri;

            expect(vscode.workspace.registerTextDocumentContentProvider).toHaveBeenCalledWith(
                READ_ONLY_JSON_SCHEME,
                readOnlyJsonDocumentProvider,
            );
            onClose({ uri: markdownUri } as vscode.TextDocument);
            expect(readOnlyJsonDocumentProvider.provideTextDocumentContent(markdownUri)).toBe('# Report');
            expect(readOnlyJsonDocumentProvider.provideTextDocumentContent(jsonUri)).toBe('{}');
            onClose({ uri: jsonUri } as vscode.TextDocument);
            expect(readOnlyJsonDocumentProvider.provideTextDocumentContent(jsonUri)).toBe('');
            registration.dispose();
        });

        describe('preview lifetime', () => {
            it('keeps the report while its preview is open, even after VS Code closes the source text model', async () => {
                const { onClose, changeTabs, registration } = register();
                const uri = await readOnlyJsonDocumentProvider.openMarkdownDocument('Diagnostics', '# Report');
                changeTabs([previewTab('Preview Diagnostics.md')]);

                onClose({ uri } as vscode.TextDocument);
                changeTabs([previewTab('Preview Diagnostics.md'), textTab(vscode.Uri.file('/other.ts'))]);

                expect(readOnlyJsonDocumentProvider.provideTextDocumentContent(uri)).toBe('# Report');
                registration.dispose();
            });

            it('releases the report when the last tab showing it closes', async () => {
                const { changeTabs, registration } = register();
                const uri = await readOnlyJsonDocumentProvider.openMarkdownDocument('Diagnostics', '# Report');
                changeTabs([previewTab('[Preview] Diagnostics.md')]);
                changeTabs([previewTab('[Preview] Diagnostics.md'), textTab(uri)]);

                changeTabs([textTab(uri)]);
                expect(readOnlyJsonDocumentProvider.provideTextDocumentContent(uri)).toBe('# Report');
                changeTabs([]);
                expect(readOnlyJsonDocumentProvider.provideTextDocumentContent(uri)).toBe('');
                registration.dispose();
            });

            it('keeps a report that no tab has shown yet', async () => {
                const { changeTabs, registration } = register();
                const uri = await readOnlyJsonDocumentProvider.openMarkdownDocument('Diagnostics', '# Report');

                changeTabs([textTab(vscode.Uri.file('/other.ts'))]);

                expect(readOnlyJsonDocumentProvider.provideTextDocumentContent(uri)).toBe('# Report');
                registration.dispose();
            });

            it('releases a report when its preview switches to another file or closes, keeping others', async () => {
                const { changeTabs, registration } = register();
                const first = await readOnlyJsonDocumentProvider.openMarkdownDocument('First', '# First');
                const second = await readOnlyJsonDocumentProvider.openMarkdownDocument('Second', '# Second');
                changeTabs([previewTab('Preview First.md'), previewTab('Preview Second.md')]);

                changeTabs([previewTab('Preview README.md'), previewTab('Preview Second.md')]);

                expect(readOnlyJsonDocumentProvider.provideTextDocumentContent(first)).toBe('');
                expect(readOnlyJsonDocumentProvider.provideTextDocumentContent(second)).toBe('# Second');
                registration.dispose();
            });

            it('ignores webview tabs of other types and leaves JSON documents to the close hook', async () => {
                const { changeTabs, registration } = register();
                const markdownUri = await readOnlyJsonDocumentProvider.openMarkdownDocument('Diagnostics', '# Report');
                await readOnlyJsonDocumentProvider.openDocument('Raw Output', '{}');
                const jsonUri = mockOpenTextDocument.mock.calls[0][0] as vscode.Uri;
                changeTabs([previewTab('Preview Diagnostics.md')]);

                changeTabs([previewTab('Preview Diagnostics.md', 'mainThreadWebview-other.view')]);

                expect(readOnlyJsonDocumentProvider.provideTextDocumentContent(markdownUri)).toBe('');
                expect(readOnlyJsonDocumentProvider.provideTextDocumentContent(jsonUri)).toBe('{}');
                registration.dispose();
            });
        });

        it('keeps content independent for repeated opens of the same title', async () => {
            const first = await readOnlyJsonDocumentProvider.openMarkdownDocument('Diagnostics', '# First');
            const second = await readOnlyJsonDocumentProvider.openMarkdownDocument('Diagnostics', '# Second');

            expect(first.toString()).not.toBe(second.toString());
            expect(first.query).not.toBe(second.query);
            expect(readOnlyJsonDocumentProvider.provideTextDocumentContent(first)).toBe('# First');
            expect(readOnlyJsonDocumentProvider.provideTextDocumentContent(second)).toBe('# Second');
            readOnlyJsonDocumentProvider.releaseDocument(first);
            expect(readOnlyJsonDocumentProvider.provideTextDocumentContent(second)).toBe('# Second');
        });
    });
});
