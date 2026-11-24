/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { EJSON } from 'bson';
import { type Document } from 'mongodb';
import * as vscode from 'vscode';
import { openCollectionViewInternal } from '../../commands/openCollectionView/openCollectionView';
import { openInteractiveShellWithInput } from '../../commands/openInteractiveShell/openInteractiveShell';
import { newPlaygroundWithContent, newUnboundPlayground } from '../../commands/playground/newPlayground';
import { modifierKey } from '../../constants';
import { ClustersClient } from '../../documentdb/ClustersClient';
import { SchemaStore } from '../../documentdb/SchemaStore';
import { Views } from '../../documentdb/Views';
import { settingsKeys } from '../../settingsKeys';
import { revealInConnectionsView } from '../../tree/connections-view/connectionsViewHelpers';
import { openUrl } from '../../utils/openUrl';
import { openClusterDashboardWebview } from '../../webviews/documentdb/clusterDashboard/clusterDashboardController';
import {
    resolveClusterNode,
    resolveNamespaceNode,
} from '../../webviews/documentdb/clusterDashboard/resolveNamespaceNode';
import { CopilotService } from '../copilotService';
import { SettingsService } from '../SettingsService';
import {
    CHAT_OPEN_COMMAND,
    MAX_RESULT_DOCUMENTS,
    pickOne,
    pipelineWrites,
    WishScopeError,
    type CollectionTab,
    type Spell,
    type WishPromptScope,
    type WishTool,
} from './wishEngine';
import { type WishCluster, type WishScope } from './wishScope';

/** A card drawn from the scoped cluster's own data. */
export interface LuckyCard {
    readonly kind: 'document' | 'trivia';
    readonly detail?: string;
    /** Opens the card's collection, filtered to the document when there is one. */
    readonly spell: Spell;
}

export interface ReadResult {
    readonly count: number;
    readonly text: string;
    readonly documents: readonly Document[];
}

/**
 * Everything the well does to the outside world. The service only talks to this interface, so
 * tests run it with fakes and the webview, shell, Copilot tools and MCP server share one engine.
 */
export interface WishPowers {
    isCopilotAvailable(): Promise<boolean>;
    askCopilot(prompt: string, signal?: AbortSignal): Promise<string>;
    isChatAvailable(): Promise<boolean>;
    /** Names and field paths for the prompt. Samples the collection when its schema is unknown. */
    describeScope(scope: WishScope): Promise<WishPromptScope>;
    /** Runs a find or aggregate spell read-only. */
    read(
        spell: Extract<Spell, { kind: 'find' | 'aggregate' }>,
        scope: WishScope,
        signal?: AbortSignal,
    ): Promise<ReadResult>;
    drawFromCluster(kind: LuckyCard['kind'], scope: WishScope, random: () => number): Promise<LuckyCard | undefined>;
    cast(spell: Spell, scope: WishScope, context: IActionContext): Promise<void>;
}

const SYSTEM_DATABASES = new Set(['admin', 'config', 'local']);
const MAX_DETAIL = 6000;
const READ_TIMEOUT_MS = 20_000;
/** Bounds the trivia scan on large clusters: it runs one count per collection. */
const TRIVIA_DATABASES = 10;
const TRIVIA_COLLECTIONS = 25;
const DASHBOARD_REFRESH_INTERVAL_MS = 5000;

const TABS: Record<CollectionTab, 'tab_result' | 'tab_indexes' | 'tab_queryInsights'> = {
    documents: 'tab_result',
    indexes: 'tab_indexes',
    insights: 'tab_queryInsights',
};

const TOOL_COMMANDS: Record<
    WishTool,
    { readonly commandId: string; readonly level: 'cluster' | 'database' | 'collection' }
> = {
    import: { commandId: 'vscode-documentdb.command.importDocuments', level: 'collection' },
    export: { commandId: 'vscode-documentdb.command.exportDocuments', level: 'collection' },
    diagnose: { commandId: 'vscode-documentdb.command.diagnoseConnection', level: 'cluster' },
    createCollection: { commandId: 'vscode-documentdb.command.createCollection', level: 'database' },
    createDatabase: { commandId: 'vscode-documentdb.command.createDatabase', level: 'cluster' },
};

function requireCluster(scope: WishScope): WishCluster {
    if (!scope.cluster) {
        throw new WishScopeError(l10n.t('This wish needs a database connection.'));
    }
    return scope.cluster;
}

function requireNamespace(
    scope: WishScope,
    collection: string | undefined,
): { cluster: WishCluster; databaseName: string; collectionName: string } {
    const cluster = requireCluster(scope);
    const collectionName = collection ?? scope.collectionName;
    if (!scope.databaseName) {
        throw new WishScopeError(l10n.t('This wish needs a database. Wish from a database, or name one.'));
    }
    if (!collectionName) {
        throw new WishScopeError(l10n.t('This wish needs a collection. Name one in your wish.'));
    }
    return { cluster, databaseName: scope.databaseName, collectionName };
}

