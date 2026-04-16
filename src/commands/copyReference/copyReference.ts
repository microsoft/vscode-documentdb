/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { CollectionItem } from '../../tree/documentdb/CollectionItem';
import { type DatabaseItem } from '../../tree/documentdb/DatabaseItem';
import { IndexItem } from '../../tree/documentdb/IndexItem';

interface CopyReferenceOption extends vscode.QuickPickItem {
    value: string;
}

function formatIndexKey(key: Record<string, number | string>): string {
    const entries = Object.entries(key)
        .map(([field, order]) => `${field}: ${order}`)
        .join(', ');
    return `{ ${entries} }`;
}

/**
 * Returns true if a name requires quoting (cannot be used in dot-notation).
 * A name is safe for dot-notation only if it matches a valid JS identifier.
 */
function needsQuoting(name: string): boolean {
    return !/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name);
}

function escapeDoubleQuotes(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function shellCollectionRef(collName: string): string {
    return needsQuoting(collName) ? `db.getCollection("${escapeDoubleQuotes(collName)}")` : `db.${collName}`;
}

function getClusterHost(connectionString: string | undefined): string | undefined {
    if (!connectionString) {
        return undefined;
    }

    try {
        const url = new URL(connectionString);
        return url.host;
    } catch {
        return undefined;
    }
}

function getDatabaseOptions(node: DatabaseItem): CopyReferenceOption[] {
    const dbName = node.databaseInfo.name;
    const host = getClusterHost(node.cluster.connectionString);

    const options: CopyReferenceOption[] = [
        {
            label: l10n.t('Name'),
            detail: dbName,
            value: dbName,
        },
        {
            label: l10n.t('Shell Command'),
            detail: `use ${dbName}`,
            value: `use ${dbName}`,
        },
    ];

    if (host) {
        options.push({
            label: l10n.t('Qualified Name'),
            detail: `${host}/${dbName}`,
            value: `${host}/${dbName}`,
        });
    }

    return options;
}

function getCollectionOptions(node: CollectionItem): CopyReferenceOption[] {
    const dbName = node.databaseInfo.name;
    const collName = node.collectionInfo.name;
    const quoted = needsQuoting(collName) || needsQuoting(dbName);
    const escapedCollName = escapeDoubleQuotes(collName);

    const options: CopyReferenceOption[] = [
        {
            label: l10n.t('Name'),
            detail: collName,
            value: collName,
        },
    ];

    if (!quoted) {
        options.push({
            label: l10n.t('Namespace'),
            detail: `${dbName}.${collName}`,
            value: `${dbName}.${collName}`,
        });
    }

    if (!quoted) {
        options.push({
            label: l10n.t('Shell Reference'),
            detail: `db.${collName}`,
            value: `db.${collName}`,
        });
    }

    options.push({
        label: l10n.t('Shell Command'),
        detail: `db.getCollection("${escapedCollName}")`,
        value: `db.getCollection("${escapedCollName}")`,
    });

    return options;
}

function getIndexOptions(node: IndexItem): CopyReferenceOption[] {
    const indexName = node.indexInfo.name;
    const collName = node.collectionInfo.name;

    const options: CopyReferenceOption[] = [
        {
            label: l10n.t('Name'),
            detail: indexName,
            value: indexName,
        },
    ];

    if (node.indexInfo.key) {
        const keyDef = formatIndexKey(node.indexInfo.key);

        options.push({
            label: l10n.t('Key Definition'),
            detail: keyDef,
            value: keyDef,
        });

        const collRef = shellCollectionRef(collName);
        const escapedIndexName = escapeDoubleQuotes(indexName);

        options.push({
            label: l10n.t('Shell Command'),
            detail: `${collRef}.getIndexes().find(i => i.name === "${escapedIndexName}")`,
            value: `${collRef}.getIndexes().find(i => i.name === "${escapedIndexName}")`,
        });
    }

    return options;
}

function getOptionsForNode(node: DatabaseItem | CollectionItem | IndexItem): {
    title: string;
    options: CopyReferenceOption[];
} {
    if (node instanceof IndexItem) {
        return {
            title: l10n.t('Copy Reference: {0}', node.indexInfo.name),
            options: getIndexOptions(node),
        };
    }

    if (node instanceof CollectionItem) {
        return {
            title: l10n.t('Copy Reference: {0}.{1}', node.databaseInfo.name, node.collectionInfo.name),
            options: getCollectionOptions(node),
        };
    }

    return {
        title: l10n.t('Copy Reference: {0}', node.databaseInfo.name),
        options: getDatabaseOptions(node),
    };
}

export async function copyReference(
    _context: IActionContext,
    node: DatabaseItem | CollectionItem | IndexItem,
): Promise<void> {
    if (!node) {
        throw new Error(l10n.t('No node selected.'));
    }

    const { title, options } = getOptionsForNode(node);

    const picker = vscode.window.createQuickPick<CopyReferenceOption>();
    picker.title = title;
    picker.placeholder = l10n.t('Select a format to copy');
    picker.items = options;
    picker.matchOnDetail = true;

    // Workaround: setting sortByLabel to false via the options object is not available
    // in the createQuickPick API, but we can suppress persistence by not setting a value
    // for the quickpick's value property, which avoids reordering.

    const result = await new Promise<CopyReferenceOption | undefined>((resolve) => {
        picker.onDidAccept(() => {
            resolve(picker.selectedItems[0] as CopyReferenceOption | undefined);
            picker.dispose();
        });
        picker.onDidHide(() => {
            resolve(undefined);
            picker.dispose();
        });
        picker.show();
    });

    if (!result) {
        return;
    }

    await vscode.env.clipboard.writeText(result.value);
    void vscode.window.showInformationMessage(l10n.t('Copied to clipboard'));
}
