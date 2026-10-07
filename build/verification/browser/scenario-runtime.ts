/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { fakeVsCodeApi } from './core/fakeVsCodeApi';
import { type Scenario, type ScenarioRoute } from './scenarios';

declare global {
    interface Window {
        __harnessErrors: string[];
        __scenario: { readonly route: ScenarioRoute; readonly data: Scenario; readonly check: () => void };
    }
}

export function visible(element: Element): boolean {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.visibility !== 'hidden' && style.display !== 'none' &&
        rect.width > 0 && rect.height > 0;
}

export function readinessHolds(scenario: Scenario): boolean {
    const text = document.body.innerText.replace(/\s+/g, ' ');
    return scenario.readiness.content.every((content): boolean => text.includes(content.replace(/\s+/g, ' '))) &&
        (scenario.readiness.selectors ?? []).every((selector): boolean =>
            [...document.querySelectorAll(selector)].some(visible)) &&
        (!scenario.readiness.noProgressbar || ![...document.querySelectorAll('[role="progressbar"]')].some(visible));
}

export function installScenario(route: ScenarioRoute, data: Scenario): void {
    const errors = window.__harnessErrors;
    window.acquireVsCodeApi = fakeVsCodeApi(data.rpc, errors);
    const check = (): void => {
        document.documentElement.dataset.ready = errors.length ? 'failed' : readinessHolds(data) ? 'true' : 'pending';
    };
    window.__scenario = { route, data, check };
    // Poll as well as observing DOM mutations: layout/animations and shared-core errors can change
    // without a DOM mutation. Keep monitoring after ready; a late error must still fail the page.
    const timer = setInterval(check, 50);
    const observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true });
    window.addEventListener('pagehide', (): void => {
        clearInterval(timer);
        observer.disconnect();
    }, { once: true });
    check();
}
