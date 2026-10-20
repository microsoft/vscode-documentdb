/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { Button, Field, Input, MessageBar, MessageBarBody, Select, Textarea } from '@fluentui/react-components';
import { ContainerFooter, Wizard, WizardStep } from '@microsoft/vscode-ext-webview-fluentui/components';
import { useConfiguration } from '@microsoft/vscode-ext-webview/react';
import * as l10n from '@vscode/l10n';
import { useCallback, useMemo, useState, type JSX } from 'react';
import type { CommandType } from '../../../commands/llmEnhancedCommands/indexAdvisorCommands';
import type { AvailableModelInfo } from '../../../services/ai/modelSelection';
import { useTrpcClient } from '../../_integration/useTrpcClient';
import type { QueryInsightsState } from '../collectionView/collectionViewContext';
import { QueryInsightsDataSourceContext, type QueryInsightsDataSource } from '../collectionView/queryInsightsTab/QueryInsightsDataSourceContext';
import { QueryInsightsMain } from '../collectionView/queryInsightsTab/QueryInsightsTab';
import { ModelPicker } from '../queryInsightsShared/ModelPicker';
import type { QueryInsightsPrefill, StandaloneInput } from './types';
import './queryInsightsStandalone.scss';

function Analyze({ input }: { input: StandaloneInput }): JSX.Element {
    const client = useTrpcClient();
    const [pipeline, setPipeline] = useState<QueryInsightsState>({ kind: 'idle' });
    const dispatch = useCallback<QueryInsightsDataSource['dispatch']>((transition) => setPipeline(transition), []);
    const source = useMemo<QueryInsightsDataSource>(() => ({
        pipeline, dispatch,
        identity: { databaseName: input.databaseName, collectionName: input.collectionName },
        actionsEnabled: false, isQueryLoading: false, autoStartStage3: true,
        commandType: input.commandType as CommandType,
        getStage1: () => client.queryInsightsStandalone.getStage1.query(input),
        getStage2: () => client.queryInsightsStandalone.getStage2.query(input),
        streamStage3: (requestKey, callbacks, modelId) =>
            client.queryInsightsStandalone.streamStage3.subscribe({ ...input, modelId: modelId ?? input.modelId, requestKey }, callbacks),
        executeAction: async () => ({ success: false, message: l10n.t('Index actions are disabled in the explorer.') }),
    }), [client, input, pipeline, dispatch]);
    return <QueryInsightsDataSourceContext.Provider value={source}><QueryInsightsMain /></QueryInsightsDataSourceContext.Provider>;
}

