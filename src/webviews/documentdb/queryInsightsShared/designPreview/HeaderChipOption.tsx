/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Dev-only design preview (POC); strings intentionally not localized.

import {
    Button,
    Divider,
    Dropdown,
    Field,
    Link,
    makeStyles,
    mergeClasses,
    Option,
    OptionGroup,
    Popover,
    PopoverSurface,
    PopoverTrigger,
    Text,
    tokens,
} from '@fluentui/react-components';
import { ChevronDownRegular, SparkleRegular } from '@fluentui/react-icons';
import { useState, type JSX } from 'react';
import { groupPreviewModels, previewModel } from './mockModels';
import type { OptionProps } from './ModelPillOption';
import { contextLabel, CostBadge, costExplanation, InsightsCardShell, usePreviewStyles } from './previewParts';

const useChipStyles = makeStyles({
    panel: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalM, width: '340px', maxWidth: '100%' },
    facts: {
        display: 'grid',
        gridTemplateColumns: 'max-content minmax(0, 1fr)',
        columnGap: tokens.spacingHorizontalL,
        rowGap: tokens.spacingVerticalXS,
        margin: 0,
        fontSize: tokens.fontSizeBase200,
        lineHeight: tokens.lineHeightBase200,
        '& dt': { color: tokens.colorNeutralForeground3 },
        '& dd': {
            margin: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-start',
            gap: tokens.spacingVerticalXXS,
        },
    },
    surface: { padding: tokens.spacingHorizontalL },
    muted: { color: tokens.colorNeutralForeground3 },
});

/** The popover body: model dropdown, cost and context facts, prompt, Explore. */
export function ModelSettingsPanel({
    modelId,
    onSelect,
}: {
    modelId: string;
    onSelect?: (id: string) => void;
}): JSX.Element {
    const chip = useChipStyles();
    const model = previewModel(modelId);
    const credits = model.isUtility
        ? costExplanation(model)
        : `Credits per 1M tokens: in ${model.inputCost?.toLocaleString('en-US')} · out ${model.outputCost?.toLocaleString('en-US')}`;
    return (
        <div className={chip.panel}>
            <Text weight="semibold">Model for AI Performance Insights</Text>
            <Field label="Copilot model" size="small">
                <Dropdown
                    size="small"
                    value={model.name}
                    selectedOptions={[model.id]}
                    onOptionSelect={(_event, data) => {
                        if (data.optionValue) onSelect?.(data.optionValue);
                    }}
                >
                    {groupPreviewModels().map((group) => (
                        <OptionGroup key={group.key} label={group.label}>
                            {group.models.map((item) => (
                                <Option key={item.id} value={item.id}>
                                    {item.name}
                                </Option>
                            ))}
                        </OptionGroup>
                    ))}
                </Dropdown>
            </Field>
            <dl className={chip.facts}>
                <dt>Cost</dt>
                <dd>
                    <CostBadge model={model} />
                    <span>{credits}</span>
                </dd>
                <dt>Context</dt>
                <dd>{contextLabel(model)} tokens</dd>
                <dt>Prompt</dt>
                <dd>Built-in</dd>
            </dl>
            <Text size={200} className={chip.muted}>
                Saved for Query Insights everywhere. Thinking level follows VS Code Chat.
            </Text>
            <Divider />
            <Link inline>Explore with your own input…</Link>
        </div>
    );
}

export function StaticModelSettings({ selectedId }: { selectedId: string }): JSX.Element {
    const styles = usePreviewStyles();
    const chip = useChipStyles();
    return (
        <div className={mergeClasses(styles.staticSurface, chip.surface)}>
            <ModelSettingsPanel modelId={selectedId} />
        </div>
    );
}

/** Option E: the model is a chip in the card header that opens a small settings popover. */
export function HeaderChipOption({ initialModelId, anchorRef }: OptionProps): JSX.Element {
    const styles = usePreviewStyles();
    const [modelId, setModelId] = useState(initialModelId);
    const model = previewModel(modelId);
    const headerChip = (
        <span ref={anchorRef} className={styles.anchor}>
            <Popover positioning="below-end" withArrow={false}>
                <PopoverTrigger disableButtonEnhancement>
                    <Button
                        appearance="subtle"
                        size="small"
                        icon={<ChevronDownRegular />}
                        iconPosition="after"
                        aria-label={`Model settings: ${model.name}`}
                    >
                        <span className={styles.pillContent}>
                            {model.name}
                            <CostBadge model={model} />
                        </span>
                    </Button>
                </PopoverTrigger>
                <PopoverSurface aria-label="Model settings">
                    <ModelSettingsPanel modelId={modelId} onSelect={setModelId} />
                </PopoverSurface>
            </Popover>
        </span>
    );
    return (
        <InsightsCardShell headerAction={headerChip}>
            <div className={styles.actions}>
                <Button appearance="primary" icon={<SparkleRegular />}>
                    Get AI Performance Insights
                </Button>
                <Button appearance="subtle" aria-label="Learn more about AI Performance Insights">
                    Learn more
                </Button>
            </div>
        </InsightsCardShell>
    );
}
