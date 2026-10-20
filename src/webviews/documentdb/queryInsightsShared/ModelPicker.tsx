/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Badge, Button, Dropdown, Field, Option, OptionGroup, Text, Tooltip } from '@fluentui/react-components';
import { InfoRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { useEffect, useRef, useState, type JSX } from 'react';
import type { CommandType } from '../../../commands/llmEnhancedCommands/indexAdvisorCommands';
import type { AvailableModelInfo, AvailableModelsResult } from '../../../services/ai/modelSelection';
import type { IndexAdvisorPromptSourceInfo } from '../../../services/promptTemplateService';
import { formatTokenCount } from '../../../utils/formatTokenCount';
import { useTrpcClient } from '../../_integration/useTrpcClient';
import { Announcer } from '../../components/accessibility';
import './ModelPicker.scss';

export interface ModelPickerProps {
    commandType: CommandType;
    compact?: boolean;
    disabled?: boolean;
    /** Undefined while loading/saving, or when no model is available. */
    onModelChange?: (model: AvailableModelInfo | undefined) => void;
}

function categoryLabel(category: string | undefined): string {
    switch (category) {
        case 'powerful': return l10n.t('Powerful');
        case 'versatile': return l10n.t('Versatile');
        case 'lightweight': return l10n.t('Lightweight');
        default: return l10n.t('Other');
    }
}

function modelSummary(model: AvailableModelInfo): string {
    return [
        model.pricing,
        model.maxInputTokens > 0 ? l10n.t('{0} context', formatTokenCount(model.maxInputTokens, navigator.language)) : undefined,
        model.category ? categoryLabel(model.category) : undefined,
    ].filter(Boolean).join(' · ');
}

function ModelDetails({ model }: { model: AvailableModelInfo }): JSX.Element {
    const tiers: Record<string, number> = { low: 1, medium: 2, high: 3, very_high: 4 };
    const tier = model.priceCategory ? tiers[model.priceCategory] : undefined;
    const costs: readonly [keyof AvailableModelInfo, string][] = [
        ['inputCost', l10n.t('Input')], ['outputCost', l10n.t('Output')],
        ['cacheCost', l10n.t('Cached input')], ['cacheWriteCost', l10n.t('Cache write')],
        ['longContextInputCost', l10n.t('Long-context input')],
        ['longContextOutputCost', l10n.t('Long-context output')],
        ['longContextCacheCost', l10n.t('Long-context cached input')],
        ['longContextCacheWriteCost', l10n.t('Long-context cache write')],
    ];
    const capabilities: string[] = [];
    if (model.supportsToolCalling !== undefined) capabilities.push(model.supportsToolCalling ? l10n.t('Tools supported') : l10n.t('No tool calling'));
    if (model.supportsImageToText !== undefined) capabilities.push(model.supportsImageToText ? l10n.t('Images supported') : l10n.t('No image input'));
    return (
        <div className="query-insights-model-details">
            {(model.pricing || model.priceCategory) && (
                <Text size={200}>
                    {[model.pricing, tier ? l10n.t('Price tier {0}/4', String(tier)) : model.priceCategory].filter(Boolean).join(' · ')}
                </Text>
            )}
            {costs.some(([key]) => model[key] !== undefined) && (
                <>
                    <Text size={200} className="query-insights-model-muted">{l10n.t('AI credits per 1M tokens')}</Text>
                    <dl className="query-insights-model-costs">
                        {costs.filter(([key]) => model[key] !== undefined).map(([key, label]) => (
                            <div key={key}><dt>{label}</dt><dd>{String(model[key])}</dd></div>
                        ))}
                    </dl>
                </>
            )}
            {model.maxInputTokens > 0 && <Text size={200}>{l10n.t('Context window: {0} tokens', model.maxInputTokens.toLocaleString(navigator.language))}</Text>}
            {capabilities.length > 0 && <Text size={200}>{capabilities.join(' · ')}</Text>}
            <Text size={100} className="query-insights-model-identity query-insights-model-muted">
                {[model.family, model.version, model.id].filter(Boolean).join(' / ')}
            </Text>
        </div>
    );
}

export function ModelPicker({
    commandType,
    compact = false,
    disabled = false,
    onModelChange,
}: ModelPickerProps): JSX.Element {
    const client = useTrpcClient();
    const [available, setAvailable] = useState<AvailableModelsResult>();
    const [promptSource, setPromptSource] = useState<IndexAdvisorPromptSourceInfo>();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string>();
    const [refreshKey, setRefreshKey] = useState(0);
    const mounted = useRef(false);
    const selected = available?.models.find((model) => model.id === available.effectiveModelId);

    useEffect(() => {
        onModelChange?.(loading || saving ? undefined : selected);
    }, [loading, saving, selected, onModelChange]);

    useEffect(() => {
        mounted.current = true;
        const controller = new AbortController();
        let requestId = 0;
        const refresh = async (): Promise<void> => {
            const currentRequest = ++requestId;
            setLoading(true);
            try {
                const [models, source] = await Promise.all([
                    client.ai.getAvailableModels.query(undefined, { signal: controller.signal }),
                    client.ai.getPromptSourceInfo.query({ commandType }, { signal: controller.signal }),
                ]);
                if (!controller.signal.aborted && currentRequest === requestId) {
                    setAvailable(models);
                    setPromptSource(source);
                    setError(undefined);
                }
            } catch (cause) {
                if (!controller.signal.aborted && currentRequest === requestId) {
                    setError(l10n.t('Failed to load model settings: {0}', cause instanceof Error ? cause.message : String(cause)));
                }
            } finally {
                if (!controller.signal.aborted && currentRequest === requestId) {
                    setLoading(false);
                }
            }
        };
        const onFocus = (): void => {
            void refresh();
        };
        void refresh();
        window.addEventListener('focus', onFocus);
        return () => {
            mounted.current = false;
            controller.abort();
            window.removeEventListener('focus', onFocus);
        };
    }, [client, commandType, refreshKey]);

    const selectModel = async (modelId: string): Promise<void> => {
        setSaving(true);
        setError(undefined);
        try {
            const result = await client.ai.setSelectedModel.mutate({ modelId });
            if (mounted.current) {
                setAvailable(result);
            }
        } catch (cause) {
            if (mounted.current) {
                setError(l10n.t('Failed to save model choice: {0}', cause instanceof Error ? cause.message : String(cause)));
            }
        } finally {
            if (mounted.current) {
                setSaving(false);
            }
        }
    };

    const models = [
        ...(available?.models.filter((model) => model.isUtility) ?? []),
        ...(available?.models.filter((model) => !model.isUtility) ?? []),
    ];
    const selectionReason =
        selected && selected.id === available?.savedModelId ? l10n.t('Saved choice') : l10n.t('First available model');
    const promptBasename = promptSource?.path?.split(/[/\\]/).pop();
    const utility = models.filter((model) => model.isUtility);
    const others = models.filter((model) => !model.isUtility);
    const option = (model: AvailableModelInfo): JSX.Element => (
        <Option key={model.id} value={model.id} text={model.name}>
            <span className="query-insights-model-option">
                <span>{model.name}</span>
                <span className="query-insights-model-option-meta">
                    <Text size={200} className="query-insights-model-muted">
                        {[model.pricing, model.maxInputTokens > 0 ? formatTokenCount(model.maxInputTokens, navigator.language) : undefined].filter(Boolean).join(' · ')}
                    </Text>
                    <Badge appearance="tint" shape="rounded" size="small">
                        {model.isUtility ? l10n.t('Utility') : categoryLabel(model.category)}
                    </Badge>
                </span>
            </span>
        </Option>
    );

    return (
        <div className={`query-insights-model-picker${compact ? ' query-insights-model-picker-compact' : ''}`}>
            <Field label={l10n.t('Copilot model')}>
                <Dropdown
                    size={compact ? 'small' : 'medium'}
                    value={selected?.name ?? ''}
                    selectedOptions={selected ? [selected.id] : []}
                    placeholder={loading ? l10n.t('Loading models…') : l10n.t('No Copilot models available')}
                    disabled={disabled || loading || saving || models.length === 0}
                    onOptionSelect={(_event, data) => {
                        if (data.optionValue) {
                            void selectModel(data.optionValue);
                        }
                    }}
                >
                    {utility.map(option)}
                    {others.some((model) => model.category)
                        ? ['powerful', 'versatile', 'lightweight', 'other'].map((category) => {
                            const group = others.filter((model) =>
                                (['powerful', 'versatile', 'lightweight'].includes(model.category ?? '') ? model.category : 'other') === category);
                            return group.length > 0 ? (
                                <OptionGroup key={category} label={categoryLabel(category)}>{group.map(option)}</OptionGroup>
                            ) : null;
                        })
                        : others.map(option)}
                </Dropdown>
            </Field>
            {selected && (compact ? (
                <div className="query-insights-model-compact-details">
                    <Text size={200} className="query-insights-model-muted">{modelSummary(selected)}</Text>
                    <Tooltip content={<ModelDetails model={selected} />} relationship="description">
                        <Button appearance="subtle" size="small" icon={<InfoRegular />} aria-label={l10n.t('Selected model details')} />
                    </Tooltip>
                </div>
            ) : <ModelDetails model={selected} />)}
            {selected && (
                <Text size={200} className="query-insights-model-muted">
                    {l10n.t('Using {0} · {1}', selected.name, selectionReason)}
                    {!selected.isUtility && <> · {l10n.t('May use premium requests')}</>}
                </Text>
            )}
            {promptSource && (
                <Text size={200} className="query-insights-model-muted">
                    {promptSource.source === 'custom-file'
                        ? l10n.t('Prompt: custom file {0}', promptBasename ?? '')
                        : l10n.t('Prompt: built-in')}
                </Text>
            )}
            {error && <Text size={200}>{error}</Text>}
            {!loading && models.length === 0 && (
                <Button appearance="subtle" size="small" onClick={() => setRefreshKey((value) => value + 1)}>
                    {l10n.t('Refresh models')}
                </Button>
            )}
            <Announcer when={!!error} message={error ?? ''} />
        </div>
    );
}
