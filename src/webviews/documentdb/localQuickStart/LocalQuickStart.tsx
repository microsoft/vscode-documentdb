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
import {
    type DockerGuidanceKey,
    type DockerGuideKey,
    type DockerReadinessPresentationState,
    type DockerRecoveryNoteKey,
    type DockerStartLabelKey,
    getDockerExecutionTargetKey,
    getDockerLastCheckedAtMs,
    getDockerReadinessPresentation,
} from './dockerReadinessPresentation';
import { pollDockerReadiness } from './dockerReadinessPolling';

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
    muted: { color: tokens.colorNeutralForeground3 },
    readinessFooter: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '8px',
    },
    recoveryCommand: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '8px',
        padding: '8px',
        backgroundColor: tokens.colorNeutralBackground3,
        borderRadius: tokens.borderRadiusSmall,
    },
    recoveryCommandText: { display: 'flex', flexDirection: 'column', gap: '4px' },
    targetNotice: {
        padding: '10px',
        backgroundColor: tokens.colorNeutralBackground3,
        borderRadius: tokens.borderRadiusSmall,
    },
    waitingStatus: { display: 'flex', alignItems: 'center', gap: '8px' },
    // Visually hidden but exposed to assistive tech (WCAG 4.1.3 status text).
    srOnly: {
        position: 'absolute',
        width: '1px',
        height: '1px',
        padding: 0,
        margin: '-1px',
        overflow: 'hidden',
        clip: 'rect(0, 0, 0, 0)',
        whiteSpace: 'nowrap',
    },
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

const DOCKER_DAEMON_VALUES: Readonly<Record<DockerReadinessPresentationState, string>> = {
    ready: l10n.t('Reachable'),
    cliMissing: l10n.t('Unknown'),
    accessDenied: l10n.t('Access denied'),
    accessDeniedPendingRestart: l10n.t('Access denied'),
    dockerDesktopNotRunning: l10n.t('Docker Desktop not running'),
    notRunning: l10n.t('Not running'),
    starting: l10n.t('Starting…'),
    notAccessibleFromWsl: l10n.t('Not accessible from WSL'),
    endpointUnreachable: l10n.t('Endpoint unreachable'),
    contextUnavailable: l10n.t('Context unavailable'),
    checkTimedOut: l10n.t('Check timed out'),
    unsupported: l10n.t('Unsupported'),
    windowsContainers: l10n.t('Linux containers required'),
    notAccessible: l10n.t('Not accessible'),
};

const DOCKER_GUIDANCE: Readonly<Record<DockerGuidanceKey, string>> = {
    installDocker: l10n.t('Install Docker Engine or Docker Desktop, then reopen Quick Start.'),
    accessDeniedLinux: l10n.t(
        'Your user cannot access the Docker socket. Run this command, then sign out and sign back in.',
    ),
    accessDeniedWsl: l10n.t(
        'Your user cannot access the Docker socket. Run this command, then restart the WSL session.',
    ),
    accessDeniedRemote: l10n.t(
        'Your user cannot access the Docker socket on the machine where this extension is running.',
    ),
    pendingRestartLinux: l10n.t(
        'You are in the Docker group, but this session started before that change. Sign out of your desktop session and sign back in. Reloading the window is not enough.',
    ),
    pendingRestartWsl: l10n.t(
        'Your Docker group change requires a new WSL session. Run this command in a Windows terminal. This VS Code window will disconnect. Reconnect to WSL, then open Quick Start again.',
    ),
    pendingRestartSsh: l10n.t(
        'You are in the Docker group on the remote host, but the VS Code server started before that change. Run "Remote-SSH: Kill VS Code Server on Host", then reconnect.',
    ),
    pendingRestartContainer: l10n.t(
        'You are in the Docker group, but this container started before that change. Rebuild the container.',
    ),
    dockerDesktopNotRunning: l10n.t('Start Docker Desktop and wait until it is ready.'),
    daemonNotRunning: l10n.t('Start the Docker service, then check again.'),
    daemonStarting: l10n.t('Waiting for Docker to start. This can take a minute.'),
    wslIntegrationUnavailable: l10n.t(
        'Enable Docker Desktop integration for this WSL distribution, then check again.',
    ),
    remoteDockerUnavailable: l10n.t(
        'Docker must be available in the remote environment where this extension is running.',
    ),
    endpointUnreachable: l10n.t('The configured Docker endpoint did not respond.'),
    contextUnavailable: l10n.t(
        'The active Docker context is unavailable. Select or repair a valid context, then check again.',
    ),
    checkTimedOut: l10n.t('Docker did not respond before the readiness check timed out.'),
    unsupportedHost: l10n.t(
        'Local Quick Start is supported when the extension runs on Windows, macOS, or Linux.',
    ),
    windowsContainers: l10n.t('Switch Docker to Linux containers, then check again.'),
    notAccessible: l10n.t('The extension could not connect to the Docker daemon.'),
};

