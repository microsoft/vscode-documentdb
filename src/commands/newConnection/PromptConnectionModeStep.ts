/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep, type IWizardOptions } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { MongoClustersExperience } from '../../AzureDBExperiences';
import { MongoConnectionStringStep } from './MongoConnectionStringStep';
import { MongoExecuteStep } from './MongoExecuteStep';
import { MongoPasswordStep } from './MongoPasswordStep';
import { MongoUsernameStep } from './MongoUsernameStep';
import { ConnectionMode, type NewConnectionWizardContext } from './NewConnectionWizardContext';
import { PromptServiceDiscoveryStep } from './PromptServiceDiscoveryStep';

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
    }

    // eslint-disable-next-line @typescript-eslint/require-await
    public async getSubWizard(
        wizardContext: NewConnectionWizardContext,
    ): Promise<IWizardOptions<NewConnectionWizardContext> | undefined> {
        switch (wizardContext.connectionMode) {
            case ConnectionMode.ConnectionString:
                return {
                    title: l10n.t('Connection String'),
                    promptSteps: [new MongoConnectionStringStep(), new MongoUsernameStep(), new MongoPasswordStep()],
                    executeSteps: [new MongoExecuteStep()],
                };
            case ConnectionMode.ServiceDiscovery:
                return {
                    title: l10n.t('Service Discovery'),
                    promptSteps: [new PromptServiceDiscoveryStep()],
                    executeSteps: [new MongoExecuteStep()],
                };
            default:
                return undefined;
        }
    }

    public shouldPrompt(): boolean {
        return true;
    }
}
