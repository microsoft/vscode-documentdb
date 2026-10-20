/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import {
    Badge,
    CounterBadge,
    Button,
    Field,
    Input,
    Link,
    makeStyles,
    Radio,
    RadioGroup,
    Select,
    Spinner,
    Table,
    TableBody,
    TableCell,
    TableCellLayout,
    TableRow,
    Text,
    tokens,
    Tooltip,
} from '@fluentui/react-components';
import {
    ArrowLeftRegular,
    CheckmarkCircleRegular,
    CheckmarkRegular,
    CopyRegular,
    DataUsageRegular,
    EditRegular,
    ErrorCircleRegular,
    ShieldLockRegular,
} from '@fluentui/react-icons';
import { Collapse } from '@fluentui/react-motion-components-preview';
import { ContainerFooter, ContainerHeader, Wizard, WizardStep } from '@microsoft/vscode-ext-webview-fluentui/components';
import { useConfiguration } from '@microsoft/vscode-ext-webview/react';
import * as l10n from '@vscode/l10n';
import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState, type JSX, type ReactNode } from 'react';
import type { CommandType } from '../../../commands/llmEnhancedCommands/indexAdvisorCommands';
import type { AvailableModelInfo } from '../../../services/ai/modelSelection';
import type { IndexAdvisorPromptSourceInfo } from '../../../services/promptTemplateService';
import { useTrpcClient } from '../../_integration/useTrpcClient';
import { Announcer } from '../../components/accessibility';
import { MessageBlock } from '../../components/MessageBlock';
import type { QueryInsightsState } from '../collectionView/collectionViewContext';
import { QueryInsightsDataSourceContext, type QueryInsightsDataSource } from '../collectionView/queryInsightsTab/QueryInsightsDataSourceContext';
import { QueryInsightsMain } from '../collectionView/queryInsightsTab/QueryInsightsTab';
import { QueryInsightsDesignPreview } from '../queryInsightsShared/designPreview/QueryInsightsDesignPreview';
import { ModelPicker } from '../queryInsightsShared/ModelPicker';
import { QueryInsightsPreviewBadge } from '../queryInsightsShared/QueryInsightsPreviewBadge';
import type { InputIssue, StandaloneInspection } from './queryInsightsStandaloneInput';
import { JsonPlanEditor } from './JsonPlanEditor';
import { contextSnippets, explainSnippets, samplePlan, type SampleCommand, type ShellSnippet } from './samplePlans';
import type { QueryInsightsPrefill, StandaloneInput } from './types';
import './queryInsightsStandalone.scss';

type StepId = 'welcome' | 'configure' | 'analyze';
type OptionalRow = 'collectionStats' | 'indexes' | 'namespace' | 'clusterType';
type AnalysisKind = QueryInsightsState['kind'];

