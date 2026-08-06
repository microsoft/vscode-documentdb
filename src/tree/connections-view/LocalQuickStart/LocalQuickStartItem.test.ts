/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { QuickStartService } from '../../../services/localQuickStart/QuickStartService';
import { InstanceState, type QuickStartStatus } from '../../../services/localQuickStart/quickStartTypes';
import { LocalQuickStartItem } from './LocalQuickStartItem';

// The root node's iconPath initializer calls getResourcesPath() (needs ext.context); stub it so the
// item constructs without a real extension host.
jest.mock('../../../utils/icons', () => ({ getResourcesPath: () => '/resources' }));

// UX review #1: the credential-unavailable state must render an ACTIONABLE, Delete-only instance row
// (not the passive rocket + command-less warning dead end). This locks in the tree contract: the row
// carries treeItem_quickStartInstance + state_credentialsMissing (so the Delete when-clause matches)
// and a single click launches the Delete command (which shows the confirmation dialog) so the
// recovery is discoverable (GPT-5.6 review follow-up).
describe('LocalQuickStartItem — CredentialsMissing row (UX review #1)', () => {
    afterEach(() => jest.restoreAllMocks());

    it('renders a single actionable, Delete-only instance row', async () => {
        jest.spyOn(QuickStartService, 'refreshLiveStateInBackground').mockReturnValue(undefined);
        jest.spyOn(QuickStartService, 'getStatus').mockReturnValue({
            state: InstanceState.CredentialsMissing,
            metadata: undefined,
            missing: false,
            canResumeReadiness: false,
        } as QuickStartStatus);

        const item = new LocalQuickStartItem('connectionsView/root');
        const children = await item.getChildren();

        expect(children).toHaveLength(1);
        const treeItem = await children[0].getTreeItem();
        const contextValue = String(treeItem.contextValue ?? '');
        // Both tokens present so the Delete command's when-clause matches (package.json).
        expect(contextValue).toContain('treeItem_quickStartInstance');
        expect(contextValue).toContain('state_credentialsMissing');
        // A single click launches Delete (with its confirmation) — discoverable one-click recovery.
        expect(treeItem.command?.command).toBe('vscode-documentdb.command.localQuickStart.delete');
    });
});

// Review §9.2 Q4 / N3 (I2-4): a genuine failure renders ACTIONABLE recovery nodes, not error text.
// `Missing` / `CredentialsMissing` are service states with their own rows and are deliberately NOT
// treated this way (I2-Q5) — the test above pins that contract.
describe('LocalQuickStartItem — error recovery nodes (I2-4)', () => {
    afterEach(() => jest.restoreAllMocks());

    async function childIds(status: Partial<QuickStartStatus>): Promise<string[]> {
        jest.spyOn(QuickStartService, 'refreshLiveStateInBackground').mockReturnValue(undefined);
        jest.spyOn(QuickStartService, 'getStatus').mockReturnValue({
            state: InstanceState.Error,
            errorMessage: 'boom',
            missing: false,
            canResumeReadiness: false,
            ...status,
        } as QuickStartStatus);

        const item = new LocalQuickStartItem('connectionsView/root');
        const children = await item.getChildren();
        // The provider caches the failed children only when the element reports a retry node.
        expect(item.hasRetryNode(children)).toBe(true);
        return children.map((child) => String(child.id));
    }

    it('offers retry, the setup log and Delete Container when a container exists', async () => {
        const ids = await childIds({
            metadata: {
                containerId: 'c1',
                alias: 'vscode-documentdb-local',
                boundPort: 10260,
                clusterId: 'quickstart-vscode-documentdb-local',
                connectionString: 'mongodb://u:p@localhost:10260/',
                username: 'u',
            },
        } as Partial<QuickStartStatus>);

        expect(ids).toEqual([
            'connectionsView/root/localQuickStart/instance',
            'connectionsView/root/localQuickStart/retry',
            'connectionsView/root/localQuickStart/viewLogs',
            'connectionsView/root/localQuickStart/delete',
        ]);
    });

    it('offers retry and the setup log only when nothing was created, and never a message-only row (N3)', async () => {
        const ids = await childIds({ metadata: undefined });

        expect(ids).toEqual([
            'connectionsView/root/localQuickStart/start',
            'connectionsView/root/localQuickStart/retry',
            'connectionsView/root/localQuickStart/viewLogs',
        ]);
        expect(ids).not.toContain('connectionsView/root/localQuickStart/error');
    });
});
