/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { type JSONSchema } from 'vscode-json-languageservice';
import { z } from 'zod';
import { ClusterSession } from '../../../documentdb/ClusterSession';
import { getConfirmationAsInSettings } from '../../../utils/dialogs/getConfirmation';
import { getKnownFields, type FieldEntry } from '../../../utils/json/mongo/autocomplete/getKnownFields';
import { publicProcedure, router, trpcToTelemetry } from '../../api/extension-server/trpc';

import * as l10n from '@vscode/l10n';
import { showConfirmationAsInSettings } from '../../../utils/dialogs/showConfirmation';
// eslint-disable-next-line import/no-internal-modules
import { Views } from '../../../documentdb/Views';
import { ext } from '../../../extensionVariables';
import { type CollectionItem } from '../../../tree/documentdb/CollectionItem';
// eslint-disable-next-line import/no-internal-modules
import basicFindQuerySchema from '../../../utils/json/mongo/autocomplete/basicMongoFindFilterSchema.json';
import { generateMongoFindJsonSchema } from '../../../utils/json/mongo/autocomplete/generateMongoFindJsonSchema';
import { promptAfterActionEventually } from '../../../utils/survey';
import { UsageImpact } from '../../../utils/surveyTypes';
import { type BaseRouterContext } from '../../api/configuration/appRouter';

export type RouterContext = BaseRouterContext & {
    sessionId: string;
    clusterId: string;
    databaseName: string;
    collectionName: string;
};

// Helper function to find the collection node based on context
async function findCollectionNodeInTree(
    clusterId: string,
    databaseName: string,
    collectionName: string,
): Promise<CollectionItem | undefined> {
    let branchDataProvider: { findNodeById(id: string): Promise<unknown> } | undefined;
    const nodeId = `${clusterId}/${databaseName}/${collectionName}`;

    // TODO: this should not be necessary in general, let's rebuild this in the near future
    // There is a lack of consistency with using the parentId in the ID of the tree nodes
    // This is happening in the discovery and the plugins, it's easy to fix but needs
    // a bit of work. For now, we'll ignore it as we only have two branchdata providers
    // but it needs to be fixed when new providers are added.

    if (clusterId.startsWith(Views.ConnectionsView)) {
        branchDataProvider = ext.connectionsBranchDataProvider;
    } else {
        branchDataProvider = ext.discoveryBranchDataProvider;
    }
    // } else if (clusterId.startsWith(Views.DiscoveryView)) {
    //     branchDataProvider = ext.discoveryBranchDataProvider;
    // } else if (clusterId.startsWith(WorkspaceResourceType.MongoClusters)) {
    //     branchDataProvider = ext.mongoClustersWorkspaceBranchDataProvider;
    // } else if (clusterId.includes('/providers/Microsoft.DocumentDB/mongoClusters/')) {
    //     branchDataProvider = ext.mongoVCoreBranchDataProvider;
    // }

    if (branchDataProvider) {
        try {
            // Assuming findNodeById might return undefined or throw if not found
            const node = await branchDataProvider.findNodeById(nodeId);
            // The cast is still necessary if the providers don't share a precise enough common type
            return node as CollectionItem | undefined;
        } catch (error) {
            console.error(`Error finding node by ID '${nodeId}':`, error);
            return undefined;
        }
    } else {
        console.warn(`Could not determine branch data provider for clusterId: ${clusterId}`);
        return undefined;
    }
}

