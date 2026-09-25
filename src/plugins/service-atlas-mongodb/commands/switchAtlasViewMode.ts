/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { Views } from '../../../documentdb/Views';
import { ext } from '../../../extensionVariables';
import {
    DEFAULT_ATLAS_VIEW_MODE,
    DISCOVERY_PROVIDER_ID,
    DISCOVERY_VIEW_MODE_STATE_KEY,
    type AtlasViewMode,
} from '../config';

/** Reads the persisted MongoDB Atlas discovery view mode. */
export function getAtlasViewMode(): AtlasViewMode {
    return ext.context.globalState.get<AtlasViewMode>(DISCOVERY_VIEW_MODE_STATE_KEY, DEFAULT_ATLAS_VIEW_MODE);
}

/**
 * Persists the global MongoDB Atlas discovery {@link AtlasViewMode} and refreshes the tree.
 *
 * The mode is global (it applies to the whole MongoDB Atlas discovery provider) and stored
 * directly in globalState, matching the Kubernetes view-mode toggle, so the choice always
 * persists without exposing a user-facing setting.
 */
async function setAtlasViewMode(context: IActionContext, mode: AtlasViewMode): Promise<void> {
    context.telemetry.properties.discoveryProviderId = DISCOVERY_PROVIDER_ID;
    context.telemetry.properties.atlasViewMode = mode;

    await ext.context.globalState.update(DISCOVERY_VIEW_MODE_STATE_KEY, mode);

    const rootId = `${Views.DiscoveryView}/${DISCOVERY_PROVIDER_ID}`;
    ext.discoveryBranchDataProvider.resetNodeErrorState(rootId);
    ext.discoveryBranchDataProvider.refresh();
}

/** Switches MongoDB Atlas discovery to the hierarchical organization tree. */
export async function switchToAtlasTreeView(context: IActionContext): Promise<void> {
    await setAtlasViewMode(context, 'tree');
}

/** Switches MongoDB Atlas discovery to the flat, deduplicated cluster list. */
export async function switchToAtlasFlatListView(context: IActionContext): Promise<void> {
    await setAtlasViewMode(context, 'list');
}
