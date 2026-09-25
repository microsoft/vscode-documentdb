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
    // Spliced mid-sentence before another full stop, so its own would double up.
    const reason = detail?.replace(/\.+$/, '') || undefined;

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
        case 'imageNotFound':
            return l10n.t(
                'Docker could not find the image {0}. Go back to Configure and check the image tag, or leave it empty to use the latest version.',
                message.image ?? '',
            );
        case 'createTimedOut':
            return l10n.t(
                'Docker did not finish creating the container in time. Try again, or go back to Configure and choose a different port. If it keeps happening, restart Docker.',
            );
        case 'containerExited':
            return formatContainerExited(message.exitCode, detail);
        case 'credentialsRejected':
            return reason
                ? l10n.t(
                      'We could not sign in with this username and password: {0}. Go back to Configure and check the credentials.',
                      reason,
                  )
                : l10n.t(
                      'We could not sign in with this username and password. Go back to Configure and check the credentials.',
                  );
        case 'savedCredentialsRejected':
            return reason
                ? l10n.t(
                      'We could not sign in with the saved username and password: {0}. To start over, go back to Configure and choose "Erase the existing data and start empty". This permanently deletes all data in DocumentDB Local.',
                      reason,
                  )
                : l10n.t(
                      'We could not sign in with the saved username and password. To start over, go back to Configure and choose "Erase the existing data and start empty". This permanently deletes all data in DocumentDB Local.',
                  );
        case 'passwordNotSupported':
            return l10n.t(
                'We could not sign in because this password contains unsupported characters. Go back to Configure and choose a different password.',
            );
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

function formatContainerExited(exitCode: number | undefined, detail: string | undefined): string {
    const reason = detail?.replace(/\.+$/, '') || undefined;
    if (exitCode === undefined) {
        return reason
            ? l10n.t(
                  'The DocumentDB container stopped before it was ready: {0}. View the setup log for details.',
                  reason,
              )
            : l10n.t('The DocumentDB container stopped before it was ready. View the setup log for details.');
    }
    return reason
        ? l10n.t(
              'The DocumentDB container stopped before it was ready (exit code {0}): {1}. View the setup log for details.',
              String(exitCode),
              reason,
          )
        : l10n.t(
              'The DocumentDB container stopped before it was ready (exit code {0}). View the setup log for details.',
              String(exitCode),
          );
}
