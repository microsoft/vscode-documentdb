/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Accordion,
    AccordionHeader,
    AccordionItem,
    AccordionPanel,
    Badge,
    Button,
    Card,
    Divider,
    Field,
    Input,
    Link,
    makeStyles,
    Spinner,
    Switch,
    Text,
    tokens,
} from '@fluentui/react-components';
import {
    ArrowClockwiseRegular,
    CheckmarkCircleFilled,
    CircleRegular,
    ErrorCircleFilled,
    RocketRegular,
} from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { type JSX, useCallback, useEffect, useRef, useState } from 'react';
import {
    type AdvancedQuickStartOptions,
    type DockerStatusResult,
    PROVISION_STAGES,
    type ProvisionStage,
    QUICK_START_DEFAULT_TAG,
    QUICK_START_IMAGE,
    QUICK_START_IMAGE_REPOSITORY,
    QUICK_START_PORT,
    type StageEvent,
} from '../../../services/localQuickStart/quickStartTypes';
import { useTrpcClient } from '../../_integration/useTrpcClient';
import { Announcer } from '../../components/accessibility/Announcer';

type Phase = 'loading' | 'review' | 'dockerNotReady' | 'provisioning' | 'success' | 'failed';
type StageStatus = 'pending' | 'active' | 'done' | 'error';

const useStyles = makeStyles({
    root: {
        padding: '20px',
        maxWidth: '880px',
        margin: '0 auto',
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
    },
    hero: { display: 'flex', alignItems: 'center', gap: '12px' },
    heroIcon: { fontSize: '28px', color: tokens.colorBrandForeground1 },
    cardGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '12px' },
    metricCard: { padding: '14px', display: 'flex', flexDirection: 'column', gap: '4px' },
    metricLabel: { color: tokens.colorNeutralForeground3 },
    summaryCard: { padding: '16px', display: 'flex', flexDirection: 'column', gap: '8px' },
    summaryRow: { display: 'grid', gridTemplateColumns: '140px 1fr', gap: '8px' },
    actions: { display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '8px' },
    stageList: { display: 'flex', flexDirection: 'column', gap: '10px', padding: '16px' },
    stageRow: { display: 'flex', alignItems: 'center', gap: '10px' },
    stageIconDone: { color: tokens.colorPaletteGreenForeground1, fontSize: '18px' },
    stageIconError: { color: tokens.colorPaletteRedForeground1, fontSize: '18px' },
    stageIconPending: { color: tokens.colorNeutralForeground4, fontSize: '18px' },
    errorBox: {
        padding: '12px',
        borderRadius: tokens.borderRadiusMedium,
        backgroundColor: tokens.colorStatusDangerBackground1,
        color: tokens.colorStatusDangerForeground1,
    },
    successBox: {
        padding: '12px',
        borderRadius: tokens.borderRadiusMedium,
        backgroundColor: tokens.colorStatusSuccessBackground1,
        color: tokens.colorStatusSuccessForeground1,
    },
    nextSteps: { display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '8px' },
    advancedPanel: { display: 'flex', flexDirection: 'column', gap: '12px', paddingTop: '8px' },
    advancedGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' },
    advancedError: { color: tokens.colorStatusDangerForeground1 },
    muted: { color: tokens.colorNeutralForeground3 },
});

const STAGE_LABELS: Record<ProvisionStage, string> = {
    checking: l10n.t('Checking Docker'),
    pulling: l10n.t('Pulling official image'),
    creating: l10n.t('Creating container'),
    starting: l10n.t('Starting container'),
    waiting: l10n.t('Waiting for DocumentDB to accept connections'),
    done: l10n.t('Done'),
    error: l10n.t('Error'),
};

function emptyStageStatus(): Record<ProvisionStage, StageStatus> {
    return {
        checking: 'pending',
        pulling: 'pending',
        creating: 'pending',
        starting: 'pending',
        waiting: 'pending',
        done: 'pending',
        error: 'pending',
    };
}

const MetricCard = ({ label, value, badge }: { label: string; value: string; badge?: JSX.Element }): JSX.Element => {
    const styles = useStyles();
    return (
        <Card className={styles.metricCard}>
            <Text size={200} className={styles.metricLabel}>
                {label}
            </Text>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                {badge}
                <Text weight="semibold">{value}</Text>
            </div>
        </Card>
    );
};

