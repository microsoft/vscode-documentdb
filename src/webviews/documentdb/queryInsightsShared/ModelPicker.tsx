/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Badge,
    Button,
    CompoundButton,
    Dropdown,
    Label,
    Menu,
    MenuGroup,
    MenuGroupHeader,
    MenuItemRadio,
    MenuList,
    MenuPopover,
    MenuTrigger,
    Option,
    OptionGroup,
    Popover,
    PopoverSurface,
    PopoverTrigger,
    Text,
    useId,
} from '@fluentui/react-components';
import { ChevronDownRegular, InfoRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { Fragment, useEffect, useRef, useState, type JSX, type ReactNode } from 'react';
import type { CommandType } from '../../../commands/llmEnhancedCommands/indexAdvisorCommands';
import type { AvailableModelInfo, AvailableModelsResult } from '../../../services/ai/modelSelection';
import type { IndexAdvisorPromptSourceInfo } from '../../../services/promptTemplateService';
import { useTrpcClient } from '../../_integration/useTrpcClient';
import { Announcer } from '../../components/accessibility';
import './ModelPicker.scss';

export type ModelPickerVariant = 'label-change' | 'compound' | 'outline-button' | 'outline' | 'filled-darker' | 'underline';

export interface ModelPickerProps {
    commandType: CommandType;
    /** Control size; the Collection View card uses `small`, the wizard matches its other fields. */
    size?: 'small' | 'medium';
    /** Show a visible "Copilot model" label above the dropdown (wizard form layout). */
    showLabel?: boolean;
    disabled?: boolean;
    /** Undefined while loading/saving, or when no model is available. */
    onModelChange?: (model: AvailableModelInfo | undefined) => void;
    /** The prompt source label, so the host can show it in its meta line. */
    onPromptLabelChange?: (label: string | undefined) => void;
    /** POC comparison: render several presentations backed by one selection and request lifecycle. */
    children?: (renderPicker: (variant: ModelPickerVariant) => JSX.Element) => ReactNode;
}

const knownCategories = ['powerful', 'versatile', 'lightweight'];

function categoryLabel(category: string | undefined): string {
    switch (category) {
        case 'powerful': return l10n.t('Powerful');
        case 'versatile': return l10n.t('Versatile');
        case 'lightweight': return l10n.t('Lightweight');
        default: return l10n.t('Other');
    }
}

function formatCredits(value: number): string {
    return new Intl.NumberFormat(navigator.language, { maximumFractionDigits: 2 }).format(value);
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

/** One line per context tier, each a list of parts such as "Input 125", "Output 1,000". */
function creditLines(model: AvailableModelInfo): { key: string; label?: string; parts: string[] }[] {
    const kinds = [l10n.t('Input'), l10n.t('Output'), l10n.t('Cache read'), l10n.t('Cache write')];
    const tiers: { key: string; label?: string; keys: readonly CostKey[] }[] = [
        { key: 'standard', keys: ['inputCost', 'outputCost', 'cacheCost', 'cacheWriteCost'] },
        {
            key: 'long-context',
            label: l10n.t('Long context'),
            keys: ['longContextInputCost', 'longContextOutputCost', 'longContextCacheCost', 'longContextCacheWriteCost'],
        },
    ];
    return tiers.flatMap((tier) => {
        const parts = tier.keys.flatMap((key, index) => {
            const value = model[key];
            return value !== undefined ? [`${kinds[index]} ${formatCredits(value)}`] : [];
        });
        if (parts.length === 0) return [];
        return [{ key: tier.key, label: tier.label, parts }];
    });
}

interface ModelFact {
    readonly key: string;
    readonly label: string;
    readonly value: ReactNode;
}

/** Every fact is always listed, so a missing value reads as "not reported", never as a hidden row. */
function modelFacts(model: AvailableModelInfo, promptLabel: string | undefined, selectionReason: string): ModelFact[] {
    const notReported = <Text size={200} className="query-insights-model-muted">{l10n.t('Not reported for this model')}</Text>;
    const credits = creditLines(model);
    const capabilities: string[] = [];
    if (model.supportsToolCalling !== undefined) {
        capabilities.push(model.supportsToolCalling ? l10n.t('Tool calling') : l10n.t('No tool calling'));
    }
    if (model.supportsImageToText !== undefined) {
        capabilities.push(model.supportsImageToText ? l10n.t('Image input') : l10n.t('No image input'));
    }
    let cost: ReactNode = notReported;
    if (model.isUtility) {
        cost = <Text size={200}>{l10n.t('No additional cost for most GitHub Copilot subscribers.')}</Text>;
    } else if (model.priceCategory) {
        cost = <ModelCostBadge category={model.priceCategory} />;
    }
    const facts: ModelFact[] = [
        { key: 'cost', label: l10n.t('Cost'), value: cost },
        {
            key: 'credits',
            label: l10n.t('Credits per 1M tokens'),
            value: credits.length > 0
                ? credits.map((line) => (
                    // Each part stays on one line, so wrapping happens only between parts.
                    <Text key={line.key} size={200} block>
                        {line.label && <>{l10n.t('{0}:', line.label)} </>}
                        {line.parts.map((part, index) => (
                            <Fragment key={part}>
                                {index > 0 && ' · '}
                                <span className="query-insights-model-nowrap">{part}</span>
                            </Fragment>
                        ))}
                    </Text>
                ))
                : notReported,
        },
        {
            key: 'context',
            label: l10n.t('Context window'),
            value: model.maxInputTokens > 0
                ? <Text size={200}>{l10n.t('{0} tokens', model.maxInputTokens.toLocaleString(navigator.language))}</Text>
                : notReported,
        },
        {
            key: 'capabilities',
            label: l10n.t('Capabilities'),
            value: capabilities.length > 0 ? <Text size={200}>{capabilities.join(' · ')}</Text> : notReported,
        },
        {
            key: 'id',
            label: l10n.t('Model ID'),
            value: <Text size={200} font="monospace" className="query-insights-model-identity">{model.id}</Text>,
        },
    ];
    if (promptLabel) {
        facts.push({ key: 'prompt', label: l10n.t('Prompt'), value: <Text size={200}>{promptLabel}</Text> });
    }
    facts.push({ key: 'selection', label: l10n.t('Selection'), value: <Text size={200}>{selectionReason}</Text> });
    return facts;
}

function ModelDetails({ model, facts }: { model: AvailableModelInfo; facts: readonly ModelFact[] }): JSX.Element {
    return (
        <div className="query-insights-model-details">
            <Text weight="semibold">{model.name}</Text>
            <dl className="query-insights-model-fact-list">
                {facts.map((fact) => (
                    <div key={fact.key}>
                        <dt><Text size={200}>{fact.label}</Text></dt>
                        <dd>{fact.value}</dd>
                    </div>
                ))}
            </dl>
            <Text size={200} className="query-insights-model-muted">
                {l10n.t('Thinking level and context size follow this model\'s settings in the VS Code Chat model picker.')}
            </Text>
        </div>
    );
}

/**
 * Copilot model selection shared by the Collection View card and the Query Insights Explorer:
 * a Fluent Dropdown grouped by model category, plus an info button whose popover holds the details.
 */
export function ModelPicker({
    commandType,
    size = 'small',
    showLabel = false,
    disabled = false,
    onModelChange,
    onPromptLabelChange,
    children,
}: ModelPickerProps): JSX.Element {
    const client = useTrpcClient();
    const labelId = useId('query-insights-model-label');
    const [available, setAvailable] = useState<AvailableModelsResult>();
    const [promptSource, setPromptSource] = useState<IndexAdvisorPromptSourceInfo>();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string>();
    const [refreshKey, setRefreshKey] = useState(0);
    const mounted = useRef(false);
    const requestId = useRef(0);
    const refreshRef = useRef<() => Promise<void>>(async () => undefined);
    const selected = available?.models.find((model) => model.id === available.effectiveModelId);
    const promptBasename = promptSource?.path?.split(/[/\\]/).pop() ?? '';
    let promptLabel: string | undefined;
    if (promptSource) {
        promptLabel = promptSource.source === 'custom-file'
            ? l10n.t('Custom prompt {0}', promptBasename)
            : l10n.t('Built-in prompt');
    }

    useEffect(() => {
        onPromptLabelChange?.(promptLabel);
    }, [promptLabel, onPromptLabelChange]);

    useEffect(() => {
        onModelChange?.(loading || saving ? undefined : selected);
    }, [loading, saving, selected, onModelChange]);

    useEffect(() => {
        mounted.current = true;
        const controller = new AbortController();
        let hasLoaded = false;
        // Only the first load shows the loading state; later refreshes (focus, dropdown open) are silent
        // so an open listbox is not disabled and closed while Copilot registers more models.
        const refresh = async (): Promise<void> => {
            const currentRequest = ++requestId.current;
            if (!hasLoaded) setLoading(true);
            try {
                const [models, source] = await Promise.all([
                    client.ai.getAvailableModels.query(undefined, { signal: controller.signal }),
                    client.ai.getPromptSourceInfo.query({ commandType }, { signal: controller.signal }),
                ]);
                if (!controller.signal.aborted && currentRequest === requestId.current) {
                    hasLoaded = true;
                    setAvailable(models);
                    setPromptSource(source);
                    setError(undefined);
                }
            } catch (cause) {
                if (!controller.signal.aborted && currentRequest === requestId.current) {
                    setError(l10n.t('Failed to load model settings: {0}', cause instanceof Error ? cause.message : String(cause)));
                }
            } finally {
                if (!controller.signal.aborted && currentRequest === requestId.current) {
                    setLoading(false);
                }
            }
        };
        refreshRef.current = refresh;
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
        // Drop any in-flight refresh so it cannot overwrite the saved choice with older data.
        requestId.current++;
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

    const utility = available?.models.filter((model) => model.isUtility) ?? [];
    const others = available?.models.filter((model) => !model.isUtility) ?? [];
    const hasModels = utility.length + others.length > 0;
    let selectionReason: string;
    switch (available?.effectiveReason) {
        case 'saved': selectionReason = l10n.t('Saved choice'); break;
        case 'first-powerful': selectionReason = l10n.t('Default: first Powerful model'); break;
        default: selectionReason = l10n.t('Default: first available model');
    }

    const option = (model: AvailableModelInfo): JSX.Element => (
        <Option key={model.id} value={model.id} text={model.name}>
            <span className="query-insights-model-option">
                <span>{model.name}</span>
                {!model.isUtility && <ModelCostBadge category={model.priceCategory} />}
            </span>
        </Option>
    );
    const groupedOthers = others.some((model) => model.category)
        ? [...knownCategories, 'other'].map((category) => {
            const group = others.filter((model) =>
                (knownCategories.includes(model.category ?? '') ? model.category : 'other') === category);
            return group.length > 0
                ? <OptionGroup key={category} label={categoryLabel(category)}>{group.map(option)}</OptionGroup>
                : null;
        })
        : others.map(option);

    const renderPicker = (variant: ModelPickerVariant): JSX.Element => {
        const useMenu = variant === 'label-change' || variant === 'compound' || variant === 'outline-button';
        const modelName = selected?.name ?? (loading ? l10n.t('Loading models…') : l10n.t('No Copilot models available'));
        const menuOption = (model: AvailableModelInfo): JSX.Element => (
            <MenuItemRadio key={model.id} name="model" value={model.id}
                secondaryContent={model.isUtility ? undefined : <ModelCostBadge category={model.priceCategory} />}>
                {model.name}
            </MenuItemRadio>
        );
        const menuGroups = [
            { key: 'utility', label: l10n.t('Utility'), models: utility },
            ...[...knownCategories, 'other'].map((category) => ({
                key: category,
                label: categoryLabel(category),
                models: others.filter((model) =>
                    (knownCategories.includes(model.category ?? '') ? model.category : 'other') === category),
            })),
        ].filter((group) => group.models.length > 0);
        return (
            <div className="query-insights-model-picker">
                {showLabel && <Label id={`${labelId}-${variant}`} size="small">{l10n.t('Copilot model')}</Label>}
                <div className="query-insights-model-picker-row">
                    {variant === 'label-change' && <Text weight="semibold">{modelName}</Text>}
                    {useMenu ? (
                        <Menu
                            checkedValues={{ model: selected ? [selected.id] : [] }}
                            onOpenChange={(_event, data) => {
                                if (data.open) void refreshRef.current();
                            }}
                            onCheckedValueChange={(_event, data) => {
                                const modelId = data.checkedItems[0];
                                if (modelId && modelId !== selected?.id) void selectModel(modelId);
                            }}
                        >
                            <MenuTrigger disableButtonEnhancement>
                                {variant === 'compound' ? (
                                    <CompoundButton
                                        appearance="outline"
                                        size={size}
                                        secondaryContent={modelName}
                                        disabled={disabled || loading || saving || !hasModels}
                                    >
                                        {l10n.t('Change model')}
                                    </CompoundButton>
                                ) : (
                                    <Button
                                        appearance={variant === 'outline-button' ? 'outline' : 'subtle'}
                                        size={size}
                                        icon={variant === 'outline-button' ? <ChevronDownRegular /> : undefined}
                                        iconPosition="after"
                                        disabled={disabled || loading || saving || !hasModels}
                                    >
                                        {variant === 'label-change' ? l10n.t('Change') : modelName}
                                    </Button>
                                )}
                            </MenuTrigger>
                            <MenuPopover>
                                <MenuList className="query-insights-model-menu">
                                    {menuGroups.map((group) => (
                                        <MenuGroup key={group.key}>
                                            <MenuGroupHeader>{group.label}</MenuGroupHeader>
                                            {group.models.map(menuOption)}
                                        </MenuGroup>
                                    ))}
                                </MenuList>
                            </MenuPopover>
                        </Menu>
                    ) : (
                        <Dropdown
                            appearance={variant === 'filled-darker' || variant === 'underline' ? variant : 'outline'}
                            aria-label={showLabel ? undefined : l10n.t('Copilot model')}
                            aria-labelledby={showLabel ? `${labelId}-${variant}` : undefined}
                            size={size}
                            value={selected?.name ?? ''}
                            selectedOptions={selected ? [selected.id] : []}
                            placeholder={loading ? l10n.t('Loading models…') : l10n.t('No Copilot models available')}
                            disabled={disabled || loading || saving || !hasModels}
                            // Cap list height on one side of the trigger; autoSize height can cover the trigger.
                            positioning={{
                                position: 'below', align: 'start', fallbackPositions: ['above-start'],
                                autoSize: 'width', matchTargetSize: undefined,
                            }}
                            listbox={{ className: 'query-insights-model-listbox' }}
                            onOpenChange={(_event, data) => {
                                if (data.open) void refreshRef.current();
                            }}
                            onOptionSelect={(_event, data) => {
                                if (data.optionValue && data.optionValue !== selected?.id) {
                                    void selectModel(data.optionValue);
                                }
                            }}
                        >
                            {utility.map(option)}
                            {groupedOthers}
                        </Dropdown>
                    )}
                    {selected && (
                        <Popover openOnHover withArrow size="small" positioning={{ position: 'below', align: 'start', autoSize: 'height' }}>
                            <PopoverTrigger disableButtonEnhancement>
                                <Button appearance="subtle" size={size} icon={<InfoRegular />} aria-label={l10n.t('Model details')} />
                            </PopoverTrigger>
                            <PopoverSurface aria-label={l10n.t('Model details')} className="query-insights-model-details-surface">
                                <ModelDetails model={selected} facts={modelFacts(selected, promptLabel, selectionReason)} />
                            </PopoverSurface>
                        </Popover>
                    )}
                    {!loading && !hasModels && (
                        <Button appearance="subtle" size={size} onClick={() => setRefreshKey((value) => value + 1)}>
                            {l10n.t('Refresh models')}
                        </Button>
                    )}
                </div>
            </div>
        );
    };

    return (
        <>
            {children ? children(renderPicker) : renderPicker('outline')}
            {error && <Text size={200}>{error}</Text>}
            <Announcer when={!!error} message={error ?? ''} />
        </>
    );
}
