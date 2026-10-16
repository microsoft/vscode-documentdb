/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

export const READ_ONLY_JSON_SCHEME = 'documentdb-readonly-json';

class ReadOnlyJsonDocumentProvider implements vscode.TextDocumentContentProvider, vscode.Disposable {
    private readonly contents = new Map<string, string>();
    private sequence = 0;

    public provideTextDocumentContent(uri: vscode.Uri): string {
        return this.contents.get(uri.toString()) ?? '';
    }

    public async openDocument(title: string, content: string): Promise<void> {
        const fileName = title.toLowerCase().endsWith('.json') ? title : `${title}.json`;
        const uri = vscode.Uri.from({
            scheme: READ_ONLY_JSON_SCHEME,
            authority: 'view',
            path: `/${fileName.replace(/[\\/]/g, '-')}`,
            query: `id=${this.sequence++}`,
        });

        this.contents.set(uri.toString(), content);

        try {
            const document = await vscode.workspace.openTextDocument(uri);
            await vscode.window.showTextDocument(document);
        } catch (error) {
            this.contents.delete(uri.toString());
            throw error;
        }
    }

    public releaseDocument(uri: vscode.Uri): void {
        if (uri.scheme === READ_ONLY_JSON_SCHEME) {
            this.contents.delete(uri.toString());
        }
    }

    public dispose(): void {
        this.contents.clear();
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

    return {
        dispose: () => {
            providerRegistration.dispose();
            closeRegistration.dispose();
            readOnlyJsonDocumentProvider.dispose();
        },
    };
}
