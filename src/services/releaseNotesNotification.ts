/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as semver from 'semver';
import * as vscode from 'vscode';
import { ext } from '../extensionVariables';

const STORAGE_KEY = 'ms-azuretools.vscode-documentdb.releaseNotes/lastShownVersion';

/**
 * In-memory flag to defer the notification until next VS Code session.
 * When true, the notification will not be shown again in this session.
 */
let remindLaterDeferred = false;

/**
 * Telemetry outcomes for the release notes notification.
 */
type ReleaseNotesOutcome = 'viewedReleaseNotes' | 'remindLater' | 'ignored' | 'dismissed';

/**
 * Shows a notification prompting the user to view release notes when a new major.minor version is detected.
 *
 * Behavior:
 * - First-time install: Initializes storage to current version, no notification shown.
 * - Existing user with new major.minor: Shows notification with "Release Notes", "Remind Me Later", "Ignore" options.
 * - "Release Notes": Opens release notes URL, updates stored version.
 * - "Remind Me Later": Sets in-memory flag (notification returns on VS Code restart), storage unchanged.
 * - "Ignore": Updates stored version, no URL opened.
 */
export async function maybeShowReleaseNotesNotification(): Promise<void> {
    // Don't show if already deferred this session
    if (remindLaterDeferred) {
        return;
    }

    await callWithTelemetryAndErrorHandling(
        'releaseNotesNotification',
        async (context: IActionContext): Promise<void> => {
            // Default: notification not shown (filtered out by version check or first install)
            context.telemetry.properties.notificationShown = 'false';

            const packageJSON = ext.context.extension.packageJSON as {
                version: string;
                releaseNotesUrl?: string;
            };

            const currentVersion = semver.parse(packageJSON.version);
            if (!currentVersion) {
                ext.outputChannel.warn(`Release notes: Could not parse current version: ${packageJSON.version}`);
                context.telemetry.properties.parseError = 'true';
                return;
            }

            const storedVersionString = ext.context.globalState.get<string>(STORAGE_KEY);
            const storedVersion = storedVersionString ? semver.parse(storedVersionString) : null;

            // First-time install: initialize storage and skip notification
            if (!storedVersion) {
                // ================================================================================
                // TRANSITIONAL CODE FOR 0.7.0 RELEASE - CAN BE REMOVED IN 0.8.0 OR LATER
                // ================================================================================
                // Since the release notes feature is being introduced in 0.7.0, we cannot
                // distinguish between a fresh install and an upgrade from a pre-0.7.0 version
                // based solely on the release notes storage key (which didn't exist before).
                //
                // To detect upgrades from pre-0.7.0 versions, we check for the welcome screen
                // flag that was set in previous versions. If this flag exists, the user had
                // a previous version installed and should see the release notes notification.
                //
                // Once most users have transitioned to 0.7.0+, this block can be safely removed.
                // ================================================================================
                const welcomeScreenShown = ext.context.globalState.get<boolean>('welcomeScreenShown_v0_4_0', false);
                if (welcomeScreenShown) {
                    // User upgraded from a pre-0.7.0 version - treat as upgrade, not first install
                    // Set stored version to 0.0.0 so the version comparison triggers the notification
                    ext.outputChannel.trace(
                        'Release notes: Detected upgrade from pre-0.7.0 version (welcome screen flag present)',
                    );
                    context.telemetry.properties.upgradeFromPre070 = 'true';
                    // Continue to the version comparison below with storedVersion as 0.0.0
                } else {
                    // Genuine first-time install
                    const normalizedVersion = `${currentVersion.major}.${currentVersion.minor}.0`;
                    await ext.context.globalState.update(STORAGE_KEY, normalizedVersion);
                    ext.outputChannel.trace(
                        `Release notes: First-time install, initialized to version ${normalizedVersion}`,
                    );
                    context.telemetry.properties.firstInstall = 'true';
                    return;
                }
                // ================================================================================
                // END TRANSITIONAL CODE
                // ================================================================================
            }

            // Compare major.minor only (ignore patch)
            const currentMajorMinor = `${currentVersion.major}.${currentVersion.minor}.0`;
            // For pre-0.7.0 upgrades (transitional), use 0.0.0 to ensure notification is shown
            const storedMajorMinor = storedVersion ? `${storedVersion.major}.${storedVersion.minor}.0` : '0.0.0';

            context.telemetry.properties.currentVersion = currentMajorMinor;
            context.telemetry.properties.storedVersion = storedMajorMinor;

            if (!semver.gt(currentMajorMinor, storedMajorMinor)) {
                // Same or older version, no notification needed
                return;
            }

            ext.outputChannel.info(
                `Release notes: New version detected (${currentMajorMinor} > ${storedMajorMinor}), showing notification`,
            );

            // Track that notification was shown
            context.telemetry.properties.notificationShown = 'true';

            // Define button actions with outcome tracking
            let outcome: ReleaseNotesOutcome = 'dismissed';

            const releaseNotesButton = {
                title: vscode.l10n.t('Release Notes'),
                run: async () => {
                    outcome = 'viewedReleaseNotes';
                    const releaseNotesUrl = packageJSON.releaseNotesUrl;
                    if (releaseNotesUrl) {
                        await vscode.env.openExternal(vscode.Uri.parse(releaseNotesUrl));
                    }
                    await ext.context.globalState.update(STORAGE_KEY, currentMajorMinor);
                    ext.outputChannel.trace(
                        `Release notes: User viewed release notes, updated to ${currentMajorMinor}`,
                    );
                },
            };

            const remindLaterButton = {
                title: vscode.l10n.t('Remind Me Later'),
                run: async () => {
                    outcome = 'remindLater';
                    remindLaterDeferred = true;
                    ext.outputChannel.trace(
                        'Release notes: User chose "Remind Me Later", will show again next session',
                    );
                },
            };

            const ignoreButton = {
                title: vscode.l10n.t('Ignore'),
                isSecondary: true,
                run: async () => {
                    outcome = 'ignored';
                    await ext.context.globalState.update(STORAGE_KEY, currentMajorMinor);
                    ext.outputChannel.trace(`Release notes: User ignored, updated to ${currentMajorMinor}`);
                },
            };

            const selectedButton = await vscode.window.showInformationMessage(
                vscode.l10n.t('DocumentDB for VS Code has been updated. View the release notes?'),
                releaseNotesButton,
                remindLaterButton,
                ignoreButton,
            );

            // Handle response - defaults to "Remind Me Later" if dismissed (but track as dismissed)
            if (selectedButton) {
                await selectedButton.run();
            } else {
                // User dismissed without clicking a button - treat as remind later behavior
                remindLaterDeferred = true;
                ext.outputChannel.trace('Release notes: User dismissed notification, will show again next session');
            }

            // Record the outcome in telemetry
            context.telemetry.properties.outcome = outcome;
        },
    );
}