const DOCKER_GUIDES: Readonly<Record<DockerGuideKey, { readonly label: string; readonly href: string }>> = {
    install: { label: l10n.t('Install Docker'), href: 'https://docs.docker.com/engine/install/' },
    linuxPostInstall: {
        label: l10n.t('Linux setup guide'),
        href: 'https://docs.docker.com/engine/install/linux-postinstall/',
    },
    dockerTroubleshooting: {
        label: l10n.t('Docker troubleshooting'),
        href: 'https://docs.docker.com/engine/daemon/troubleshoot/',
    },
    dockerContexts: {
        label: l10n.t('Docker context guide'),
        href: 'https://docs.docker.com/engine/manage-resources/contexts/',
    },
    wslIntegration: {
        label: l10n.t('WSL integration guide'),
        href: 'https://docs.docker.com/desktop/features/wsl/',
    },
    remoteDocker: {
        label: l10n.t('Remote Docker guide'),
        href: 'https://docs.docker.com/engine/security/protect-access/',
    },
    linuxContainers: {
        label: l10n.t('Linux containers guide'),
        href: 'https://docs.docker.com/desktop/setup/install/windows-install/',
    },
    learnMore: { label: l10n.t('Learn more'), href: 'https://docs.docker.com/engine/install/' },
};

const DOCKER_START_LABELS: Readonly<Record<DockerStartLabelKey, string>> = {
    startDockerDesktop: l10n.t('Start Docker Desktop'),
    startDocker: l10n.t('Start Docker'),
};

const EXECUTION_TARGET_VALUES: Readonly<Record<ReturnType<typeof getDockerExecutionTargetKey>, string>> = {
    local: l10n.t('This machine (Docker)'),
    wsl: l10n.t('This WSL environment (Docker)'),
    ssh: l10n.t('Remote SSH host (Docker)'),
    devContainer: l10n.t('This dev container environment (Docker)'),
    codespaces: l10n.t('This Codespaces environment (Docker)'),
    otherRemote: l10n.t('This remote extension host (Docker)'),
};

const EXECUTION_TARGET_NOTICES: Readonly<Partial<Record<ReturnType<typeof getDockerExecutionTargetKey>, string>>> = {
    wsl: l10n.t('Docker and DocumentDB Local will run in WSL, where this extension is running.'),
    ssh: l10n.t(
        'Docker and DocumentDB Local will run on the remote SSH host. localhost refers to that remote host.',
    ),
    devContainer: l10n.t(
        'Docker and DocumentDB Local will run in the dev-container environment. localhost refers to the extension host.',
    ),
    codespaces: l10n.t(
        'Docker and DocumentDB Local will run in Codespaces. localhost refers to the Codespaces extension host.',
    ),
    otherRemote: l10n.t(
        'Docker and DocumentDB Local will run on the remote extension host. localhost refers to that host.',
    ),
};

const DOCKER_RECOVERY_NOTES: Readonly<Record<DockerRecoveryNoteKey, string>> = {
    groupMembershipNewSession: l10n.t('Group membership applies to new login sessions only.'),
    restartWslDistribution: l10n.t(
        'This stops all running WSL distributions so the new group membership applies when WSL starts again.',
    ),
    runsDockerService: l10n.t('Runs the system Docker service.'),
};

function formatLastChecked(checkedAtMs: number | undefined, now: number): string {
    if (checkedAtMs === undefined) {
        return l10n.t('Last check did not complete');
    }
    const elapsedMinutes = Math.max(0, Math.floor((now - checkedAtMs) / 60_000));
    if (elapsedMinutes === 0) {
        return l10n.t('Last checked just now');
    }
    if (elapsedMinutes === 1) {
        return l10n.t('Last checked 1 minute ago');
    }
    if (elapsedMinutes < 60) {
        return l10n.t('Last checked {0} minutes ago', String(elapsedMinutes));
    }
    const elapsedHours = Math.floor(elapsedMinutes / 60);
    if (elapsedHours === 1) {
        return l10n.t('Last checked 1 hour ago');
    }
    if (elapsedHours < 24) {
        return l10n.t('Last checked {0} hours ago', String(elapsedHours));
    }
    const elapsedDays = Math.floor(elapsedHours / 24);
    if (elapsedDays === 1) {
        return l10n.t('Last checked 1 day ago');
    }
    return l10n.t('Last checked {0} days ago', String(elapsedDays));
}

