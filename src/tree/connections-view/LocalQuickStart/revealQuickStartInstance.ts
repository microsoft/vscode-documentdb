/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Shared "take me to the managed instance" navigation. */

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { revealConnectionsViewElement } from '../../api/revealConnectionsViewElement';
import { focusAndRevealInConnectionsView } from '../connectionsViewHelpers';
import { buildQuickStartInstanceTreeId, buildQuickStartTreeId } from './quickStartTreeIdentity';

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
    await focusAndRevealInConnectionsView(context, buildQuickStartTreeId(), {
        select: false,
        focus: false,
        expand: true,
    });
    await revealConnectionsViewElement(context, buildQuickStartInstanceTreeId(), {
        select: true,
        focus: true,
        // Expanding is the point: it connects and lists the databases.
        expand: true,
    });
}