export const collectionsViewRouter = router({
    getInfo: publicProcedure.use(trpcToTelemetry).query(({ ctx }) => {
        const myCtx = ctx as RouterContext;

        return l10n.t('Info from the webview: ') + JSON.stringify(myCtx);
    }),
    runQuery: publicProcedure
        .use(trpcToTelemetry)
        // parameters
        .input(
            z.object({
                findQuery: z.string(),
                pageNumber: z.number(),
                pageSize: z.number(),
            }),
        )
        // procedure type
        .query(async ({ input, ctx }) => {
            const myCtx = ctx as RouterContext;

            // run query
            const session: ClusterSession = ClusterSession.getSession(myCtx.sessionId);
            const size = await session.runQueryWithCache(
                myCtx.databaseName,
                myCtx.collectionName,
                input.findQuery,
                input.pageNumber,
                input.pageSize,
            );

            void promptAfterActionEventually(UsageImpact.High);

            return { documentCount: size };
        }),
    getAutocompletionSchema: publicProcedure
        .use(trpcToTelemetry)
        // procedure type
        .query(({ ctx }) => {
            const myCtx = ctx as RouterContext;

            const session: ClusterSession = ClusterSession.getSession(myCtx.sessionId);

            const _currentJsonSchema = session.getCurrentSchema();
            const autoCompletionData: FieldEntry[] = getKnownFields(_currentJsonSchema);

            let querySchema: JSONSchema;

            if (autoCompletionData.length > 0) {
                querySchema = generateMongoFindJsonSchema(autoCompletionData);
            } else {
                // eslint-disable-next-line
                querySchema = basicFindQuerySchema;
            }

            return querySchema;
        }),
    getCurrentPageAsTable: publicProcedure
        .use(trpcToTelemetry)
        //parameters
        .input(z.array(z.string()))
        // procedure type
        .query(({ input, ctx }) => {
            const myCtx = ctx as RouterContext;

            const session: ClusterSession = ClusterSession.getSession(myCtx.sessionId);
            const tableData = session.getCurrentPageAsTable(input);

            return tableData;
        }),
    getCurrentPageAsTree: publicProcedure
        .use(trpcToTelemetry)
        // procedure type
        .query(({ ctx }) => {
            const myCtx = ctx as RouterContext;

            const session: ClusterSession = ClusterSession.getSession(myCtx.sessionId);
            const treeData = session.getCurrentPageAsTree();

            return treeData;
        }),
    getCurrentPageAsJson: publicProcedure
        .use(trpcToTelemetry)
        // procedure type
        .query(({ ctx }) => {
            const myCtx = ctx as RouterContext;

            const session: ClusterSession = ClusterSession.getSession(myCtx.sessionId);
            const jsonData = session.getCurrentPageAsJson();

            return jsonData;
        }),
    addDocument: publicProcedure
        .use(trpcToTelemetry)
        // procedure type
        .mutation(({ ctx }) => {
            const myCtx = ctx as RouterContext;

            vscode.commands.executeCommand('vscode-documentdb.command.internal.documentView.open', {
                clusterId: myCtx.clusterId,
                databaseName: myCtx.databaseName,
                collectionName: myCtx.collectionName,
                mode: 'add',
            });
        }),
    viewDocumentById: publicProcedure
        .use(trpcToTelemetry)
        // parameters
        .input(z.string())
        // procedure type
        .mutation(({ input, ctx }) => {
            const myCtx = ctx as RouterContext;

            vscode.commands.executeCommand('vscode-documentdb.command.internal.documentView.open', {
                clusterId: myCtx.clusterId,
                databaseName: myCtx.databaseName,
                collectionName: myCtx.collectionName,
                documentId: input,
                mode: 'view',
            });
        }),
    editDocumentById: publicProcedure
        .use(trpcToTelemetry)
        // parameters
        .input(z.string())
        // procedure type
        .mutation(({ input, ctx }) => {
            const myCtx = ctx as RouterContext;

            vscode.commands.executeCommand('vscode-documentdb.command.internal.documentView.open', {
                clusterId: myCtx.clusterId,
                databaseName: myCtx.databaseName,
                collectionName: myCtx.collectionName,
                documentId: input,
                mode: 'edit',
            });
        }),
    deleteDocumentsById: publicProcedure
        .use(trpcToTelemetry)
        // parameteres
        .input(z.array(z.string())) // stands for string[]
        // procedure type
        .mutation(async ({ input, ctx }) => {
            const myCtx = ctx as RouterContext;

            const confirmed = await getConfirmationAsInSettings(
                l10n.t('Are you sure?'),
                l10n.t('Delete {count} documents?', { count: input.length }) + '\n' + l10n.t('This cannot be undone.'),
                'delete',
            );

            if (!confirmed) {
                return false;
            }

            const session: ClusterSession = ClusterSession.getSession(myCtx.sessionId);
            const acknowledged = await session.deleteDocuments(myCtx.databaseName, myCtx.collectionName, input);

            if (acknowledged) {
                showConfirmationAsInSettings(
                    input.length > 1
                        ? l10n.t('{countMany} documents have been deleted.', { countMany: input.length })
                        : l10n.t('{countOne} document has been deleted.', { countOne: input.length }),
                );
            } else {
                void vscode.window.showErrorMessage(l10n.t('Failed to delete documents. Unknown error.'), {
                    modal: true,
                });
            }

            return acknowledged;
        }),
    exportDocuments: publicProcedure
        .use(trpcToTelemetry)
        // parameters
        .input(z.object({ query: z.string() }))
        //procedure type
        .query(async ({ input, ctx }) => {
            const myCtx = ctx as RouterContext;

            // TODO: remove the dependency on the tree node, in the end it was here only to show progress on the 'tree item'
            const collectionTreeNode = await findCollectionNodeInTree(
                myCtx.clusterId,
                myCtx.databaseName,
                myCtx.collectionName,
            );

            if (collectionTreeNode) {
                vscode.commands.executeCommand(
                    'vscode-documentdb.command.internal.exportDocuments',
                    collectionTreeNode,
                    {
                        queryText: input.query,
                        source: 'webview;collectionView',
                    },
                );
            } else {
                throw new Error('Could not find the specified collection in the tree.');
            }
        }),

    importDocuments: publicProcedure.use(trpcToTelemetry).query(async ({ ctx }) => {
        const myCtx = ctx as RouterContext;

        // TODO: remove the dependency on the tree node, in the end it was here only to show progress on the 'tree item'
        const collectionTreeNode = await findCollectionNodeInTree(
            myCtx.clusterId,
            myCtx.databaseName,
            myCtx.collectionName,
        );

        if (collectionTreeNode) {
            vscode.commands.executeCommand('vscode-documentdb.command.importDocuments', collectionTreeNode, null, {
                source: 'webview;collectionView',
            });
        } else {
            throw new Error('Could not find the specified collection in the tree.');
        }
    }),
});
