/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { ext } from '../../../extensionVariables';
import { type TreeElement } from '../../../tree/TreeElement';
import { openAtlasCredentialsWebview } from '../../../webviews/documentdb/atlasCredentials/atlasCredentialsController';
import { DISCOVERY_PROVIDER_ID } from '../config';
import { type AtlasDiscoveryService } from '../discovery/AtlasDiscoveryService';

export const ADD_ATLAS_CREDENTIAL_COMMAND_ID = 'vscode-documentdb.command.internal.atlas.addCredential';

/** Opens credential entry directly for the empty Atlas tree state. */
export async function addAtlasCredential(
    context: IActionContext,
    discoveryService: AtlasDiscoveryService,
    node: TreeElement,
): Promise<boolean> {
    context.telemetry.properties.credentialConfigActivated = 'true';
    context.telemetry.properties.discoveryProviderId = DISCOVERY_PROVIDER_ID;
    context.telemetry.properties.atlasCredentialAction = 'add';

    const stored = await openAtlasCredentialsWebview();

    context.telemetry.properties.credentialsManagementResult = stored ? 'Succeeded' : 'Canceled';
    if (stored) {
        ext.outputChannel.info(l10n.t('MongoDB Atlas credential added.'));
    }

    discoveryService.reset();
    if (node.id) {
        ext.discoveryBranchDataProvider.resetNodeErrorState(node.id);
    }
    ext.discoveryBranchDataProvider.refresh(node);

    return stored;
}
