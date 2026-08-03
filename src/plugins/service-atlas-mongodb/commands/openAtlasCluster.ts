/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { openUrl } from '../../../utils/openUrl';
import { DISCOVERY_PROVIDER_ID } from '../config';
import { type AtlasClusterItem } from '../discovery-tree/AtlasClusterItem';

export const OPEN_ATLAS_CLUSTER_COMMAND_ID = 'vscode-documentdb.command.discoveryView.atlas.openCluster';

export async function openAtlasCluster(context: IActionContext, node: AtlasClusterItem): Promise<void> {
    context.telemetry.properties.discoveryProviderId = DISCOVERY_PROVIDER_ID;
    context.telemetry.properties.resourceType = 'atlas-mongodb-cluster';

    await openUrl(node.getAtlasConsoleUrl());
}
