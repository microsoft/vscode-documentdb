/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Link, makeStyles, Text, tokens } from '@fluentui/react-components';
import { useState, type JSX } from 'react';
import { type AvailableModelInfo } from '../../../../services/ai/modelSelection';
import { GetPerformanceInsightsCard } from '../../collectionView/queryInsightsTab/components/optimizationCards/custom/GetPerformanceInsightsCard';
import { ModelPicker } from '../ModelPicker';
import { BODY_TEXT } from './previewParts';

const useStyles = makeStyles({
    page: {
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.spacingVerticalL,
        padding: `${tokens.spacingVerticalXXL} ${tokens.spacingHorizontalXXL}`,
    },
});

/** Dev-only L2 route: the selected card design with fixture models, not the live Copilot catalog. */
export function QueryInsightsDesignPreview(): JSX.Element {
    const styles = useStyles();
    const [selected, setSelected] = useState<AvailableModelInfo>();
    const noop = (): void => undefined;
    return (
        <main className={styles.page}>
            <Text as="h1" size={600} weight="semibold">
                Query Insights — selected card design
            </Text>
            <Text>
                Preview fixture models only. The installed Query Insights tab and wizard use the live Copilot catalog.
            </Text>
            <GetPerformanceInsightsCard
                bodyText={BODY_TEXT}
                isLoading={false}
                enabled={!!selected}
                modelPicker={
                    <ModelPicker size="medium" appearance="underline" showModelIcon onModelChange={setSelected} />
                }
                mayUsePremiumRequests={!selected?.isUtility}
                secondaryLink={<Link inline>Explore with your own input…</Link>}
                onGetInsights={noop}
                onLearnMore={noop}
                onCancel={noop}
                onLearnMoreUtilityModel={noop}
            />
        </main>
    );
}
