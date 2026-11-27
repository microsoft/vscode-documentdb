/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { type ConnectionBinding } from '../../documentdb/ClustersClient';

export interface CreateCollectionWizardContext extends IActionContext {
    /**
     * The stable cluster identifier for credential lookup.
     * This should be `cluster.clusterId` (NOT treeId).
     */
    credentialsId: string;
    readonly binding?: ConnectionBinding;
    databaseId: string;
    nodeId: string;

    newCollectionName?: string;
}
