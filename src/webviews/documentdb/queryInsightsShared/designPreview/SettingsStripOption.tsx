/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Dev-only design preview (POC); strings intentionally not localized.

import { Button, Divider, Link, makeStyles, mergeClasses, Text, tokens } from '@fluentui/react-components';
import { SparkleRegular } from '@fluentui/react-icons';
import { useState, type JSX } from 'react';
import { previewModel } from './mockModels';
import type { OptionProps } from './ModelPillOption';
import { CostBadge, InsightsCardShell, ModelMenu, usePreviewStyles } from './previewParts';

const useStripStyles = makeStyles({
    divider: { marginTop: tokens.spacingVerticalL, marginBottom: tokens.spacingVerticalS },
    strip: {
        display: 'grid',
        gridTemplateColumns: 'max-content minmax(0, 1fr) auto',
        alignItems: 'center',
        columnGap: tokens.spacingHorizontalL,
        rowGap: tokens.spacingVerticalXS,
        fontSize: tokens.fontSizeBase200,
        lineHeight: tokens.lineHeightBase200,
    },
    label: { color: tokens.colorNeutralForeground3 },
    value: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: tokens.spacingHorizontalS, minWidth: 0 },
    explore: { gridColumn: 3, gridRow: 1, justifySelf: 'end' },
});

/** Option C: the card body stays clean; a divider and a compact settings strip hold model and prompt. */
export function SettingsStripOption({ initialModelId, anchorRef }: OptionProps): JSX.Element {
    const styles = usePreviewStyles();
    const strip = useStripStyles();
    const [modelId, setModelId] = useState(initialModelId);
    const model = previewModel(modelId);
    return (
        <InsightsCardShell>
            <div className={styles.actions}>
                <Button appearance="primary" icon={<SparkleRegular />}>
                    Get AI Performance Insights
                </Button>
                <Button appearance="subtle" aria-label="Learn more about AI Performance Insights">
                    Learn more
                </Button>
            </div>
            <Divider className={strip.divider} />
            <div className={strip.strip}>
                <Text size={200} className={strip.label}>
                    Model
                </Text>
                <span className={strip.value}>
                    <Text size={200} weight="semibold">
                        {model.name}
                    </Text>
                    <CostBadge model={model} />
                    <span ref={anchorRef} className={styles.anchor}>
                        <ModelMenu selectedId={modelId} onSelect={setModelId}>
                            <Link
                                as="button"
                                inline
                                className={styles.smallLink}
                                aria-label={`Change model (current: ${model.name})`}
                            >
                                Change
                            </Link>
                        </ModelMenu>
                    </span>
                </span>
                <Link inline className={mergeClasses(styles.smallLink, strip.explore)}>
                    Explore with your own input…
                </Link>
                <Text size={200} className={strip.label}>
                    Prompt
                </Text>
                <Text size={200}>Built-in</Text>
            </div>
        </InsightsCardShell>
    );
}
