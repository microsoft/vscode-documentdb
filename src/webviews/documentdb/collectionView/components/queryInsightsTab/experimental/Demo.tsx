/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Demo page to showcase all three accessibility approaches side by side
 * This allows for easy comparison and testing with accessibility tools
 */

import { Tab, TabList, TabPanel, Text } from '@fluentui/react-components';
import * as l10n from '@vscode/l10n';
import * as React from 'react';
import { useState } from 'react';
import { QueryInsightsApproach1 } from './Approach1';
import { QueryInsightsApproach2 } from './Approach2';
import { QueryInsightsApproach3 } from './Approach3';
import './Demo.scss';

type ApproachTab = 'approach1' | 'approach2' | 'approach3' | 'comparison';

export const QueryInsightsAccessibilityDemo: React.FC = () => {
    const [selectedTab, setSelectedTab] = useState<ApproachTab>('approach1');

    return (
        <div className="accessibility-demo-container">
            <div className="demo-header">
                <Text size={600} weight="semibold">
                    {l10n.t('Query Insights Tooltip Accessibility - Experimental Approaches')}
                </Text>
                <Text size={300} className="demo-intro">
                    {l10n.t(
                        'This demo showcases three different approaches to making tooltips keyboard accessible. Use accessibility tools (Accessibility Insights, NVDA, JAWS) to evaluate each approach.',
                    )}
                </Text>
            </div>

            <TabList selectedValue={selectedTab} onTabSelect={(_, data) => setSelectedTab(data.value as ApproachTab)}>
                <Tab value="approach1">{l10n.t('Approach 1: Info Buttons')}</Tab>
                <Tab value="approach2">{l10n.t('Approach 2: Arrow Keys')}</Tab>
                <Tab value="approach3">{l10n.t('Approach 3: Keyboard Shortcut')}</Tab>
                <Tab value="comparison">{l10n.t('Comparison')}</Tab>
            </TabList>

            <div className="demo-content">
                <TabPanel value="approach1" selected={selectedTab === 'approach1'}>
                    <QueryInsightsApproach1 />
                </TabPanel>

                <TabPanel value="approach2" selected={selectedTab === 'approach2'}>
                    <QueryInsightsApproach2 />
                </TabPanel>

                <TabPanel value="approach3" selected={selectedTab === 'approach3'}>
                    <QueryInsightsApproach3 />
                </TabPanel>

                <TabPanel value="comparison" selected={selectedTab === 'comparison'}>
                    <div className="comparison-panel">
                        <Text size={500} weight="semibold" className="comparison-title">
                            {l10n.t('Approach Comparison')}
                        </Text>

                        <div className="comparison-grid">
                            {/* Approach 1 */}
                            <div className="comparison-card">
                                <Text size={400} weight="semibold">
                                    {l10n.t('Approach 1: Info Buttons')}
                                </Text>
                                <div className="comparison-section">
                                    <Text size={300} weight="semibold" className="section-title">
                                        {l10n.t('Pros')}
                                    </Text>
                                    <ul>
                                        <li>{l10n.t('Clear visual affordance - info buttons are universally recognized')}</li>
                                        <li>{l10n.t('Explicit tab order - each tooltip has a clear tab stop')}</li>
                                        <li>{l10n.t('Standard pattern - follows common UI patterns')}</li>
                                    </ul>
                                </div>
                                <div className="comparison-section">
                                    <Text size={300} weight="semibold" className="section-title">
                                        {l10n.t('Cons')}
                                    </Text>
                                    <ul>
                                        <li>{l10n.t('Visual clutter - adds extra UI elements')}</li>
                                        <li>{l10n.t('Tab order length - increases number of tab stops (8+ additional)')}</li>
                                        <li>{l10n.t('Redundant for mouse users - hover still works')}</li>
                                    </ul>
                                </div>
                            </div>

                            {/* Approach 2 */}
                            <div className="comparison-card">
                                <Text size={400} weight="semibold">
                                    {l10n.t('Approach 2: Arrow Keys')}
                                </Text>
                                <div className="comparison-section">
                                    <Text size={300} weight="semibold" className="section-title">
                                        {l10n.t('Pros')}
                                    </Text>
                                    <ul>
                                        <li>{l10n.t('Fewer tab stops - only 4 stops instead of 12+')}</li>
                                        <li>{l10n.t('Natural grouping - reflects semantic structure')}</li>
                                        <li>{l10n.t('Efficient navigation - arrow keys provide quick access')}</li>
                                    </ul>
                                </div>
                                <div className="comparison-section">
                                    <Text size={300} weight="semibold" className="section-title">
                                        {l10n.t('Cons')}
                                    </Text>
                                    <ul>
                                        <li>{l10n.t('Non-standard pattern - arrow key navigation is uncommon')}</li>
                                        <li>{l10n.t('Learning curve - users need to discover this pattern')}</li>
                                        <li>{l10n.t('Discoverability issues - no visual indication of arrow key support')}</li>
                                    </ul>
                                </div>
                            </div>

                            {/* Approach 3 */}
                            <div className="comparison-card">
                                <Text size={400} weight="semibold">
                                    {l10n.t('Approach 3: Keyboard Shortcut')}
                                </Text>
                                <div className="comparison-section">
                                    <Text size={300} weight="semibold" className="section-title">
                                        {l10n.t('Pros')}
                                    </Text>
                                    <ul>
                                        <li>{l10n.t('Discoverable via ARIA - screen readers announce instructions')}</li>
                                        <li>{l10n.t('Minimal UI changes - no additional visual elements')}</li>
                                        <li>{l10n.t('Consistent tab order - natural navigation flow')}</li>
                                    </ul>
                                </div>
                                <div className="comparison-section">
                                    <Text size={300} weight="semibold" className="section-title">
                                        {l10n.t('Cons')}
                                    </Text>
                                    <ul>
                                        <li>{l10n.t('Hidden affordance - keyboard shortcut not visible to sighted users')}</li>
                                        <li>{l10n.t('Potential conflicts - Ctrl+I might conflict with VS Code shortcuts')}</li>
                                        <li>{l10n.t('Discoverability challenge - non-screen-reader users may not find it')}</li>
                                    </ul>
                                </div>
                            </div>
                        </div>

                        <div className="recommendation-section">
                            <Text size={400} weight="semibold">
                                {l10n.t('Recommended Approach')}
                            </Text>
                            <Text className="recommendation-text">
                                {l10n.t(
                                    'Based on WCAG 2.1 compliance and user experience considerations, Approach 1 (Info Buttons) is recommended as the primary solution. It provides clear visual affordances, explicit keyboard navigation, and follows established UI patterns that users are familiar with.',
                                )}
                            </Text>
                        </div>
                    </div>
                </TabPanel>
            </div>
        </div>
    );
};
