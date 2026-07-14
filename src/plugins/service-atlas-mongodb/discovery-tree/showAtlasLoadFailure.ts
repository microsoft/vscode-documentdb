/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { l10n, window } from 'vscode';
import { ext } from '../../../extensionVariables';

export async function showAtlasLoadFailure(failureMessage: string, errorMessage: string): Promise<void> {
    ext.outputChannel.appendLine(l10n.t('Failed to load MongoDB Atlas discovery: {0}', errorMessage));

    await window.showErrorMessage(failureMessage, {
        modal: true,
        detail: l10n.t('Revisit credentials and try again.'),
    });
}