export const LocalQuickStart = (): JSX.Element => {
    const styles = useStyles();
    const { trpcClient } = useTrpcClient();

    const [phase, setPhase] = useState<Phase>('loading');
    const [docker, setDocker] = useState<DockerStatusResult | undefined>(undefined);
    const [stageStatus, setStageStatus] = useState<Record<ProvisionStage, StageStatus>>(emptyStageStatus);
    const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);
    const [successMessage, setSuccessMessage] = useState<string | undefined>(undefined);
    const [boundPort, setBoundPort] = useState<number | undefined>(undefined);
    const [elapsedMs, setElapsedMs] = useState(0);
    const [startingDocker, setStartingDocker] = useState(false);

    // Advanced overrides (P1-4). Empty fields fall back to the zero-decision defaults.
    const [advPort, setAdvPort] = useState('');
    const [advUser, setAdvUser] = useState('');
    const [advPass, setAdvPass] = useState('');
    const [advTag, setAdvTag] = useState('');
    const [advLoadSampleData, setAdvLoadSampleData] = useState(true);

    // The service reuses an existing instance (keeping its data volume) whenever stored
    // credentials exist, ignoring any custom credentials / image tag. `willReuse` reflects
    // that exact decision (the same predicate the service uses), so we hide those fields and
    // relabel the summary whenever — and only when — the service will actually reuse. (A
    // Missing badge always implies stored creds, so `willReuse` already subsumes it.)
    const isRecreate = docker?.willReuse === true;

    const subscriptionRef = useRef<{ unsubscribe: () => void } | null>(null);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    // Current Advanced options, synced from the fields below so handleStart (and Retry)
    // always read the latest without re-binding the provisioning subscription.
    const advancedRef = useRef<AdvancedQuickStartOptions | undefined>(undefined);

    // Validate the Advanced fields client-side, mirroring the router's zod schema so a valid
    // form never dead-ends on a server rejection. A non-empty result disables Start + shows help.
    // eslint-disable-next-line no-control-regex
    const credForbidden = /[\u0000-\u001f\u007f]/;
    const advError = ((): string | undefined => {
        const port = advPort.trim();
        if (port && (!/^\d+$/.test(port) || Number(port) < 1024 || Number(port) > 65535)) {
            return l10n.t('Port must be a whole number between 1024 and 65535.');
        }
        const user = advUser.trim();
        const pass = advPass.trim();
        const hasUser = user.length > 0;
        const hasPass = pass.length > 0;
        if (hasUser !== hasPass) {
            return l10n.t('Enter both a username and a password, or leave both blank to auto-generate.');
        }
        if (user.length > 128 || pass.length > 256) {
            return l10n.t('Username (max 128) or password (max 256) is too long.');
        }
        if ((hasUser && credForbidden.test(user)) || (hasPass && credForbidden.test(pass))) {
            return l10n.t('Username and password must not contain control characters.');
        }
        const tag = advTag.trim();
        if (tag && (tag.length > 128 || !/^[\w][\w.-]*$/.test(tag))) {
            return l10n.t('Image tag may contain only letters, numbers, dots, dashes, and underscores.');
        }
        return undefined;
    })();

    useEffect(() => {
        // Sync the Advanced fields into a ref (repo stale-closure pattern) so the provisioning
        // subscription reads current values. Skip building options while invalid.
        if (advError) {
            advancedRef.current = undefined;
            return;
        }
        const opts: AdvancedQuickStartOptions = {};
        if (advPort.trim()) opts.port = Number(advPort.trim());
        // Credentials and image tag are ignored by the service when reusing an existing
        // instance, so don't send them (the fields are hidden in that case anyway). Send the
        // trimmed credentials so what we transmit is exactly what the service stores/encodes.
        if (!isRecreate) {
            if (advUser.trim()) opts.username = advUser.trim();
            if (advPass.trim()) opts.password = advPass.trim();
            if (advTag.trim()) opts.imageTag = advTag.trim();
        }
        if (!advLoadSampleData) opts.loadSampleData = false;
        advancedRef.current = Object.keys(opts).length > 0 ? opts : undefined;
    }, [advPort, advUser, advPass, advTag, advLoadSampleData, advError, isRecreate]);

    const loadDockerStatus = useCallback((): void => {
        setPhase('loading');
        void trpcClient.localQuickStart.getDockerStatus
            .query()
            .then((result) => {
                setDocker(result);
                const ready = result.readiness.cliInstalled && result.readiness.daemonReachable;
                setPhase(ready ? 'review' : 'dockerNotReady');
            })
            .catch((error: unknown) => {
                setErrorMessage(error instanceof Error ? error.message : String(error));
                setPhase('dockerNotReady');
            });
    }, [trpcClient]);

    const stopTimer = useCallback((): void => {
        if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
        }
    }, []);

    const handleStartDocker = useCallback((): void => {
        setStartingDocker(true);
        void trpcClient.localQuickStart.startDockerDesktop
            .mutate()
            .catch(() => false)
            .then(() => {
                // Give Docker Desktop a few seconds to come up, then re-check.
                setTimeout(() => {
                    setStartingDocker(false);
                    loadDockerStatus();
                }, 5000);
            });
    }, [trpcClient, loadDockerStatus]);

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load sets the 'loading' phase before the async docker query
        loadDockerStatus();
        return () => {
            subscriptionRef.current?.unsubscribe();
            if (timerRef.current) clearInterval(timerRef.current);
        };
    }, [loadDockerStatus]);

    const handleStart = useCallback((): void => {
        // Cancel any prior in-flight subscription so a fast double-click can't leak
        // an uncancellable stream (mirrors the Query Insights pattern).
        subscriptionRef.current?.unsubscribe();
        subscriptionRef.current = null;

        setStageStatus(emptyStageStatus());
        setErrorMessage(undefined);
        setSuccessMessage(undefined);
        setElapsedMs(0);
        setPhase('provisioning');

        const startedAt = Date.now();
        timerRef.current = setInterval(() => setElapsedMs(Date.now() - startedAt), 250);

        let settled = false;
        const subscription = trpcClient.localQuickStart.startQuickStart.subscribe(advancedRef.current, {
            onData(event: StageEvent) {
                setStageStatus((prev) => ({ ...prev, [event.stage]: event.status }));
                if (event.stage === 'done' && event.status === 'done') {
                    settled = true;
                    stopTimer();
                    setSuccessMessage(event.message);
                    setBoundPort(event.boundPort);
                    setPhase('success');
                } else if (event.status === 'error') {
                    settled = true;
                    stopTimer();
                    setErrorMessage(event.error ?? event.message ?? l10n.t('Setup failed.'));
                    setPhase('failed');
                }
            },
            onError(error: unknown) {
                settled = true;
                stopTimer();
                setErrorMessage(error instanceof Error ? error.message : String(error));
                setPhase('failed');
                if (subscriptionRef.current === subscription) {
                    subscriptionRef.current = null;
                }
            },
            onComplete() {
                // The stream ended without a terminal stage event (e.g. the service
                // was already busy and returned early) — recover to review rather
                // than hang on 'provisioning' with a runaway timer.
                if (!settled) {
                    stopTimer();
                    setPhase('review');
                }
                if (subscriptionRef.current === subscription) {
                    subscriptionRef.current = null;
                }
            },
        });
        subscriptionRef.current = subscription;
    }, [trpcClient, stopTimer]);

    const handleClose = useCallback((): void => {
        void trpcClient.localQuickStart.closePanel.mutate().catch(() => undefined);
    }, [trpcClient]);

    const handleCancel = useCallback((): void => {
        subscriptionRef.current?.unsubscribe();
        subscriptionRef.current = null;
        stopTimer();
        setPhase('review');
    }, [stopTimer]);

    // From the failed phase, return to the review form (Advanced field state is preserved) so
    // the user can correct a bad option (e.g. a busy explicit port) and retry — design feedback.
    const handleBackToReview = useCallback((): void => {
        setErrorMessage(undefined);
        setPhase('review');
    }, []);

    const handleViewOutput = useCallback((): void => {
        void trpcClient.localQuickStart.showOutput.mutate().catch(() => undefined);
    }, [trpcClient]);

    const handleOpenConnection = useCallback((): void => {
        // Reveal the connection in the Connections view but KEEP this panel open —
        // only the explicit Close button dismisses the page (user feedback).
        void trpcClient.localQuickStart.openConnection.mutate().catch(() => undefined);
    }, [trpcClient]);

    const handleCopyConnString = useCallback((): void => {
        void trpcClient.localQuickStart.copyConnectionString.mutate().catch(() => undefined);
    }, [trpcClient]);

    const renderReviewCards = (): JSX.Element => {
        const ready = !!docker && docker.readiness.cliInstalled && docker.readiness.daemonReachable;
        const effectivePort = advPort.trim() && !advError ? advPort.trim() : String(QUICK_START_PORT);
        return (
            <div className={styles.cardGrid}>
                <MetricCard
                    label={l10n.t('Docker')}
                    value={ready ? l10n.t('Ready') : l10n.t('Not ready')}
                    badge={
                        <Badge appearance="filled" color={ready ? 'success' : 'danger'} size="small">
                            {ready ? '✓' : '!'}
                        </Badge>
                    }
                />
                <MetricCard label={l10n.t('Port')} value={effectivePort} />
                <MetricCard label={l10n.t('Data')} value={l10n.t('Persistent volume')} />
                <MetricCard label={l10n.t('Security')} value={l10n.t('TLS · self-signed')} />
            </div>
        );
    };

    const renderSummary = (): JSX.Element => {
        const effectiveImage =
            !isRecreate && advTag.trim() ? `${QUICK_START_IMAGE_REPOSITORY}:${advTag.trim()}` : QUICK_START_IMAGE;
        const customCreds = !isRecreate && advUser.trim().length > 0 && advPass.trim().length > 0;
        const customPort = advPort.trim().length > 0 && !advError;
        return (
            <Card className={styles.summaryCard}>
                <Text weight="semibold">{l10n.t("What we'll do")}</Text>
                <Divider />
                <div className={styles.summaryRow}>
                    <Text className={styles.muted}>{l10n.t('Image')}</Text>
                    <Text>{isRecreate ? l10n.t('Kept from the existing instance') : effectiveImage}</Text>
                </div>
                <div className={styles.summaryRow}>
                    <Text className={styles.muted}>{l10n.t('Port')}</Text>
                    <Text>{customPort ? advPort.trim() : l10n.t('{0} (auto)', String(QUICK_START_PORT))}</Text>
                </div>
                <div className={styles.summaryRow}>
                    <Text className={styles.muted}>{l10n.t('Runs on')}</Text>
                    <Text>{l10n.t('This machine (Docker)')}</Text>
                </div>
                <div className={styles.summaryRow}>
                    <Text className={styles.muted}>{l10n.t('Credentials')}</Text>
                    <Text>
                        {isRecreate
                            ? l10n.t('Reused from the existing instance')
                            : customCreds
                              ? l10n.t('Custom, stored securely')
                              : l10n.t('Auto-generated, stored securely')}
                    </Text>
                </div>
                <div className={styles.summaryRow}>
                    <Text className={styles.muted}>{l10n.t('Lifetime')}</Text>
                    <Text>{l10n.t('Keeps running after VS Code closes')}</Text>
                </div>
            </Card>
        );
    };

    const renderAdvanced = (): JSX.Element => (
        <Accordion collapsible>
            <AccordionItem value="advanced">
                <AccordionHeader>{l10n.t('Advanced (optional)')}</AccordionHeader>
                <AccordionPanel>
                    <div className={styles.advancedPanel}>
                        <Text size={200} className={styles.muted}>
                            {l10n.t('Leave any field blank to keep the automatic default.')}
                        </Text>
                        <div className={styles.advancedGrid}>
                            <Field label={l10n.t('Port')} hint={l10n.t('Default {0}', String(QUICK_START_PORT))}>
                                <Input
                                    type="number"
                                    value={advPort}
                                    placeholder={String(QUICK_START_PORT)}
                                    onChange={(_e, d) => setAdvPort(d.value)}
                                />
                            </Field>
                            {!isRecreate && (
                                <Field
                                    label={l10n.t('Image tag')}
                                    hint={l10n.t('Default “{0}”', QUICK_START_DEFAULT_TAG)}
                                >
                                    <Input
                                        value={advTag}
                                        maxLength={128}
                                        placeholder={QUICK_START_DEFAULT_TAG}
                                        onChange={(_e, d) => setAdvTag(d.value)}
                                    />
                                </Field>
                            )}
                            {!isRecreate && (
                                <Field label={l10n.t('Username')} hint={l10n.t('Default: auto-generated')}>
                                    <Input
                                        value={advUser}
                                        maxLength={128}
                                        placeholder={l10n.t('auto')}
                                        onChange={(_e, d) => setAdvUser(d.value)}
                                    />
                                </Field>
                            )}
                            {!isRecreate && (
                                <Field label={l10n.t('Password')} hint={l10n.t('Default: auto-generated')}>
                                    <Input
                                        type="password"
                                        value={advPass}
                                        maxLength={256}
                                        placeholder={l10n.t('auto')}
                                        onChange={(_e, d) => setAdvPass(d.value)}
                                    />
                                </Field>
                            )}
                        </div>
                        {isRecreate && (
                            <Text size={200} className={styles.muted}>
                                {l10n.t(
                                    'Recreating reuses the existing data volume, so the original credentials and image are kept.',
                                )}
                            </Text>
                        )}
                        <Switch
                            checked={advLoadSampleData}
                            label={l10n.t('Load sample data')}
                            onChange={(_e, d) => setAdvLoadSampleData(d.checked)}
                        />
                        {advError && (
                            <Text size={200} role="alert" className={styles.advancedError}>
                                {advError}
                            </Text>
                        )}
                    </div>
                </AccordionPanel>
            </AccordionItem>
        </Accordion>
    );

    const renderStageRow = (stage: ProvisionStage): JSX.Element => {
        const status = stageStatus[stage];
        let icon: JSX.Element;
        if (status === 'done') {
            icon = <CheckmarkCircleFilled className={styles.stageIconDone} />;
        } else if (status === 'error') {
            icon = <ErrorCircleFilled className={styles.stageIconError} />;
        } else if (status === 'active') {
            icon = <Spinner size="tiny" />;
        } else {
            icon = <CircleRegular className={styles.stageIconPending} />;
        }
        return (
            <div key={stage} className={styles.stageRow}>
                {icon}
                <Text className={status === 'pending' ? styles.muted : undefined}>{STAGE_LABELS[stage]}</Text>
            </div>
        );
    };

    const elapsedLabel = (): string => {
        const total = Math.floor(elapsedMs / 1000);
        const mm = String(Math.floor(total / 60)).padStart(2, '0');
        const ss = String(total % 60).padStart(2, '0');
        return `${mm}:${ss}`;
    };

    const hero = (title: string, subtitle: string): JSX.Element => (
        <div className={styles.hero}>
            <RocketRegular className={styles.heroIcon} />
            <div>
                <Text as="h2" size={600} weight="semibold">
                    {title}
                </Text>
                {subtitle && (
                    <div>
                        <Text className={styles.muted}>{subtitle}</Text>
                    </div>
                )}
            </div>
        </div>
    );

    if (phase === 'loading') {
        return (
            <div className={styles.root}>
                <Spinner label={l10n.t('Checking Docker…')} />
            </div>
        );
    }

    if (phase === 'dockerNotReady') {
        const r = docker?.readiness;
        const cliOk = !!r?.cliInstalled;
        const daemonOk = !!r?.daemonReachable;
        const platformOk = r?.platformSupported !== false;
        const statusBadge = (ok: boolean, notOkColor: 'danger' | 'warning'): JSX.Element => (
            <Badge appearance="filled" color={ok ? 'success' : notOkColor} size="small">
                {ok ? '✓' : '!'}
            </Badge>
        );
        return (
            <div className={styles.root}>
                {hero(
                    l10n.t('Docker is required'),
                    l10n.t(
                        'Local Quick Start runs DocumentDB on your machine using Docker. The extension does not install Docker for you.',
                    ),
                )}
                <div className={styles.cardGrid}>
                    <MetricCard
                        label={l10n.t('Docker CLI')}
                        value={cliOk ? (r?.cliVersion ?? l10n.t('Found')) : l10n.t('Not found')}
                        badge={statusBadge(cliOk, 'danger')}
                    />
                    <MetricCard
                        label={l10n.t('Docker daemon')}
                        value={daemonOk ? l10n.t('Reachable') : l10n.t('Stopped')}
                        badge={statusBadge(daemonOk, 'danger')}
                    />
                    <MetricCard
                        label={l10n.t('Platform')}
                        value={r?.arch ?? l10n.t('unknown')}
                        badge={statusBadge(platformOk, 'warning')}
                    />
                </div>
                <Card className={styles.summaryCard}>
                    <Text weight="semibold">{l10n.t('How to fix')}</Text>
                    <Divider />
                    <Text size={200}>
                        {cliOk
                            ? l10n.t('• Start Docker Desktop and wait for it to report “running”.')
                            : l10n.t('• Install Docker Desktop, then reopen Quick Start.')}
                    </Text>
                    <Text size={200}>{l10n.t('• If you use a corporate proxy, check that ghcr.io is reachable.')}</Text>
                    <div className={styles.actions}>
                        {!cliOk && (
                            <Link href="https://www.docker.com/products/docker-desktop/">
                                {l10n.t('Install Docker')}
                            </Link>
                        )}
                        <Link href="https://docs.docker.com/desktop/troubleshoot-and-support/troubleshoot/">
                            {l10n.t('Troubleshooting')}
                        </Link>
                    </div>
                </Card>
                <div className={styles.actions}>
                    {cliOk && !daemonOk && (
                        <Button appearance="primary" disabled={startingDocker} onClick={handleStartDocker}>
                            {startingDocker ? l10n.t('Starting Docker Desktop…') : l10n.t('Start Docker Desktop')}
                        </Button>
                    )}
                    <Button
                        appearance={cliOk && !daemonOk ? 'secondary' : 'primary'}
                        icon={<ArrowClockwiseRegular />}
                        onClick={loadDockerStatus}
                    >
                        {l10n.t('Retry')}
                    </Button>
                </div>
            </div>
        );
    }

    if (phase === 'provisioning' || phase === 'success' || phase === 'failed') {
        return (
            <div className={styles.root}>
                <Announcer
                    when={phase === 'success'}
                    message={l10n.t('DocumentDB Local is ready. Next steps are shown below.')}
                />
                {hero(l10n.t('Setting up DocumentDB Local…'), phase === 'provisioning' ? elapsedLabel() : '')}

                {phase === 'success' && (
                    <div className={styles.successBox}>
                        <Text weight="semibold">{successMessage ?? l10n.t('DocumentDB Local is running.')}</Text>
                        <div className={styles.nextSteps}>
                            <Text size={200} weight="semibold">
                                {l10n.t('Next steps')}
                            </Text>
                            <Text size={200}>
                                {l10n.t(
                                    '• Open Connection — browse your databases in the Connections view, under “DocumentDB Local”.',
                                )}
                            </Text>
                            <Text size={200}>
                                {l10n.t(
                                    '• Copy Connection String — use it from a Query Playground, your app, or mongosh (localhost:{0}).',
                                    String(boundPort ?? QUICK_START_PORT),
                                )}
                            </Text>
                            <Text size={200}>
                                {l10n.t(
                                    '• The container keeps running after VS Code closes. Manage it with Stop / Restart / Delete in the Connections view.',
                                )}
                            </Text>
                        </div>
                    </div>
                )}

                <Card className={styles.stageList}>{PROVISION_STAGES.map(renderStageRow)}</Card>

                {phase === 'failed' && (
                    <div className={styles.errorBox}>
                        <Text>{errorMessage ?? l10n.t('Setup failed.')}</Text>
                    </div>
                )}

                <div>
                    <Link onClick={handleViewOutput}>{l10n.t('View Docker output')}</Link>
                </div>

                <div className={styles.actions}>
                    {phase === 'provisioning' && (
                        <Button appearance="secondary" onClick={handleCancel}>
                            {l10n.t('Cancel')}
                        </Button>
                    )}
                    {phase === 'success' && (
                        <>
                            <Button appearance="secondary" onClick={handleClose}>
                                {l10n.t('Close')}
                            </Button>
                            <Button appearance="secondary" onClick={handleCopyConnString}>
                                {l10n.t('Copy Connection String')}
                            </Button>
                            <Button appearance="primary" onClick={handleOpenConnection}>
                                {l10n.t('Open Connection')}
                            </Button>
                        </>
                    )}
                    {phase === 'failed' && (
                        <>
                            <Button appearance="secondary" onClick={handleBackToReview}>
                                {l10n.t('Edit settings')}
                            </Button>
                            <Button appearance="primary" icon={<ArrowClockwiseRegular />} onClick={handleStart}>
                                {l10n.t('Retry')}
                            </Button>
                        </>
                    )}
                </div>
            </div>
        );
    }

    // phase === 'review'
    return (
        <div className={styles.root}>
            {hero(
                l10n.t('Start DocumentDB Local'),
                l10n.t('Get a working local DocumentDB instance in one click. No terminal commands needed.'),
            )}
            {renderReviewCards()}
            {renderSummary()}
            {renderAdvanced()}
            <div className={styles.actions}>
                <Button appearance="secondary" onClick={handleClose}>
                    {l10n.t('Cancel')}
                </Button>
                <Button appearance="primary" icon={<RocketRegular />} disabled={!!advError} onClick={handleStart}>
                    {l10n.t('Start DocumentDB Local')}
                </Button>
            </div>
        </div>
    );
};