const useStyles = makeStyles({
    muted: { color: tokens.colorNeutralForeground2 },
    // Matches LocalQuickStart: a section owns its heading, which keeps more air above than below.
    section: { display: 'flex', flexDirection: 'column', gap: '8px' },
    sections: { display: 'flex', flexDirection: 'column', gap: '28px', marginTop: '8px' },
    sectionHeading: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', margin: 0 },
    // Same numbered list as LocalQuickStart's "What will happen in the Set up step".
    needList: { display: 'flex', flexDirection: 'column', gap: '2px', margin: 0, padding: 0, listStyle: 'none' },
    needItem: { display: 'grid', gridTemplateColumns: '24px minmax(0, 1fr)', gap: '0 10px', padding: '7px 0' },
    needNumber: { justifySelf: 'start', alignSelf: 'start', marginTop: '1px' },
    needCopy: { display: 'flex', flexDirection: 'column', gap: '1px', minWidth: 0 },
    needTitle: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px' },
    prefilledNote: { display: 'inline-flex', alignItems: 'center', gap: '4px', color: tokens.colorPaletteGreenForeground1 },
    snippetList: { display: 'flex', flexDirection: 'column', gap: '6px' },
    snippetGroupLabel: { marginTop: '6px' },
    snippet: {
        display: 'grid',
        gridTemplateColumns: '84px minmax(0, 1fr) auto',
        alignItems: 'start',
        gap: '8px',
        padding: '4px 4px 4px 10px',
        borderRadius: tokens.borderRadiusMedium,
        border: `1px solid ${tokens.colorNeutralStroke2}`,
        backgroundColor: tokens.colorNeutralBackground2,
        '@media (max-width: 480px)': { gridTemplateColumns: 'minmax(0, 1fr) auto' },
    },
    snippetLabel: {
        paddingTop: '5px',
        color: tokens.colorNeutralForeground2,
        '@media (max-width: 480px)': { display: 'none' },
    },
    code: {
        margin: 0,
        paddingTop: '5px',
        minWidth: 0,
        whiteSpace: 'pre-wrap',
        overflowWrap: 'anywhere',
        fontFamily: tokens.fontFamilyMonospace,
        fontSize: tokens.fontSizeBase200,
        lineHeight: tokens.lineHeightBase300,
        color: tokens.colorNeutralForeground1,
    },
    mono: { fontFamily: tokens.fontFamilyMonospace, fontSize: tokens.fontSizeBase200 },
    sampleRow: { display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: '4px 10px' },
    detected: {
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        padding: '12px',
        borderRadius: tokens.borderRadiusMedium,
        border: `1px solid ${tokens.colorNeutralStroke2}`,
        backgroundColor: tokens.colorNeutralBackground2,
    },
    facts: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 20px', margin: 0 },
    fact: { display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0, margin: 0 },
    factValue: { margin: 0, minWidth: 0, overflowWrap: 'anywhere' },
    queryPreview: {
        margin: 0,
        padding: '8px 10px',
        borderRadius: tokens.borderRadiusSmall,
        backgroundColor: tokens.colorNeutralBackground1,
        border: `1px solid ${tokens.colorNeutralStroke2}`,
        whiteSpace: 'pre-wrap',
        overflowWrap: 'anywhere',
        fontFamily: tokens.fontFamilyMonospace,
        fontSize: tokens.fontSizeBase200,
        color: tokens.colorNeutralForeground1,
    },
    detectedActions: { display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '8px 16px' },
    commandSelect: { minWidth: '200px' },
    issue: { display: 'flex', alignItems: 'flex-start', gap: '6px', color: tokens.colorPaletteRedForeground1 },
    issueIcon: { flexShrink: 0, marginTop: '2px' },
    // Fluent's Table is `table-layout: fixed`: every column that must not take the leftover space
    // needs an explicit width (copied from LocalQuickStart's settings table).
    colLabel: { width: '200px', '@media (max-width: 560px)': { width: '110px' } },
    colAction: { width: '48px' },
    valueCell: { minWidth: 0, overflowWrap: 'anywhere' },
    rowAction: { display: 'flex', justifyContent: 'flex-end' },
    editorRow: { borderBottom: 'none' },
    editorCell: { display: 'table-cell', height: 'auto', padding: 0 },
    editorBody: {
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        padding: '10px 12px 14px 208px',
        borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
        '@media (max-width: 560px)': { paddingLeft: '12px' },
    },
    nameFields: {
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'flex-start',
        gap: '12px',
        '> *': { flexGrow: 1, flexBasis: '200px', minWidth: 0 },
        '& .fui-Input': { minWidth: 0 },
    },
    summaryBar: {
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: '4px 8px',
        marginBottom: '8px',
        color: tokens.colorNeutralForeground2,
    },
});

function describeIssue(issue: InputIssue): string {
    return issue.line !== undefined && issue.column !== undefined
        ? l10n.t('Line {0}, column {1}: {2}', String(issue.line), String(issue.column), issue.message)
        : issue.message;
}

function namespaceOf(databaseName?: string, collectionName?: string): string | undefined {
    if (databaseName && collectionName) return `${databaseName}.${collectionName}`;
    return collectionName || databaseName || undefined;
}

function clusterTypeLabel(value: StandaloneInput['clusterType']): string {
    switch (value) {
        case 'azure-documentdb':
            return l10n.t('Azure DocumentDB');
        case 'documentdb':
            return l10n.t('DocumentDB');
        default:
            return l10n.t('Other');
    }
}

function CodeSnippet({ snippet, onCopy }: { snippet: ShellSnippet; onCopy: (snippet: ShellSnippet) => Promise<boolean> }): JSX.Element {
    const styles = useStyles();
    const [copied, setCopied] = useState(false);
    useEffect(() => {
        if (!copied) return undefined;
        const timer = window.setTimeout(() => setCopied(false), 2000);
        return () => window.clearTimeout(timer);
    }, [copied]);
    const label = l10n.t('Copy the {0} command', snippet.label);
    return (
        <div className={styles.snippet}>
            <Text size={200} className={styles.snippetLabel} aria-hidden>
                {snippet.label}
            </Text>
            <pre className={styles.code}>
                <code>{snippet.code}</code>
            </pre>
            <Tooltip content={copied ? l10n.t('Copied') : label} relationship="label" withArrow>
                <Button
                    appearance="subtle"
                    size="small"
                    icon={copied ? <CheckmarkRegular /> : <CopyRegular />}
                    onClick={() => void onCopy(snippet).then(setCopied)}
                />
            </Tooltip>
        </div>
    );
}

function Analyze({ input, onKindChange }: { input: StandaloneInput; onKindChange: (kind: AnalysisKind) => void }): JSX.Element {
    const client = useTrpcClient();
    const [pipeline, setPipeline] = useState<QueryInsightsState>({ kind: 'idle' });
    const dispatch = useCallback<QueryInsightsDataSource['dispatch']>((transition) => setPipeline(transition), []);
    useEffect(() => onKindChange(pipeline.kind), [pipeline.kind, onKindChange]);
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
        viewRawExplain: async (): Promise<void> => { await client.queryInsightsStandalone.openRawExplain.mutate(input); },
    }), [client, input, pipeline, dispatch]);
    return (
        // The wizard body is the only scroll container: this host flattens the tab's own scroll area.
        <div className="queryInsightsExplorer-analysis">
            <QueryInsightsDataSourceContext.Provider value={source}><QueryInsightsMain /></QueryInsightsDataSourceContext.Provider>
        </div>
    );
}

