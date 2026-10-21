/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import type { JSX } from 'react';
import { ModelPicker, type ModelPickerProps } from '../../../../../queryInsightsShared/ModelPicker';
import { GetPerformanceInsightsCard, type GetPerformanceInsightsCardProps } from './GetPerformanceInsightsCard';

interface PerformanceInsightsCardComparisonProps
    extends Omit<GetPerformanceInsightsCardProps, 'modelPicker' | 'experimentLabel'>,
        Pick<ModelPickerProps, 'commandType' | 'onModelChange' | 'onPromptLabelChange'> {}

/** Temporary POC alternatives in the live panel; all six controls share one model selection. */
export function PerformanceInsightsCardComparison({
    commandType,
    onModelChange,
    onPromptLabelChange,
    ...cardProps
}: PerformanceInsightsCardComparisonProps): JSX.Element {
    return (
        <ModelPicker commandType={commandType} onModelChange={onModelChange} onPromptLabelChange={onPromptLabelChange}>
            {(renderPicker) => (
                <>
                    {([
                        { variant: 'label-change', label: l10n.t('A — Model label, Change button and info') },
                        { variant: 'compound', label: l10n.t('B — Outline CompoundButton') },
                        { variant: 'outline-button', label: l10n.t('C — Outline button with model name') },
                        { variant: 'outline', label: l10n.t('D — Dropdown: outline') },
                        { variant: 'filled-darker', label: l10n.t('E — Dropdown: filled-darker') },
                        { variant: 'underline', label: l10n.t('F — Dropdown: underline') },
                    ] as const).map(({ variant, label }) => (
                        <GetPerformanceInsightsCard
                            {...cardProps}
                            key={variant}
                            experimentLabel={label}
                            modelPicker={renderPicker(variant)}
                        />
                    ))}
                </>
            )}
        </ModelPicker>
    );
}
