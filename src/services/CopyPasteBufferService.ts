import * as vscode from 'vscode';

export type CopiedIndexScope =
    | { readonly kind: 'index'; readonly indexName: string }
    | { readonly kind: 'allIndexes' };

export interface CopiedIndexSelection {
    readonly source: {
        readonly clusterId: string;
        readonly databaseName: string;
        readonly collectionName: string;
    };
    readonly sourceConnectionName: string;
    readonly scope: CopiedIndexScope;
}

class CopyPasteBufferServiceImpl {
    private copiedIndexes: CopiedIndexSelection | undefined;

    public getIndexes(): CopiedIndexSelection | undefined {
        return this.copiedIndexes ? this.cloneSelection(this.copiedIndexes) : undefined;
    }

    public async setIndexes(selection: CopiedIndexSelection): Promise<void> {
        this.copiedIndexes = this.cloneSelection(selection);
        await vscode.commands.executeCommand('setContext', 'documentdb.hasCopiedIndexes', true);
    }

    public async clearIndexes(): Promise<void> {
        this.copiedIndexes = undefined;
        await vscode.commands.executeCommand('setContext', 'documentdb.hasCopiedIndexes', false);
    }

    public async resetForTests(): Promise<void> {
        await this.clearIndexes();
    }

    private cloneSelection(selection: CopiedIndexSelection): CopiedIndexSelection {
        return {
            source: { ...selection.source },
            sourceConnectionName: selection.sourceConnectionName,
            scope: { ...selection.scope },
        };
    }
}

export const CopyPasteBufferService = new CopyPasteBufferServiceImpl();