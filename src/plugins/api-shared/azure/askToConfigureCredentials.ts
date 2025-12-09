/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { window } from 'vscode';

interface AskToConfigureCredentialsOptions {
    /**
     * Whether to show the "Adjust Filters" button.
     * Set to false when already in the filtering wizard to avoid circular flow.
     * @default true
     */
    showFilterOption?: boolean;
}

/**
 * Shows a modal dialog asking the user if they want to configure/manage their Azure credentials or adjust filters.
 * Used when no Azure subscriptions are found or when user is not signed in.
 *
 * @param options Configuration options for the dialog
 * @returns Promise that resolves to 'configure' if user wants to manage accounts, 'filter' if user wants to adjust filters, 'cancel' otherwise
 */
export async function askToConfigureCredentials(
    options: AskToConfigureCredentialsOptions = {},
): Promise<'configure' | 'filter' | 'cancel'> {
    const { showFilterOption = true } = options;

    const configure = l10n.t('Manage Accounts');
    const filter = l10n.t('Adjust Filters');

    const buttons = showFilterOption ? [{ title: configure }, { title: filter }] : [{ title: configure }];

    const detailMessage = showFilterOption
        ? l10n.t(
              'To connect to Azure resources, you need to sign in to Azure accounts.\n\n' +
                  'If you are already signed in, your subscription or tenant filters may be hiding results.',
          )
        : l10n.t('To connect to Azure resources, you need to sign in to Azure accounts.');

    const result = await window.showInformationMessage(
        l10n.t('No Azure Subscriptions Found'),
        {
            modal: true,
            detail: detailMessage,
        },
        ...buttons,
    );

    if (result?.title === configure) {
        return 'configure';
    } else if (result?.title === filter) {
        return 'filter';
    }
    return 'cancel';
}
