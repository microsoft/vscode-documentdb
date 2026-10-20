/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Dev-only design preview (POC); strings intentionally not localized.

import { Button, Link, makeStyles, mergeClasses, tokens } from '@fluentui/react-components';
import { CheckmarkRegular, SparkleRegular } from '@fluentui/react-icons';
import { type JSX } from 'react';
import { groupPreviewModels, previewModel } from './mockModels';
import type { OptionProps } from './ModelPillOption';
import { contextLabel, CostBadge, costExplanation, costLabel, InsightsCardShell, MetaItems, usePreviewStyles } from './previewParts';
import type { AvailableModelInfo } from '../../../../services/ai/modelSelection';

/** Option D: the card names the model; "Change model…" asks the host for vscode.window.showQuickPick. */
export function QuickPickOption({ initialModelId, anchorRef }: OptionProps): JSX.Element {
    const styles = usePreviewStyles();
    const model = previewModel(initialModelId);
    return (
        <InsightsCardShell>
            <div className={styles.actions}>
                <Button appearance="primary" icon={<SparkleRegular />}>Get AI Performance Insights</Button>
                <Button appearance="subtle" aria-label="Learn more about AI Performance Insights">Learn more</Button>
            </div>
            <div className={styles.metaLine}>
                <span className={styles.pillContent}>
                    <span>Uses <span className={styles.strong}>{model.name}</span></span>
                    <CostBadge model={model} />
                </span>
                <span ref={anchorRef} className={styles.anchor}>
                    <Link inline className={styles.smallLink}>Change model…</Link>
                </span>
            </div>
            <div className={styles.metaLine}>
                <MetaItems
                    items={['Built-in prompt', <Link key="explore" inline className={styles.smallLink}>Explore with your own input…</Link>]}
                />
            </div>
        </InsightsCardShell>
    );
}

const useQuickPickStyles = makeStyles({
    widget: {
        width: '560px',
        maxWidth: '100%',
        padding: tokens.spacingHorizontalXS,
        backgroundColor: tokens.colorNeutralBackground1,
        color: tokens.colorNeutralForeground1,
        borderRadius: tokens.borderRadiusLarge,
        border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
        boxShadow: tokens.shadow28,
        fontSize: tokens.fontSizeBase300,
        lineHeight: tokens.lineHeightBase300,
    },
    title: {
        textAlign: 'center',
        padding: `${tokens.spacingVerticalXS} 0`,
        color: tokens.colorNeutralForeground2,
        fontSize: tokens.fontSizeBase200,
    },
    input: {
        margin: `0 ${tokens.spacingHorizontalXS} ${tokens.spacingVerticalXS}`,
        padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalS}`,
        border: `${tokens.strokeWidthThin} solid ${tokens.colorBrandStroke1}`,
        borderRadius: tokens.borderRadiusSmall,
        color: tokens.colorNeutralForeground4,
        backgroundColor: tokens.colorNeutralBackground3,
    },
    row: {
        display: 'grid',
        gridTemplateColumns: '16px minmax(0, 1fr) auto',
        columnGap: tokens.spacingHorizontalS,
        alignItems: 'center',
        padding: `${tokens.spacingVerticalXXS} ${tokens.spacingHorizontalS}`,
        borderRadius: tokens.borderRadiusMedium,
    },
    separator: { borderTop: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}` },
    // The active row inherits one selected foreground, as VS Code's list.activeSelectionForeground does.
    active: {
        backgroundColor: tokens.colorNeutralBackground1Selected,
        color: tokens.colorNeutralForeground1Selected,
        '& span': { color: 'inherit' },
    },
    label: { display: 'flex', alignItems: 'baseline', gap: tokens.spacingHorizontalS, minWidth: 0, whiteSpace: 'nowrap' },
    description: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200, overflow: 'hidden', textOverflow: 'ellipsis' },
    detail: {
        gridColumn: 2,
        color: tokens.colorNeutralForeground3,
        fontSize: tokens.fontSizeBase200,
        lineHeight: tokens.lineHeightBase200,
    },
    groupLabel: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 },
});

function creditsDetail(model: AvailableModelInfo): string {
    if (model.isUtility) return costExplanation(model);
    const parts = [
        model.inputCost !== undefined ? `input ${model.inputCost.toLocaleString('en-US')}` : undefined,
        model.outputCost !== undefined ? `output ${model.outputCost.toLocaleString('en-US')}` : undefined,
        model.cacheCost !== undefined ? `cache read ${model.cacheCost.toLocaleString('en-US')}` : undefined,
    ].filter(Boolean);
    return parts.length > 0 ? `Credits per 1M tokens: ${parts.join(' · ')}` : costExplanation(model);
}

/**
 * Faithful static mock of `vscode.window.showQuickPick` with QuickPickItemKind.Separator groups,
 * description = cost tier · context window, detail = credits. Plain text only (no badge colours).
 */
export function QuickPickMock({ selectedId }: { selectedId: string }): JSX.Element {
    const qp = useQuickPickStyles();
    return (
        <div className={qp.widget}>
            <div className={qp.title}>Copilot model for Query Insights</div>
            <div className={qp.input}>Select a model (current: {previewModel(selectedId).name})</div>
            {groupPreviewModels().map((group, groupIndex) =>
                group.models.map((model, index) => (
                    <div
                        key={model.id}
                        className={mergeClasses(qp.row, groupIndex > 0 && index === 0 && qp.separator, model.id === selectedId && qp.active)}
                    >
                        <span>{model.id === selectedId && <CheckmarkRegular aria-hidden />}</span>
                        <span className={qp.label}>
                            <span>{model.name}</span>
                            <span className={qp.description}>
                                {[costLabel(model), contextLabel(model) && `${contextLabel(model)} context`].filter(Boolean).join(' · ')}
                            </span>
                        </span>
                        <span className={qp.groupLabel}>{index === 0 ? group.label : ''}</span>
                        <span className={qp.detail}>{creditsDetail(model)}</span>
                    </div>
                )),
            )}
        </div>
    );
}
