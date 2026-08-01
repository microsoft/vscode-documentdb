/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * EXPERIMENT (dev/tnaum/quickstart-brainstorm).
 *
 * Command entry points for the Local Quick Start layout prototypes. Delete this
 * file, its `package.json` command entries, and its registrations in
 * `ClustersExtension` once a layout is chosen.
 */

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import {
    openQuickStartPrototypeWebview,
    type QuickStartPrototype,
} from '../../webviews/documentdb/localQuickStart/prototypes/quickStartPrototypeController';

function open(prototype: QuickStartPrototype): void {
    const view = openQuickStartPrototypeWebview(prototype);
    view.revealToForeground(view.panel.viewColumn ?? vscode.ViewColumn.Active);
}

export function openQuickStartPrototypeExpress(_context: IActionContext): void {
    open('express');
}

export function openQuickStartPrototypeWizard(_context: IActionContext): void {
    open('wizard');
}

export function openQuickStartPrototypeGuided(_context: IActionContext): void {
    open('guided');
}

interface PrototypePick extends vscode.QuickPickItem {
    readonly prototype?: QuickStartPrototype;
}

/** One entry point that offers all layouts side by side, for a review session. */
export async function pickQuickStartPrototype(context: IActionContext): Promise<void> {
    const items: PrototypePick[] = [
        {
            label: `$(rocket) ${vscode.l10n.t('A — Express')}`,
            description: vscode.l10n.t('One page, no navigation'),
            detail: vscode.l10n.t('A single action slot swaps between ready, running, and done. Zero decisions.'),
            prototype: 'express',
        },
        {
            label: `$(list-ordered) ${vscode.l10n.t('B — Wizard')}`,
            description: vscode.l10n.t('MongoDB Atlas style'),
            detail: vscode.l10n.t('Step breadcrumb plus a pinned footer: Check Docker → Configure → Set up → Done.'),
            prototype: 'wizard',
        },
        {
            label: `$(layout) ${vscode.l10n.t('C — Guided')}`,
            description: vscode.l10n.t('One page, wizard chrome'),
            detail: vscode.l10n.t('A non-clickable progress rail and a pinned action bar, but no step navigation.'),
            prototype: 'guided',
        },
        {
            label: `$(circle-outline) ${vscode.l10n.t('Current')}`,
            description: vscode.l10n.t('Shipping layout'),
            detail: vscode.l10n.t('The Quick Start view as it exists today, for comparison.'),
        },
    ];

    const picked = await vscode.window.showQuickPick(items, {
        title: vscode.l10n.t('Local Quick Start — layout prototypes'),
        placeHolder: vscode.l10n.t('Choose a layout to open'),
    });
    if (!picked) {
        context.telemetry.properties.result = 'Canceled';
        return;
    }
    context.telemetry.properties.prototype = picked.prototype ?? 'current';
    if (picked.prototype) {
        open(picked.prototype);
    } else {
        await vscode.commands.executeCommand('vscode-documentdb.command.localQuickStart.open');
    }
}
