/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { EJSON } from 'bson';
import { type Document } from 'mongodb';
import { z } from 'zod';
import { type ConnectionBinding } from '../../../documentdb/ClustersClient';
import { recordSurveyActivity } from '../../../services/survey/SurveyService';
import { showConfirmationAsInSettings } from '../../../utils/dialogs/showConfirmation';
import { type BaseRouterContext } from '../../_integration/appRouter';
import { publicProcedureWithTelemetry, router, type WithTelemetry } from '../../_integration/trpc';
import { guardBoundViewOperation, runBoundViewOperation } from '../boundViewOperations';

export type RouterContext = BaseRouterContext & {
    clusterId: string;
    readonly binding: ConnectionBinding;
    /**
     * Identifies which tree view this cluster belongs to.
     *
     * Required for finding the correct tree node when the webview needs to interact
     * with the tree. The same Azure Resource ID can appear in multiple views
     * (Discovery, Azure Resources, Workspace), so we need to know which branch
     * data provider to query.
     *
     * @see Views enum for possible values (e.g., 'connectionsView', 'discoveryView')
     */
    viewId: string;
    databaseName: string;
    collectionName: string;
    documentId: string;

    viewPanelTitleSetter: (title: string) => void;
};

export const documentsViewRouter = router({
    getInfo: publicProcedureWithTelemetry.query(({ ctx }) => {
        const { binding: _binding, ...info } = ctx as WithTelemetry<RouterContext>;

        return l10n.t('Info from the webview: ') + JSON.stringify(info);
    }),
    getDocumentById: publicProcedureWithTelemetry
        // parameters
        .input(z.string())
        // procedure type
        .query(async ({ input, ctx }) => {
            const myCtx = ctx as RouterContext;
            const assertCurrent = guardBoundViewOperation(myCtx.binding, myCtx.signal);
            const documentContent = await runBoundViewOperation(
                myCtx.binding,
                assertCurrent,
                (client) => client.pointRead(myCtx.databaseName, myCtx.collectionName, input),
                { trigger: 'documentView' },
            );

            /**
             * Please note, the document is a 'Document' object, which is a BSON object.
             * Not all BSON objects can be serialized to JSON. Therefore, we're using
             * EJSON to serialize the document to an object that can be serialized to JSON.
             */
            const extendedJson = EJSON.stringify(documentContent, undefined, 4);

            //const documentContetntAsString = JSON.stringify(extendedJson, null, 4);

            return extendedJson;
        }),
    saveDocument: publicProcedureWithTelemetry
        // parameters
        .input(z.object({ documentContent: z.string() }))
        // procedure type
        .mutation(async ({ input, ctx }) => {
            const myCtx = ctx as RouterContext;
            const assertCurrent = guardBoundViewOperation(myCtx.binding, myCtx.signal);

            // eslint-disable-next-line
            const documentBson: Document = EJSON.parse(input.documentContent);
            const documentId: unknown = documentBson['_id'];

            const upsertResult = await runBoundViewOperation(
                myCtx.binding,
                assertCurrent,
                (client) =>
                    client.upsertDocument(
                        myCtx.databaseName,
                        myCtx.collectionName,
                        documentId ? EJSON.stringify(documentId) : '',
                        documentBson,
                    ),
                { trigger: 'documentView' },
            );

            // extract the _id field from the document
            const newDocumentId = EJSON.stringify(upsertResult.documentId);

            /**
             * Please note, the document is a 'Document' object, which is a BSON object.
             * Not all BSON objects can be serialized to JSON. Therefore, we're using
             * EJSON to serialize the document to an object that can be serialized to JSON.
             */
            const extendedJson = EJSON.serialize(upsertResult.document);
            const newDocumentStringified = JSON.stringify(extendedJson, null, 4);

            assertCurrent();
            myCtx.viewPanelTitleSetter(`${myCtx.databaseName}/${myCtx.collectionName}/${newDocumentId}`);

            showConfirmationAsInSettings(l10n.t('The document with the _id "{0}" has been saved.', newDocumentId));

            recordSurveyActivity('dataBrowsing');
            return { documentStringified: newDocumentStringified, documentId: newDocumentId };
        }),
});

// function extractIdFromJson(jsonString: string): string | null {
//     let extractedId: string | null = null;

//     // Use JSON.parse with a reviver function
//     JSON.parse(jsonString, (key, value) => {
//         if (key === '_id') {
//             // eslint-disable-next-line
//             extractedId = value; // Extract _id when found
//         }
//         // Return the value to keep parsing
//         // eslint-disable-next-line @typescript-eslint/no-unsafe-return
//         return value;
//     });

//     return extractedId;
// }
