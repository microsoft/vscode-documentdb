/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { GetPerformanceInsightsCard } from './components/optimizationCards/custom/GetPerformanceInsightsCard';

vi.mock('@vscode/l10n', () => ({ t: (message: string): string => message }));

describe('GetPerformanceInsightsCard model disclosure', () => {
    function render(mayUsePremiumRequests?: boolean): string {
        return renderToStaticMarkup(
            <GetPerformanceInsightsCard
                bodyText="Analysis"
                isLoading={false}
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
});
