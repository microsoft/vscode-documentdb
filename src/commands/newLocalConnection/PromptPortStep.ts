/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { DocumentDBExperience, MongoExperience } from '../../DocumentDBExperiences';
import { NewEmulatorConnectionMode, type NewLocalConnectionWizardContext } from './NewLocalConnectionWizardContext';

export class PromptPortStep extends AzureWizardPromptStep<NewLocalConnectionWizardContext> {
    public hideStepCount: boolean = false;

    public async prompt(context: NewLocalConnectionWizardContext): Promise<void> {
        let defaultPort: string;
        let promptText: string;
        let placeHolder: string | undefined;

        switch (context.experience) {
            case MongoExperience:
            case DocumentDBExperience:
            default:
                defaultPort = context.port ? context.port.toString() : '10255';
                promptText = l10n.t('Enter the port number');
                placeHolder = l10n.t('The default port: 10255');
                break;
        }

        const port = await context.ui.showInputBox({
            prompt: promptText,
            value: defaultPort,
            placeHolder: placeHolder,
            validateInput: (input: string) => this.validateInput(input),
        });

        if (port) {
            context.port = Number(port);
        }
    }

    public shouldPrompt(context: NewLocalConnectionWizardContext): boolean {
        // For Mongo and NoSQL, prompt if mode is Preconfigured
        return context.mode === NewEmulatorConnectionMode.Preconfigured;
    }

    private validateInput(port: string | undefined): string | undefined {
        port = port ? port.trim() : '';

        if (!port) {
            return l10n.t('Port number is required');
        }

        const portNumber = parseInt(port, 10);
        if (isNaN(portNumber)) {
            return l10n.t('Port number must be a number');
        }

        if (portNumber <= 0 || portNumber > 65535) {
            return l10n.t('Port number must be between 1 and 65535');
        }

        return undefined;
    }
}