function stringify(documents: readonly Document[]): string {
    const json = EJSON.stringify(documents, undefined, 2, { relaxed: true });
    return json.length > MAX_DETAIL ? `${json.slice(0, MAX_DETAIL - 1)}…` : json;
}

/** A filter that finds exactly this document again, in the syntax the collection view accepts. */
function filterForId(id: unknown): string | undefined {
    if (
        typeof id === 'object' &&
        id !== null &&
        '_bsontype' in id &&
        (id as { _bsontype: unknown })._bsontype === 'ObjectId'
    ) {
        return `{ "_id": ObjectId("${(id as unknown as { toHexString(): string }).toHexString()}") }`;
    }
    if (typeof id === 'string' || typeof id === 'number') {
        return JSON.stringify({ _id: id });
    }
    return undefined;
}

function quoteJs(name: string): string {
    return `'${name.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

export function createWishPowers(): WishPowers {
    const client = (cluster: WishCluster): Promise<ClustersClient> => ClustersClient.getClient(cluster.clusterId);

    async function databases(cluster: WishCluster, scope: WishScope): Promise<string[]> {
        if (scope.databaseName) {
            return [scope.databaseName];
        }
        return (await (await client(cluster)).listDatabases())
            .map((database) => database.name)
            .filter((name) => !SYSTEM_DATABASES.has(name));
    }

    async function collections(cluster: WishCluster, databaseName: string): Promise<string[]> {
        return (await (await client(cluster)).listCollections(databaseName))
            .filter((collection) => !collection.name.startsWith('system.') && collection.type !== 'view')
            .map((collection) => collection.name);
    }

    async function fields(cluster: WishCluster, databaseName: string, collectionName: string): Promise<string[]> {
        const store = SchemaStore.getInstance();
        let known = store.getKnownFields(cluster.clusterId, databaseName, collectionName);
        if (known.length === 0) {
            const sample = await (await client(cluster)).getSampleDocuments(databaseName, collectionName, 10);
            store.addDocuments(cluster.clusterId, databaseName, collectionName, sample as never);
            known = store.getKnownFields(cluster.clusterId, databaseName, collectionName);
        }
        return known.map((field) => `${field.path}: ${field.bsonType ?? field.type}`);
    }

    async function fishDocument(
        cluster: WishCluster,
        scope: WishScope,
        random: () => number,
    ): Promise<LuckyCard | undefined> {
        const names = await databases(cluster, scope);
        for (let attempt = 0; attempt < 4 && names.length > 0; attempt++) {
            const databaseName = pickOne(names, random);
            const collectionNames = scope.collectionName
                ? [scope.collectionName]
                : await collections(cluster, databaseName);
            if (collectionNames.length === 0) {
                continue;
            }
            const collectionName = pickOne(collectionNames, random);
            const documentClient = await client(cluster);
            const count = await documentClient.estimateDocumentCount(databaseName, collectionName);
            if (count === 0) {
                continue;
            }
            const skip = Math.floor(random() * Math.min(count, 500));
            const [document] = await documentClient.runFindQuery(databaseName, collectionName, { skip, limit: 1 });
            if (!document) {
                continue;
            }
            const json = EJSON.stringify(document, undefined, 2, { relaxed: true });
            return {
                kind: 'document',
                detail: json.length > MAX_DETAIL ? `${json.slice(0, MAX_DETAIL - 1)}…` : json,
                spell: {
                    kind: 'collectionView',
                    collection: collectionName,
                    filter: filterForId(document._id),
                    title: l10n.t('Fished out of {0}', collectionName),
                    message: l10n.t(
                        'One of about {0} documents in {1}.{2}.',
                        count.toLocaleString(),
                        databaseName,
                        collectionName,
                    ),
                },
            };
        }
        return undefined;
    }

    async function trivia(cluster: WishCluster, scope: WishScope): Promise<LuckyCard | undefined> {
        const names = await databases(cluster, scope);
        const triviaClient = await client(cluster);
        let collectionCount = 0;
        let biggest: { databaseName: string; collectionName: string; count: number } | undefined;
        for (const databaseName of names.slice(0, TRIVIA_DATABASES)) {
            const collectionNames = await collections(cluster, databaseName);
            collectionCount += collectionNames.length;
            for (const collectionName of collectionNames.slice(0, TRIVIA_COLLECTIONS)) {
                const count = await triviaClient.estimateDocumentCount(databaseName, collectionName);
                if (!biggest || count > biggest.count) {
                    biggest = { databaseName, collectionName, count };
                }
            }
        }
        if (!biggest) {
            return undefined;
        }

        const message = scope.databaseName
            ? l10n.t(
                  '{0} holds {1} collections. The biggest is {2}, with about {3} documents.',
                  biggest.databaseName,
                  collectionCount,
                  biggest.collectionName,
                  biggest.count.toLocaleString(),
              )
            : l10n.t(
                  'This cluster holds {0} databases and {1} collections. The biggest is {2}.{3}, with about {4} documents.',
                  names.length,
                  collectionCount,
                  biggest.databaseName,
                  biggest.collectionName,
                  biggest.count.toLocaleString(),
              );
        return {
            kind: 'trivia',
            spell: {
                kind: 'collectionView',
                collection: biggest.collectionName,
                title: l10n.t('Cluster trivia'),
                message,
            },
        };
    }

    async function openPlayground(context: IActionContext, scope: WishScope, script: string): Promise<void> {
        if (scope.cluster && scope.databaseName) {
            await newPlaygroundWithContent(context, {
                clusterId: scope.cluster.clusterId,
                clusterDisplayName: scope.cluster.clusterDisplayName,
                databaseName: scope.databaseName,
                viewId: scope.cluster.viewId,
                content: script,
            });
            return;
        }
        await newUnboundPlayground(
            [
                '// Query Playground from the Wishing Well',
                `// Use ${modifierKey}+Enter to run the current block; you will be asked which database to use.`,
                '',
                script,
                '',
            ].join('\n'),
        );
    }

    /** The tree node an existing tree command needs, expanding the Connections view when needed. */
    async function treeNode(
        context: IActionContext,
        scope: WishScope,
        tool: WishTool,
        collection: string | undefined,
    ): Promise<unknown> {
        const { level } = TOOL_COMMANDS[tool];
        const cluster = requireCluster(scope);
        const collectionName = collection ?? scope.collectionName;
        if (level !== 'cluster' && !scope.databaseName) {
            throw new WishScopeError(l10n.t('This wish needs a database.'));
        }
        if (level === 'collection' && !collectionName) {
            throw new WishScopeError(l10n.t('This wish needs a collection. Name one in your wish.'));
        }

        const find = (): Promise<unknown> =>
            level === 'cluster'
                ? resolveClusterNode(cluster.viewId, cluster.clusterId)
                : resolveNamespaceNode(
                      cluster.viewId,
                      cluster.clusterId,
                      scope.databaseName ?? '',
                      level === 'collection' ? collectionName : undefined,
                  );

        let node = await find();
        if (!node && cluster.viewId === (Views.ConnectionsView as string)) {
            await revealInConnectionsView(
                context,
                cluster.clusterId,
                false,
                level === 'cluster' ? undefined : scope.databaseName,
                level === 'collection' ? collectionName : undefined,
            );
            node = await find();
        }
        if (!node) {
            throw new WishScopeError(
                l10n.t('Expand {0} in the DocumentDB side bar, then grant the wish again.', cluster.clusterDisplayName),
            );
        }
        return node;
    }

    return {
        isCopilotAvailable: () => CopilotService.isAvailable(),

        async askCopilot(prompt: string, signal?: AbortSignal): Promise<string> {
            const response = await CopilotService.sendMessage([vscode.LanguageModelChatMessage.User(prompt)], {
                signal,
                featureSource: 'wishingWell',
            });
            return response.text;
        },

        async isChatAvailable(): Promise<boolean> {
            return (await vscode.commands.getCommands(true)).includes(CHAT_OPEN_COMMAND);
        },

        async describeScope(scope: WishScope): Promise<WishPromptScope> {
            const cluster = scope.cluster;
            if (!cluster) {
                return {};
            }
            const described: {
                connectionName: string;
                databaseName?: string;
                collectionName?: string;
                databaseNames?: string[];
                collectionNames?: string[];
                fields?: string[];
            } = {
                connectionName: cluster.clusterDisplayName,
                databaseName: scope.databaseName,
                collectionName: scope.collectionName,
            };
            if (scope.databaseName) {
                described.collectionNames = await collections(cluster, scope.databaseName).catch(() => []);
                const fieldsOf =
                    scope.collectionName ??
                    (described.collectionNames.length === 1 ? described.collectionNames[0] : undefined);
                if (fieldsOf) {
                    described.collectionName = fieldsOf;
                    described.fields = await fields(cluster, scope.databaseName, fieldsOf).catch(() => []);
                }
            } else {
                described.databaseNames = await databases(cluster, scope).catch(() => []);
            }
            return described;
        },

        async read(spell, scope, signal): Promise<ReadResult> {
            const { cluster, databaseName, collectionName } = requireNamespace(scope, spell.collection);
            const readClient = await client(cluster);

            let documents: Document[];
            if (spell.kind === 'find') {
                documents = await readClient.runFindQuery(databaseName, collectionName, {
                    filter: spell.filter,
                    project: spell.project,
                    sort: spell.sort,
                    skip: 0,
                    limit: Math.min(spell.limit ?? 20, MAX_RESULT_DOCUMENTS),
                });
            } else {
                let pipeline: unknown;
                try {
                    pipeline = EJSON.parse(spell.pipeline, { relaxed: false });
                } catch (error) {
                    throw new Error(
                        l10n.t(
                            'The pipeline is not valid JSON: {0}',
                            error instanceof Error ? error.message : String(error),
                        ),
                    );
                }
                if (!Array.isArray(pipeline)) {
                    throw new Error(l10n.t('A pipeline must be a list of stages.'));
                }
                if (pipelineWrites(pipeline)) {
                    throw new Error(l10n.t('The well only reads. $out and $merge write, so it will not run them.'));
                }
                documents = await readClient
                    .getMongoClient()
                    .db(databaseName)
                    .collection(collectionName)
                    .aggregate([...(pipeline as Document[]), { $limit: MAX_RESULT_DOCUMENTS }], {
                        maxTimeMS: READ_TIMEOUT_MS,
                        signal,
                    })
                    .toArray();
            }
            return { count: documents.length, text: stringify(documents), documents };
        },

        async drawFromCluster(kind, scope, random): Promise<LuckyCard | undefined> {
            if (!scope.cluster) {
                return undefined;
            }
            return kind === 'document' ? fishDocument(scope.cluster, scope, random) : trivia(scope.cluster, scope);
        },

        async cast(spell: Spell, scope: WishScope, context: IActionContext): Promise<void> {
            switch (spell.kind) {
                case 'answer':
                    return;
                case 'find':
                case 'collectionView': {
                    const { cluster, databaseName, collectionName } = requireNamespace(scope, spell.collection);
                    await openCollectionViewInternal(context, {
                        clusterId: cluster.clusterId,
                        clusterDisplayName: cluster.clusterDisplayName,
                        viewId: cluster.viewId,
                        databaseName,
                        collectionName,
                        initialQuery:
                            spell.filter || spell.project || spell.sort
                                ? { filter: spell.filter, project: spell.project, sort: spell.sort }
                                : undefined,
                        initialTab: spell.kind === 'collectionView' && spell.tab ? TABS[spell.tab] : undefined,
                    });
                    return;
                }
                case 'aggregate': {
                    const collection = spell.collection ?? scope.collectionName ?? 'collectionName';
                    await openPlayground(
                        context,
                        scope,
                        `db.getCollection(${quoteJs(collection)}).aggregate(${spell.pipeline})`,
                    );
                    return;
                }
                case 'shell': {
                    const cluster = requireCluster(scope);
                    await openInteractiveShellWithInput(context, {
                        clusterId: cluster.clusterId,
                        clusterDisplayName: cluster.clusterDisplayName,
                        databaseName: scope.databaseName ?? 'test',
                        initialInput: spell.command,
                    });
                    return;
                }
                case 'playground':
                    await openPlayground(context, scope, spell.script);
                    return;
                case 'dashboard': {
                    const cluster = requireCluster(scope);
                    openClusterDashboardWebview({
                        clusterId: cluster.clusterId,
                        clusterDisplayName: cluster.clusterDisplayName,
                        viewId: cluster.viewId,
                        refreshIntervalMs: DASHBOARD_REFRESH_INTERVAL_MS,
                        selectedDatabaseName: scope.databaseName,
                        showDashboardOnConnect:
                            SettingsService.getSetting<boolean>(settingsKeys.showDashboardOnConnect) ?? true,
                    });
                    return;
                }
                case 'newDocument': {
                    const { cluster, databaseName, collectionName } = requireNamespace(scope, spell.collection);
                    await vscode.commands.executeCommand('vscode-documentdb.command.internal.documentView.open', {
                        clusterId: cluster.clusterId,
                        viewId: cluster.viewId,
                        databaseName,
                        collectionName,
                        mode: 'add',
                    });
                    return;
                }
                case 'tool': {
                    const node = await treeNode(context, scope, spell.tool, spell.collection);
                    await vscode.commands.executeCommand(TOOL_COMMANDS[spell.tool].commandId, node);
                    return;
                }
                case 'command':
                    await vscode.commands.executeCommand(spell.commandId, ...(spell.argument ? [spell.argument] : []));
                    return;
                case 'agent':
                    await vscode.commands.executeCommand(CHAT_OPEN_COMMAND, { query: spell.prompt, mode: 'agent' });
                    return;
                case 'link':
                    if (!(await openUrl(spell.url))) {
                        void vscode.window.showErrorMessage(l10n.t("We couldn't open this link."));
                    }
                    return;
            }
        },
    };
}