function formatElapsed(elapsedMs: number): string {
    const totalSeconds = Math.floor(elapsedMs / 1_000);
    const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
    const seconds = String(totalSeconds % 60).padStart(2, '0');
    return `${minutes}:${seconds}`;
}

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
    const trpcClient = useTrpcClient();

    const [phase, setPhase] = useState<Phase>('loading');
    const [docker, setDocker] = useState<DockerStatusResult | undefined>(undefined);
    const [stageStatus, setStageStatus] = useState<Record<ProvisionStage, StageStatus>>(emptyStageStatus);
    const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);
    const [successMessage, setSuccessMessage] = useState<string | undefined>(undefined);
    const [boundPort, setBoundPort] = useState<number | undefined>(undefined);
    const [elapsedMs, setElapsedMs] = useState(0);
    const [startingDocker, setStartingDocker] = useState(false);
    const [dockerWaitElapsedMs, setDockerWaitElapsedMs] = useState(0);
    const [relativeTimeNow, setRelativeTimeNow] = useState(0);
    const [dockerActionMessage, setDockerActionMessage] = useState<string | undefined>(undefined);
    const [copyAnnouncementKey, setCopyAnnouncementKey] = useState(0);
    // True when the terminal failure was a readiness timeout (the container was left running),
    // so the failed view offers Wait longer / View logs / Start over instead of just Retry (§9.1).
    const [timedOut, setTimedOut] = useState(false);

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
    const readinessAbortRef = useRef<AbortController | null>(null);
    const dockerPollAbortRef = useRef<AbortController | null>(null);
    const dockerWaitTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    // Current Advanced options, synced from the fields below so handleStart (and Retry)
    // always read the latest without re-binding the provisioning subscription.
    const advancedRef = useRef<AdvancedQuickStartOptions | undefined>(undefined);
    // Focused when provisioning ends so keyboard/screen-reader users land on the primary
    // result action instead of being stranded on the now-unmounted Cancel button (WCAG 2.4.3).
    const resultActionRef = useRef<HTMLButtonElement>(null);
    // Focused while provisioning so a keyboard user isn't stranded on <body> after Start/Retry/
    // Wait longer unmounts the button they clicked (WCAG 2.4.3).
    const cancelButtonRef = useRef<HTMLButtonElement>(null);
    // True while the in-flight stream is a "Wait longer" resume, so Cancel returns to the
    // timed-out actions view (container is kept) rather than the fresh setup form.
    const isWaitLongerRef = useRef(false);
    // Monotonic id for the current provisioning/resume stream. Callbacks capture it and ignore
    // any invocation from a superseded/cancelled stream, so a late/flushed event can't overwrite
    // state after Cancel / Start over / a new Start (gpt-5.5 defense-in-depth).
    const streamGenerationRef = useRef(0);

    // Validate the Advanced fields client-side, mirroring the router's zod schema so a valid
    // form never dead-ends on a server rejection. Returns the offending field (for a per-field
    // error state, a11y §3.3.1) plus the message. Credential/image checks are skipped while
    // reusing an existing instance, since those inputs are hidden and their values are ignored.
    // eslint-disable-next-line no-control-regex
    const credForbidden = /[\u0000-\u001f\u007f]/;
    const advValidation = ((): { field: 'port' | 'username' | 'password' | 'tag'; message: string } | undefined => {
        const port = advPort.trim();
        if (port && (!/^\d+$/.test(port) || Number(port) < 1024 || Number(port) > 65535)) {
            return { field: 'port', message: l10n.t('Port must be a whole number between 1024 and 65535.') };
        }
        if (!isRecreate) {
            const user = advUser.trim();
            const pass = advPass.trim();
            const hasUser = user.length > 0;
            const hasPass = pass.length > 0;
            if (hasUser !== hasPass) {
                return {
                    field: hasUser ? 'password' : 'username',
                    message: l10n.t('Enter both a username and a password, or leave both blank to auto-generate.'),
                };
            }
            if (user.length > 128) {
                return { field: 'username', message: l10n.t('Username must be 128 characters or fewer.') };
            }
            if (pass.length > 256) {
                return { field: 'password', message: l10n.t('Password must be 256 characters or fewer.') };
            }
            if (hasUser && credForbidden.test(user)) {
                return { field: 'username', message: l10n.t('Username must not contain control characters.') };
            }
            if (hasPass && credForbidden.test(pass)) {
                return { field: 'password', message: l10n.t('Password must not contain control characters.') };
            }
            const tag = advTag.trim();
            if (tag && (tag.length > 128 || !/^[\w][\w.-]*$/.test(tag))) {
                return {
                    field: 'tag',
                    message: l10n.t('Image tag may contain only letters, numbers, dots, dashes, and underscores.'),
                };
            }
        }
        return undefined;
    })();
    const advError = advValidation?.message;

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

    useEffect(() => {
        // Keep keyboard/screen-reader focus in the current content across phase changes (WCAG
        // 2.4.3): on a terminal phase focus the primary result action; while provisioning focus
        // Cancel — otherwise focus would fall to <body> when the button the user clicked unmounts.
        if (phase === 'success' || phase === 'failed') {
            resultActionRef.current?.focus();
        } else if (phase === 'provisioning') {
            cancelButtonRef.current?.focus();
        }
    }, [phase]);

    // Human-readable message for the current in-flight stage, mirrored into a polite live
    // region so screen-reader users hear provisioning progress (WCAG 4.1.3). Suppressed once
    // any stage has errored so a stale "…" utterance can't precede the failure announcement.
    const activeStage = PROVISION_STAGES.find((s) => stageStatus[s] === 'active');
    const anyStageErrored = PROVISION_STAGES.some((s) => stageStatus[s] === 'error');
    const provisioningStatusMessage = activeStage && !anyStageErrored ? l10n.t('{0}…', STAGE_LABELS[activeStage]) : '';

    const applyDockerStatus = useCallback((result: DockerStatusResult): void => {
        setDocker(result);
        setRelativeTimeNow(Date.now());
        const ready = result.readiness.outcome === 'ready';
        if (ready && result.status.canResumeReadiness) {
            setStageStatus({
                checking: 'done',
                pulling: 'done',
                creating: 'done',
                starting: 'done',
                waiting: 'error',
                done: 'pending',
                error: 'pending',
            });
            setTimedOut(true);
            setPhase('failed');
            return;
        }
        setPhase(ready ? 'review' : 'dockerNotReady');
    }, []);

    const loadDockerStatus = useCallback(
        (forceRefresh = false): void => {
            readinessAbortRef.current?.abort();
            const abortController = new AbortController();
            readinessAbortRef.current = abortController;
            setPhase('loading');
            void trpcClient.localQuickStart.getDockerStatus
                .query(forceRefresh ? { forceRefresh: true } : undefined, { signal: abortController.signal })
                .then((result) => {
                    if (abortController.signal.aborted) return;
                    applyDockerStatus(result);
                })
                .catch((error: unknown) => {
                    if (abortController.signal.aborted) return;
                    setErrorMessage(error instanceof Error ? error.message : String(error));
                    setPhase('dockerNotReady');
                })
                .finally(() => {
                    if (readinessAbortRef.current === abortController) {
                        readinessAbortRef.current = null;
                    }
                });
        },
        [applyDockerStatus, trpcClient],
    );

    const stopTimer = useCallback((): void => {
        if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
        }
    }, []);

    const stopDockerWait = useCallback((): void => {
        dockerPollAbortRef.current?.abort();
        dockerPollAbortRef.current = null;
        if (dockerWaitTimerRef.current) {
            clearInterval(dockerWaitTimerRef.current);
            dockerWaitTimerRef.current = null;
        }
        setStartingDocker(false);
    }, []);

    const handleStopWaiting = useCallback((): void => {
        stopDockerWait();
        setDockerActionMessage(l10n.t('Stopped waiting for Docker.'));
    }, [stopDockerWait]);

    const handleStartDocker = useCallback((): void => {
        stopDockerWait();
        setDockerActionMessage(undefined);
        setStartingDocker(true);
        setDockerWaitElapsedMs(0);
        const abortController = new AbortController();
        dockerPollAbortRef.current = abortController;
        void trpcClient.localQuickStart.startDockerProvider
            .mutate(undefined, { signal: abortController.signal })
            .then(async (launchResult) => {
                if (abortController.signal.aborted) return;
                if (launchResult === 'notAvailable' || launchResult === 'failed') {
                    stopDockerWait();
                    setDockerActionMessage(l10n.t('Docker could not be started.'));
                    return;
                }
                const startedAt = Date.now();
                dockerWaitTimerRef.current = setInterval(
                    () => setDockerWaitElapsedMs(Date.now() - startedAt),
                    250,
                );
                let latestResult: DockerStatusResult | undefined;
                const outcome = await pollDockerReadiness({
                    signal: abortController.signal,
                    query: (suppressCommandEcho) =>
                        trpcClient.localQuickStart.getDockerStatus.query(
                            { forceRefresh: true, suppressCommandEcho },
                            { signal: abortController.signal },
                        ),
                    onResult: (result) => {
                        latestResult = result;
                        setDocker(result);
                        setRelativeTimeNow(Date.now());
                    },
                });
                if (abortController.signal.aborted) return;
                stopDockerWait();
                if (outcome === 'ready' && latestResult) {
                    applyDockerStatus(latestResult);
                } else if (outcome === 'deadline') {
                    setDockerActionMessage(l10n.t('Docker did not become ready before the wait timed out.'));
                }
            })
            .catch(() => {
                if (abortController.signal.aborted) return;
                stopDockerWait();
                setDockerActionMessage(l10n.t('The Docker readiness check failed.'));
            });
    }, [applyDockerStatus, stopDockerWait, trpcClient]);

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- initial async readiness load owns the loading phase
        loadDockerStatus();
        return () => {
            readinessAbortRef.current?.abort();
            dockerPollAbortRef.current?.abort();
            subscriptionRef.current?.unsubscribe();
            if (timerRef.current) clearInterval(timerRef.current);
            if (dockerWaitTimerRef.current) clearInterval(dockerWaitTimerRef.current);
        };
    }, [loadDockerStatus]);

    useEffect(() => {
        const relativeTimeTimer = setInterval(() => setRelativeTimeNow(Date.now()), 30_000);
        return () => clearInterval(relativeTimeTimer);
    }, []);

    const runStream = useCallback(
        (
            subscribe: (handlers: {
                onData: (event: StageEvent) => void;
                onError: (error: unknown) => void;
                onComplete: () => void;
            }) => { unsubscribe: () => void },
            options?: { resetStages?: boolean },
        ): void => {
            // Cancel any prior in-flight subscription so a fast double-click can't leak
            // an uncancellable stream (mirrors the Query Insights pattern).
            subscriptionRef.current?.unsubscribe();
            subscriptionRef.current = null;
            // Supersede any prior stream: its in-flight callbacks will see a newer generation and no-op.
            const myGeneration = ++streamGenerationRef.current;

            // "Wait longer" resumes at the waiting stage, so keep the earlier stages' done state
            // rather than resetting the whole list to pending.
            if (options?.resetStages !== false) {
                setStageStatus(emptyStageStatus());
            }
            setErrorMessage(undefined);
            setSuccessMessage(undefined);
            setTimedOut(false);
            setElapsedMs(0);
            setPhase('provisioning');

            const startedAt = Date.now();
            timerRef.current = setInterval(() => setElapsedMs(Date.now() - startedAt), 250);

            let settled = false;
            const subscription = subscribe({
                onData(event: StageEvent) {
                    if (myGeneration !== streamGenerationRef.current) return; // superseded/cancelled stream
                    if (event.stage === 'done' && event.status === 'done') {
                        settled = true;
                        stopTimer();
                        setStageStatus((prev) => ({ ...prev, [event.stage]: event.status }));
                        setSuccessMessage(event.message);
                        setBoundPort(event.boundPort);
                        setPhase('success');
                    } else if (event.status === 'error') {
                        settled = true;
                        stopTimer();
                        // Also flip the still-active real stage to 'error' so its row shows the error
                        // icon + "failed" status instead of a stuck spinner / "in progress" that would
                        // contradict the failure message for sighted and screen-reader users alike.
                        setStageStatus((prev) => {
                            const next = { ...prev, [event.stage]: event.status };
                            const active = PROVISION_STAGES.find((s) => prev[s] === 'active');
                            if (active) next[active] = 'error';
                            return next;
                        });
                        setErrorMessage(event.error ?? event.message ?? l10n.t('Setup failed.'));
                        setTimedOut(event.timedOut === true);
                        setPhase('failed');
                    } else {
                        setStageStatus((prev) => ({ ...prev, [event.stage]: event.status }));
                    }
                },
                onError(error: unknown) {
                    if (myGeneration !== streamGenerationRef.current) return; // superseded/cancelled stream
                    settled = true;
                    stopTimer();
                    setErrorMessage(error instanceof Error ? error.message : String(error));
                    setTimedOut(false);
                    setPhase('failed');
                    if (subscriptionRef.current === subscription) {
                        subscriptionRef.current = null;
                    }
                },
                onComplete() {
                    if (myGeneration !== streamGenerationRef.current) return; // superseded/cancelled stream
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
        },
        [stopTimer],
    );

    const startProvisioning = useCallback(
        (continueAnyway: boolean): void => {
            isWaitLongerRef.current = false;
            const options = continueAnyway
                ? { ...(advancedRef.current ?? {}), continueAnyway: true }
                : advancedRef.current;
            runStream((handlers) => trpcClient.localQuickStart.startQuickStart.subscribe(options, handlers));
        },
        [trpcClient, runStream],
    );

    const handleStart = useCallback((): void => startProvisioning(false), [startProvisioning]);

    const handleContinueAnyway = useCallback((): void => startProvisioning(true), [startProvisioning]);

    // "Wait longer" (§9.1): re-probe the container the service kept running after a readiness
    // timeout, keeping the already-completed stages visible. Optimistically flip the waiting row
    // back to active so it doesn't flash the error icon before the first server event arrives.
    const handleWaitLonger = useCallback((): void => {
        isWaitLongerRef.current = true;
        setStageStatus((prev) => ({ ...prev, waiting: 'active' }));
        runStream((handlers) => trpcClient.localQuickStart.waitLonger.subscribe(undefined, handlers), {
            resetStages: false,
        });
    }, [trpcClient, runStream]);

    // "Start over" (§9.1): discard the timed-out container (a fresh attempt's volume is wiped) and
    // return to the review form. If the discard no-ops because a just-cancelled resume is still
    // unwinding, keep the timed-out actions (the container is intact) so nothing is stranded.
    const handleStartOver = useCallback((): void => {
        subscriptionRef.current?.unsubscribe();
        subscriptionRef.current = null;
        streamGenerationRef.current++; // ignore any trailing callbacks from the cancelled stream
        isWaitLongerRef.current = false;
        stopTimer();
        void trpcClient.localQuickStart.discardTimedOut
            .mutate()
            .then((discarded) => {
                if (discarded) {
                    setTimedOut(false);
                    setErrorMessage(undefined);
                    setStageStatus(emptyStageStatus());
                    setPhase('review');
                } else {
                    setTimedOut(true);
                    setPhase('failed');
                }
            })
            .catch(() => {
                setTimedOut(true);
                setPhase('failed');
            });
    }, [trpcClient, stopTimer]);

    const handleClose = useCallback((): void => {
        void trpcClient.localQuickStart.closePanel.mutate().catch(() => undefined);
    }, [trpcClient]);

    const handleCancel = useCallback((): void => {
        subscriptionRef.current?.unsubscribe();
        subscriptionRef.current = null;
        streamGenerationRef.current++; // ignore any trailing callbacks from the cancelled stream
        stopTimer();
        if (isWaitLongerRef.current) {
            // Cancelling a "Wait longer" resume leaves the container running, so return to the
            // timed-out actions (Wait longer / Start over) rather than the fresh setup form.
            isWaitLongerRef.current = false;
            setTimedOut(true);
            setPhase('failed');
        } else {
            setTimedOut(false);
            setPhase('review');
        }
    }, [stopTimer]);

    // From the failed phase, return to the review form (Advanced field state is preserved) so
    // the user can correct a bad option (e.g. a busy explicit port) and retry — design feedback.
    const handleBackToReview = useCallback((): void => {
        isWaitLongerRef.current = false;
        setErrorMessage(undefined);
        setTimedOut(false);
        setPhase('review');
    }, []);

    const handleViewOutput = useCallback((): void => {
        void trpcClient.localQuickStart.showOutput.mutate().catch(() => undefined);
    }, [trpcClient]);

    const handleCopyRecoveryCommand = useCallback((): void => {
        const recoveryCommand = docker?.readiness.recoveryCommand;
        if (!recoveryCommand) return;
        void trpcClient.localQuickStart.copyRecoveryCommand
            .mutate(recoveryCommand.id)
            .then(() => setCopyAnnouncementKey((current) => current + 1))
            .catch(() => undefined);
    }, [docker, trpcClient]);

    const handleOpenConnection = useCallback((): void => {
        // Reveal the connection in the Connections view but KEEP this panel open —
        // only the explicit Close button dismisses the page (user feedback).
        void trpcClient.localQuickStart.openConnection.mutate().catch(() => undefined);
    }, [trpcClient]);

    const handleCopyConnString = useCallback((): void => {
        void trpcClient.localQuickStart.copyConnectionString.mutate().catch(() => undefined);
    }, [trpcClient]);

    const renderReadinessFooter = (): JSX.Element => (
        <div className={styles.readinessFooter}>
            <Text size={200} className={styles.muted} role="status" aria-live="polite">
                {formatLastChecked(
                    docker ? getDockerLastCheckedAtMs(docker.readiness) : undefined,
                    relativeTimeNow,
                )}
            </Text>
            <Button
                appearance="subtle"
                size="small"
                icon={<ArrowClockwiseRegular />}
                onClick={() => loadDockerStatus(true)}
            >
                {l10n.t('Refresh')}
            </Button>
        </div>
    );

    const renderReviewCards = (): JSX.Element => {
        const ready = docker?.readiness.outcome === 'ready';
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
                <MetricCard
                    label={l10n.t('Platform')}
                    value={docker?.readiness.daemonArchitecture ?? l10n.t('Unknown until Docker is reachable')}
                />
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
        const targetKey = getDockerExecutionTargetKey(docker?.readiness.executionTarget ?? 'local');
        const targetNotice = EXECUTION_TARGET_NOTICES[targetKey];
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
                    <Text>{EXECUTION_TARGET_VALUES[targetKey]}</Text>
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
                {targetNotice && (
                    <Text size={200} className={styles.targetNotice}>
                        {targetNotice}
                    </Text>
                )}
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
                            <Field
                                label={l10n.t('Port')}
                                hint={l10n.t('Default {0}', String(QUICK_START_PORT))}
                                validationState={advValidation?.field === 'port' ? 'error' : 'none'}
                                validationMessage={advValidation?.field === 'port' ? advValidation.message : undefined}
                            >
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
                                    validationState={advValidation?.field === 'tag' ? 'error' : 'none'}
                                    validationMessage={
                                        advValidation?.field === 'tag' ? advValidation.message : undefined
                                    }
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
                                <Field
                                    label={l10n.t('Username')}
                                    hint={l10n.t('Default: auto-generated')}
                                    validationState={advValidation?.field === 'username' ? 'error' : 'none'}
                                    validationMessage={
                                        advValidation?.field === 'username' ? advValidation.message : undefined
                                    }
                                >
                                    <Input
                                        value={advUser}
                                        maxLength={128}
                                        placeholder={l10n.t('auto')}
                                        onChange={(_e, d) => setAdvUser(d.value)}
                                    />
                                </Field>
                            )}
                            {!isRecreate && (
                                <Field
                                    label={l10n.t('Password')}
                                    hint={l10n.t('Default: auto-generated')}
                                    validationState={advValidation?.field === 'password' ? 'error' : 'none'}
                                    validationMessage={
                                        advValidation?.field === 'password' ? advValidation.message : undefined
                                    }
                                >
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
                    </div>
                </AccordionPanel>
            </AccordionItem>
        </Accordion>
    );

    const renderStageRow = (stage: ProvisionStage): JSX.Element => {
        const status = stageStatus[stage];
        let icon: JSX.Element;
        let statusText: string;
        if (status === 'done') {
            icon = <CheckmarkCircleFilled aria-hidden className={styles.stageIconDone} />;
            statusText = l10n.t('done');
        } else if (status === 'error') {
            icon = <ErrorCircleFilled aria-hidden className={styles.stageIconError} />;
            statusText = l10n.t('failed');
        } else if (status === 'active') {
            icon = <Spinner size="tiny" aria-hidden />;
            statusText = l10n.t('in progress');
        } else {
            icon = <CircleRegular aria-hidden className={styles.stageIconPending} />;
            statusText = l10n.t('pending');
        }
        return (
            <div
                key={stage}
                role="listitem"
                className={styles.stageRow}
                // Row-level label reads naturally on every screen reader (e.g. "Pulling official
                // image, done"); the icon and visible text are decorative duplicates (WCAG 1.1.1).
                aria-label={`${STAGE_LABELS[stage]}, ${statusText}`}
            >
                {icon}
                <Text aria-hidden className={status === 'pending' ? styles.muted : undefined}>
                    {STAGE_LABELS[stage]}
                </Text>
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
            <RocketRegular aria-hidden className={styles.heroIcon} />
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
        const presentation = r ? getDockerReadinessPresentation(r) : undefined;
        const presentationState = startingDocker ? 'starting' : (presentation?.state ?? 'notAccessible');
        const guidance = DOCKER_GUIDANCE[startingDocker ? 'daemonStarting' : (presentation?.guidance ?? 'notAccessible')];
        const recoveryNote = presentation?.recoveryNote ? DOCKER_RECOVERY_NOTES[presentation.recoveryNote] : undefined;
        const platformKnown = r?.daemonArchitecture !== undefined;
        const statusBadge = (ok: boolean, notOkColor: 'danger' | 'warning'): JSX.Element => (
            <Badge appearance="filled" color={ok ? 'success' : notOkColor} size="small">
                {ok ? '✓' : '!'}
            </Badge>
        );
        return (
            <div className={styles.root}>
                <Announcer
                    when={phase === 'dockerNotReady'}
                    message={l10n.t('Docker is not ready. {0}', guidance)}
                    politeness="assertive"
                />
                <Announcer
                    when={startingDocker}
                    message={l10n.t('Waiting for Docker to start.')}
                    politeness="polite"
                />
                <Announcer
                    key={copyAnnouncementKey}
                    when={copyAnnouncementKey > 0}
                    message={l10n.t('Recovery command copied.')}
                    politeness="polite"
                />
                <Announcer
                    when={dockerActionMessage !== undefined}
                    message={dockerActionMessage ?? ''}
                    politeness="assertive"
                />
                {hero(
                    l10n.t('DocumentDB Local'),
                    l10n.t(
                        'Docker is required to run DocumentDB locally. The extension does not install Docker for you.',
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
                        value={DOCKER_DAEMON_VALUES[presentationState]}
                        badge={statusBadge(false, startingDocker ? 'warning' : 'danger')}
                    />
                    <MetricCard
                        label={l10n.t('Platform')}
                        value={r?.daemonArchitecture ?? l10n.t('Unknown until Docker is reachable')}
                        badge={statusBadge(platformKnown, 'warning')}
                    />
                </div>
                <Card className={styles.summaryCard}>
                    <Text weight="semibold">{l10n.t('How to fix')}</Text>
                    <Divider />
                    <Text size={200}>{guidance}</Text>
                    {startingDocker && (
                        <div className={styles.waitingStatus}>
                            <Spinner size="tiny" aria-hidden />
                            <Text size={200}>{l10n.t('Waiting {0}', formatElapsed(dockerWaitElapsedMs))}</Text>
                        </div>
                    )}
                    {presentation?.showCopyCommand && r?.recoveryCommand && (
                        <div className={styles.recoveryCommand}>
                            <div className={styles.recoveryCommandText}>
                                <code>{r.recoveryCommand.commandLine}</code>
                                {recoveryNote && (
                                    <Text size={200} className={styles.muted}>
                                        {recoveryNote}
                                    </Text>
                                )}
                            </div>
                            <Button size="small" onClick={handleCopyRecoveryCommand}>
                                {l10n.t('Copy command')}
                            </Button>
                        </div>
                    )}
                    {r?.diagnosticSummary && (
                        <details>
                            <summary>{l10n.t('Show details')}</summary>
                            <Text size={200}>{r.diagnosticSummary}</Text>
                        </details>
                    )}
                    <div className={styles.actions}>
                        {presentation && (
                            <Link href={DOCKER_GUIDES[presentation.guide].href}>
                                {DOCKER_GUIDES[presentation.guide].label}
                            </Link>
                        )}
                    </div>
                </Card>
                <div className={styles.actions}>
                    {presentation?.showViewOutput && (
                        <Button appearance="secondary" onClick={handleViewOutput}>
                            {l10n.t('View Docker output')}
                        </Button>
                    )}
                    {presentation?.showContinueAnyway && (
                        <Button appearance="secondary" onClick={handleContinueAnyway}>
                            {l10n.t('Continue anyway')}
                        </Button>
                    )}
                    {startingDocker ? (
                        <Button appearance="secondary" onClick={handleStopWaiting}>
                            {l10n.t('Stop waiting')}
                        </Button>
                    ) : presentation?.showStartDockerProvider && presentation.startLabel ? (
                        <Button appearance="primary" onClick={handleStartDocker}>
                            {DOCKER_START_LABELS[presentation.startLabel]}
                        </Button>
                    ) : null}
                    {!startingDocker && presentation?.showRetry && (
                        <Button
                            appearance="primary"
                            icon={<ArrowClockwiseRegular />}
                            onClick={() => loadDockerStatus(true)}
                        >
                            {l10n.t('Retry')}
                        </Button>
                    )}
                </div>
                {renderReadinessFooter()}
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
                <Announcer
                    when={phase === 'failed'}
                    message={
                        timedOut
                            ? l10n.t('DocumentDB is still initializing. Keep waiting, view the logs, or start over.')
                            : l10n.t('Setup failed. {0}', errorMessage ?? l10n.t('See the details below.'))
                    }
                    politeness="polite"
                />
                {/* Streams the current provisioning stage to screen readers (WCAG 4.1.3). */}
                <div role="status" aria-live="polite" aria-atomic="true" className={styles.srOnly}>
                    {phase === 'provisioning' ? provisioningStatusMessage : ''}
                </div>
                {hero(
                    l10n.t('DocumentDB Local'),
                    phase === 'provisioning' ? l10n.t('Setting up… {0}', elapsedLabel()) : '',
                )}

                {phase === 'success' && (
                    <div className={styles.successBox}>
                        <Text weight="semibold">{successMessage ?? l10n.t('DocumentDB Local is running.')}</Text>
                        <div className={styles.nextSteps}>
                            <Text size={200} weight="semibold">
                                {l10n.t('Next steps')}
                            </Text>
                            <Text size={200}>
                                {l10n.t(
                                    '• Open Connection: browse your databases in the Connections view, under “DocumentDB Local”.',
                                )}
                            </Text>
                            <Text size={200}>
                                {docker?.readiness.executionTarget === 'local'
                                    ? l10n.t(
                                          '• Copy Connection String: use it from a Query Playground, your app, or mongosh (localhost:{0}).',
                                          String(boundPort ?? QUICK_START_PORT),
                                      )
                                    : l10n.t(
                                          '• Copy Connection String: localhost:{0} is reachable from tools running on the extension host.',
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

                <Card className={styles.stageList} role="list" aria-label={l10n.t('Setup progress')}>
                    {PROVISION_STAGES.map(renderStageRow)}
                </Card>

                {phase === 'failed' && (
                    <div className={styles.errorBox}>
                        {timedOut ? (
                            <Text>
                                {l10n.t(
                                    'The container is running, but DocumentDB has not accepted connections yet. It may still be initializing. Keep waiting, view the logs, or start over.',
                                )}
                            </Text>
                        ) : (
                            <Text>{errorMessage ?? l10n.t('Setup failed.')}</Text>
                        )}
                    </div>
                )}

                <div>
                    <Link onClick={handleViewOutput}>{l10n.t('View Docker output')}</Link>
                </div>

                <div className={styles.actions}>
                    {phase === 'provisioning' && (
                        <Button appearance="secondary" ref={cancelButtonRef} onClick={handleCancel}>
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
                            <Button appearance="primary" ref={resultActionRef} onClick={handleOpenConnection}>
                                {l10n.t('Open Connection')}
                            </Button>
                        </>
                    )}
                    {phase === 'failed' && timedOut && (
                        <>
                            <Button appearance="secondary" onClick={handleStartOver}>
                                {l10n.t('Start over')}
                            </Button>
                            <Button
                                appearance="primary"
                                ref={resultActionRef}
                                icon={<ArrowClockwiseRegular />}
                                onClick={handleWaitLonger}
                            >
                                {l10n.t('Wait longer')}
                            </Button>
                        </>
                    )}
                    {phase === 'failed' && !timedOut && (
                        <>
                            <Button appearance="secondary" onClick={handleBackToReview}>
                                {l10n.t('Edit settings')}
                            </Button>
                            <Button
                                appearance="primary"
                                ref={resultActionRef}
                                icon={<ArrowClockwiseRegular />}
                                onClick={handleStart}
                            >
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
                l10n.t('DocumentDB Local'),
                l10n.t('Get a working local DocumentDB instance in one click. No terminal commands needed.'),
            )}
            {renderReviewCards()}
            {renderSummary()}
            {renderAdvanced()}
            {renderReadinessFooter()}
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
