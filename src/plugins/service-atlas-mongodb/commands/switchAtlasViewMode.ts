/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { Views } from '../../../documentdb/Views';
import { ext } from '../../../extensionVariables';
import { LiveConfigService } from '../../../services/LiveConfigService';
import { DISCOVERY_PROVIDER_ID, type AtlasViewMode } from '../config';

async function setAtlasViewMode(context: IActionContext, mode: AtlasViewMode): Promise<void> {
    context.telemetry.properties.discoveryProviderId = DISCOVERY_PROVIDER_ID;
    context.telemetry.properties.atlasViewMode = mode;

    await LiveConfigService.setAtlasViewMode(mode);

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
