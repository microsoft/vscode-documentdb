/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizard, UserCancelledError, type IActionContext } from '@microsoft/vscode-azext-utils';
import { randomUUID } from 'crypto';
import * as vscode from 'vscode';
import { CredentialCache } from '../../documentdb/CredentialCache';
import { CopyPasteBufferService, type CopiedIndexSelection } from '../../services/CopyPasteBufferService';
import { createIndexCopier } from '../../services/taskService/data-api/indexes/createIndexCopier';
import { type IndexesItem } from '../../tree/documentdb/IndexesItem';
import { ConfirmPasteIndexesStep } from './ConfirmPasteIndexesStep';
import { ExecuteStep } from './ExecuteStep';
import { LoadSourceIndexesStep } from './LoadSourceIndexesStep';
import { type PasteIndexesWizardContext } from './PasteIndexesWizardContext';

export async function pasteIndexes(context: IActionContext, targetNode: IndexesItem): Promise<void> {
    context.telemetry.properties.wizardStarted = 'true';
    context.telemetry.properties.wizardCompletedSuccessfully = 'false';
    if (!targetNode) {
        context.telemetry.properties.wizardFailureReason = 'noTargetNode';
        throw new Error(vscode.l10n.t('No target indexes node selected.'));
    }

    const copied = CopyPasteBufferService.getIndexes();
    if (!copied) {
        context.telemetry.properties.wizardFailureReason = 'noCopiedIndexes';
        throw new Error(vscode.l10n.t('No indexes are ready to paste. Use Copy Index or Copy Indexes first.'));
    }
    if (!CredentialCache.hasCredentials(copied.source.clusterId)) {
        context.telemetry.properties.wizardFailureReason = 'sourceConnectionUnavailable';
        await CopyPasteBufferService.clearIndexes();
        throw new Error(
            vscode.l10n.t('The source connection is no longer available. Reconnect and copy the indexes again.'),
        );
    }

    const target = {
        clusterId: targetNode.cluster.clusterId,
        databaseName: targetNode.databaseInfo.name,
        collectionName: targetNode.collectionInfo.name,
    };
    if (
        copied.source.clusterId === target.clusterId &&
        copied.source.databaseName === target.databaseName &&
        copied.source.collectionName === target.collectionName
    ) {
        context.telemetry.properties.wizardFailureReason = 'sameCollectionTarget';
        throw new Error(vscode.l10n.t('Source and target must be different collections.'));
    }

    const copyOperationCorrelationId = randomUUID();
    const sourceIndexNames = getSourceIndexNames(copied.scope);
    context.telemetry.properties.copyOperationCorrelationId = copyOperationCorrelationId;
    context.telemetry.properties.copyScope = copied.scope.kind;
    if (sourceIndexNames !== undefined) {
        context.telemetry.measurements.selectedIndexCount = sourceIndexNames.length;
    }

    const wizardContext: PasteIndexesWizardContext = {
        ...context,
        source: copied.source,
        target,
        sourceConnectionName: copied.sourceConnectionName,
        targetConnectionName: targetNode.cluster.name,
        targetIndexesId: targetNode.id,
        scope: copied.scope,
        copyOperationCorrelationId,
        indexCopier: createIndexCopier(copied.source, target),
        sourceIndexNames,
        catalogCount: 0,
        copyableCount: 0,
        copyableIndexNames: [],
        excluded: [],
        uniqueIndexNames: [],
        ttlIndexNames: [],
    };
    const wizard = new AzureWizard(wizardContext, {
        title: vscode.l10n.t('Paste Indexes'),
        promptSteps: [new LoadSourceIndexesStep(), new ConfirmPasteIndexesStep()],
        executeSteps: [new ExecuteStep()],
    });

    try {
        await wizard.prompt();
        await wizard.execute();
        context.telemetry.properties.wizardCompletedSuccessfully = 'true';
    } catch (error) {
        if (error instanceof UserCancelledError) {
            context.telemetry.properties.wizardFailureReason ??= 'userCancelled';
            context.telemetry.properties.wizardCancelledByUser = 'true';
        } else {
            context.telemetry.properties.wizardFailureReason ??= 'executionError';
        }
        throw error;
    }
}

function getSourceIndexNames(scope: CopiedIndexSelection['scope']): readonly string[] | undefined {
    switch (scope.kind) {
        case 'index':
            return [scope.indexName];
        case 'indexes':
            return scope.indexNames;
        case 'allIndexes':
            return undefined;
    }
}
