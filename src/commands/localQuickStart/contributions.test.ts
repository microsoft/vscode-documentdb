/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Contribution-manifest regression tests for Local Quick Start (#851, #852).
 *
 * These two defects live in data, not in code paths, so no amount of service-level testing catches
 * them: #851 was a MISSING `contributes.menus.commandPalette` entry, and #852 was a user-facing
 * string that never reached `l10n/bundle.l10n.json` because it bypassed `l10n.t()`. Both are
 * asserted against the shipped manifests directly.
 */

import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');

function readJson<T>(relativePath: string): T {
    return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8')) as T;
}

interface PackageManifest {
    contributes: {
        commands: Array<{ command: string }>;
        menus: { commandPalette: Array<{ command: string; when?: string }> };
    };
}

describe('Local Quick Start command contributions (#851)', () => {
    const manifest = readJson<PackageManifest>('package.json');
    const quickStartCommands = manifest.contributes.commands
        .map((entry) => entry.command)
        .filter((command) => command.includes('localQuickStart'));
    const paletteEntries = new Map(
        manifest.contributes.menus.commandPalette.map((entry) => [entry.command, entry.when]),
    );

    /** Guards the list itself: a new command added without a decision here should fail. */
    it('contributes exactly the commands this test reasons about', () => {
        expect(quickStartCommands.sort()).toEqual(
            [
                'vscode-documentdb.command.localQuickStart.copyConnectionString',
                'vscode-documentdb.command.localQuickStart.copyPassword',
                'vscode-documentdb.command.localQuickStart.delete',
                'vscode-documentdb.command.localQuickStart.open',
                'vscode-documentdb.command.localQuickStart.restart',
                'vscode-documentdb.command.localQuickStart.start',
                'vscode-documentdb.command.localQuickStart.stop',
                'vscode-documentdb.command.localQuickStart.viewLogs',
            ].sort(),
        );
    });

    // Every one of these acts on the instance selected in the Connections view. Run from the
    // palette there is nothing in context, so they used to run their pipeline, find nothing, and
    // return in silence — no notification, no error, no log line.
    it.each([
        'vscode-documentdb.command.localQuickStart.start',
        'vscode-documentdb.command.localQuickStart.stop',
        'vscode-documentdb.command.localQuickStart.restart',
        'vscode-documentdb.command.localQuickStart.delete',
        'vscode-documentdb.command.localQuickStart.copyConnectionString',
        'vscode-documentdb.command.localQuickStart.copyPassword',
        'vscode-documentdb.command.localQuickStart.viewLogs',
    ])('hides %s from the Command Palette', (command) => {
        expect(paletteEntries.get(command)).toBe('never');
    });

    /** The entry point must STAY reachable — hiding everything would be its own bug. */
    it('keeps the Quick Start entry point in the Command Palette', () => {
        expect(paletteEntries.has('vscode-documentdb.command.localQuickStart.open')).toBe(false);
    });
});

describe('Local Quick Start localized strings (#852)', () => {
    const bundle = readJson<Record<string, unknown>>('l10n/bundle.l10n.json');

    // The extractor only picks up strings wrapped in `l10n.t()`, so presence in the bundle is
    // proof the call goes through localization rather than a raw template literal.
    it.each([
        'Port {0} is already in use. Choose a different port or free it, then retry.',
        'Port {0} was busy, using {1} instead.',
        'Docker CLI was not found on your PATH. Install Docker and retry.',
        'Docker is installed but the daemon is not reachable. Start Docker and retry.',
        'DocumentDB Local is running on localhost:{0}.',
        'Setup is already in progress.',
        'Setup was cancelled.',
    ])('extracts %s for translation', (message) => {
        expect(Object.keys(bundle)).toContain(message);
    });

    /**
     * The old wording claimed the whole 100-port band had been checked when the search sampled at
     * most eleven of it. Nothing should reintroduce that claim.
     */
    it('never claims a whole port range was checked', () => {
        const offenders = Object.keys(bundle).filter((key) => /ports .*are all in use/i.test(key));
        expect(offenders).toEqual([]);
    });
});
