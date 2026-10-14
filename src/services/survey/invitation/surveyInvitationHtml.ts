/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type SurveyEligibilityExplanation } from '../surveyTypes';

export interface SurveyInvitationStrings {
    readonly language: string;
    readonly title: string;
    readonly question: string;
    readonly stars: readonly string[];
    readonly openSurvey: string;
    readonly browserNote: string;
    readonly englishNote: string;
    readonly askLater: string;
    readonly neverAgain: string;
    readonly why: string;
    readonly usage: string;
    readonly reminders: Readonly<Record<'opened' | 'askLater' | 'dismissed', string>>;
    readonly telemetry: string;
    readonly privacy: string;
}

export interface SurveyInvitationHtmlOptions {
    readonly explanation: SurveyEligibilityExplanation;
    readonly strings: SurveyInvitationStrings;
    readonly nonce: string;
    readonly cspSource: string;
    readonly artworkUri: string;
    /** Variant with a light database glyph for dark and high-contrast dark themes. */
    readonly artworkDarkUri: string;
}

// Fluent System Icons (MIT), Star24Regular / Star24Filled.
const starOutlinePath =
    'M10.79 3.1c.5-1 1.92-1 2.42 0l2.36 4.78 5.27.77c1.1.16 1.55 1.52.75 2.3l-3.82 3.72.9 5.25a1.35 1.35 0 0 1-1.96 1.42L12 18.86l-4.72 2.48a1.35 1.35 0 0 1-1.96-1.42l.9-5.25-3.81-3.72c-.8-.78-.36-2.14.75-2.3l5.27-.77 2.36-4.78Zm1.2.94L9.75 8.6c-.2.4-.58.68-1.02.74l-5.05.74 3.66 3.56c.32.3.46.76.39 1.2l-.87 5.02 4.52-2.37c.4-.2.86-.2 1.26 0l4.51 2.37-.86-5.03c-.07-.43.07-.88.39-1.2l3.65-3.55-5.05-.74a1.35 1.35 0 0 1-1.01-.74L12 4.04Z';
const starFilledPath =
    'M10.79 3.1c.5-1 1.92-1 2.42 0l2.36 4.78 5.27.77c1.1.16 1.55 1.52.75 2.3l-3.82 3.72.9 5.25a1.35 1.35 0 0 1-1.96 1.42L12 18.86l-4.72 2.48a1.35 1.35 0 0 1-1.96-1.42l.9-5.25-3.81-3.72c-.8-.78-.36-2.14.75-2.3l5.27-.77 2.36-4.78Z';

function escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, (character): string => {
        const entities: Record<string, string> = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;',
        };
        return entities[character];
    });
}

