/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, type IActionContext } from '@microsoft/vscode-azext-utils';
import { type WorkspaceResource, type WorkspaceResourceBranchDataProvider } from '@microsoft/vscode-azureresources-api';
import { Views } from '../../documentdb/Views';
import { ext } from '../../extensionVariables';
import { BaseExtendedTreeDataProvider } from '../BaseExtendedTreeDataProvider';
import { type TreeElement } from '../TreeElement';
import { isTreeElementWithContextValue } from '../TreeElementWithContextValue';
import { DocumentDbAccountsItem } from './DocumentDbAccountsItem';

export class ClustersWorkspaceBranchDataProvider
    extends BaseExtendedTreeDataProvider<TreeElement>
    implements WorkspaceResourceBranchDataProvider<TreeElement>
{
    getResourceItem(_element: WorkspaceResource): TreeElement | Thenable<TreeElement> {
        return callWithTelemetryAndErrorHandling('getResourceItem', async (context: IActionContext) => {
            context.telemetry.properties.view = Views.AzureWorkspaceView;

            return new DocumentDbAccountsItem();
        }) as unknown as TreeElement;
    }

    async getChildren(element: TreeElement): Promise<TreeElement[] | null | undefined> {
        return await callWithTelemetryAndErrorHandling('getChildren', async (context: IActionContext) => {
            context.telemetry.properties.view = Views.AzureWorkspaceView;

            const children = element.getChildren ? await element.getChildren() : [];

            if (!children) {
                return [];
            }

            // Wrap each child with state handling for refresh support
            const wrappedChildren = children.map((child) => {
                if (isTreeElementWithContextValue(child)) {
                    this.appendContextValues(child, Views.AzureWorkspaceView);
                }

                const wrappedChild = ext.state.wrapItemInStateHandling(child, () => this.refresh(child)) as TreeElement;

                // Register parent-child relationship in the cache
                // Note: The check for `typeof wrappedChild.id === 'string'` is necessary because `wrapItemInStateHandling`
                // can process temporary nodes that don't have an `id` property, which would otherwise cause a runtime error.
                if (element.id && typeof wrappedChild.id === 'string') {
                    this.registerRelationshipInCache(element, wrappedChild);
                }

                return wrappedChild;
            }) as TreeElement[];

            return wrappedChildren;
        });
    }

    /**
     * Finds a cluster node by its stable cluster identifier.
     *
     * Note: Azure Workspace View currently doesn't surface cluster items directly.
     * This method is provided for interface consistency but will typically return undefined.
     *
     * @param clusterId The stable cluster identifier
     * @returns A Promise that resolves to undefined (workspace view doesn't have direct cluster nodes)
     */
    async findClusterNodeByClusterId(_clusterId: string): Promise<TreeElement | undefined> {
        // Azure Workspace View doesn't surface cluster items directly
        // If this changes in the future, implement similar to Azure Resources View
        return undefined;
    }
}
