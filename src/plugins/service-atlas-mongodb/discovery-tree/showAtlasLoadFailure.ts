/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { l10n, window } from 'vscode';
import { ext } from '../../../extensionVariables';
import { type AtlasErrorKind } from '../discovery/AtlasDiscoveryService';

/**
 * Recovery wording for a classified discovery failure.
 *
 * A transient failure (rate limit, dropped connection) must not tell the user to re-enter a working
 * credential, which is the credential-blaming default this replaces.
 */
export function recoveryHintFor(kind: AtlasErrorKind): string {
    switch (kind) {
        case 'auth':
            return l10n.t('The stored credential was rejected. Update it, then try again.');
        case 'forbidden':
            return l10n.t(
                'The credential is signed in but lacks access to this project. Review its roles and IP access list in MongoDB Atlas.',
            );
        case 'rateLimited':
            return l10n.t('MongoDB Atlas asked us to slow down. Wait briefly, then try again.');
        case 'network':
            return l10n.t(
                'MongoDB Atlas could not be reached. Check your connection or proxy settings, then try again.',
            );
        default:
            return l10n.t('Try again. If this persists, check the output channel for details.');
    }
}

/**
 * Reports a discovery load failure: the full error to the output channel, and a modal with the
 * classified recovery hint plus the real error text.
 *
 * `void`, not `await`, on purpose - the Kubernetes plugin does the same. Awaiting a modal inside
 * `getChildren()` keeps the tree node spinning until the dialog is dismissed and queues one dialog
 * per expanded project. The caller decides whether to show it at all (a passive Refresh suppresses
 * it; an expand or an explicit retry does not).
 */
export function showAtlasLoadFailure(title: string, error: unknown, hint: string): void {
    const message = error instanceof Error ? error.message : String(error);
    ext.outputChannel.error(l10n.t('Failed to load MongoDB Atlas discovery: {0}', message));

    void window.showErrorMessage(title, {
        modal: true,
        detail: `${hint}\n\n${l10n.t('Error: {0}', message)}`,
    });
}
