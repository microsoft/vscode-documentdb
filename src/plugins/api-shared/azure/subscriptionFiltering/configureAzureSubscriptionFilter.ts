/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type VSCodeAzureSubscriptionProvider } from '@microsoft/vscode-azext-azureauth';
import {
    AzureWizard,
    type AzureWizardExecuteStep,
    type AzureWizardPromptStep,
    type IActionContext,
} from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { ext } from '../../../../extensionVariables';
import { ExecuteStep } from './ExecuteStep';
import { type FilteringWizardContext } from './FilteringWizardContext';
import { InitializeFilteringStep } from './InitializeFilteringStep';

/**
 * Options for extending the subscription filtering wizard with additional steps
 */
export interface SubscriptionFilteringOptions<TContext extends FilteringWizardContext = FilteringWizardContext> {
    /** Additional prompt steps to include after the standard filtering steps */
    additionalPromptSteps?: AzureWizardPromptStep<TContext>[];
    /** Additional execute steps to include after the standard execute steps */
    additionalExecuteSteps?: AzureWizardExecuteStep<TContext>[];
    /** Function to extend the wizard context with additional properties */
    contextExtender?: (context: FilteringWizardContext) => TContext;
    /** Custom title for the wizard */
    title?: string;
}

/**
 * Configures the Azure subscription filter using the wizard pattern.
 */
export async function configureAzureSubscriptionFilter<
    TContext extends FilteringWizardContext = FilteringWizardContext,
>(
    context: IActionContext,
    azureSubscriptionProvider: VSCodeAzureSubscriptionProvider,
    options?: SubscriptionFilteringOptions<TContext>,
): Promise<void> {
    context.telemetry.properties.subscriptionFiltering = 'configureAzureSubscriptionFilter';

    // Create base wizard context
    const baseWizardContext: FilteringWizardContext = {
        ...context,
        azureSubscriptionProvider,
    };

    // Extend context if extender is provided
    const wizardContext = options?.contextExtender
        ? options.contextExtender(baseWizardContext)
        : (baseWizardContext as TContext);

    // Build prompt steps
    const promptSteps: AzureWizardPromptStep<TContext>[] = [
        new InitializeFilteringStep() as AzureWizardPromptStep<TContext>,
    ];
    if (options?.additionalPromptSteps) {
        promptSteps.push(...options.additionalPromptSteps);
    }

    // Build execute steps
    const executeSteps: AzureWizardExecuteStep<TContext>[] = [new ExecuteStep() as AzureWizardExecuteStep<TContext>];
    if (options?.additionalExecuteSteps) {
        executeSteps.push(...options.additionalExecuteSteps);
    }

    // Create and run wizard
    const wizard = new AzureWizard(wizardContext, {
        title: options?.title || l10n.t('Configure Azure Discovery Filters'),
        promptSteps,
        executeSteps,
    });

    try {
        await wizard.prompt();
        await wizard.execute();
        context.telemetry.properties.subscriptionFilteringResult = 'Succeeded';
    } catch (error) {
        context.telemetry.properties.subscriptionFilteringResult = 'Failed';
        context.telemetry.properties.subscriptionFilteringError =
            error instanceof Error ? error.message : String(error);
        ext.outputChannel.error(
            `Error during subscription filtering: ${error instanceof Error ? error.message : String(error)}`,
        );
    }
}
