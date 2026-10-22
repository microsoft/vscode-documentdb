/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { GetPerformanceInsightsCard } from './components/optimizationCards/custom/GetPerformanceInsightsCard';

vi.mock('@vscode/l10n', () => ({ t: (message: string): string => message }));

describe('GetPerformanceInsightsCard model disclosure', () => {
    function render(mayUsePremiumRequests?: boolean, isLoading = false): string {
        return renderToStaticMarkup(
            <GetPerformanceInsightsCard
                bodyText="Analysis"
                isLoading={isLoading}
                onGetInsights={vi.fn()}
                onLearnMore={vi.fn()}
                onCancel={vi.fn()}
                onLearnMoreUtilityModel={vi.fn()}
                mayUsePremiumRequests={mayUsePremiumRequests}
                modelPicker={<span>Model picker slot</span>}
                secondaryLink={<span>Secondary link slot</span>}
            />,
        );
    }

    it('preserves the existing utility disclosure by default and renders optional slots', () => {
        const html = render();
        expect(html).toContain('No additional cost for most GitHub Copilot subscribers.');
        expect(html).toContain('Learn more about the utility model used.');
        expect(html).toContain('Model picker slot');
        expect(html).toContain('Secondary link slot');
        expect(html).not.toContain('The selected model may use premium requests.');
    });

    it('discloses premium requests without claiming that a non-utility model is free', () => {
        const html = render(true);
        expect(html).toContain('The selected model may use premium requests.');
        expect(html).not.toContain('No additional cost');
        expect(html).not.toContain('Learn more about the utility model used.');
    });

    it.each([false, true])('puts the model picker before the action, then one footer line (premium: %s)', (premium) => {
        const container = document.createElement('div');
        container.innerHTML = render(premium);
        const actions = container.querySelector('.get-performance-insights-card-actions');
        expect([...(actions?.children ?? [])].map((child) => child.textContent)).toEqual([
            'Model picker slot',
            'Get AI Performance Insights',
        ]);
        const footer = container.querySelector('.get-performance-insights-card-meta');
        const footerText = footer?.textContent ?? '';
        expect(footerText.startsWith(premium
            ? 'The selected model may use premium requests.'
            : 'No additional cost for most GitHub Copilot subscribers.')).toBe(true);
        expect(footerText).toContain('AI responses may be inaccurate');
        expect(footerText).toContain('Secondary link slot');
        expect(footer?.lastElementChild?.textContent).toBe('Learn more about AI Performance Insights');
        expect(container.querySelector('.fui-CardHeader')?.textContent).not.toContain('inaccurate');
        expect(container.textContent).not.toMatch(/prompt/i);
    });

    it('keeps the footer visible but hides the picker during loading', () => {
        const html = render(false, true);
        expect(html).toContain('Cancel');
        expect(html).toContain('No additional cost for most GitHub Copilot subscribers.');
        expect(html).not.toContain('Model picker slot');
    });
});
