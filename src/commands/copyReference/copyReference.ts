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

interface CopyReferenceOption {
    id: string;
    label: string;
    detail: string;
    alwaysShow: true;
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

function opt(label: string, value: string): CopyReferenceOption {
    return { id: value, label, detail: value, alwaysShow: true };
}

function getDatabaseOptions(dbName: string, host?: string): CopyReferenceOption[] {
    const options: CopyReferenceOption[] = [opt(l10n.t('Name'), dbName), opt(l10n.t('Shell Command'), `use ${dbName}`)];

    if (host) {
        options.push(opt(l10n.t('Qualified Name'), `${host}/${dbName}`));
    }

    return options;
}

function getCollectionOptions(dbName: string, collName: string): CopyReferenceOption[] {
    const quoted = needsQuoting(collName) || needsQuoting(dbName);
    const escapedCollName = escapeDoubleQuotes(collName);

    const options: CopyReferenceOption[] = [opt(l10n.t('Name'), collName)];

    if (!quoted) {
        options.push(opt(l10n.t('Namespace'), `${dbName}.${collName}`));
        options.push(opt(l10n.t('Shell Reference'), `db.${collName}`));
    }

    options.push(opt(l10n.t('Shell Command'), `db.getCollection("${escapedCollName}")`));

    return options;
}

function getIndexOptions(node: IndexItem): CopyReferenceOption[] {
    const indexName = node.indexInfo.name;
    const collName = node.collectionInfo.name;

    const options: CopyReferenceOption[] = [opt(l10n.t('Name'), indexName)];

    if (node.indexInfo.key) {
        const keyDef = formatIndexKey(node.indexInfo.key);
        const collRef = shellCollectionRef(collName);
        const escapedIndexName = escapeDoubleQuotes(indexName);

        options.push(opt(l10n.t('Key Definition'), keyDef));
        options.push(
            opt(l10n.t('Shell Command'), `${collRef}.getIndexes().find(i => i.name === "${escapedIndexName}")`),
        );
    }

    return options;
}

export async function copyNamespaceReference(
    context: IActionContext,
    databaseName: string,
    collectionName?: string,
    host?: string,
): Promise<void> {
    if (collectionName === undefined) {
        await copyReferenceOptions(
            context,
            l10n.t('Copy Reference: {0}', databaseName),
            getDatabaseOptions(databaseName, host),
        );
    } else {
        await copyReferenceOptions(
            context,
            l10n.t('Copy Reference: {0}.{1}', databaseName, collectionName),
            getCollectionOptions(databaseName, collectionName),
        );
    }
}

export async function copyReference(
    context: IActionContext,
    node: DatabaseItem | CollectionItem | IndexItem,
): Promise<void> {
    if (!node) {
        throw new Error(l10n.t('No node selected.'));
    }

    if (node instanceof IndexItem) {
        await copyReferenceOptions(context, l10n.t('Copy Reference: {0}', node.indexInfo.name), getIndexOptions(node));
    } else if (node instanceof CollectionItem) {
        await copyNamespaceReference(context, node.databaseInfo.name, node.collectionInfo.name);
    } else {
        await copyNamespaceReference(
            context,
            node.databaseInfo.name,
            undefined,
            getClusterHost(node.cluster.connectionString),
        );
    }
}

async function copyReferenceOptions(
    context: IActionContext,
    title: string,
    options: CopyReferenceOption[],
): Promise<void> {
    const picked = await context.ui.showQuickPick(options, {
        placeHolder: title,
        stepName: 'copyReference',
        suppressPersistence: true,
    });

    await vscode.env.clipboard.writeText(picked.id);
    void vscode.window.showInformationMessage(l10n.t('Copied to clipboard'));
}
