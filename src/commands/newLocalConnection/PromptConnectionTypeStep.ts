/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep, openUrl, UserCancelledError } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { wellKnownEmulatorPassword } from '../../constants';
import { getExperienceFromApi, type API } from '../../DocumentDBExperiences';
import { defaultMongoEmulatorConfiguration } from '../../utils/emulatorConfiguration';
import { NewEmulatorConnectionMode, type NewLocalConnectionWizardContext } from './NewLocalConnectionWizardContext';

export class PromptConnectionTypeStep extends AzureWizardPromptStep<NewLocalConnectionWizardContext> {
    private readonly preselectedAPI: API;

    constructor(preselectedAPI: API) {
        super();
        this.preselectedAPI = preselectedAPI;
    }

    public async prompt(context: NewLocalConnectionWizardContext): Promise<void> {
        const preconfiguredEmulators = [
            {
                id: 'mongo-ru',
                label: l10n.t('Azure Cosmos DB for MongoDB (RU) Emulator'),
                detail: l10n.t('I want to connect to the Azure Cosmos DB Emulator for MongoDB (RU).'),
                alwaysShow: true,
                group: 'Preconfigured Connections',
                learnMoreUrl: '',
            },
            {
                id: 'documentdb',
                label: l10n.t('DocumentDB Local'),
                detail: l10n.t('I want to connect to a local DocumentDB instance.'),
                alwaysShow: true,
                group: 'Preconfigured Connections',
                learnMoreUrl: '',
            },
            // Additional MongoDB emulator options can be added here
        ];

        const commonItems = [
            { label: '', kind: vscode.QuickPickItemKind.Separator },
            {
                id: 'connectionString',
                label: l10n.t('Connection String'),
                detail: l10n.t('I want to connect using a connection string.'),
                alwaysShow: true,
                group: 'Custom Connections',
            },
            { label: '', kind: vscode.QuickPickItemKind.Separator },
            {
                id: 'learnMore',
                label: l10n.t('Learn more…'),
                detail: l10n.t('Learn more about local connections.'),
                learnMoreUrl: 'https://aka.ms/vscode-documentdb-local-connections',
                alwaysShow: true,
                group: 'Learn More',
            },
        ];

        const selectedItem = await context.ui.showQuickPick([...preconfiguredEmulators, ...commonItems], {
            enableGrouping: true,
            placeHolder: l10n.t('Select the local connection type…'),
            stepName: 'selectEmulatorType',
            suppressPersistence: true,
        });

        context.telemetry.properties.connectionMode = selectedItem.id;

        if (selectedItem.id === 'learnMore') {
            context.telemetry.properties.emulatorLearnMore = 'true';

            await openUrl(selectedItem.learnMoreUrl!);
            throw new UserCancelledError();
        }

        if (selectedItem.id === 'connectionString') {
            context.mode = NewEmulatorConnectionMode.CustomConnectionString;

            context.experience = getExperienceFromApi(this.preselectedAPI);
            context.mongoEmulatorConfiguration = { ...defaultMongoEmulatorConfiguration };

            return;
        }

        if (preconfiguredEmulators.some((emulator) => emulator.id === selectedItem.id)) {
            context.mode = NewEmulatorConnectionMode.Preconfigured;
            context.experience = getExperienceFromApi(this.preselectedAPI);
            context.mongoEmulatorConfiguration = { ...defaultMongoEmulatorConfiguration };
            context.emulatorType = selectedItem.id;

            switch (context.emulatorType) {
                case 'documentdb':
                    context.connectionString = `mongodb://localhost/?directConnection=true&tls=true&tlsAllowInvalidCertificates=true`;
                    context.port = 10255;
                    break;
                case 'mongo-ru':
                    context.connectionString = `mongodb://localhost/?directConnection=true&tls=true&tlsAllowInvalidCertificates=true`;
                    context.port = 10255;
                    context.userName = 'localhost';
                    context.password = wellKnownEmulatorPassword;
                    break;
                default:
                    throw new Error(
                        l10n.t('Unsupported emulator type: "{emulatorType}"', {
                            emulatorType: context.emulatorType ?? 'undefined',
                        }),
                    );
            }
        }
    }

    public shouldPrompt(): boolean {
        return true;
    }
}
