/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { type Disposable } from 'vscode';
import { ext } from '../../../extensionVariables';
import { QuickStartService, type QuickStartOperationKind } from '../../../services/localQuickStart/QuickStartService';
import { buildQuickStartInstanceTreeId } from './quickStartTreeIdentity';

function operationLabel(kind: QuickStartOperationKind): string {
    switch (kind) {
        case 'provisioning':
            return l10n.t('Provisioning…');
        case 'starting':
            return l10n.t('Starting…');
        case 'stopping':
            return l10n.t('Stopping…');
        case 'restarting':
            return l10n.t('Restarting…');
        case 'deleting':
            return l10n.t('Deleting…');
        default:
            return l10n.t('Refreshing…');
    }
}

/**
 * Hands Quick Start's in-flight work to the tree framework's node-progress state, so the managed
 * instance row shows progress the same way every other node does.
 *
 * Lives outside the tree item because the work is service-owned: it can be started from the
 * Quick Start webview or a lifecycle command, and the row only ever renders the resulting state.
 */
export function createQuickStartProgressBridge(): Disposable {
    let bridged: Promise<void> | undefined;

    const sync = (): void => {
        const operation = QuickStartService.getInFlightOperation();
        if (!operation || operation.promise === bridged) {
            return;
        }
        bridged = operation.promise;
        void ext.state
            .runWithTemporaryDescription(
                buildQuickStartInstanceTreeId(),
                operationLabel(operation.kind),
                () => operation.promise,
            )
            .finally(() => {
                if (bridged === operation.promise) {
                    bridged = undefined;
                }
            });
    };

    // Deferred: work can start from inside a tree render, and applying state fires a refresh synchronously.
    return QuickStartService.onDidChangeOperation(() => queueMicrotask(sync));
}
