/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * An error that carries a VS Code settings key to show as a clickable
 * link in the terminal output.
 *
 * When the shell PTY catches a {@link SettingsHintError}, it displays
 * the error message followed by a hint line and a clickable settings
 * action line (e.g., `⚙ [documentDB.shell.initTimeout]`) that opens the setting.
 */
export class SettingsHintError extends Error {
    constructor(
        message: string,
        readonly settingKey: string,
        readonly settingsHint: string,
    ) {
        super(message);
        this.name = 'SettingsHintError';
    }
}
