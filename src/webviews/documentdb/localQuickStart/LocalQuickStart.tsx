/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Badge, Button, Card, Divider, Link, makeStyles, Spinner, Text, tokens } from '@fluentui/react-components';
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
    type DockerStatusResult,
    PROVISION_STAGES,
    type ProvisionStage,
    QUICK_START_IMAGE,
    QUICK_START_PORT,
    type StageEvent,
} from '../../../services/localQuickStart/quickStartTypes';
import { useTrpcClient } from '../../_integration/useTrpcClient';

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
    const [elapsedMs, setElapsedMs] = useState(0);

    const subscriptionRef = useRef<{ unsubscribe: () => void } | null>(null);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load sets the 'loading' phase before the async docker query
        loadDockerStatus();
        return () => {
            subscriptionRef.current?.unsubscribe();
            if (timerRef.current) clearInterval(timerRef.current);
            if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
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
        const subscription = trpcClient.localQuickStart.startQuickStart.subscribe(undefined, {
            onData(event: StageEvent) {
                setStageStatus((prev) => ({ ...prev, [event.stage]: event.status }));
                if (event.stage === 'done' && event.status === 'done') {
                    settled = true;
                    stopTimer();
                    setSuccessMessage(event.message);
                    setPhase('success');
                    closeTimerRef.current = setTimeout(() => {
                        void trpcClient.localQuickStart.closePanel.mutate().catch(() => undefined);
                    }, 1800);
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

    const handleViewOutput = useCallback((): void => {
        void trpcClient.localQuickStart.showOutput.mutate().catch(() => undefined);
    }, [trpcClient]);

    const renderReviewCards = (): JSX.Element => {
        const ready = !!docker && docker.readiness.cliInstalled && docker.readiness.daemonReachable;
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
                <MetricCard label={l10n.t('Port')} value={String(QUICK_START_PORT)} />
                <MetricCard label={l10n.t('Data')} value={l10n.t('Ephemeral (POC)')} />
                <MetricCard label={l10n.t('Security')} value={l10n.t('TLS · self-signed')} />
            </div>
        );
    };

    const renderSummary = (): JSX.Element => (
        <Card className={styles.summaryCard}>
            <Text weight="semibold">{l10n.t("What we'll do")}</Text>
            <Divider />
            <div className={styles.summaryRow}>
                <Text className={styles.muted}>{l10n.t('Image')}</Text>
                <Text>{QUICK_START_IMAGE}</Text>
            </div>
            <div className={styles.summaryRow}>
                <Text className={styles.muted}>{l10n.t('Runs on')}</Text>
                <Text>{l10n.t('This machine (Docker)')}</Text>
            </div>
            <div className={styles.summaryRow}>
                <Text className={styles.muted}>{l10n.t('Credentials')}</Text>
                <Text>{l10n.t('Auto-generated, stored securely')}</Text>
            </div>
            <div className={styles.summaryRow}>
                <Text className={styles.muted}>{l10n.t('Lifetime')}</Text>
                <Text>{l10n.t('Keeps running after VS Code closes')}</Text>
            </div>
        </Card>
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
        return (
            <div className={styles.root}>
                {hero(
                    l10n.t('Docker is required'),
                    l10n.t('Local Quick Start runs DocumentDB on your machine using Docker.'),
                )}
                <div className={styles.errorBox}>
                    <Text>
                        {docker?.readiness.cliInstalled === false
                            ? l10n.t('Docker CLI was not found on your PATH. Install Docker and retry.')
                            : l10n.t(
                                  'Docker is installed but the daemon is not reachable. Start Docker Desktop and retry.',
                              )}
                    </Text>
                </div>
                <div className={styles.actions}>
                    <Button appearance="primary" icon={<ArrowClockwiseRegular />} onClick={loadDockerStatus}>
                        {l10n.t('Retry')}
                    </Button>
                </div>
            </div>
        );
    }

    if (phase === 'provisioning' || phase === 'success' || phase === 'failed') {
        return (
            <div className={styles.root}>
                {hero(l10n.t('Setting up DocumentDB Local…'), phase === 'provisioning' ? elapsedLabel() : '')}

                {phase === 'success' && (
                    <div className={styles.successBox}>
                        <Text weight="semibold">{successMessage ?? l10n.t('DocumentDB Local is running.')}</Text>
                        <div>
                            <Text size={200}>{l10n.t('Opening it in the Connections view…')}</Text>
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
                    {phase === 'failed' && (
                        <Button appearance="primary" icon={<ArrowClockwiseRegular />} onClick={handleStart}>
                            {l10n.t('Retry')}
                        </Button>
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
            <div className={styles.actions}>
                <Button appearance="secondary" onClick={handleClose}>
                    {l10n.t('Cancel')}
                </Button>
                <Button appearance="primary" icon={<RocketRegular />} onClick={handleStart}>
                    {l10n.t('Start DocumentDB Local')}
                </Button>
            </div>
        </div>
    );
};
