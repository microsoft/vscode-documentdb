/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Badge,
    Button,
    Dropdown,
    Menu,
    MenuButton,
    MenuGroup,
    MenuGroupHeader,
    MenuItemRadio,
    MenuList,
    MenuPopover,
    MenuTrigger,
    Option,
    OptionGroup,
    Table,
    TableBody,
    TableCell,
    TableCellLayout,
    TableRow,
    Text,
    Tooltip,
    useId,
} from '@fluentui/react-components';
import * as l10n from '@vscode/l10n';
import { useEffect, useRef, useState, type JSX, type ReactNode } from 'react';
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
    /** Compact variant only: the prompt source label, so the host card can show it in its footer. */
    onPromptLabelChange?: (label: string | undefined) => void;
}

function categoryLabel(category: string | undefined): string {
    switch (category) {
        case 'powerful': return l10n.t('Powerful');
        case 'versatile': return l10n.t('Versatile');
        case 'lightweight': return l10n.t('Lightweight');
        default: return l10n.t('Other');
    }
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

type CostKey =
    | 'inputCost' | 'outputCost' | 'cacheCost' | 'cacheWriteCost'
    | 'longContextInputCost' | 'longContextOutputCost' | 'longContextCacheCost' | 'longContextCacheWriteCost';

const standardCostKeys: readonly CostKey[] = ['inputCost', 'outputCost', 'cacheCost', 'cacheWriteCost'];
const longContextCostKeys: readonly CostKey[] = [
    'longContextInputCost', 'longContextOutputCost', 'longContextCacheCost', 'longContextCacheWriteCost',
];

/** Credits per 1M tokens as a small grid: one column per token kind, one row per context tier. */
function CostGrid({ model }: { model: AvailableModelInfo }): JSX.Element | null {
    const columns = [l10n.t('Input'), l10n.t('Output'), l10n.t('Cache read'), l10n.t('Cache write')];
    const tiers = [
        { label: l10n.t('Standard'), keys: standardCostKeys },
        { label: l10n.t('Long context'), keys: longContextCostKeys },
    ].filter((tier) => tier.keys.some((key) => model[key] !== undefined));
    if (tiers.length === 0) {
        return null;
    }
    const visible = columns.map((_, index) => tiers.some((tier) => model[tier.keys[index]] !== undefined));
    return (
        <table className="query-insights-model-cost-grid">
            <caption>{l10n.t('Credits per 1M tokens')}</caption>
            <thead>
                <tr>
                    <td />
                    {columns.map((column, index) => visible[index] && <th key={column} scope="col">{column}</th>)}
                </tr>
            </thead>
            <tbody>
                {tiers.map((tier) => (
                    <tr key={tier.label}>
                        <th scope="row">{tier.label}</th>
                        {tier.keys.map((key, index) => visible[index] && (
                            <td key={key}>{model[key] !== undefined ? formatCredits(model[key]) : '—'}</td>
                        ))}
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

interface ModelFact {
    readonly key: string;
    readonly label: string;
    readonly value: ReactNode;
}

/** Every fact is always listed, so a missing value reads as "not reported", never as a hidden section. */
function modelFacts(model: AvailableModelInfo, promptLabel: string | undefined): ModelFact[] {
    const notReported = <Text className="query-insights-model-muted">{l10n.t('Not reported for this model')}</Text>;
    const hasCosts = [...standardCostKeys, ...longContextCostKeys].some((key) => model[key] !== undefined);
    const capabilities: string[] = [];
    if (model.supportsToolCalling !== undefined) {
        capabilities.push(model.supportsToolCalling ? l10n.t('Tool calling') : l10n.t('No tool calling'));
    }
    if (model.supportsImageToText !== undefined) {
        capabilities.push(model.supportsImageToText ? l10n.t('Image input') : l10n.t('No image input'));
    }
    const facts: ModelFact[] = [
        {
            key: 'cost',
            label: l10n.t('Cost'),
            value: model.isUtility ? (
                <div className="query-insights-model-cost">
                    <Text>{l10n.t('No additional cost for most GitHub Copilot subscribers.')}</Text>
                    <CostGrid model={model} />
                </div>
            ) : model.priceCategory || hasCosts ? (
                <div className="query-insights-model-cost">
                    <ModelCostBadge category={model.priceCategory} />
                    <CostGrid model={model} />
                </div>
            ) : notReported,
        },
        {
            key: 'context',
            label: l10n.t('Context window'),
            value: model.maxInputTokens > 0
                ? l10n.t('{0} tokens', model.maxInputTokens.toLocaleString(navigator.language))
                : notReported,
        },
        {
            key: 'capabilities',
            label: l10n.t('Capabilities'),
            value: capabilities.length > 0 ? capabilities.join(' · ') : notReported,
        },
        {
            key: 'id',
            label: l10n.t('Model ID'),
            value: <span className="query-insights-model-identity">{model.id}</span>,
        },
    ];
    if (promptLabel) {
        facts.push({ key: 'prompt', label: l10n.t('Prompt'), value: promptLabel });
    }
    return facts;
}

function FactList({ facts }: { facts: readonly ModelFact[] }): JSX.Element {
    return (
        <dl className="query-insights-model-fact-list">
            {facts.map((fact) => (
                <div key={fact.key}>
                    <dt>{fact.label}</dt>
                    <dd>{fact.value}</dd>
                </div>
            ))}
        </dl>
    );
}

export function ModelPicker({
    commandType,
    compact = false,
    disabled = false,
    onModelChange,
    onPromptLabelChange,
}: ModelPickerProps): JSX.Element {
    const client = useTrpcClient();
    const dropdownLabelId = useId('query-insights-model-label');
    const [available, setAvailable] = useState<AvailableModelsResult>();
    const [promptSource, setPromptSource] = useState<IndexAdvisorPromptSourceInfo>();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string>();
    const [refreshKey, setRefreshKey] = useState(0);
    const mounted = useRef(false);
    const selected = available?.models.find((model) => model.id === available.effectiveModelId);
    const promptLabelForCallback = promptSource
        ? promptSource.source === 'custom-file'
            ? l10n.t('Custom prompt {0}', promptSource.path?.split(/[/\\]/).pop() ?? '')
            : l10n.t('Built-in prompt')
        : undefined;

    useEffect(() => {
        onPromptLabelChange?.(promptLabelForCallback);
    }, [promptLabelForCallback, onPromptLabelChange]);

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
    const selectionReason = ((): string => {
        switch (available?.effectiveReason) {
            case 'saved': return l10n.t('Saved choice');
            case 'first-powerful': return l10n.t('Default: first Powerful model');
            default: return l10n.t('Default: first available model');
        }
    })();
    const promptBasename = promptSource?.path?.split(/[/\\]/).pop();
    const promptLabel = promptSource
        ? promptSource.source === 'custom-file'
            ? l10n.t('Custom file {0}', promptBasename ?? '')
            : l10n.t('Built-in')
        : undefined;
    const utility = models.filter((model) => model.isUtility);
    const others = models.filter((model) => !model.isUtility);
    const option = (model: AvailableModelInfo): JSX.Element => (
        <Option key={model.id} value={model.id} text={model.name}>
            <span className="query-insights-model-option">
                <span>{model.name}</span>
                <span className="query-insights-model-option-meta">
                    <Text size={200} className="query-insights-model-muted">
                        {[model.isUtility ? undefined : model.pricing, model.maxInputTokens > 0 ? formatTokenCount(model.maxInputTokens, navigator.language) : undefined].filter(Boolean).join(' · ')}
                    </Text>
                    <Badge appearance="tint" shape="rounded" size="small">
                        {model.isUtility ? l10n.t('Utility') : categoryLabel(model.category)}
                    </Badge>
                </span>
            </span>
        </Option>
    );

    const dropdown = (
        <Dropdown
            aria-labelledby={compact ? undefined : dropdownLabelId}
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
    );
    const selectionNote = selected && (
        <Text size={200} className="query-insights-model-muted">
            {selectionReason}
            {!selected.isUtility && <> · {l10n.t('May use premium requests')}</>}
        </Text>
    );

    if (compact) {
        // Option A (Phase F): a VS Code chat-style model pill next to the primary action.
        const groups = [
            { key: 'utility', label: l10n.t('Utility'), models: utility },
            ...['powerful', 'versatile', 'lightweight', 'other'].map((category) => ({
                key: category,
                label: categoryLabel(category),
                models: others.filter((model) =>
                    (['powerful', 'versatile', 'lightweight'].includes(model.category ?? '') ? model.category : 'other') === category),
            })),
        ].filter((group) => group.models.length > 0);
        const pillLabel = selected
            ? l10n.t('Copilot model: {0}', selected.name)
            : loading ? l10n.t('Loading models…') : l10n.t('No Copilot models available');
        return (
            <span className="query-insights-model-pill">
                <Menu
                    positioning="below-start"
                    hasCheckmarks
                    checkedValues={{ model: selected ? [selected.id] : [] }}
                    onCheckedValueChange={(_event, data) => {
                        const modelId = data.checkedItems[0];
                        if (data.name === 'model' && modelId && modelId !== selected?.id) {
                            void selectModel(modelId);
                        }
                    }}
                >
                    <Tooltip
                        content={selected ? <FactList facts={modelFacts(selected, promptLabel)} /> : pillLabel}
                        relationship="description"
                    >
                        <MenuTrigger disableButtonEnhancement>
                            <MenuButton
                                appearance="subtle"
                                aria-label={pillLabel}
                                disabled={disabled || loading || saving || models.length === 0}
                            >
                                <span className="query-insights-model-pill-content">
                                    {selected?.name ?? pillLabel}
                                    {selected && !selected.isUtility && <ModelCostBadge category={selected.priceCategory} />}
                                </span>
                            </MenuButton>
                        </MenuTrigger>
                    </Tooltip>
                    <MenuPopover>
                        <MenuList>
                            {groups.map((group) => (
                                <MenuGroup key={group.key}>
                                    <MenuGroupHeader>{group.label}</MenuGroupHeader>
                                    {group.models.map((model) => (
                                        <MenuItemRadio
                                            key={model.id}
                                            name="model"
                                            value={model.id}
                                            secondaryContent={!model.isUtility ? <ModelCostBadge category={model.priceCategory} /> : undefined}
                                        >
                                            {model.name}
                                        </MenuItemRadio>
                                    ))}
                                </MenuGroup>
                            ))}
                        </MenuList>
                    </MenuPopover>
                </Menu>
                {error && <Text size={200}>{error}</Text>}
                {!loading && models.length === 0 && (
                    <Button appearance="subtle" size="small" onClick={() => setRefreshKey((value) => value + 1)}>
                        {l10n.t('Refresh models')}
                    </Button>
                )}
                <Announcer when={!!error} message={error ?? ''} />
            </span>
        );
    }

    const facts = selected ? modelFacts(selected, promptLabel) : [];
    return (
            <div className="query-insights-model-picker">
                <Table size="small" className="query-insights-model-table">
                    <colgroup>
                        <col className="query-insights-model-table-label" />
                        <col />
                    </colgroup>
                    <TableBody>
                        <TableRow>
                            <TableCell>
                                <TableCellLayout appearance="primary">
                                    <span id={dropdownLabelId}>{l10n.t('Copilot model')}</span>
                                </TableCellLayout>
                            </TableCell>
                            <TableCell className="query-insights-model-table-value">
                                {dropdown}
                                {selectionNote}
                            </TableCell>
                        </TableRow>
                        {facts.map((fact) => (
                            <TableRow key={fact.key}>
                                <TableCell><TableCellLayout appearance="primary">{fact.label}</TableCellLayout></TableCell>
                                <TableCell className="query-insights-model-table-value">{fact.value}</TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
                {selected && (
                    <Text size={200} className="query-insights-model-muted">
                        {l10n.t('Thinking level and context size follow this model\'s settings in the VS Code Chat model picker.')}
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
