/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import assert from 'node:assert';
import * as path from 'path';
import { Uri, type IconPath } from 'vscode';
import { ext } from '../extensionVariables';

export function getResourcesPath(): string {
    return ext.context.asAbsolutePath('resources');
}

export function getThemedIconPath(iconName: string): IconPath {
    const light = path.join(getResourcesPath(), 'icons', 'light', iconName);
    const dark = path.join(getResourcesPath(), 'icons', 'dark', iconName);

    assert.ok(fs.existsSync(light));
    assert.ok(fs.existsSync(dark));

    return {
        light: Uri.file(light),
        dark: Uri.file(dark),
    };
}

export function getThemeAgnosticIconPath(iconName: string): IconPath {
    const icon = path.join(getResourcesPath(), 'icons', 'theme-agnostic', iconName);

    assert.ok(fs.existsSync(icon));

    return Uri.file(icon);
}

export function getIconPath(iconName: string): IconPath {
    const icon = path.join(getResourcesPath(), 'icons', iconName);
    assert.ok(fs.existsSync(icon));
    return Uri.file(icon);
}
