/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { Links } from '../../constants';
import { openUrl } from '../../utils/openUrl';

export async function showEntraUnavailableDetails(): Promise<void> {
    const learnMore = { title: vscode.l10n.t('Learn More') };
    const back = { title: vscode.l10n.t('Back'), isCloseAffordance: true };
    const selected = await vscode.window.showInformationMessage(
        vscode.l10n.t("Microsoft Entra ID isn't available for this server."),
        {
            modal: true,
            detail: vscode.l10n.t(
                'Microsoft Entra ID is available only for Azure DocumentDB\nor servers allowed by the trusted-server setting.',
            ),
        },
        learnMore,
        back,
    );
    if (selected === learnMore && !(await openUrl(Links.EntraTrustedServers))) {
        void vscode.window.showWarningMessage(vscode.l10n.t("We couldn't open this link."));
    }
}
