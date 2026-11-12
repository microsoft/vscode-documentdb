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
        /** Per `sequence` assertion name: when each milestone first matched, in ms since page load. */
        __scenarioTimeline: Record<string, (number | null)[]>;
    }
}

export function visible(element: Element): boolean {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
}

export function readinessHolds(scenario: Scenario): boolean {
    const text = document.body.innerText.replace(/\s+/g, ' ');
    return (
        scenario.readiness.content.every((content): boolean => text.includes(content.replace(/\s+/g, ' '))) &&
        (scenario.readiness.selectors ?? []).every((selector): boolean =>
            [...document.querySelectorAll(selector)].some(visible),
        ) &&
        (!scenario.readiness.noProgressbar || ![...document.querySelectorAll('[role="progressbar"]')].some(visible))
    );
}

/** Notes the first time each `sequence` milestone matches; DOM mutations trigger this, so it is prompt. */
function recordMilestones(data: Scenario, timeline: Record<string, (number | null)[]>): void {
    for (const assertion of data.assertions ?? []) {
        if (assertion.kind !== 'sequence') continue;
        const times = (timeline[assertion.name] ??= assertion.milestones.map((): null => null));
        assertion.milestones.forEach((selector, index): void => {
            if (times[index] === null && document.querySelector(selector)) times[index] = performance.now();
        });
    }
}

export function installScenario(route: ScenarioRoute, data: Scenario): void {
    const errors = window.__harnessErrors;
    window.acquireVsCodeApi = fakeVsCodeApi(data.rpc, errors);
    const timeline: Record<string, (number | null)[]> = {};
    window.__scenarioTimeline = timeline;
    const check = (): void => {
        recordMilestones(data, timeline);
        document.documentElement.dataset.ready = errors.length ? 'failed' : readinessHolds(data) ? 'true' : 'pending';
    };
    window.__scenario = { route, data, check };
    // Poll as well as observing DOM mutations: layout/animations and shared-core errors can change
    // without a DOM mutation. Keep monitoring after ready; a late error must still fail the page.
    const timer = setInterval(check, 50);
    const observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true });
    window.addEventListener(
        'pagehide',
        (): void => {
            clearInterval(timer);
            observer.disconnect();
        },
        { once: true },
    );
    check();
}
