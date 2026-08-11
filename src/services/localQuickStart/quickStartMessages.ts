/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { type QuickStartMessage } from './quickStartTypes';

/**
 * The wording behind every {@link QuickStartMessage}. Shared by the tree and the setup webview so
 * one situation cannot end up phrased two ways.
 *
 * Must stay free of `vscode` imports: the webview bundle imports this module too. Every string is
 * built inside the function rather than at module scope, so it resolves against whichever l10n
 * bundle the calling surface loaded.
 */
export function formatQuickStartMessage(message: QuickStartMessage): string {
    // Whitespace-only detail is no evidence at all; collapsing it here keeps every branch below
    // from having to decide what an empty string means.
    const detail = message.detail?.trim() || undefined;

    switch (message.key) {
        case 'setupAlreadyInProgress':
            return l10n.t('Setup is already in progress.');
        case 'setupCancelled':
            return l10n.t('Setup was cancelled.');
        case 'credentialsUnavailable':
            return l10n.t(
                'DocumentDB Local has data on disk but its saved credentials are missing, so it cannot be opened. Use "Delete Container" to remove it and start fresh (this erases the data).',
            );
        case 'portInUse':
            return l10n.t(
                'Port {0} is already in use. Go back to Configure to pick a different port, or free it, then try again.',
                String(message.port ?? ''),
            );
        case 'dockerCliMissing':
            return l10n.t('Docker CLI was not found on your PATH. Install Docker and retry.');
        case 'dockerDaemonUnreachable':
            return l10n.t('Docker is installed but the daemon is not reachable. Start Docker and retry.');
        case 'dockerUnavailableDuringSetup':
            return detail
                ? l10n.t('Docker became unavailable during setup: {0}', detail)
                : l10n.t('Docker became unavailable during setup.');
        case 'readinessTimeout':
            // A dev container publishes the port on its host, so "it is still starting" would be
            // the wrong thing to tell someone whose port is simply not routed.
            return message.environment === 'devContainer'
                ? l10n.t(
                      'DocumentDB did not accept connections in time. Docker may be running on the dev container host, so the published localhost port might not be reachable from inside the dev container.',
                  )
                : l10n.t('DocumentDB did not accept connections in time. It may still be initializing.');
        case 'stillInitializing':
            return l10n.t('Still initializing. Keep waiting, view the logs, or start over.');
        case 'instanceRunning':
            return l10n.t('DocumentDB Local is running on localhost:{0}.', String(message.port ?? ''));
        case 'nothingToResume':
            return l10n.t('There is nothing to resume.');
        case 'startedButExited':
            return l10n.t('The container started but exited shortly after. Check the DocumentDB Local setup logs.');
        case 'restartedButExited':
            return l10n.t('The container restarted but exited shortly after. Check the DocumentDB Local setup logs.');
        case 'unexpectedFailure':
        default:
            // Never return the raw text alone: it is English, and on its own it leaves a reader
            // with no translated sentence telling them what it is about.
            return detail ? l10n.t('Setup failed: {0}', detail) : l10n.t('Setup failed.');
    }
}
