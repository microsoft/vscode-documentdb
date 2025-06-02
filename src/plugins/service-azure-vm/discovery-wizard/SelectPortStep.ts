/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { type NewConnectionWizardContext } from '../../../commands/newConnection/NewConnectionWizardContext';
import { AzureVMContextProperties } from '../AzureVMDiscoveryProvider';

const DEFAULT_PORT = '27017';

export class SelectPortStep extends AzureWizardPromptStep<NewConnectionWizardContext> {
    public async prompt(context: NewConnectionWizardContext): Promise<void> {
        const newPort = await context.ui.showInputBox({
            prompt: l10n.t(
                'Enter the port number your DocumentDB uses. The default port: {defaultPort}.',
                `${DEFAULT_PORT}`,
            ),
            value: DEFAULT_PORT,
            placeHolder: l10n.t('The default port: {defaultPort}', { defaultPort: DEFAULT_PORT }),
            validateInput: (input: string) => this.validateInput(input),
        });

        context.properties[AzureVMContextProperties.SelectedPort] = newPort;
    }

    public shouldPrompt(): boolean {
        return true;
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
