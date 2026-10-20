/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Dev-only design preview (POC); strings intentionally not localized.

import { Button, Link, MenuButton, Tooltip } from '@fluentui/react-components';
import { SparkleRegular } from '@fluentui/react-icons';
import { useState, type JSX, type RefObject } from 'react';
import { previewModel } from './mockModels';
import { contextLabel, CostBadge, costExplanation, costLabel, InsightsCardShell, MetaItems, ModelMenu, usePreviewStyles } from './previewParts';

export interface OptionProps {
    readonly initialModelId: string;
    /** The model trigger, so a frame can float a static open menu under it. */
    readonly anchorRef?: RefObject<HTMLSpanElement | null>;
}

/** Option A: primary button + VS Code chat-style model pill; one muted footer line. */
export function ModelPillOption({ initialModelId, anchorRef }: OptionProps): JSX.Element {
    const styles = usePreviewStyles();
    const [modelId, setModelId] = useState(initialModelId);
    const model = previewModel(modelId);
    return (
        <InsightsCardShell>
            <div className={styles.actions}>
                <Button appearance="primary" icon={<SparkleRegular />}>Get AI Performance Insights</Button>
                <span ref={anchorRef} className={styles.anchor}>
                <ModelMenu selectedId={modelId} onSelect={setModelId}>
                    <Tooltip content={`Copilot model · ${contextLabel(model)} context. ${costExplanation(model)}`} relationship="description">
                        <MenuButton appearance="subtle" aria-label={`Copilot model: ${model.name}, ${costLabel(model) ?? ''}`}>
                            <span className={styles.pillContent}>
                                {model.name}
                                <CostBadge model={model} />
                            </span>
                        </MenuButton>
                    </Tooltip>
                </ModelMenu>
                </span>
            </div>
            <div className={styles.metaLine}>
                <MetaItems
                    items={[
                        'Built-in prompt',
                        <Link key="explore" inline className={styles.smallLink}>Explore with your own input…</Link>,
                        <Link key="learn" inline className={styles.smallLink}>Learn more</Link>,
                    ]}
                />
            </div>
        </InsightsCardShell>
    );
}