export function QueryInsightsStandalone(): JSX.Element {
    const prefill = useConfiguration<QueryInsightsPrefill>();
    const client = useTrpcClient();
    const [step, setStep] = useState('welcome');
    const [form, setForm] = useState<StandaloneInput>(() => ({
        explain: prefill.explain ?? '', query: prefill.query ?? '',
        commandType: prefill.commandType ?? 'auto',
        collectionStats: prefill.collectionStats ?? '', indexes: prefill.indexes ?? '',
        databaseName: prefill.databaseName ?? '', collectionName: prefill.collectionName ?? '',
        clusterType: prefill.clusterType ?? 'azure-documentdb',
    }));
    const [selectedModel, setSelectedModel] = useState<AvailableModelInfo>();
    const [detectedCommand, setDetectedCommand] = useState<CommandType>('find' as CommandType);
    const [analysisInput, setAnalysisInput] = useState<StandaloneInput>();
    const [error, setError] = useState<string>();
    const [validating, setValidating] = useState(false);
    const update = <K extends keyof StandaloneInput>(key: K, value: StandaloneInput[K]): void => {
        setForm((previous) => ({ ...previous, [key]: value }));
        setError(undefined);
    };
    const validate = async (analyze: boolean): Promise<void> => {
        setValidating(true);
        setError(undefined);
        try {
            const submitted = { ...form, modelId: selectedModel?.id };
            const result = await client.queryInsightsStandalone.validateInput.query(submitted);
            setDetectedCommand(result.commandType);
            setForm((previous) => ({ ...previous, query: result.query }));
            if (analyze) {
                setAnalysisInput({ ...submitted, query: result.query, commandType: result.commandType });
                setStep('analyze');
            }
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
        } finally {
            setValidating(false);
        }
    };
    return (
        <div className="queryInsightsStandalone">
            <Wizard
                activeStep={step}
                onStepChange={(value) => { if (!validating && value !== 'analyze') setStep(value); }}
                contentMaxWidth={step === 'analyze' ? '100%' : '900px'}
                stepsAriaLabel={l10n.t('Query Insights Explorer steps')}
                overflowAriaLabel={(count) => l10n.t('{0} more steps', String(count))}
                footer={<ContainerFooter>
                    {step !== 'welcome' && <Button disabled={validating} onClick={() => setStep(step === 'analyze' ? 'configure' : 'welcome')}>
                        {l10n.t('Back')}
                    </Button>}
                    {step === 'welcome' && <Button appearance="primary" onClick={() => setStep('configure')}>{l10n.t('Continue')}</Button>}
                    {step === 'configure' && <Button appearance="primary" aria-label={l10n.t('Analyze supplied data')} disabled={!form.explain.trim() || !selectedModel || validating}
                        onClick={() => void validate(true)}>
                        {validating ? l10n.t('Validating…') : l10n.t('Analyze')}
                    </Button>}
                </ContainerFooter>}
            >
                <WizardStep value="welcome" label={l10n.t('Welcome')} title={l10n.t('Query Insights Explorer (POC)')}>
                    <p>{l10n.t('Analyze an execution plan without connecting to a database. Paste the JSON output from explain("executionStats"). Optionally include collection statistics and index definitions or usage statistics.')}</p>
                    <p>{l10n.t('When you select Analyze, your supplied query, plan, statistics and indexes are sent to the selected GitHub Copilot model. Review the data before sending it. The selected model may use premium requests.')}</p>
                    <p>{l10n.t('The explorer reuses Query Insights analysis and layout. Index recommendations are copy-only; it cannot change a database.')}</p>
                </WizardStep>
                <WizardStep value="configure" label={l10n.t('Configure')} title={l10n.t('Provide your query data')}>
                    <div className="queryInsightsStandalone-fields">
                        <Field label={l10n.t('Explain plan')} required>
                            <Textarea resize="vertical" rows={12} value={form.explain}
                                onChange={(_event, data) => update('explain', data.value)} />
                        </Field>
                        <Button disabled={!form.explain.trim() || validating} onClick={() => void validate(false)}>
                            {l10n.t('Validate and extract query')}
                        </Button>
                        <Field label={l10n.t('Query or pipeline')} hint={l10n.t('Leave empty to extract from explain.command or queryPlanner.parsedQuery. Find accepts a filter or {filter, sort, projection, skip, limit}.')}>
                            <Textarea resize="vertical" rows={5} value={form.query}
                                onChange={(_event, data) => update('query', data.value)} />
                        </Field>
                        <Field label={l10n.t('Command type')}>
                            <Select value={form.commandType} onChange={(_event, data) => update('commandType', data.value as StandaloneInput['commandType'])}>
                                <option value="auto">{l10n.t('Auto-detect')}</option>
                                <option value="find">find</option><option value="aggregate">aggregate</option><option value="count">count</option>
                            </Select>
                        </Field>
                        <Field label={l10n.t('Collection statistics (optional)')}>
                            <Textarea resize="vertical" rows={4} value={form.collectionStats}
                                onChange={(_event, data) => update('collectionStats', data.value)} />
                        </Field>
                        <Field label={l10n.t('Indexes (optional)')} hint={l10n.t('Paste a getIndexes() or $indexStats JSON array, or a merged array containing both.')}>
                            <Textarea resize="vertical" rows={4} value={form.indexes}
                                onChange={(_event, data) => update('indexes', data.value)} />
                        </Field>
                        <Field label={l10n.t('Database name (optional)')}><Input value={form.databaseName}
                            onChange={(_event, data) => update('databaseName', data.value)} /></Field>
                        <Field label={l10n.t('Collection name (optional)')}><Input value={form.collectionName}
                            onChange={(_event, data) => update('collectionName', data.value)} /></Field>
                        <Field label={l10n.t('Cluster type')}>
                            <Select value={form.clusterType} onChange={(_event, data) => update('clusterType', data.value as StandaloneInput['clusterType'])}>
                                <option value="azure-documentdb">{l10n.t('Azure DocumentDB')}</option>
                                <option value="documentdb">{l10n.t('DocumentDB')}</option>
                                <option value="other">{l10n.t('Other')}</option>
                            </Select>
                        </Field>
                        <ModelPicker commandType={form.commandType === 'auto' ? detectedCommand : form.commandType as CommandType}
                            onModelChange={setSelectedModel} disabled={validating} />
                        {error && <MessageBar intent="error"><MessageBarBody>{error}</MessageBarBody></MessageBar>}
                    </div>
                </WizardStep>
                <WizardStep value="analyze" label={l10n.t('Analyze')} title={l10n.t('Query Insights')}>
                    {step === 'analyze' && analysisInput && <Analyze input={analysisInput} />}
                </WizardStep>
            </Wizard>
        </div>
    );
}
