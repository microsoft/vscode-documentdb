/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type WebviewName } from '../../../src/webviews/_integration/WebviewRegistry';
import { type render } from '../../../src/webviews/index';
import { type Scenario, type ScenarioRoute } from './scenarios';
import { installScenario } from './scenario-runtime';

interface InitialData {
    readonly initialData: string;
    readonly l10n: Record<string, string>;
    readonly viewType: WebviewName;
}

function readJson<T>(id: string): T {
    const element = document.getElementById(id);
    if (!element?.textContent) {
        throw new Error(`L2-dev data block missing: ${id}`);
    }
    // Data is emitted only by the typed serve-only plugin, not accepted from a query or user input.
    return JSON.parse(element.textContent) as T;
}

interface ViewEntry {
    readonly render: typeof render;
}

function isViewEntry(value: unknown): value is ViewEntry {
    return typeof value === 'object' && value !== null && 'render' in value && typeof value.render === 'function';
}

async function boot(): Promise<void> {
    const { route, scenario } = readJson<{ route: ScenarioRoute; scenario: Scenario }>('l2-dev-scenario');
    installScenario(route, scenario);
    const initial = readJson<InitialData>('vscode-ext-webview-initial-data');
    globalThis.l10n_bundle = initial.l10n;
    window.config = { ...window.config, __initialData: initial.initialData };
    const entry = '/views.js';
    const module: unknown = await import(/* @vite-ignore */ entry);
    if (!isViewEntry(module)) throw new Error('L2-dev /views.js does not export render');
    module.render(initial.viewType, window.acquireVsCodeApi());
}

void boot().catch((error: unknown): void => { console.error(error); });
