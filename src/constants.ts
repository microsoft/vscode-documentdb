/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const isWindows: boolean = /^win/.test(process.platform);
export const isLinux: boolean = /^linux/.test(process.platform);
export const isMacOS: boolean = /^darwin/.test(process.platform);

import * as fs from 'fs';
import assert from 'node:assert';
import * as path from 'path';
import { Uri } from 'vscode';
import { ext } from './extensionVariables';

export namespace Links {
    export const LocalConnectionDebuggingTips: string = 'https://aka.ms/vscode-documentdb-local-connections';
}

export function getThemedIconPath(iconName: string): { light: Uri; dark: Uri } {
    const light = path.join(getResourcesPath(), 'icons', 'light', iconName);
    const dark = path.join(getResourcesPath(), 'icons', 'dark', iconName);

    assert.ok(fs.existsSync(light));
    assert.ok(fs.existsSync(dark));

    return {
        light: Uri.file(light),
        dark: Uri.file(dark),
    };
}

export function getThemeAgnosticIconPath(iconName: string): Uri {
    const icon = path.join(getResourcesPath(), 'icons', 'theme-agnostic', iconName);

    assert.ok(fs.existsSync(icon));

    return Uri.file(icon);
}

export function getIconPath(iconName: string): Uri {
    const icon = path.join(getResourcesPath(), 'icons', iconName);
    assert.ok(fs.existsSync(icon));
    return Uri.file(icon);
}

export function getResourcesPath(): string {
    return ext.context.asAbsolutePath('resources');
}

export const doubleClickDebounceDelay = 500; //milliseconds

export const wellKnownEmulatorPassword =
    'C2y6yDjf5/R+ob0N8A7Cgv30VRDJIWEHLM+4QDU5DE2nQ9nDuVTqobD4b8mGGyPMbIZnqyMsEcaGQy67XIw/Jw==';

export const isEmulatorSupported = isWindows || isLinux || (isMacOS && process.arch === 'x64');

// https://docs.mongodb.com/manual/mongo/#working-with-the-mongo-shell
export const testDb: string = 'test';
