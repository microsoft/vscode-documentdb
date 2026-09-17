/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { ext } from '../../extensionVariables';
import { type PasteCollectionWizardContext } from './PasteCollectionWizardContext';
import { createIndexCopier } from './createIndexCopier';

class IndexCountCompleteError extends Error {
    public constructor() {
        super('Source index count completed');
        this.name = 'IndexCountCompleteError';
    }
}

export class CountSourceIndexesStep extends AzureWizardPromptStep<PasteCollectionWizardContext> {
    public async prompt(context: PasteCollectionWizardContext): Promise<void> {
        const controller = new AbortController();

        try {
            await context.ui.showQuickPick(this.loadSourceIndexCount(context, controller.signal), {
                loadingPlaceHolder: l10n.t('Counting source indexes…'),
                suppressPersistence: true,
            });
        } catch (error) {
            if (error instanceof IndexCountCompleteError) {
                return;
            }

            throw error;
        } finally {
            controller.abort();
        }
    }

    public shouldPrompt(context: PasteCollectionWizardContext): boolean {
        return context.copyIndexes;
    }

    private async loadSourceIndexCount(context: PasteCollectionWizardContext, signal: AbortSignal): Promise<never> {
        try {
            const summary = await createIndexCopier(context).getSourceIndexSummary(signal);
            context.sourceIndexCount = summary.count;
            context.sourceUniqueIndexNames = summary.uniqueIndexNames;
            context.sourceTtlIndexNames = summary.ttlIndexNames;
            context.telemetry.measurements.sourceIndexCount = context.sourceIndexCount;
        } catch (error) {
            if (signal.aborted) {
                throw error;
            }

            context.sourceIndexCount = undefined;
            context.sourceUniqueIndexNames = [];
            context.sourceTtlIndexNames = [];
            context.telemetry.properties.sourceIndexCountError = error instanceof Error ? error.name : 'UnknownError';
            const errorMessage = error instanceof Error ? error.message : String(error);
            ext.outputChannel.warn(l10n.t('[IndexCopy] Failed to count source indexes: {0}', errorMessage));
            throw new Error(l10n.t('Failed to read source indexes: {0}', errorMessage), { cause: error });
        }

        throw new IndexCountCompleteError();
    }
}
