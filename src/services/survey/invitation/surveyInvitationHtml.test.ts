/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { JSDOM } from 'jsdom';
import { buildSurveyInvitationHtml, type SurveyInvitationStrings } from './surveyInvitationHtml';

const { window } = new JSDOM();
const { DOMParser } = window;

const strings: SurveyInvitationStrings = {
    language: 'en',
    title: 'DocumentDB',
    question: 'Overall, how satisfied are you with DocumentDB for VS Code?',
    stars: ['Very dissatisfied', 'Dissatisfied', 'Neutral', 'Satisfied', 'Very satisfied'],
    openSurvey: 'Continue to survey',
    browserNote: "You'll answer this question in the external form in your browser.",
    englishNote: 'The survey is in English.',
    askLater: 'Ask me later',
    neverAgain: 'Never again',
    why: 'Why am I seeing this?',
    usage: "You've used DocumentDB for VS Code on {0} days with meaningful extension use. This count stays on your device.",
    reminders: {
        opened: 'The waiting period after opening the survey has passed.',
        askLater: 'You asked us to remind you later. The reminder period has passed.',
        dismissed: 'You closed the previous invitation. The reminder period has passed.',
    },
    telemetry: 'We record the selected rating on opening, but not external form answers or the usage count.',
    privacy: 'Privacy Statement',
};

function html(previousOutcome?: 'opened' | 'askLater' | 'dismissed'): string {
    return buildSurveyInvitationHtml({
        strings,
        nonce: 'test-nonce',
        cspSource: 'vscode-webview:',
        artworkUri: 'vscode-webview://extension/icon.png',
        artworkDarkUri: 'vscode-webview://extension/icon-dark.svg',
        explanation: { activeDayCount: 7, requiredActiveDays: 3, isReminder: !!previousOutcome, previousOutcome },
    });
}

function parseHtml(value: string): Document {
    return new DOMParser().parseFromString(value, 'text/html');
}

function interactiveHtml(): {
    dom: JSDOM;
    messages: unknown[];
    respond: () => void;
} {
    const dom = new JSDOM(html());
    const messages: unknown[] = [];
    // Executes the production inline script in a fresh document.
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const runScript = new Function(
        'acquireVsCodeApi',
        'requestAnimationFrame',
        'document',
        'window',
        dom.window.document.querySelector('script')?.textContent ?? '',
    );
    runScript(
        (): object => ({
            postMessage: (message: unknown): void => {
                messages.push(message);
            },
        }),
        (callback: () => void): void => callback(),
        dom.window.document,
        dom.window,
    );
    return {
        dom,
        messages,
        respond: (): void => {
            dom.window.dispatchEvent(new dom.window.MessageEvent('message', { data: { type: 'openResult' } }));
        },
    };
}

