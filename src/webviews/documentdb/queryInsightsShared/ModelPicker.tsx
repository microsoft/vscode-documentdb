/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Badge, Button, Dropdown, Field, Option, OptionGroup, Text, Tooltip } from '@fluentui/react-components';
import { ChevronRightRegular, InfoRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { useEffect, useRef, useState, type JSX } from 'react';
import type { CommandType } from '../../../commands/llmEnhancedCommands/indexAdvisorCommands';
import type { AvailableModelInfo, AvailableModelsResult } from '../../../services/ai/modelSelection';
import type { IndexAdvisorPromptSourceInfo } from '../../../services/promptTemplateService';
import { formatTokenCount } from '../../../utils/formatTokenCount';
import { useTrpcClient } from '../../_integration/useTrpcClient';
import { Announcer } from '../../components/accessibility';
import './ModelPicker.scss';

function formatCredits(value: unknown): string {
    return typeof value === 'number'
        ? new Intl.NumberFormat(navigator.language, { maximumFractionDigits: 2 }).format(value)
        : String(value);
}

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

function ModelCostBadge({ category }: { category: string | undefined }): JSX.Element | null {
    if (!category) return null;
    // VS Code modelPickerPresentation.ts: two tints, not a calculated per-token price.
    // CAPI model_picker_price_category is read by Copilot's platform/endpoint/node/chatEndpoint.ts.
    let label: string;
    switch (category) {
        case 'low': label = l10n.t('Low cost'); break;
        case 'medium': label = l10n.t('Medium cost'); break;
        case 'high': label = l10n.t('High cost'); break;
        case 'very_high': label = l10n.t('Very high cost'); break;
        default: label = l10n.t('{0} cost', category.charAt(0).toUpperCase() + category.slice(1));
    }
    return <Badge appearance="tint" shape="rounded" size="small"
        color={category === 'high' || category === 'very_high' ? 'warning' : 'informative'}>{label}</Badge>;
}

function ModelDetails({ model, compact = false, tooltip = false }: {
    model: AvailableModelInfo; compact?: boolean; tooltip?: boolean;
}): JSX.Element {
    const costs: readonly [keyof AvailableModelInfo, string][] = [
        ['inputCost', l10n.t('Input')], ['outputCost', l10n.t('Output')],
        ['cacheCost', l10n.t('Cache Read')], ['cacheWriteCost', l10n.t('Cache Write')],
    ];
    const longCosts: readonly [keyof AvailableModelInfo, string][] = [
        ['longContextInputCost', l10n.t('Input')], ['longContextOutputCost', l10n.t('Output')],
        ['longContextCacheCost', l10n.t('Cache Read')], ['longContextCacheWriteCost', l10n.t('Cache Write')],
    ];
    const hasPricing = !!model.pricing || !!model.priceCategory ||
        [...costs, ...longCosts].some(([key]) => model[key] !== undefined);
    const rows = (fields: readonly [keyof AvailableModelInfo, string][]): JSX.Element => (
        <dl className="query-insights-model-costs">
            {fields.filter(([key]) => model[key] !== undefined).map(([key, label]) => (
                <div key={key}><dt>{label}</dt><dd>{formatCredits(model[key])}</dd></div>
            ))}
        </dl>
    );
    const capabilities: string[] = [];
    if (model.supportsToolCalling !== undefined) capabilities.push(model.supportsToolCalling ? l10n.t('Tools supported') : l10n.t('No tool calling'));
    if (model.supportsImageToText !== undefined) capabilities.push(model.supportsImageToText ? l10n.t('Images supported') : l10n.t('No image input'));
    const metadata = (
        <div className="query-insights-model-metadata query-insights-model-muted">
            {model.maxInputTokens > 0 && <Text size={200}>{l10n.t('Context window: {0} tokens', model.maxInputTokens.toLocaleString(navigator.language))}</Text>}
            {capabilities.length > 0 && <Text size={200}>{capabilities.join(' · ')}</Text>}
            <Text size={100} className="query-insights-model-identity">
                {[model.id, model.family !== model.id ? model.family : undefined, model.version ? `v${model.version}` : undefined].filter(Boolean).join(' · ')}
            </Text>
            <Text size={200}>{l10n.t('Thinking level and context size follow this model\'s settings in the VS Code Chat model picker.')}</Text>
        </div>
    );
    const pricing = (
        <div className="query-insights-model-pricing-body">
            {(costs.some(([key]) => model[key] !== undefined) || longCosts.some(([key]) => model[key] !== undefined)) && (
                <>
                    <Text size={200} className="query-insights-model-muted">{l10n.t('Credits per 1M tokens')}</Text>
                    {rows(costs)}
                    {longCosts.some(([key]) => model[key] !== undefined) && (
                        <>
                            <span className="query-insights-model-cost-group">{l10n.t('Long context')}</span>
                            {rows(longCosts)}
                        </>
                    )}
                </>
            )}
        </div>
    );
    return (
        <div className={`query-insights-model-details${compact || !hasPricing ? ' query-insights-model-details-compact' : ''}`}>
            {!hasPricing ? (
                compact && <Text size={200} className="query-insights-model-muted">{modelSummary(model)}</Text>
            ) : tooltip ? (
                <>
                    <div className="query-insights-model-pricing-title">
                        <Text weight="semibold">{l10n.t('Pricing details')}</Text>
                        <ModelCostBadge category={model.priceCategory} />
                    </div>
                    {pricing}
                </>
            ) : (
                <details open={!compact}>
                    <summary>
                        <ChevronRightRegular aria-hidden="true" className="query-insights-model-chevron" />
                        <span>{l10n.t('Pricing details')}</span>
                        {compact && <Text size={200} className="query-insights-model-muted">{modelSummary(model)}</Text>}
                        <ModelCostBadge category={model.priceCategory} />
                    </summary>
                    {pricing}
                    {compact && metadata}
                </details>
            )}
            {!compact && metadata}
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
                    <ModelDetails model={selected} compact />
                    <Tooltip content={<ModelDetails model={selected} tooltip />} relationship="description">
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
