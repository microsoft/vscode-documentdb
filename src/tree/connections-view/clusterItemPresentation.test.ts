/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ClustersClient } from '../../documentdb/ClustersClient';
import { buildClusterTreeItem, type ClusterPresentationModel } from './clusterItemPresentation';
import type * as vscode from 'vscode';

describe('cluster presentation SRV flag', (): void => {
    afterEach((): void => {
        jest.restoreAllMocks();
    });

    it('uses the stable cluster ID before and after a folder move, preserving the original displayed host', (): void => {
        const cluster: ClusterPresentationModel = {
            clusterId: 'stable-id', name: 'Connection', connectionString: 'mongodb+srv://original.example.com/',
        };
        const getSummary = jest.spyOn(ClustersClient, 'getSrvResolution').mockImplementation((id) =>
            id === cluster.clusterId ? { path: 'fallback', nodeErrorCode: 'EBADRESP', resolvedAt: 1 } : undefined,
        );
        for (const id of ['stable-id', 'folder/stable-id']) {
            const item = buildClusterTreeItem({ id, contextValue: 'cluster', cluster });
            const tooltip = item.tooltip as vscode.MarkdownString;
            expect(tooltip.value).toContain('**DNS:**');
            expect(tooltip.value).toContain('original\\.example\\.com');
            expect(getSummary).toHaveBeenLastCalledWith('stable-id');
        }
    });
});
