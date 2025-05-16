/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep, type IWizardOptions } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { MongoClustersExperience } from '../../DocumentDBExperiences';
import { ExecuteStep } from './ExecuteStep';
import { ConnectionMode, type NewConnectionWizardContext } from './NewConnectionWizardContext';
import { PromptConnectionStringStep } from './PromptConnectionStringStep';
import { PromptPasswordStep } from './PromptPasswordStep';
import { PromptServiceDiscoveryStep } from './PromptServiceDiscoveryStep';
import { PromptUsernameStep } from './PromptUsernameStep';

export class PromptConnectionModeStep extends AzureWizardPromptStep<NewConnectionWizardContext> {
    public async prompt(context: NewConnectionWizardContext): Promise<void> {
        const promptItems = [
            {
                id: 'connectionString',
                label: l10n.t('Connection String'),
                detail: l10n.t('I want to connect using a connection string.'),
                alwaysShow: true,
            },
            {
                id: 'serviceDiscovery',
                label: l10n.t('Service Discovery'),
                detail: l10n.t('I want to choose the server from an online registry.'),
                alwaysShow: true,
            },
        ];

        const selectedItem = await context.ui.showQuickPick([...promptItems], {
            enableGrouping: true,
            placeHolder: l10n.t('How do you want to connect?'),
            stepName: 'selectEmulatorType',
            suppressPersistence: true,
        });

        switch (selectedItem.id) {
            case 'connectionString':
                context.experience = MongoClustersExperience;
                context.connectionMode = ConnectionMode.ConnectionString;
                break;
            case 'serviceDiscovery':
                context.connectionMode = ConnectionMode.ServiceDiscovery;
                break;
            default:
                throw new Error(l10n.t('Invalid connection type selected.'));
        }

        context.telemetry.properties.connectionMode = selectedItem.id;
    }

    // eslint-disable-next-line @typescript-eslint/require-await
    public async getSubWizard(
        wizardContext: NewConnectionWizardContext,
    ): Promise<IWizardOptions<NewConnectionWizardContext> | undefined> {
        switch (wizardContext.connectionMode) {
            case ConnectionMode.ConnectionString:
                return {
                    title: l10n.t('Connection String'),
                    promptSteps: [new PromptConnectionStringStep(), new PromptUsernameStep(), new PromptPasswordStep()],
                    executeSteps: [new ExecuteStep()],
                };
            case ConnectionMode.ServiceDiscovery:
                return {
                    title: l10n.t('Service Discovery'),
                    promptSteps: [new PromptServiceDiscoveryStep()],
                    executeSteps: [new ExecuteStep()],
                };
            default:
                return undefined;
        }
    }

    public shouldPrompt(): boolean {
        return true;
    }
}
