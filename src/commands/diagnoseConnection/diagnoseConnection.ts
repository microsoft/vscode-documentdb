/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { UserCancelledError, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { inferViewIdFromTreeId } from '../../documentdb/Views';
import { ext } from '../../extensionVariables';
import { type TreeElement } from '../../tree/TreeElement';
import { isTreeElementWithContextValue } from '../../tree/TreeElementWithContextValue';
import {
    CLUSTER_ITEM_CONTEXT_VALUE,
    ClusterItemBase,
    type EphemeralClusterCredentials,
} from '../../tree/documentdb/ClusterItemBase';
import { type DiagnosticCredentialRead } from '../../tree/documentdb/diagnosticCredentialRead';
import { type TroubleshooterEntryPoint, type TroubleshootTarget } from '../../connectionDiagnostics/types';
import { trackJourneyCorrelationId } from '../../utils/commandTelemetry';
import { pickTreeNode } from '../../utils/pickItem/pickTreeNode';
import { openConnectivityTroubleshooter } from '../../webviews/documentdb/connectionDiagnostics/connectionDiagnosticsController';

export async function troubleshootConnection(
    context: IActionContext,
    node?: ClusterItemBase,
    _nodes?: ClusterItemBase[],
    entryPointHint?: unknown,
): Promise<void> {
    context.telemetry.maskEntireErrorMessage = true;
    let entryPoint: TroubleshooterEntryPoint = node ? 'contextMenu' : 'commandPalette';
    if (node && entryPointHint === 'errorNode') {
        entryPoint = 'errorNode';
    }
    const sourceView = node ? (node.cluster.viewId ?? inferViewIdFromTreeId(node.cluster.treeId)) : 'commandPalette';
    context.telemetry.properties.entryPoint = entryPoint;
    context.telemetry.properties.sourceView = sourceView;

    if (!node) {
        const selected = await pickTreeNode({
            leafContextValue: CLUSTER_ITEM_CONTEXT_VALUE,
            telemetrySource: 'troubleshootConnection',
            placeHolder: vscode.l10n.t('Select a connection to diagnose'),
            provider: {
                async getChildren(element?: TreeElement): Promise<TreeElement[]> {
                    const children = await ext.connectionsBranchDataProvider.getChildren(element);
                    // Only browse stored-connection containers. Quick Start instances are not
                    // selectable clusters here, and drilling into them would attempt to connect.
                    return (children ?? []).filter(
                        (child) =>
                            isTreeElementWithContextValue(child) &&
                            child.contextValue
                                .split(';')
                                .some((tag) =>
                                    [CLUSTER_ITEM_CONTEXT_VALUE, 'treeItem_folder', 'treeItem_LocalEmulators'].includes(
                                        tag,
                                    ),
                                ),
                    );
                },
            },
        });
        if (!(selected instanceof ClusterItemBase)) {
            throw new UserCancelledError();
        }
        node = selected;
    }

    const targetNode = node;
    trackJourneyCorrelationId(context, targetNode);
    const target: TroubleshootTarget = {
        clusterId: targetNode.cluster.clusterId,
        displayName: targetNode.cluster.name,
        sourceView,
        // Each node's diagnostic read: silent, no tunnel, typed failures (design §4.3, §5.3).
        getCredentials(read: DiagnosticCredentialRead): Promise<EphemeralClusterCredentials | undefined> {
            return targetNode.getCredentialsForDiagnostics(read);
        },
    };
    const result = openConnectivityTroubleshooter({ target, entryPoint });
    context.telemetry.properties.panelAction = result.panelAction;
    context.telemetry.properties.troubleshooterSessionId = result.troubleshooterSessionId;
}
