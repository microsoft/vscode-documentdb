/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext, callWithTelemetryAndErrorHandling } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { ext } from '../extensionVariables';
import { settingsKeys } from '../settingsKeys';

/** globalState flag recording that the one-time setting rename migration has run. */
const MIGRATION_COMPLETED_KEY = 'documentdb.settings.renameMigration.completed';

/**
 * Settings renamed in 0.11, paired old name to new name.
 */
const RENAMED_SETTINGS: ReadonlyArray<{ readonly legacyKey: string; readonly key: string }> = [
    { legacyKey: settingsKeys.legacy.confirmationStyle, key: settingsKeys.confirmationStyle },
    { legacyKey: settingsKeys.legacy.enableAIQueryGeneration, key: settingsKeys.enableAIQueryGeneration },
];

type Inspected<T> = { workspaceFolderValue?: T; workspaceValue?: T; globalValue?: T } | undefined;

// vscode.ConfigurationTarget is read inside functions, never at module scope: suites that stub
// the vscode module would otherwise fail to even load this file.

/** The targets a user can write to, narrowest scope first. */
function writableTargets(): readonly vscode.ConfigurationTarget[] {
    return [
        vscode.ConfigurationTarget.WorkspaceFolder,
        vscode.ConfigurationTarget.Workspace,
        vscode.ConfigurationTarget.Global,
    ];
}

function valueForTarget<T>(inspected: Inspected<T>, target: vscode.ConfigurationTarget): T | undefined {
    if (target === vscode.ConfigurationTarget.WorkspaceFolder) {
        return inspected?.workspaceFolderValue;
    }
    if (target === vscode.ConfigurationTarget.Workspace) {
        return inspected?.workspaceValue;
    }
    return inspected?.globalValue;
}

/** The narrowest value the user explicitly set, or undefined when they never set the key. */
function explicitValue<T>(inspected: Inspected<T>): T | undefined {
    return inspected?.workspaceFolderValue ?? inspected?.workspaceValue ?? inspected?.globalValue;
}

/**
 * Reads a setting, falling back to its pre-rename key when the current key has no explicit value.
 *
 * Uses `inspect()` rather than `get()`, because `get()` would return the new key's *default* and
 * silently beat a value the user set under the old name.
 */
export function getSettingWithLegacyFallback<T>(key: string, legacyKey: string, fallback: T): T {
    const config = vscode.workspace.getConfiguration();

    return (
        explicitValue(config.inspect<T>(key)) ??
        explicitValue(config.inspect<T>(legacyKey)) ??
        config.get<T>(key, fallback)
    );
}

/**
 * Copies values set under pre-rename setting keys onto their new keys, then clears the old ones,
 * so the deprecated entries stop appearing alongside their replacements in the Settings editor.
 *
 * Runs at most once per profile. Failures are non-fatal: the deprecated keys stay registered and
 * {@link getSettingWithLegacyFallback} keeps honouring them.
 */
export async function migrateRenamedSettings(): Promise<void> {
    if (ext.context.globalState.get<boolean>(MIGRATION_COMPLETED_KEY, false)) {
        return;
    }

    await callWithTelemetryAndErrorHandling('documentDB.settings.renameMigration', async (context: IActionContext) => {
        context.telemetry.properties.isActivationEvent = 'true';
        context.errorHandling.suppressDisplay = true;
        context.errorHandling.rethrow = false;

        const config = vscode.workspace.getConfiguration();
        let migrated = 0;

        for (const { legacyKey, key } of RENAMED_SETTINGS) {
            const inspected = config.inspect<unknown>(legacyKey);
            for (const target of writableTargets()) {
                const legacyValue = valueForTarget(inspected, target);
                if (legacyValue === undefined) {
                    continue;
                }

                // Never clobber a value the user already set under the new name.
                if (valueForTarget(config.inspect<unknown>(key), target) === undefined) {
                    await config.update(key, legacyValue, target);
                }
                await config.update(legacyKey, undefined, target);
                migrated++;
            }
        }

        context.telemetry.measurements.migratedSettings = migrated;
        await ext.context.globalState.update(MIGRATION_COMPLETED_KEY, true);
    });
}
