/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, Dropdown, Field, Option, Text } from '@fluentui/react-components';
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
                    {models.map((model) => (
                        <Option key={model.id} value={model.id} text={model.name}>
                            <span className="query-insights-model-option">
                                <span>{model.name}</span>
                                <Text size={200} className="query-insights-model-muted">
                                    {l10n.t('{0} tokens', formatTokenCount(model.maxInputTokens, navigator.language))}
                                </Text>
                            </span>
                        </Option>
                    ))}
                </Dropdown>
            </Field>
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
