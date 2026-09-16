/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';

export interface CreateDatabaseWizardContext extends IActionContext {
    /**
     * The stable cluster identifier for credential lookup.
     * This should be `cluster.clusterId` (NOT treeId).
     */
    credentialsId: string;
    clusterName: string;
    nodeId: string;

    /**
     * When true, the wizard prompts for an initial collection name.
     * Required where dropping the last collection also removes the database, as with the MongoDB API
     * wire protocol as implemented by Atlas. Azure DocumentDB vCore does not need this.
     */
    requiresInitialCollection?: boolean;

    databaseName?: string;
    collectionName?: string;
}