export function buildSurveyInvitationHtml(options: SurveyInvitationHtmlOptions): string {
    const { explanation, strings, nonce, cspSource, artworkUri, artworkDarkUri } = options;
    const text = escapeHtml;
    const usage = strings.usage.replaceAll('{0}', String(explanation.activeDayCount));
    const reminder =
        explanation.isReminder && explanation.previousOutcome
            ? `<p>${text(strings.reminders[explanation.previousOutcome])}</p>`
            : '';
    const stars = strings.stars
        .map(
            (label, index): string =>
                `<label class="star"><input class="rating-input" type="radio" name="rating" value="${index + 1}" aria-label="${index + 1} ${text(label)}" data-rating-label="${text(label)}"><svg class="star-icon" viewBox="0 0 24 24" aria-hidden="true"><path class="star-fill" d="${starFilledPath}"></path><path class="star-outline" d="${starOutlinePath}"></path></svg></label>`,
        )
        .join('');
    return `<!DOCTYPE html>
<html lang="${text(strings.language)}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${text(cspSource)}; style-src 'nonce-${text(nonce)}'; script-src 'nonce-${text(nonce)}'; base-uri 'none'; form-action 'none';">
<title>${text(strings.title)}</title>
<style nonce="${text(nonce)}">
* { box-sizing: border-box; }
body { margin: 0; padding: 0; color: var(--vscode-editor-foreground, var(--vscode-foreground)); background: var(--vscode-editor-background); font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); line-height: 1.5; overflow-wrap: anywhere; }
main { min-height: 100vh; }
header { padding: 8px 16px; background: var(--vscode-tree-tableOddRowsBackground, var(--vscode-sideBar-background, var(--vscode-editorWidget-background))); border-bottom: 1px solid var(--vscode-panel-border, var(--vscode-widget-border, var(--vscode-editorWidget-border))); }
.identity { display: flex; align-items: center; gap: 12px; max-width: 448px; margin: 0 auto; }
img { flex: 0 0 auto; width: 36px; height: 36px; object-fit: contain; }
.logo-dark { display: none; }
body.vscode-dark .logo-light, body.vscode-high-contrast:not(.vscode-high-contrast-light) .logo-light { display: none; }
body.vscode-dark .logo-dark, body.vscode-high-contrast:not(.vscode-high-contrast-light) .logo-dark { display: block; }
h1 { flex: 1 1 auto; min-width: 0; font-size: 18px; font-weight: 600; line-height: 24px; margin: 0; }
.content { max-width: 480px; margin: 0 auto; padding: 24px 16px; }
h2 { font-size: 16px; font-weight: 600; line-height: 24px; margin: 0; }
p { margin: 8px 0; }
.note { color: var(--vscode-descriptionForeground); font-size: 12px; line-height: 16px; margin: 8px 0; }
.rating-note { margin: 4px 0 0; }
.stars { display: grid; grid-template-columns: repeat(5, 32px); gap: 4px; justify-content: center; margin-top: 34px; }
.star { position: relative; display: flex; align-items: center; justify-content: center; height: 32px; color: var(--vscode-foreground); cursor: pointer; }
.rating-input { position: absolute; width: 1px; height: 1px; opacity: 0; }
.star-icon { width: 20px; height: 20px; }
.star-outline { fill: currentColor; }
.star-fill { fill: #ffb900; display: none; }
.star.lit .star-fill { display: block; }
.star:has(input:disabled) { opacity: .65; cursor: default; }
.rating-label { min-height: 18px; text-align: center; color: var(--vscode-descriptionForeground); font-size: 12px; margin-top: 4px; }
button { font: inherit; font-weight: 600; line-height: 20px; min-height: 32px; color: var(--vscode-button-foreground); background: var(--vscode-button-background); border: 1px solid var(--vscode-button-border, var(--vscode-contrastBorder, transparent)); border-radius: 4px; padding: 5px 12px; cursor: pointer; white-space: normal; overflow-wrap: anywhere; min-width: 0; transition: background-color .1s cubic-bezier(.33,0,.67,1), color .1s; }
button:hover { background: var(--vscode-button-hoverBackground); }
button:disabled, button[aria-disabled="true"] { opacity: .65; cursor: default; }
.primary { width: 100%; margin-top: 16px; }
.choices { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
.choices button { flex: 1 1 140px; }
.secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); font-weight: 400; }
.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
details { margin-top: 24px; }
summary { cursor: pointer; font-weight: 400; }
details p { color: var(--vscode-descriptionForeground); font-size: 12px; line-height: 16px; }
details a { font-size: 12px; }
a { color: var(--vscode-textLink-foreground); }
a:hover { color: var(--vscode-textLink-activeForeground); }
button:focus-visible, .star:has(input:focus-visible), summary:focus-visible, a:focus-visible { outline: 2px solid var(--vscode-focusBorder); outline-offset: 2px; border-radius: 4px; }
</style>
</head>
<body><main>
<header><div class="identity"><img class="logo-light" src="${text(artworkUri)}" alt=""><img class="logo-dark" src="${text(artworkDarkUri)}" alt=""><h1>${text(strings.title)}</h1></div></header>
<div class="content">
<h2 id="survey-question">${text(strings.question)}</h2>
<p class="note rating-note">${text(strings.browserNote)} ${text(strings.englishNote)}</p>
<div class="stars" role="radiogroup" aria-labelledby="survey-question">${stars}</div>
<div id="rating-label" class="rating-label"></div>
<button id="open-survey" class="primary" type="button" data-action="openForm">${text(strings.openSurvey)}</button>
<div class="choices">
<button class="secondary" type="button" data-action="askLater">${text(strings.askLater)}</button>
<button class="secondary" type="button" data-action="neverAgain">${text(strings.neverAgain)}</button>
</div>
<details><summary>${text(strings.why)}</summary><p>${text(usage)}</p>${reminder}<p>${text(strings.telemetry)}</p><a href="#" data-action="privacy">${text(strings.privacy)}</a></details>
</div>
</main>
<script nonce="${text(nonce)}">
const vscode = acquireVsCodeApi();
const controls = [...document.querySelectorAll('button[data-action], input[name="rating"]')];
const stars = [...document.querySelectorAll('.star')];
const ratingInputs = [...document.querySelectorAll('input[name="rating"]')];
const ratingLabel = document.getElementById('rating-label');
const openButton = document.getElementById('open-survey');
let selectedRating;
let hoveredRating;
let focusedRating;
let busy = false;
const renderRating = () => {
    const count = hoveredRating ?? selectedRating ?? 0;
    stars.forEach((star, index) => star.classList.toggle('lit', index < count));
    const labelRating = hoveredRating ?? selectedRating ?? focusedRating;
    ratingLabel.textContent = labelRating ? ratingInputs[labelRating - 1].dataset.ratingLabel : '';
};
stars.forEach((star, index) => {
    star.addEventListener('mouseenter', () => {
        if (busy) return;
        hoveredRating = index + 1;
        renderRating();
    });
    star.addEventListener('mouseleave', () => {
        hoveredRating = undefined;
        renderRating();
    });
});
ratingInputs.forEach(input => {
    input.addEventListener('focus', () => {
        if (busy) return;
        focusedRating = Number(input.value);
        renderRating();
    });
    input.addEventListener('blur', () => {
        focusedRating = undefined;
        renderRating();
    });
    input.addEventListener('keydown', event => {
        if (event.key === ' ') {
            event.preventDefault();
            if (!event.repeat) input.click();
        }
    });
    input.addEventListener('click', () => {
        const value = Number(input.value);
        selectedRating = selectedRating === value ? undefined : value;
        input.checked = selectedRating !== undefined;
        hoveredRating = undefined;
        focusedRating = undefined;
        renderRating();
    });
    input.addEventListener('change', () => {
        const selected = ratingInputs.find(radio => radio.checked);
        selectedRating = selected ? Number(selected.value) : undefined;
        hoveredRating = undefined;
        focusedRating = undefined;
        renderRating();
    });
});
document.querySelectorAll('[data-action]').forEach(control => {
    control.addEventListener('click', event => {
        event.preventDefault();
        const action = control.dataset.action;
        const message = { type: action };
        if (action !== 'privacy') {
            if (busy) return;
            busy = true;
            hoveredRating = undefined;
            focusedRating = undefined;
            renderRating();
            if (action === 'openForm') {
                const selected = ratingInputs.find(input => input.checked);
                if (selected) message.selectedRating = Number(selected.value);
            }
            controls.forEach(element => {
                if (element === openButton && action === 'openForm') {
                    element.setAttribute('aria-disabled', 'true');
                } else {
                    element.disabled = true;
                }
            });
        }
        vscode.postMessage(message);
    });
});
window.addEventListener('message', event => {
    if (!event.data || event.data.type !== 'openResult') return;
    busy = false;
    controls.forEach(control => { control.disabled = false; });
    openButton.removeAttribute('aria-disabled');
});
requestAnimationFrame(() => requestAnimationFrame(() => vscode.postMessage({ type: 'rendered' })));
</script>
</body></html>`;
}
