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
        vscode.l10n.t('Using Microsoft Entra ID with this server'),
        {
            modal: true,
            detail: vscode.l10n.t(
                'This is a server-address check, not a sign-in failure.\n\nTo protect your sign-in tokens, the extension enables Microsoft Entra ID only for recognized Azure DocumentDB addresses or explicitly configured trusted servers.\n\nConnecting to Azure DocumentDB? Compare your connection string with the one in the Azure portal. If that address is still unrecognized, or you use a custom address, select Learn More for endpoint verification and trusted-server setup guidance.\n\nConnecting to another service? Choose an authentication method supported by that service.',
            ),
        },
        learnMore,
        back,
    );
    if (selected === learnMore) {
        let opened: boolean;
        try {
            opened = await openUrl(Links.EntraTrustedServers);
        } catch {
            opened = false;
        }
        if (!opened) {
            void vscode.window.showWarningMessage(vscode.l10n.t("We couldn't open this link."));
        }
    }
}
