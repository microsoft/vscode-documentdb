/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep, UserCancelledError } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { type ExcludedSourceIndex, type PasteIndexesWizardContext } from './PasteIndexesWizardContext';

export class ConfirmPasteIndexesStep extends AzureWizardPromptStep<PasteIndexesWizardContext> {
    public async prompt(context: PasteIndexesWizardContext): Promise<void> {
        const action = vscode.l10n.t('Paste Indexes');
        const detail = this.buildConfirmationDetail(context);
        const hasDocumentAffectingIndexes = context.uniqueIndexNames.length > 0 || context.ttlIndexNames.length > 0;
        context.telemetry.properties.uniqueIndexWarningShown =
            context.uniqueIndexNames.length > 0 ? 'true' : 'false';
        context.telemetry.properties.ttlIndexWarningShown = context.ttlIndexNames.length > 0 ? 'true' : 'false';
        context.telemetry.measurements.sourceUniqueIndexCount = context.uniqueIndexNames.length;
        context.telemetry.measurements.sourceTtlIndexCount = context.ttlIndexNames.length;
        const response = hasDocumentAffectingIndexes
            ? await vscode.window.showWarningMessage(
                  vscode.l10n.t('Paste indexes into "{0}"?', context.target.collectionName),
                  { modal: true, detail },
                  action,
              )
            : await vscode.window.showInformationMessage(
                  vscode.l10n.t('Paste indexes into "{0}"?', context.target.collectionName),
                  { modal: true, detail },
                  action,
              );

        context.telemetry.properties.operationConfirmed = response === action ? 'true' : 'false';
        if (response !== action) {
            throw new UserCancelledError();
        }
    }

    public shouldPrompt(): boolean {
        return true;
    }

    private buildConfirmationDetail(context: PasteIndexesWizardContext): string {
        const lines = [
            vscode.l10n.t('Source:'),
            vscode.l10n.t(' • Connection: {0}', context.sourceConnectionName),
            vscode.l10n.t(' • Database: "{0}"', context.source.databaseName),
            vscode.l10n.t(' • Collection: "{0}"', context.source.collectionName),
            '',
            vscode.l10n.t('Target:'),
            vscode.l10n.t(' • Connection: {0}', context.targetConnectionName),
            vscode.l10n.t(' • Database: "{0}"', context.target.databaseName),
            vscode.l10n.t(' • Collection: "{0}"', context.target.collectionName),
            '',
        ];

        if (context.scope.kind === 'index') {
            lines.push(vscode.l10n.t('Index to copy: "{0}"', context.scope.indexName));
        } else if (context.scope.kind === 'indexes') {
            lines.push(
                vscode.l10n.t('Indexes to copy: {0}', context.scope.indexNames.map((name) => `"${name}"`).join(', ')),
            );
        } else {
            if (context.copyableCount === 0) {
                lines.push(vscode.l10n.t('There are no copyable secondary indexes in the source collection.'));
            } else {
                lines.push(
                    vscode.l10n.t(
                        '{0} of {1} indexes will be copied.',
                        context.copyableCount.toString(),
                        context.catalogCount.toString(),
                    ),
                );
            }
            if (context.copyableIndexNames.length > 0 && context.copyableIndexNames.length <= 10) {
                lines.push(
                    vscode.l10n.t('Copying: {0}', context.copyableIndexNames.map((name) => `"${name}"`).join(', ')),
                );
            }
            if (context.excluded.length > 0) {
                lines.push(
                    vscode.l10n.t(
                        'Not copied: {0}. Search-index exclusions are best-effort and may be incomplete.',
                        context.excluded.map((index) => this.formatExclusion(index)).join('; '),
                    ),
                );
            }
        }

        lines.push(
            '',
            vscode.l10n.t(
                'Equivalent indexes and same-key option conflicts are skipped, different-key name collisions are renamed, and cancellation does not remove indexes already created.',
            ),
        );
        if (context.uniqueIndexNames.length > 0) {
            lines.push(
                vscode.l10n.t(
                    'Creating unique indexes ({0}) may fail if existing target documents contain duplicate values.',
                    context.uniqueIndexNames.join(', '),
                ),
            );
        }
        if (context.ttlIndexNames.length > 0) {
            lines.push(
                vscode.l10n.t(
                    'TTL indexes ({0}) may delete expired documents already in the target collection, including after this task finishes.',
                    context.ttlIndexNames.join(', '),
                ),
            );
        }

        return lines.join('\n');
    }

    private formatExclusion(index: ExcludedSourceIndex): string {
        if (index.reason === 'builtInId') {
            return vscode.l10n.t(
                '"{0}" (the target\'s own _id index already exists or is created automatically)',
                index.name,
            );
        }

        const type = index.type === 'vectorSearch' ? vscode.l10n.t('vector search') : index.type;
        return vscode.l10n.t('"{0}" ({1} index - recreate it manually on the target)', index.name, type);
    }
}
