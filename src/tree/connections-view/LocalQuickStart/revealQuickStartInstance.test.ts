/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { QuickStartService } from '../../../services/localQuickStart/QuickStartService';
import { InstanceState, type QuickStartStatus } from '../../../services/localQuickStart/quickStartTypes';
import { revealConnectionsViewElement } from '../../api/revealConnectionsViewElement';
import { focusAndRevealInConnectionsView } from '../connectionsViewHelpers';
import { LocalQuickStartItem } from './LocalQuickStartItem';
import { buildQuickStartInstanceTreeId, buildQuickStartTreeId } from './quickStartTreeIdentity';
import { revealQuickStartInstance } from './revealQuickStartInstance';

vi.mock('../connectionsViewHelpers', () => ({
    focusAndRevealInConnectionsView: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../api/revealConnectionsViewElement', () => ({
    revealConnectionsViewElement: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../../utils/icons', () => ({ getResourcesPath: () => '/resources' }));

const focusAndReveal = focusAndRevealInConnectionsView as MockedFunction<typeof focusAndRevealInConnectionsView>;
const reveal = revealConnectionsViewElement as MockedFunction<typeof revealConnectionsViewElement>;

/**
 * The success screen's "Open Connection" used to run `connectionsView.focus` and nothing else. When
 * that view is already the active one in the sidebar — which it is, because Quick Start is opened
 * FROM it — focusing changes nothing on screen, so the primary action looked broken.
 */
describe('revealQuickStartInstance', () => {
    const context = { telemetry: { properties: {}, measurements: {} } } as unknown as IActionContext;

    beforeEach(() => {
        focusAndReveal.mockClear();
        reveal.mockClear();
    });

    it('expands the instance row rather than only focusing the view', async () => {
        await revealQuickStartInstance(context);

        // Expanding IS the "open": it connects and lists the databases.
        expect(reveal).toHaveBeenCalledWith(
            context,
            buildQuickStartInstanceTreeId(),
            expect.objectContaining({ select: true, focus: true, expand: true }),
        );
    });

    it('expands the parent first, since the instance row is created lazily', async () => {
        await revealQuickStartInstance(context);

        expect(focusAndReveal).toHaveBeenCalledWith(
            context,
            buildQuickStartTreeId(),
            expect.objectContaining({ expand: true }),
        );
        // Parent before child, or the child is not in the tree yet to be found.
        expect(focusAndReveal.mock.invocationCallOrder[0]).toBeLessThan(reveal.mock.invocationCallOrder[0]);
    });
});

/**
 * The paths are written as constants but must match the ids {@link LocalQuickStartItem} actually
 * builds; nothing in the type system ties them together, and a silent mismatch degrades every
 * "take me to the instance" action into a no-op.
 */
describe('Quick Start tree paths match the ids the tree builds', () => {
    afterEach(() => vi.restoreAllMocks());

    it('matches the root node id', () => {
        expect(new LocalQuickStartItem('connectionsView').id).toBe(buildQuickStartTreeId());
    });

    it('matches the managed-instance row id', async () => {
        vi.spyOn(QuickStartService, 'ensureHydrated').mockResolvedValue(undefined);
        vi.spyOn(QuickStartService, 'isHydrated', 'get').mockReturnValue(true);
        vi.spyOn(QuickStartService, 'refreshLiveStateInBackground').mockReturnValue(undefined);
        vi.spyOn(QuickStartService, 'getStatus').mockReturnValue({
            state: InstanceState.Running,
            metadata: {
                containerId: 'c1',
                alias: 'vscode-documentdb-local',
                boundPort: 10260,
                clusterId: 'quickstart-vscode-documentdb-local',
                connectionString: 'mongodb://u:p@localhost:10260/',
                username: 'u',
            },
            missing: false,
            canResumeReadiness: false,
        } as QuickStartStatus);

        const children = await new LocalQuickStartItem('connectionsView').getChildren();

        expect(children).toHaveLength(1);
        expect(children[0].id).toBe(buildQuickStartInstanceTreeId());
    });
});
