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
        jest.spyOn(QuickStartService, 'refreshLiveState').mockResolvedValue(undefined);
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