describe('survey invitation HTML', (): void => {
    it('uses a nonce CSP, packaged artwork, theme variables, and no remote resource URLs', (): void => {
        const page = parseHtml(html());
        expect(page.querySelector('meta[http-equiv]')?.getAttribute('content')).toContain("default-src 'none'");
        expect(page.querySelector('meta[http-equiv]')?.getAttribute('content')).toContain(
            "script-src 'nonce-test-nonce'",
        );
        expect(page.querySelector('style')?.getAttribute('nonce')).toBe('test-nonce');
        expect(page.querySelector('script')?.getAttribute('nonce')).toBe('test-nonce');
        expect(html()).not.toMatch(/https?:/);
        expect(html()).toContain('var(--vscode-focusBorder)');
        expect(page.querySelector('img.logo-light')?.getAttribute('src')).toBe('vscode-webview://extension/icon.png');
        expect(page.querySelector('img.logo-dark')?.getAttribute('src')).toBe(
            'vscode-webview://extension/icon-dark.svg',
        );
        const styles = page.querySelector('style')?.textContent ?? '';
        expect(styles).toContain('.logo-dark { display: none; }');
        expect(styles).toContain(
            'body.vscode-dark .logo-dark, body.vscode-high-contrast:not(.vscode-high-contrast-light) .logo-dark { display: block; }',
        );
    });

    it('selects outline stars locally and submits only the checked rating when opening', (): void => {
        const h = interactiveHtml();
        const page = h.dom.window.document;
        const radios = page.querySelectorAll<HTMLInputElement>('input[type="radio"]');
        const open = page.querySelector<HTMLButtonElement>('#open-survey');
        expect(radios).toHaveLength(5);
        expect(page.querySelector(':checked')).toBeNull();
        expect(page.querySelectorAll('.lit')).toHaveLength(0);
        expect(page.querySelectorAll('.star-outline')).toHaveLength(5);
        expect(page.querySelectorAll('.star-fill')).toHaveLength(5);
        radios[3].click();
        expect(radios[3].checked).toBe(true);
        expect(page.querySelectorAll('.lit')).toHaveLength(4);
        expect(h.messages).toEqual([{ type: 'rendered' }]);
        open?.dispatchEvent(new h.dom.window.MouseEvent('mouseenter'));
        expect(page.querySelectorAll('.lit')).toHaveLength(4);

        open?.focus();
        open?.click();
        open?.click();
        expect(h.messages).toEqual([{ type: 'rendered' }, { type: 'openForm', selectedRating: 4 }]);
        expect(open?.getAttribute('aria-disabled')).toBe('true');
        expect(open?.disabled).toBe(false);
        expect(page.activeElement).toBe(open);
        expect([...radios].every((radio): boolean => radio.disabled)).toBe(true);
        h.respond();
        expect(page.querySelectorAll('[data-action="openForm"]')).toHaveLength(1);
        expect(open?.textContent).toBe(strings.openSurvey);
        expect(open?.hasAttribute('aria-disabled')).toBe(false);
        expect([...radios].every((radio): boolean => !radio.disabled)).toBe(true);
        expect(page.activeElement).toBe(open);
        expect(radios[3].checked).toBe(true);
        expect(page.querySelector('#status, [role="status"]')).toBeNull();
        open?.click();
        expect(h.messages.at(-1)).toEqual({ type: 'openForm', selectedRating: 4 });
        h.respond();
        radios[1].click();
        expect(page.querySelectorAll('.lit')).toHaveLength(2);
        open?.click();
        expect(h.messages.at(-1)).toEqual({ type: 'openForm', selectedRating: 2 });
        h.dom.window.close();
    });

    it('opens without a rating and omits the field rather than sending zero', (): void => {
        const h = interactiveHtml();
        h.dom.window.document.querySelector<HTMLButtonElement>('#open-survey')?.click();
        expect(h.messages).toEqual([{ type: 'rendered' }, { type: 'openForm' }]);
        h.dom.window.close();
    });

    it('shows only the hovered or selected rating description, restoring or clearing it on leave', (): void => {
        const h = interactiveHtml();
        const page = h.dom.window.document;
        const label = page.querySelector('#rating-label');
        const stars = page.querySelectorAll<HTMLElement>('.star');
        const radios = page.querySelectorAll<HTMLInputElement>('input[type="radio"]');
        expect(page.querySelector('.endpoints')).toBeNull();
        expect(label?.textContent).toBe('');
        stars[4].dispatchEvent(new h.dom.window.MouseEvent('mouseenter'));
        expect(label?.textContent).toBe('Very satisfied');
        stars[4].dispatchEvent(new h.dom.window.MouseEvent('mouseleave'));
        expect(label?.textContent).toBe('');
        radios[1].click();
        expect(label?.textContent).toBe('Dissatisfied');
        stars[3].dispatchEvent(new h.dom.window.MouseEvent('mouseenter'));
        expect(label?.textContent).toBe('Satisfied');
        stars[3].dispatchEvent(new h.dom.window.MouseEvent('mouseleave'));
        expect(label?.textContent).toBe('Dissatisfied');
        radios[1].click();
        expect(label?.textContent).toBe('');
        expect(h.messages).toEqual([{ type: 'rendered' }]);
        h.dom.window.close();
    });

    it('describes a keyboard-focused rating without selecting it, and clears the text on blur', (): void => {
        const h = interactiveHtml();
        const page = h.dom.window.document;
        const radios = page.querySelectorAll<HTMLInputElement>('input[type="radio"]');
        radios[2].focus();
        expect(page.querySelector('#rating-label')?.textContent).toBe('Neutral');
        expect(radios[2].getAttribute('aria-label')).toBe('3 Neutral');
        expect(page.querySelector(':checked')).toBeNull();
        expect(page.querySelectorAll('.lit')).toHaveLength(0);
        radios[2].blur();
        expect(page.querySelector('#rating-label')?.textContent).toBe('');
        expect(h.messages).toEqual([{ type: 'rendered' }]);
        h.dom.window.close();
    });

    it('previews hover without changing or submitting the committed rating', (): void => {
        const h = interactiveHtml();
        const page = h.dom.window.document;
        const stars = page.querySelectorAll<HTMLElement>('.star');
        const radios = page.querySelectorAll<HTMLInputElement>('input[type="radio"]');
        const hover = (index: number): void => {
            stars[index].dispatchEvent(new h.dom.window.MouseEvent('mouseenter'));
        };
        const leave = (index: number): void => {
            stars[index].dispatchEvent(new h.dom.window.MouseEvent('mouseleave'));
        };
        hover(4);
        expect(page.querySelectorAll('.lit')).toHaveLength(5);
        expect(page.querySelector(':checked')).toBeNull();
        leave(4);
        expect(page.querySelectorAll('.lit')).toHaveLength(0);
        radios[1].click();
        hover(3);
        expect(page.querySelectorAll('.lit')).toHaveLength(4);
        expect(radios[1].checked).toBe(true);
        leave(3);
        expect(page.querySelectorAll('.lit')).toHaveLength(2);
        hover(4);
        expect(h.messages).toEqual([{ type: 'rendered' }]);
        page.querySelector<HTMLButtonElement>('#open-survey')?.click();
        expect(h.messages.at(-1)).toEqual({ type: 'openForm', selectedRating: 2 });
        expect(page.querySelectorAll('.lit')).toHaveLength(2);
        hover(0);
        expect(page.querySelectorAll('.lit')).toHaveLength(2);
        h.dom.window.close();
    });

    it.each([0, 1, 2, 3, 4])(
        'clears selected star %i on repeat activation, including the next opening payload',
        (index): void => {
            const h = interactiveHtml();
            const page = h.dom.window.document;
            const radios = page.querySelectorAll<HTMLInputElement>('input[type="radio"]');
            const star = page.querySelectorAll<HTMLElement>('.star')[index];
            radios[index].click();
            radios[index].focus();
            star.dispatchEvent(new h.dom.window.MouseEvent('mouseenter'));
            radios[index].click();
            expect(page.querySelector(':checked')).toBeNull();
            expect(page.querySelectorAll('.lit')).toHaveLength(0);
            expect(page.activeElement).toBe(radios[index]);
            expect(h.messages).toEqual([{ type: 'rendered' }]);
            star.dispatchEvent(new h.dom.window.MouseEvent('mouseleave'));
            star.dispatchEvent(new h.dom.window.MouseEvent('mouseenter'));
            page.querySelector<HTMLButtonElement>('#open-survey')?.click();
            expect(h.messages.at(-1)).toEqual({ type: 'openForm' });
            expect(page.querySelectorAll('.lit')).toHaveLength(0);
            h.respond();
            radios[index].click();
            expect(radios[index].checked).toBe(true);
            expect(page.querySelectorAll('.lit')).toHaveLength(index + 1);
            h.dom.window.close();
        },
    );

    it('synchronizes native keyboard change events before toggle-to-clear', (): void => {
        const h = interactiveHtml();
        const page = h.dom.window.document;
        const radios = page.querySelectorAll<HTMLInputElement>('input[type="radio"]');
        radios[0].click();
        radios[1].checked = true;
        radios[1].dispatchEvent(new h.dom.window.Event('change', { bubbles: true }));
        expect(page.querySelectorAll('.lit')).toHaveLength(2);
        radios[1].click();
        expect(page.querySelector(':checked')).toBeNull();
        expect(page.querySelectorAll('.lit')).toHaveLength(0);
        expect(h.messages).toEqual([{ type: 'rendered' }]);
        h.dom.window.close();
    });

    it('uses Space to select and clear without toggling on held-key repeats', (): void => {
        const h = interactiveHtml();
        const page = h.dom.window.document;
        const radio = page.querySelectorAll<HTMLInputElement>('input[type="radio"]')[2];
        radio.focus();
        const pressSpace = (repeat = false): void => {
            const event = new h.dom.window.KeyboardEvent('keydown', {
                key: ' ',
                repeat,
                bubbles: true,
                cancelable: true,
            });
            radio.dispatchEvent(event);
            expect(event.defaultPrevented).toBe(true);
        };
        pressSpace();
        expect(radio.checked).toBe(true);
        pressSpace(true);
        expect(radio.checked).toBe(true);
        pressSpace();
        expect(page.querySelector(':checked')).toBeNull();
        expect(page.querySelectorAll('.lit')).toHaveLength(0);
        pressSpace(true);
        expect(page.querySelector(':checked')).toBeNull();
        expect(page.activeElement).toBe(radio);
        expect(h.messages).toEqual([{ type: 'rendered' }]);
        h.dom.window.close();
    });

    it.each(['askLater', 'neverAgain', 'privacy'])('does not include a selected rating on %s', (action): void => {
        const h = interactiveHtml();
        h.dom.window.document.querySelector<HTMLInputElement>('input[value="5"]')?.click();
        h.dom.window.document.querySelector<HTMLElement>(`[data-action="${action}"]`)?.click();
        expect(h.messages).toEqual([{ type: 'rendered' }, { type: action }]);
        h.dom.window.close();
    });

    it('does not steal focus if the user moves to the privacy link during an opening attempt', (): void => {
        const h = interactiveHtml();
        const page = h.dom.window.document;
        const open = page.querySelector<HTMLButtonElement>('#open-survey');
        const privacy = page.querySelector<HTMLAnchorElement>('[data-action="privacy"]');
        open?.focus();
        open?.click();
        privacy?.focus();
        h.respond();
        expect(page.activeElement).toBe(privacy);
        h.dom.window.close();
    });

    it('uses a dashboard-sized full-width header above editor-background content', (): void => {
        const page = parseHtml(html());
        const styles = page.querySelector('style')?.textContent ?? '';
        expect(page.querySelector('main > header > .identity > h1')?.textContent).toBe(strings.title);
        expect(page.querySelector('main > header + .content > h2:first-child')?.textContent).toBe(strings.question);
        expect(page.querySelector('.invitation')).toBeNull();
        expect(page.querySelectorAll('.content h2')).toHaveLength(1);
        expect(page.querySelector('h3')).toBeNull();
        expect(page.querySelector('.content [data-action="openForm"]')).not.toBeNull();
        expect(styles).toContain('background: var(--vscode-editor-background)');
        expect(styles).toContain(
            'background: var(--vscode-tree-tableOddRowsBackground, var(--vscode-sideBar-background, var(--vscode-editorWidget-background)))',
        );
        expect(styles).toContain('width: 36px; height: 36px');
        expect(styles).toContain('font-size: 18px; font-weight: 600; line-height: 24px');
        expect(styles).toContain('header { padding: 8px 16px;');
        expect(styles).toContain('gap: 12px;');
        expect(styles).toContain('.content { max-width: 480px; margin: 0 auto; padding: 24px 16px; }');
        expect(styles).toContain('.star-icon { width: 20px; height: 20px; }');
        expect(styles).toContain('.primary { width: 100%; margin-top: 16px; }');
        expect(styles).toContain(
            '.secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground);',
        );
        expect(styles).toContain('summary { cursor: pointer; font-weight: 400; }');
    });

    it('centers a compact rating between the note and its action, and stretches the choices', (): void => {
        const styles = parseHtml(html()).querySelector('style')?.textContent ?? '';
        expect(styles).toContain('grid-template-columns: repeat(5, 32px); gap: 4px; justify-content: center;');
        expect(styles).toContain('.rating-label { min-height: 18px; text-align: center;');
        // Space above the stars (operator-tuned 34 px) vs. the label slot + gap below (4 + 18 + 16 px).
        expect(styles).toContain('.rating-note { margin: 4px 0 0; }');
        expect(styles).toContain('justify-content: center; margin-top: 34px; }');
        expect(styles).toMatch(/\.rating-label \{ min-height: 18px;[^}]*margin-top: 4px; \}/);
        expect(styles).toContain('.primary { width: 100%; margin-top: 16px; }');
        expect(styles).toContain('.choices button { flex: 1 1 140px; }');
        expect(styles).toContain('.note { color: var(--vscode-descriptionForeground); font-size: 12px;');
        expect(styles).not.toMatch(/font-size: 0\.\d+em/);
    });

    it('names every control, uses native disclosure, and explains English without an opt-out note', (): void => {
        const page = parseHtml(html());
        for (const control of page.querySelectorAll('button, input, summary, a')) {
            expect(control.getAttribute('aria-label') || control.textContent?.trim()).toBeTruthy();
        }
        expect(page.querySelector('details > summary')?.textContent).toBe(strings.why);
        expect(page.body.textContent).toContain(strings.englishNote);
        expect(page.querySelectorAll('.note')).toHaveLength(1);
        expect(page.querySelector('[role="radiogroup"]')?.getAttribute('aria-labelledby')).toBe('survey-question');
        expect(page.querySelector('input[required], input[checked]')).toBeNull();
        expect(page.querySelector('.note + .stars')).not.toBeNull();
        expect(page.querySelector('.rating-note')?.textContent).toBe(`${strings.browserNote} ${strings.englishNote}`);
        expect(page.querySelector('.rating-note')?.textContent).not.toContain('telemetry');
        expect(page.querySelector('details')?.textContent).toContain(strings.telemetry);
        expect(page.querySelector('[autofocus]')).toBeNull();
        expect(html()).not.toMatch(/getState|setState/);
    });

    it.each([undefined, 'opened', 'askLater', 'dismissed'] as const)(
        'uses the actual count and reminder reason %s without release copy',
        (outcome): void => {
            const page = parseHtml(html(outcome));
            expect(page.querySelector('details')?.textContent).toContain('on 7 days');
            if (outcome) expect(page.querySelector('details')?.textContent).toContain(strings.reminders[outcome]);
            else expect(page.querySelector('details')?.textContent).not.toContain('period has passed');
            expect(page.body.textContent).not.toMatch(/release|version|anonymized/i);
        },
    );

    it('replaces every usage-count placeholder in localized copy', (): void => {
        const output = buildSurveyInvitationHtml({
            strings: { ...strings, usage: '{0} days; local count: {0}.' },
            nonce: 'nonce',
            cspSource: 'local:',
            artworkUri: 'local:icon',
            artworkDarkUri: 'local:icon-dark',
            explanation: { activeDayCount: 7, requiredActiveDays: 3, isReminder: false, previousOutcome: undefined },
        });
        expect(parseHtml(output).querySelector('details')?.textContent).toContain('7 days; local count: 7.');
        expect(output).not.toContain('{0}');
    });

    it('escapes localized content and attribute values', (): void => {
        const output = buildSurveyInvitationHtml({
            strings: { ...strings, title: '<script>bad</script>', stars: ['" onclick="bad'] },
            nonce: 'nonce',
            cspSource: 'local:',
            artworkUri: 'local:icon',
            artworkDarkUri: 'local:icon-dark',
            explanation: { activeDayCount: 3, requiredActiveDays: 3, isReminder: false, previousOutcome: undefined },
        });
        const page = parseHtml(output);
        expect(page.querySelectorAll('script')).toHaveLength(1);
        expect(page.querySelector('h1')?.textContent).toBe('<script>bad</script>');
        expect(page.querySelector('[onclick]')).toBeNull();
    });
});
