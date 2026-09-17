import { AzureWizard, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { CredentialCache } from '../../documentdb/CredentialCache';
import { CopyPasteBufferService } from '../../services/CopyPasteBufferService';
import { createIndexCopier } from '../../services/taskService/data-api/indexes/createIndexCopier';
import { type IndexesItem } from '../../tree/documentdb/IndexesItem';
import { ConfirmPasteIndexesStep } from './ConfirmPasteIndexesStep';
import { ExecuteStep } from './ExecuteStep';
import { LoadSourceIndexesStep } from './LoadSourceIndexesStep';
import { type PasteIndexesWizardContext } from './PasteIndexesWizardContext';

export async function pasteIndexes(context: IActionContext, targetNode: IndexesItem): Promise<void> {
    if (!targetNode) {
        throw new Error(vscode.l10n.t('No target indexes node selected.'));
    }

    const copied = CopyPasteBufferService.getIndexes();
    if (!copied) {
        throw new Error(vscode.l10n.t('No indexes are ready to paste. Use Copy Index or Copy Indexes first.'));
    }
    if (!CredentialCache.hasCredentials(copied.source.clusterId)) {
        await CopyPasteBufferService.clearIndexes();
        throw new Error(vscode.l10n.t('The source connection is no longer available. Reconnect and copy the indexes again.'));
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
        throw new Error(vscode.l10n.t('Source and target must be different collections.'));
    }

    const wizardContext: PasteIndexesWizardContext = {
        ...context,
        source: copied.source,
        target,
        sourceConnectionName: copied.sourceConnectionName,
        targetConnectionName: targetNode.cluster.name,
        targetIndexesId: targetNode.id,
        scope: copied.scope,
        indexCopier: createIndexCopier(copied.source, target),
        sourceIndexNames: copied.scope.kind === 'index' ? [copied.scope.indexName] : undefined,
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

    await wizard.prompt();
    await wizard.execute();
}