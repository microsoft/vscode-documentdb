/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as semver from 'semver';
import * as vscode from 'vscode';
import { ext } from '../extensionVariables';

export const STORAGE_KEY = 'ms-azuretools.vscode-documentdb.releaseNotes/lastShownVersion';
export const WELCOME_SCREEN_KEY = 'welcomeScreenShown_v0_4_0';

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
 * Result of the version check determining whether to show the release notes notification.
 */
export interface VersionCheckResult {
    /** Whether the notification should be shown */
    shouldShowNotification: boolean;
    /** The normalized current version (major.minor.0) */
    currentMajorMinor: string;
    /** The normalized stored version (major.minor.0), or '0.0.0' for pre-0.7.0 upgrades */
    storedMajorMinor: string;
    /** Whether this is a first-time install */
    isFirstInstall: boolean;
    /** Whether this is an upgrade from a pre-0.7.0 version (transitional) */
    isUpgradeFromPre070: boolean;
    /** Whether version parsing failed */
    parseError: boolean;
}

/**
 * Checks whether the release notes notification should be shown based on version comparison.
 * This function is extracted for testability.
 *
 * @param currentVersionString - The current extension version string
 * @param storedVersionString - The stored version string from globalState (or undefined if not set)
 * @param welcomeScreenShown - Whether the welcome screen flag is set (for transitional detection)
 * @returns The version check result
 */
export function checkVersionForNotification(
    currentVersionString: string,
    storedVersionString: string | undefined,
    welcomeScreenShown: boolean,
): VersionCheckResult {
    const result: VersionCheckResult = {
        shouldShowNotification: false,
        currentMajorMinor: '',
        storedMajorMinor: '',
        isFirstInstall: false,
        isUpgradeFromPre070: false,
        parseError: false,
    };

    const currentVersion = semver.parse(currentVersionString);
    if (!currentVersion) {
        result.parseError = true;
        return result;
    }

    result.currentMajorMinor = `${currentVersion.major}.${currentVersion.minor}.0`;

    const storedVersion = storedVersionString ? semver.parse(storedVersionString) : null;

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
        if (welcomeScreenShown) {
            // User upgraded from a pre-0.7.0 version
            result.isUpgradeFromPre070 = true;
            result.storedMajorMinor = '0.0.0';
            result.shouldShowNotification = true;
        } else {
            // Genuine first-time install
            result.isFirstInstall = true;
            result.storedMajorMinor = result.currentMajorMinor;
        }
        // ================================================================================
        // END TRANSITIONAL CODE
        // ================================================================================
        return result;
    }

    result.storedMajorMinor = `${storedVersion.major}.${storedVersion.minor}.0`;

    // Show notification only if current major.minor is greater than stored major.minor
    result.shouldShowNotification = semver.gt(result.currentMajorMinor, result.storedMajorMinor);

    return result;
}

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

            const storedVersionString = ext.context.globalState.get<string>(STORAGE_KEY);
            const welcomeScreenShown = ext.context.globalState.get<boolean>(WELCOME_SCREEN_KEY, false);

            // Use the extracted version check logic
            const versionCheck = checkVersionForNotification(
                packageJSON.version,
                storedVersionString,
                welcomeScreenShown,
            );

            if (versionCheck.parseError) {
                ext.outputChannel.warn(`Release notes: Could not parse current version: ${packageJSON.version}`);
                context.telemetry.properties.parseError = 'true';
                return;
            }

            context.telemetry.properties.currentVersion = versionCheck.currentMajorMinor;
            context.telemetry.properties.storedVersion = versionCheck.storedMajorMinor;

            if (versionCheck.isFirstInstall) {
                await ext.context.globalState.update(STORAGE_KEY, versionCheck.currentMajorMinor);
                ext.outputChannel.trace(
                    `Release notes: First-time install, initialized to version ${versionCheck.currentMajorMinor}`,
                );
                context.telemetry.properties.firstInstall = 'true';
                return;
            }

            if (versionCheck.isUpgradeFromPre070) {
                ext.outputChannel.trace(
                    'Release notes: Detected upgrade from pre-0.7.0 version (welcome screen flag present)',
                );
                context.telemetry.properties.upgradeFromPre070 = 'true';
            }

            if (!versionCheck.shouldShowNotification) {
                // Same or older version, no notification needed
                return;
            }

            ext.outputChannel.info(
                `Release notes: New version detected (${versionCheck.currentMajorMinor} > ${versionCheck.storedMajorMinor}), showing notification`,
            );

            // Track that notification was shown
            context.telemetry.properties.notificationShown = 'true';

            // Define button actions with outcome tracking
            let outcome: ReleaseNotesOutcome = 'dismissed';
            const currentMajorMinor = versionCheck.currentMajorMinor;

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
