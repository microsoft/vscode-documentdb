/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { describe, expect, it, vi } from 'vitest';
import { openCollectionWebview } from '../../webviews/documentdb/collectionView/collectionViewController';
import { openCollectionViewInternal } from './openCollectionView';

vi.mock('../../documentdb/ClusterSession', () => ({
    ClusterSession: { initNewSession: vi.fn().mockResolvedValue('collection-session'), closeSession: vi.fn() },
}));
vi.mock('../../utils/feedbackPermission', () => ({ isFeedbackPermitted: () => true }));
vi.mock('../../webviews/documentdb/collectionView/collectionViewController', () => ({
    openCollectionWebview: vi.fn(() => ({ onDisposed: vi.fn(), revealToForeground: vi.fn() })),
}));

describe('URL-driven collection opening', () => {
    it('records the real collection session and forwards publisher attribution', async (): Promise<void> => {
        const deepLink = { deepLinkCorrelationId: 'link-id', deepLinkSource: 'docs' };
        const context: IActionContext = {
            telemetry: { properties: { ...deepLink }, measurements: {} },
            errorHandling: { issueProperties: {} },
            valuesToMask: [],
            ui: {} as IActionContext['ui'],
        };
        await openCollectionViewInternal(context, {
            clusterId: 'stable-id',
            clusterDisplayName: 'Cluster',
            viewId: 'connectionsView',
            databaseName: 'db',
            collectionName: 'collection',
        });
        expect(context.telemetry.properties.collectionSessionId).toBe('collection-session');
        expect(openCollectionWebview).toHaveBeenCalledWith(
            expect.objectContaining({ clusterId: 'stable-id', sessionId: 'collection-session' }),
            deepLink,
        );
    });
});
