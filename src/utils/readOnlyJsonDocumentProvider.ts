/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

export const READ_ONLY_JSON_SCHEME = 'documentdb-readonly-json';

/** The built-in Markdown preview's webview type; tabs report it with a workbench prefix. */
const MARKDOWN_PREVIEW_VIEW_TYPE = 'markdown.preview';

interface MarkdownDocumentLifetime {
    readonly uri: vscode.Uri;
    /** Set once a tab shows the document; until then a tab change cannot release it. */
    shown: boolean;
}

function fileName(uri: vscode.Uri): string {
    return uri.path.slice(uri.path.lastIndexOf('/') + 1);
}

/**
 * Whether a tab shows the document: its source (or another editor of the same resource), or the
 * built-in Markdown preview. That preview is a webview tab without a resource; its title names the
 * file ("Preview {0}", "[Preview] {0}"), so reports opened under the same title are kept together.
 */
function tabShowsDocument(tab: vscode.Tab, uri: vscode.Uri): boolean {
    const input: unknown = tab.input;
    if (typeof input !== 'object' || input === null) {
        return false;
    }
    if ('uri' in input && String(input.uri) === uri.toString()) {
        return true;
    }
    return (
        'viewType' in input &&
        typeof input.viewType === 'string' &&
        input.viewType.endsWith(MARKDOWN_PREVIEW_VIEW_TYPE) &&
        tab.label.includes(fileName(uri))
    );
}

export class ReadOnlyJsonDocumentProvider implements vscode.TextDocumentContentProvider, vscode.Disposable {
    private readonly changed = new vscode.EventEmitter<vscode.Uri>();
    public readonly onDidChange = this.changed.event;
    private readonly contents = new Map<string, string>();
    /**
     * A Markdown preview holds no lasting reference to its source text model: VS Code can close that
     * model while the preview stays open, and the preview re-reads the source on refresh. Markdown
     * content therefore lives as long as a tab shows it, not as long as its text document.
     */
    private readonly markdownDocuments = new Map<string, MarkdownDocumentLifetime>();
    private sequence = 0;

    public provideTextDocumentContent(uri: vscode.Uri): string {
        return this.contents.get(uri.toString()) ?? '';
    }

    public async openDocument(title: string, content: string): Promise<void> {
        const uri = this.createDocumentUri(title, '.json');

        this.contents.set(uri.toString(), content);

        try {
            const document = await vscode.workspace.openTextDocument(uri);
            await vscode.window.showTextDocument(document);
        } catch (error) {
            this.contents.delete(uri.toString());
            throw error;
        }
    }

    public async openMarkdownDocument(title: string, content: string): Promise<vscode.Uri> {
        const uri = this.createDocumentUri(title, '.md');
        this.contents.set(uri.toString(), content);
        this.markdownDocuments.set(uri.toString(), { uri, shown: false });

        try {
            await this.revealMarkdownDocument(uri);
        } catch (error) {
            this.contents.delete(uri.toString());
            this.markdownDocuments.delete(uri.toString());
            throw error;
        }

        return uri;
    }

    /** Updates only a retained Markdown document; never resurrects a report whose tabs closed. */
    public updateMarkdownDocument(uri: vscode.Uri, content: string): boolean {
        if (!this.markdownDocuments.has(uri.toString())) {
            return false;
        }
        this.contents.set(uri.toString(), content);
        this.changed.fire(uri);
        return true;
    }

    public async revealMarkdownDocument(uri: vscode.Uri): Promise<void> {
        try {
            await vscode.commands.executeCommand('markdown.showPreview', uri);
        } catch {
            const document = await vscode.workspace.openTextDocument(uri);
            await vscode.window.showTextDocument(document);
        }
    }

    private createDocumentUri(title: string, extension: '.json' | '.md'): vscode.Uri {
        const fileName = title.toLowerCase().endsWith(extension) ? title : `${title}${extension}`;
        return vscode.Uri.from({
            scheme: READ_ONLY_JSON_SCHEME,
            authority: 'view',
            path: `/${fileName.replace(/[\\/]/g, '-')}`,
            query: `id=${this.sequence++}`,
        });
    }

    /** Releases a closed JSON document. Markdown documents follow their tabs instead. */
    public releaseDocument(uri: vscode.Uri): void {
        if (uri.scheme === READ_ONLY_JSON_SCHEME && !this.markdownDocuments.has(uri.toString())) {
            this.contents.delete(uri.toString());
        }
    }

    /** Releases each Markdown document that was shown in a tab and that no open tab shows any more. */
    public releaseUnshownMarkdownDocuments(openTabs: readonly vscode.Tab[]): void {
        for (const [key, document] of this.markdownDocuments) {
            if (openTabs.some((tab): boolean => tabShowsDocument(tab, document.uri))) {
                document.shown = true;
            } else if (document.shown) {
                this.markdownDocuments.delete(key);
                this.contents.delete(key);
            }
        }
    }

    public dispose(): void {
        this.changed.dispose();
        this.contents.clear();
        this.markdownDocuments.clear();
    }
}

export const readOnlyJsonDocumentProvider = new ReadOnlyJsonDocumentProvider();

export function registerReadOnlyJsonDocumentProvider(): vscode.Disposable {
    const providerRegistration = vscode.workspace.registerTextDocumentContentProvider(
        READ_ONLY_JSON_SCHEME,
        readOnlyJsonDocumentProvider,
    );
    const closeRegistration = vscode.workspace.onDidCloseTextDocument((document) => {
        readOnlyJsonDocumentProvider.releaseDocument(document.uri);
    });
    const tabRegistration = vscode.window.tabGroups.onDidChangeTabs(() => {
        readOnlyJsonDocumentProvider.releaseUnshownMarkdownDocuments(
            vscode.window.tabGroups.all.flatMap((group): readonly vscode.Tab[] => group.tabs),
        );
    });

    return {
        dispose: () => {
            providerRegistration.dispose();
            closeRegistration.dispose();
            tabRegistration.dispose();
            readOnlyJsonDocumentProvider.dispose();
        },
    };
}