export function QueryInsightsStandalone(): JSX.Element {
    const { designPreview } = useConfiguration<QueryInsightsPrefill>();
    return designPreview === 'tab-model-selection' ? <QueryInsightsDesignPreview /> : <QueryInsightsWizard />;
}

function QueryInsightsWizard(): JSX.Element {
    const styles = useStyles();
    const prefill = useConfiguration<QueryInsightsPrefill>();
    const client = useTrpcClient();
    const noteId = useId();
    const [step, setStep] = useState<StepId>('welcome');
    const [form, setForm] = useState<StandaloneInput>(() => ({
        explain: prefill.explain ?? '', query: prefill.query ?? '',
        commandType: prefill.commandType ?? 'auto',
        collectionStats: prefill.collectionStats ?? '', indexes: prefill.indexes ?? '',
        databaseName: prefill.databaseName ?? '', collectionName: prefill.collectionName ?? '',
        clusterType: prefill.clusterType ?? 'azure-documentdb',
    }));
    const [inspection, setInspection] = useState<StandaloneInspection>();
    const [inspecting, setInspecting] = useState(false);
    const [inspectFailure, setInspectFailure] = useState<string>();
    const [submitting, setSubmitting] = useState(false);
    const [selectedModel, setSelectedModel] = useState<AvailableModelInfo>();
    const [openRows, setOpenRows] = useState<Partial<Record<OptionalRow, boolean>>>({});
    const [editingQuery, setEditingQuery] = useState(() => !!prefill.query?.trim());
    const [analysisInput, setAnalysisInput] = useState<StandaloneInput>();
    const [analysisPrompt, setAnalysisPrompt] = useState<IndexAdvisorPromptSourceInfo>();
    const [runKey, setRunKey] = useState(0);
    const [analysisKind, setAnalysisKind] = useState<AnalysisKind>('idle');
    const [announcement, setAnnouncement] = useState<{ key: number; message: string }>({ key: 0, message: '' });
    const announce = useCallback((message: string): void => setAnnouncement((previous) => ({ key: previous.key + 1, message })), []);

    const update = <K extends keyof StandaloneInput>(key: K, value: StandaloneInput[K]): void => {
        setForm((previous) => ({ ...previous, [key]: value }));
    };

    // Live validation. Debounced, and every newer edit aborts the older request.
    const { explain, query, commandType, collectionStats, indexes, clusterType } = form;
    const inspectionInput = useMemo<StandaloneInput>(() => ({
        explain, query, commandType, collectionStats, indexes, clusterType, databaseName: '', collectionName: '',
    }), [explain, query, commandType, collectionStats, indexes, clusterType]);
    const latestInspection = useRef(0);
    useEffect(() => {
        const controller = new AbortController();
        const request = ++latestInspection.current;
        setInspecting(true);
        const timer = window.setTimeout(() => {
            client.queryInsightsStandalone.inspectInput.query(inspectionInput, { signal: controller.signal })
                .then((result) => {
                    if (request === latestInspection.current) {
                        setInspection(result);
                        setInspectFailure(undefined);
                    }
                })
                .catch((cause: unknown) => {
                    if (!controller.signal.aborted && request === latestInspection.current) {
                        setInspectFailure(cause instanceof Error ? cause.message : String(cause));
                    }
                })
                .finally(() => {
                    if (request === latestInspection.current) setInspecting(false);
                });
        }, 250);
        return () => {
            window.clearTimeout(timer);
            controller.abort();
        };
    }, [client, inspectionInput]);

    const explainInfo = inspection?.explain?.ok ? inspection.explain : undefined;
    const explainIssue = inspection?.explain && !inspection.explain.ok ? inspection.explain : undefined;
    const effectiveDatabase = form.databaseName.trim() || explainInfo?.databaseName || '';
    const effectiveCollection = form.collectionName.trim() || explainInfo?.collectionName || '';
    const effectiveCommand = (inspection?.commandType ?? explainInfo?.detectedCommandType ?? 'find') as CommandType;
    const pending = inspecting || submitting;

    let blockedReason: string | undefined;
    if (!form.explain.trim()) blockedReason = l10n.t('Paste an explain plan to continue.');
    else if (explainIssue) blockedReason = l10n.t('Fix the explain plan to continue.');
    else if (inspection?.queryIssue) blockedReason = l10n.t('Fix the query to continue.');
    else if (inspection?.collectionStats?.ok === false) blockedReason = l10n.t('Fix the collection statistics to continue.');
    else if (inspection?.indexes?.ok === false) blockedReason = l10n.t('Fix the indexes to continue.');
    else if (!selectedModel) blockedReason = l10n.t('Choose a GitHub Copilot model to continue.');
    const canAnalyze = !blockedReason && !pending && inspection?.ready === true;

    const copySnippet = useCallback(async (snippet: ShellSnippet): Promise<boolean> => {
        try {
            await client.common.copyToClipboard.mutate({ text: snippet.code });
            announce(l10n.t('Copied the {0} command.', snippet.label));
            return true;
        } catch {
            announce(l10n.t('Could not copy the {0} command.', snippet.label));
            return false;
        }
    }, [client, announce]);

    const loadSample = (command: SampleCommand): void => {
        setForm((previous) => ({ ...previous, explain: samplePlan(command), query: '', commandType: 'auto' }));
        setEditingQuery(false);
        announce(l10n.t('Loaded the {0} sample plan.', command));
    };

    const analyze = async (): Promise<void> => {
        setSubmitting(true);
        try {
            const result = await client.queryInsightsStandalone.inspectInput.query(inspectionInput);
            setInspection(result);
            if (!result.ready || !result.commandType || result.query === undefined) return;
            setAnalysisInput({
                ...form, query: result.query, commandType: result.commandType,
                databaseName: effectiveDatabase, collectionName: effectiveCollection, modelId: selectedModel?.id,
            });
            setRunKey((value) => value + 1);
            setStep('analyze');
        } catch (cause) {
            setInspectFailure(cause instanceof Error ? cause.message : String(cause));
        } finally {
            setSubmitting(false);
        }
    };

    useEffect(() => {
        if (step !== 'analyze' || !analysisInput) return;
        const controller = new AbortController();
        setAnalysisPrompt(undefined);
        void client.ai.getPromptSourceInfo.query(
            { commandType: analysisInput.commandType as CommandType }, { signal: controller.signal },
        ).then((source) => {
            if (!controller.signal.aborted) setAnalysisPrompt(source);
        }).catch(() => { /* Optional header metadata must not interrupt analysis. */ });
        return () => controller.abort();
    }, [client, step, analysisInput]);

    const toggleRow = (row: OptionalRow): void => setOpenRows((previous) => ({ ...previous, [row]: !previous[row] }));

    // ---- chrome -----------------------------------------------------------------------------

    const header = (
        <ContainerHeader
            media={<DataUsageRegular aria-hidden />}
            title={l10n.t('Query Insights Explorer')}
            subtitle={l10n.t('Analyze a query plan with GitHub Copilot, without connecting to a database.')}
            action={<QueryInsightsPreviewBadge feature />}
        />
    );

    // ---- Welcome ----------------------------------------------------------------------------

    const needs: readonly { label: string; detail: string; required: boolean; provided: boolean }[] = [
        {
            label: l10n.t('Explain output'),
            detail: l10n.t('The result of explain("executionStats"). Every rating and the plan diagram are based on it.'),
            required: true, provided: !!prefill.explain?.trim(),
        },
        {
            label: l10n.t('Collection statistics'),
            detail: l10n.t('The document count shows how much of the collection the query reads.'),
            required: false, provided: !!prefill.collectionStats?.trim(),
        },
        {
            label: l10n.t('Indexes'),
            detail: l10n.t('Lets GitHub Copilot reuse an existing index instead of recommending a duplicate.'),
            required: false, provided: !!prefill.indexes?.trim(),
        },
    ];

    const welcome = (
        <div className={styles.sections}>
            <section className={styles.section} aria-labelledby={`${noteId}-needs`}>
                <Text as="h3" size={400} weight="semibold" id={`${noteId}-needs`} className={styles.sectionHeading}>
                    {l10n.t('What you\'ll need')}
                </Text>
                <ol className={styles.needList}>
                    {needs.map((need, index) => (
                        <li className={styles.needItem} key={need.label}>
                            {/* Fluent's own default: filled, brand, circular (as in LocalQuickStart). */}
                            <CounterBadge aria-hidden count={index + 1} className={styles.needNumber} />
                            <div className={styles.needCopy}>
                                <span className={styles.needTitle}>
                                    <Text>{need.label}</Text>
                                    {need.required ? (
                                        <Badge appearance="tint" shape="rounded" size="small" color="brand">{l10n.t('Required')}</Badge>
                                    ) : (
                                        <Badge appearance="tint" shape="rounded" size="small" color="informative">{l10n.t('Optional')}</Badge>
                                    )}
                                </span>
                                <Text size={200} className={styles.muted}>{need.detail}</Text>
                                {need.provided && (
                                    <Text size={200} className={styles.prefilledNote}>
                                        <CheckmarkCircleRegular aria-hidden="true" /> {l10n.t('Prefilled from your session')}
                                    </Text>
                                )}
                            </div>
                        </li>
                    ))}
                </ol>
            </section>
            <section className={styles.section} aria-labelledby={`${noteId}-snippets`}>
                <Text as="h3" size={400} weight="semibold" id={`${noteId}-snippets`} className={styles.sectionHeading}>
                    {l10n.t('Get the explain output')}
                </Text>
                <Text size={200} className={styles.muted}>
                    {l10n.t('Run one of these in the DocumentDB shell or mongosh with your own collection and filter, then copy the whole result.')}
                </Text>
                <div className={styles.snippetList}>
                    {explainSnippets.map((snippet) => <CodeSnippet key={snippet.id} snippet={snippet} onCopy={copySnippet} />)}
                    <Text size={200} weight="semibold" className={styles.snippetGroupLabel}>
                        {l10n.t('Optional context')}
                    </Text>
                    {contextSnippets.map((snippet) => <CodeSnippet key={snippet.id} snippet={snippet} onCopy={copySnippet} />)}
                </div>
            </section>
            <MessageBlock intent="info" icon={<ShieldLockRegular />} title={l10n.t('What is sent to GitHub Copilot')}>
                <span>{l10n.t('When you analyze, the explain plan, query, statistics and indexes you provide are sent to the selected GitHub Copilot model. Values in filters are included as-is, so remove anything sensitive first.')}</span>
                <span>{l10n.t('Recommendations are copy-only; the explorer never changes a database.')}</span>
            </MessageBlock>
        </div>
    );

    // ---- Configure --------------------------------------------------------------------------

    const issueLine = (issue: InputIssue): JSX.Element => (
        <Text size={200} className={styles.issue}>
            <ErrorCircleRegular aria-hidden className={styles.issueIcon} />
            <span>{describeIssue(issue)}</span>
        </Text>
    );

    let explainState: 'none' | 'error' | 'success' = 'none';
    let explainMessage: string | undefined;
    if (form.explain.trim() && !inspecting && explainIssue) {
        explainState = 'error';
        explainMessage = describeIssue(explainIssue);
    } else if (form.explain.trim() && !inspecting && explainInfo) {
        explainState = 'success';
        explainMessage = l10n.t('Explain plan parsed.');
    }
    const detectedNamespace = namespaceOf(explainInfo?.databaseName, explainInfo?.collectionName);
    const commandWasDetected = form.commandType === 'auto';

    const explainSection = (
        <section className={styles.section} aria-labelledby={`${noteId}-explain`}>
            <Text as="h3" size={400} weight="semibold" id={`${noteId}-explain`} className={styles.sectionHeading}>
                {l10n.t('Explain plan')}
                <Badge appearance="tint" shape="rounded" size="small" color="brand">{l10n.t('Required')}</Badge>
            </Text>
            <Field
                label={l10n.t('Explain output')}
                required
                hint={explainState === 'none' && !inspecting
                    ? l10n.t('Paste the complete result of explain("executionStats"). JSON, Extended JSON and shell output are accepted.')
                    : undefined}
                validationState={explainState}
                validationMessage={inspecting && form.explain.trim()
                    ? <span className={styles.sampleRow}><Spinner size="extra-tiny" aria-hidden /> {l10n.t('Checking…')}</span>
                    : explainMessage}
                validationMessageIcon={inspecting && form.explain.trim() ? null : undefined}
            >
                <JsonPlanEditor
                    ariaLabel={l10n.t('Explain output')}
                    value={form.explain}
                    issue={!inspecting ? explainIssue : undefined}
                    onChange={(value) => update('explain', value)}
                />
            </Field>
            <div className={styles.sampleRow} role="group" aria-labelledby={`${noteId}-samples`}>
                <Text size={200} className={styles.muted} id={`${noteId}-samples`}>{l10n.t('Load a sample plan:')}</Text>
                {(['find', 'aggregate', 'count'] as const).map((command) => (
                    <Link key={command} as="button" aria-label={l10n.t('Load the {0} sample plan', command)} onClick={() => loadSample(command)}>
                        {command}
                    </Link>
                ))}
            </div>
            <Collapse visible={!!explainInfo} unmountOnExit>
                <div className={styles.detected} aria-label={l10n.t('Detected from the explain plan')} role="group">
                    <dl className={styles.facts}>
                        <div className={styles.fact}>
                            <dt><Text size={200} className={styles.muted}>{l10n.t('Command')}</Text></dt>
                            <dd className={styles.factValue}>
                                <Badge appearance="tint" shape="rounded" size="small" color="brand">{effectiveCommand}</Badge>{' '}
                                <Text size={200} className={styles.muted}>
                                    {commandWasDetected ? l10n.t('detected') : l10n.t('selected')}
                                </Text>
                            </dd>
                        </div>
                        <div className={styles.fact}>
                            <dt><Text size={200} className={styles.muted}>{l10n.t('Namespace')}</Text></dt>
                            <dd className={styles.factValue}>
                                <Text size={200} className={detectedNamespace ? styles.mono : styles.muted}>
                                    {detectedNamespace ?? l10n.t('Not in the plan')}
                                </Text>
                            </dd>
                        </div>
                        {!!explainInfo?.planStages.length && (
                            <div className={styles.fact}>
                                <dt><Text size={200} className={styles.muted}>{l10n.t('Plan')}</Text></dt>
                                <dd className={styles.factValue}>
                                    <Text size={200} className={styles.mono}>{explainInfo.planStages.join(' → ')}</Text>
                                </dd>
                            </div>
                        )}
                    </dl>
                    {inspection?.query !== undefined && (
                        <>
                            <Text size={200} weight="semibold" id={`${noteId}-query`}>
                                {inspection.queryIsExtracted ? l10n.t('Extracted query') : l10n.t('Your query')}
                            </Text>
                            <pre className={styles.queryPreview} aria-labelledby={`${noteId}-query`}>{inspection.query}</pre>
                        </>
                    )}
                    {inspection?.queryIssue && !editingQuery && issueLine(inspection.queryIssue)}
                    <div className={styles.detectedActions}>
                        <Field label={l10n.t('Command type')} size="small">
                            <Select
                                size="small"
                                className={styles.commandSelect}
                                value={form.commandType}
                                onChange={(_event, data) => update('commandType', data.value as StandaloneInput['commandType'])}
                            >
                                <option value="auto">
                                    {l10n.t('Auto-detect ({0})', explainInfo?.detectedCommandType ?? 'find')}
                                </option>
                                <option value="find">find</option>
                                <option value="aggregate">aggregate</option>
                                <option value="count">count</option>
                            </Select>
                        </Field>
                        <Button
                            appearance="subtle"
                            size="small"
                            icon={<EditRegular />}
                            aria-expanded={editingQuery}
                            onClick={() => setEditingQuery((value) => !value)}
                        >
                            {editingQuery ? l10n.t('Hide query editor') : l10n.t('Edit query')}
                        </Button>
                    </div>
                    <Collapse visible={editingQuery} unmountOnExit>
                        <div>
                            <Field
                                label={l10n.t('Query or pipeline')}
                                hint={l10n.t('Leave empty to use the extracted query. Find accepts a filter or { filter, sort, projection, skip, limit }; aggregate needs a pipeline array. Extraction from a plan can be partial.')}
                                validationState={inspection?.queryIssue ? 'error' : 'none'}
                                validationMessage={inspection?.queryIssue ? describeIssue(inspection.queryIssue) : undefined}
                            >
                                <JsonPlanEditor
                                    compact
                                    ariaLabel={l10n.t('Query or pipeline')}
                                    value={form.query}
                                    issue={!inspecting ? inspection?.queryIssue : undefined}
                                    onChange={(value) => update('query', value)}
                                />
                            </Field>
                        </div>
                    </Collapse>
                </div>
            </Collapse>
        </section>
    );

    const statsInfo = inspection?.collectionStats;
    const indexInfo = inspection?.indexes;
    const notProvided = <Text className={styles.muted}>{l10n.t('Not provided')}</Text>;
    const rowAction = (row: OptionalRow, label: string, openLabel: string): JSX.Element => (
        <Tooltip content={openRows[row] ? openLabel : label} relationship="label" withArrow>
            <Button
                appearance="subtle"
                size="small"
                icon={<EditRegular />}
                aria-expanded={!!openRows[row]}
                onClick={() => toggleRow(row)}
            />
        </Tooltip>
    );
    const optionalRows: readonly { key: OptionalRow; label: string; value: ReactNode; action: JSX.Element; editor: ReactNode }[] = [
        {
            key: 'collectionStats',
            label: l10n.t('Collection statistics'),
            value: !form.collectionStats.trim() ? notProvided
                : statsInfo?.ok === false ? issueLine(statsInfo)
                    : statsInfo?.ok && statsInfo.documentCount !== undefined
                        ? l10n.t('Provided · {0} documents', statsInfo.documentCount.toLocaleString(navigator.language))
                        : l10n.t('Provided'),
            action: rowAction('collectionStats', l10n.t('Edit collection statistics'), l10n.t('Hide collection statistics')),
            editor: (
                <Field
                    label={l10n.t('Collection statistics')}
                    hint={l10n.t('Output of db.<collection>.stats() or the collStats command. The document count is the part that matters most.')}
                    validationState={statsInfo?.ok === false ? 'error' : 'none'}
                    validationMessage={statsInfo?.ok === false ? describeIssue(statsInfo) : undefined}
                >
                    <JsonPlanEditor compact ariaLabel={l10n.t('Collection statistics')} value={form.collectionStats}
                        issue={!inspecting && statsInfo?.ok === false ? statsInfo : undefined}
                        onChange={(value) => update('collectionStats', value)} />
                </Field>
            ),
        },
        {
            key: 'indexes',
            label: l10n.t('Indexes'),
            value: !form.indexes.trim() ? notProvided
                : indexInfo?.ok === false ? issueLine(indexInfo)
                    : indexInfo?.ok ? (
                        <>
                            {indexInfo.names.length === 1 ? l10n.t('Provided · 1 index') : l10n.t('Provided · {0} indexes', String(indexInfo.names.length))}
                            {indexInfo.names.length > 0 && (
                                <Text size={200} className={styles.muted} block>{indexInfo.names.join(', ')}</Text>
                            )}
                        </>
                    ) : l10n.t('Provided'),
            action: rowAction('indexes', l10n.t('Edit indexes'), l10n.t('Hide indexes')),
            editor: (
                <Field
                    label={l10n.t('Indexes')}
                    hint={l10n.t('Output of db.<collection>.getIndexes() or an $indexStats array, or one array combining both.')}
                    validationState={indexInfo?.ok === false ? 'error' : 'none'}
                    validationMessage={indexInfo?.ok === false ? describeIssue(indexInfo) : undefined}
                >
                    <JsonPlanEditor compact ariaLabel={l10n.t('Indexes')} value={form.indexes}
                        issue={!inspecting && indexInfo?.ok === false ? indexInfo : undefined}
                        onChange={(value) => update('indexes', value)} />
                </Field>
            ),
        },
        {
            key: 'namespace',
            label: l10n.t('Database and collection'),
            value: namespaceOf(effectiveDatabase, effectiveCollection) ? (
                <>
                    <Text className={styles.mono}>{namespaceOf(effectiveDatabase, effectiveCollection)}</Text>
                    {!form.databaseName.trim() && !form.collectionName.trim() && (
                        <Text size={200} className={styles.muted}> · {l10n.t('from the explain plan')}</Text>
                    )}
                </>
            ) : notProvided,
            action: rowAction('namespace', l10n.t('Edit database and collection'), l10n.t('Hide database and collection')),
            editor: (
                <div className={styles.nameFields}>
                    <Field label={l10n.t('Database')} hint={l10n.t('Used to name the collection in the prompt and in copied commands.')}>
                        <Input value={form.databaseName} placeholder={explainInfo?.databaseName}
                            onChange={(_event, data) => update('databaseName', data.value)} />
                    </Field>
                    <Field label={l10n.t('Collection')}>
                        <Input value={form.collectionName} placeholder={explainInfo?.collectionName}
                            onChange={(_event, data) => update('collectionName', data.value)} />
                    </Field>
                </div>
            ),
        },
        {
            key: 'clusterType',
            label: l10n.t('Cluster type'),
            value: clusterTypeLabel(form.clusterType),
            action: rowAction('clusterType', l10n.t('Change the cluster type'), l10n.t('Hide the cluster type')),
            editor: (
                <Field
                    label={l10n.t('Where the plan came from')}
                    hint={l10n.t('Azure DocumentDB corrects known differences in its explain counters before rating.')}
                >
                    <RadioGroup layout="horizontal" value={form.clusterType}
                        onChange={(_event, data) => update('clusterType', data.value as StandaloneInput['clusterType'])}>
                        <Radio value="azure-documentdb" label={l10n.t('Azure DocumentDB')} />
                        <Radio value="documentdb" label={l10n.t('DocumentDB')} />
                        <Radio value="other" label={l10n.t('Other')} />
                    </RadioGroup>
                </Field>
            ),
        },
    ];

    const optionalSection = (
        <section className={styles.section} aria-labelledby={`${noteId}-optional`}>
            <Text as="h3" size={400} weight="semibold" id={`${noteId}-optional`} className={styles.sectionHeading}>
                {l10n.t('Optional context')}
            </Text>
            <Text size={200} className={styles.muted}>
                {l10n.t('More context gives sharper ratings and recommendations. Everything here can stay empty.')}
            </Text>
            <Table size="small" aria-labelledby={`${noteId}-optional`}>
                <colgroup>
                    <col className={styles.colLabel} />
                    <col />
                    <col className={styles.colAction} />
                </colgroup>
                <TableBody>
                    {optionalRows.map((row) => (
                        <Fragment key={row.key}>
                            <TableRow>
                                <TableCell><TableCellLayout appearance="primary">{row.label}</TableCellLayout></TableCell>
                                <TableCell className={styles.valueCell}>{row.value}</TableCell>
                                <TableCell><div className={styles.rowAction}>{row.action}</div></TableCell>
                            </TableRow>
                            <TableRow className={styles.editorRow} aria-hidden={!openRows[row.key]}>
                                <TableCell colSpan={3} className={styles.editorCell}>
                                    <Collapse visible={!!openRows[row.key]} unmountOnExit>
                                        <div className={styles.editorBody}>{row.editor}</div>
                                    </Collapse>
                                </TableCell>
                            </TableRow>
                        </Fragment>
                    ))}
                </TableBody>
            </Table>
        </section>
    );

    const modelSection = (
        <section className={styles.section} aria-labelledby={`${noteId}-model`}>
            <Text as="h3" size={400} weight="semibold" id={`${noteId}-model`} className={styles.sectionHeading}>
                {l10n.t('AI model & prompt')}
            </Text>
            <Text size={200} className={styles.muted}>
                {l10n.t('Your choice is saved and shared with the Query Insights tab.')}
            </Text>
            <ModelPicker commandType={effectiveCommand} onModelChange={setSelectedModel} disabled={submitting} />
        </section>
    );

    const configure = (
        <div className={styles.sections}>
            {explainSection}
            {optionalSection}
            {modelSection}
            {inspectFailure && (
                <MessageBlock intent="error" title={l10n.t('Could not check the inputs')}>{inspectFailure}</MessageBlock>
            )}
        </div>
    );

    // ---- Analyze ----------------------------------------------------------------------------

    const summaryBar = analysisInput && (
        <div className={styles.summaryBar} role="region" aria-label={l10n.t('Analysis inputs')}>
            <Tooltip content={l10n.t('Back to Configure (inputs are kept)')} relationship="description">
                <Button appearance="subtle" size="small" icon={<ArrowLeftRegular />} onClick={() => setStep('configure')}>
                    {l10n.t('Reconfigure')}
                </Button>
            </Tooltip>
            <Badge appearance="tint" shape="rounded" size="small" color="brand">{analysisInput.commandType}</Badge>
            {[
                <Text key="namespace" size={200} className={styles.mono}>
                    {namespaceOf(analysisInput.databaseName, analysisInput.collectionName) ?? l10n.t('Namespace not provided')}
                </Text>,
                <Text key="cluster" size={200}>{clusterTypeLabel(analysisInput.clusterType)}</Text>,
                selectedModel && <Text key="model" size={200}>{selectedModel.name}</Text>,
                analysisPrompt && <Text key="prompt" size={200}>
                    {analysisPrompt.source === 'custom-file'
                        ? l10n.t('Prompt: custom file {0}', analysisPrompt.path?.split(/[/\\]/).pop() ?? '')
                        : l10n.t('Prompt: built-in')}
                </Text>,
            ].filter(Boolean).map((fact, index) => (
                <Fragment key={index}><span aria-hidden>·</span>{fact}</Fragment>
            ))}
        </div>
    );

    // ---- footer -----------------------------------------------------------------------------

    let footer: JSX.Element;
    if (step === 'welcome') {
        footer = (
            <ContainerFooter note={l10n.t('Nothing is sent to GitHub Copilot until you select Analyze query.')}>
                <Button appearance="primary" onClick={() => setStep('configure')}>{l10n.t('Continue')}</Button>
            </ContainerFooter>
        );
    } else if (step === 'configure') {
        footer = (
            <ContainerFooter
                note={<span id={`${noteId}-reason`}>
                    {blockedReason ?? (selectedModel
                        ? l10n.t('Analyze query sends your inputs to {0}.', selectedModel.name)
                        : l10n.t('Analyze query sends your inputs to the selected model.'))}
                </span>}
            >
                <Button
                    appearance="primary"
                    disabledFocusable={!canAnalyze}
                    aria-describedby={`${noteId}-reason`}
                    icon={submitting ? <Spinner size="tiny" aria-hidden /> : undefined}
                    onClick={() => { if (canAnalyze) void analyze(); }}
                >
                    {l10n.t('Analyze query')}
                </Button>
                <Button appearance="secondary" disabled={submitting} onClick={() => setStep('welcome')}>
                    {l10n.t('Back')}
                </Button>
            </ContainerFooter>
        );
    } else {
        footer = (
            // Reconfigure lives above the results; the footer only explains.
            <ContainerFooter note={l10n.t('Recommendations are copy-only. The explorer never changes a database.')} />
        );
    }

    return (
        <>
            {/* Outside the wizard so they stay mounted across steps (see LocalQuickStart). */}
            <Announcer key={`announce-${announcement.key}`} when={announcement.key > 0} message={announcement.message} />
            <Announcer
                when={step === 'configure' && !inspecting && !!explainInfo}
                message={l10n.t('Explain plan is valid. Detected a {0} command.', effectiveCommand)}
            />
            <Announcer
                when={step === 'configure' && !inspecting && !!explainIssue}
                message={explainIssue ? l10n.t('Explain plan error. {0}', describeIssue(explainIssue)) : ''}
            />
            <Announcer when={step === 'analyze' && analysisKind === 's1Loading'} message={l10n.t('Analyzing the explain plan.')} />
            <Announcer when={step === 'analyze' && analysisKind === 's3Success'} message={l10n.t('Analysis complete. Recommendations are ready.')} />
            <Announcer
                when={step === 'analyze' && ['s1Error', 's2Error', 's3Error'].includes(analysisKind)}
                message={l10n.t('The analysis failed. See the details on the page.')}
                politeness="assertive"
            />
            <Wizard
                activeStep={step}
                onStepChange={(value) => { if (!submitting && value !== 'analyze') setStep(value as StepId); }}
                contentMaxWidth={step === 'analyze' ? 'none' : '760px'}
                headerBehavior="sticky-navigation"
                stepsLocked={submitting}
                stepsAriaLabel={l10n.t('Query Insights Explorer steps')}
                overflowAriaLabel={(count) => l10n.t('{0} more steps', String(count))}
                header={header}
                footer={footer}
            >
                <WizardStep
                    value="welcome"
                    label={l10n.t('Welcome')}
                    title={l10n.t('Find out why a query is slow')}
                    subtitle={l10n.t('Paste the explain output of a find, aggregate or count command. Query Insights rates how efficiently it ran, shows the execution plan, and asks GitHub Copilot for index and query recommendations.')}
                >
                    {welcome}
                </WizardStep>
                <WizardStep
                    value="configure"
                    label={l10n.t('Configure')}
                    title={l10n.t('Provide your query data')}
                    subtitle={l10n.t('Only the explain plan is required. It is checked as you type.')}
                >
                    {configure}
                </WizardStep>
                <WizardStep
                    value="analyze"
                    label={l10n.t('Analyze')}
                    title={l10n.t('Query Insights analysis results')}
                    navigable={false}
                >
                    {summaryBar}
                    {step === 'analyze' && analysisInput && (
                        <Analyze key={runKey} input={analysisInput} onKindChange={setAnalysisKind} />
                    )}
                </WizardStep>
            </Wizard>
        </>
    );
}
