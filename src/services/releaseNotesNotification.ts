/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

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

    try {
        const packageJSON = ext.context.extension.packageJSON as {
            version: string;
            releaseNotesUrl?: string;
        };

        const currentVersion = semver.parse(packageJSON.version);
        if (!currentVersion) {
            ext.outputChannel.warn(`Release notes: Could not parse current version: ${packageJSON.version}`);
            return;
        }

        const storedVersionString = ext.context.globalState.get<string>(STORAGE_KEY);
        const storedVersion = storedVersionString ? semver.parse(storedVersionString) : null;

        // First-time install: initialize storage and skip notification
        if (!storedVersion) {
            const normalizedVersion = `${currentVersion.major}.${currentVersion.minor}.0`;
            await ext.context.globalState.update(STORAGE_KEY, normalizedVersion);
            ext.outputChannel.trace(`Release notes: First-time install, initialized to version ${normalizedVersion}`);
            return;
        }

        // Compare major.minor only (ignore patch)
        const currentMajorMinor = `${currentVersion.major}.${currentVersion.minor}.0`;
        const storedMajorMinor = `${storedVersion.major}.${storedVersion.minor}.0`;

        if (!semver.gt(currentMajorMinor, storedMajorMinor)) {
            // Same or older version, no notification needed
            return;
        }

        ext.outputChannel.info(
            `Release notes: New version detected (${currentMajorMinor} > ${storedMajorMinor}), showing notification`,
        );

        // Define button actions
        const releaseNotesButton = {
            title: vscode.l10n.t('Release Notes'),
            run: async () => {
                const releaseNotesUrl = packageJSON.releaseNotesUrl;
                if (releaseNotesUrl) {
                    await vscode.env.openExternal(vscode.Uri.parse(releaseNotesUrl));
                }
                await ext.context.globalState.update(STORAGE_KEY, currentMajorMinor);
                ext.outputChannel.trace(`Release notes: User viewed release notes, updated to ${currentMajorMinor}`);
            },
        };

        const remindLaterButton = {
            title: vscode.l10n.t('Remind Me Later'),
            run: async () => {
                remindLaterDeferred = true;
                ext.outputChannel.trace('Release notes: User chose "Remind Me Later", will show again next session');
            },
        };

        const ignoreButton = {
            title: vscode.l10n.t('Ignore'),
            isSecondary: true,
            run: async () => {
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

        // Handle response - defaults to "Remind Me Later" if dismissed
        await (selectedButton ?? remindLaterButton).run();
    } catch (error) {
        // Non-critical functionality - log but don't throw
        ext.outputChannel.error(
            `Release notes: Error showing notification: ${error instanceof Error ? error.message : String(error)}`,
        );
    }
}
