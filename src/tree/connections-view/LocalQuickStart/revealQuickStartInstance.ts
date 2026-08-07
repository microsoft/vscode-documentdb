/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Tree paths of the Quick Start nodes, and the shared "take me to the instance" navigation.
 *
 * Kept in one place because two callers need it — the success screen's "Open Connection" and the
 * duplicate-endpoint prompt in the New Local Connection wizard — and because the paths must track
 * the ids {@link LocalQuickStartItem} builds. `LocalQuickStartItem.test.ts` asserts they agree.
 */

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { Views } from '../../../documentdb/Views';
import { revealConnectionsViewElement } from '../../api/revealConnectionsViewElement';
import { focusAndRevealInConnectionsView } from '../connectionsViewHelpers';

/** Tree path of the "DocumentDB Local - Quick Start" root node. */
export const QUICK_START_TREE_PATH = `${Views.ConnectionsView}/localQuickStart`;

/** Tree path of the managed-instance row beneath it (single instance, POC). */
export const QUICK_START_INSTANCE_TREE_PATH = `${QUICK_START_TREE_PATH}/instance`;

/**
 * Focus the Connections view and open the managed instance in it.
 *
 * Running `connectionsView.focus` alone is not enough: when that view is already the active one in
 * the sidebar — the normal case, since Quick Start is opened FROM it — focusing it changes nothing
 * the user can see, so the action reads as broken. Reveal the instance row itself, select it, and
 * expand it so its databases load, which is what "open" means for a cluster row here.
 *
 * The reveal is progressive (mirroring `revealInConnectionsView`): the instance row is a lazily
 * created child, so its parent has to be expanded before the child can be found. Both steps swallow
 * their own errors into telemetry, so a missing node degrades to "the view is focused" rather than
 * throwing at the caller.
 */
export async function revealQuickStartInstance(context: IActionContext): Promise<void> {
    await focusAndRevealInConnectionsView(context, QUICK_START_TREE_PATH, {
        select: false,
        focus: false,
        expand: true,
    });
    await revealConnectionsViewElement(context, QUICK_START_INSTANCE_TREE_PATH, {
        select: true,
        focus: true,
        // Expanding is the point: it connects and lists the databases.
        expand: true,
    });
}
