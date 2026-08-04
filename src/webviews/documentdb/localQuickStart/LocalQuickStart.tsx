/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Accordion,
    AccordionHeader,
    AccordionItem,
    AccordionPanel,
    Button,
    Field,
    Input,
    Link,
    makeStyles,
    mergeClasses,
    MessageBar,
    MessageBarActions,
    MessageBarBody,
    MessageBarTitle,
    Spinner,
    Switch,
    Text,
    tokens,
} from '@fluentui/react-components';
import {
    ArrowClockwiseRegular,
    ArrowLeftRegular,
    CheckmarkCircleFilled,
    CircleHintFilled,
    EditRegular,
    ErrorCircleFilled,
    InfoRegular,
    RocketRegular,
} from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { Fragment, type JSX, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    type AdvancedQuickStartOptions,
    type DockerEndpointProbe,
    type DockerFailureKind,
    type DockerProvider,
    type DockerReadiness,
    type DockerRecoveryCommand,
    type DockerStatusResult,
    PROVISION_STAGES,
    type ProvisionStage,
    QUICK_START_CONTAINER_NAME,
    QUICK_START_DEFAULT_TAG,
    QUICK_START_IMAGE,
    QUICK_START_IMAGE_REPOSITORY,
    QUICK_START_PORT,
    type StageEvent,
} from '../../../services/localQuickStart/quickStartTypes';
import { useTrpcClient } from '../../_integration/useTrpcClient';
import { Announcer } from '../../components/accessibility/Announcer';
import { WizardBreadcrumb, type WizardStepMeta } from '../../components/wizard/WizardBreadcrumb';
import { pollDockerReadiness } from './dockerReadinessPolling';
import {
    type DockerDetailFailureKey,
    type DockerDetailSegment,
    type DockerGuidanceKey,
    type DockerGuideKey,
    type DockerReadinessPresentationState,
    type DockerRecoveryNoteKey,
    type DockerStartLabelKey,
    getDockerExecutionTargetKey,
    getDockerReadinessPresentation,
} from './dockerReadinessPresentation';
import './localQuickStart.scss';

/**
 * Wizard phases. `provisioning` and `failed` are both the "Set up" step: a setup failure — Docker
 * problems included — is reported in place, beside the stage that failed, rather than on a screen
 * of its own.
 */
type Phase = 'introduction' | 'configure' | 'provisioning' | 'failed' | 'success';
type WizardStepId = 'introduction' | 'configure' | 'setup' | 'done';
type StageStatus = 'pending' | 'active' | 'done' | 'error';

function stepForPhase(phase: Phase): WizardStepId {
    switch (phase) {
        case 'introduction':
            return 'introduction';
        case 'configure':
            return 'configure';
        case 'provisioning':
        case 'failed':
            return 'setup';
        case 'success':
            return 'done';
    }
}

const useStyles = makeStyles({
    root: { display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' },
    scrollArea: { flex: 1, minHeight: 0, overflowY: 'auto' },
    content: {
        display: 'flex',
        flexDirection: 'column',
        gap: '20px',
        maxWidth: '760px',
        padding: '24px',
    },
    hero: { display: 'flex', alignItems: 'center', gap: '16px' },
    heroIcon: { color: tokens.colorBrandForeground1, fontSize: '56px', flexShrink: 0 },
    muted: { color: tokens.colorNeutralForeground2 },
    section: { display: 'flex', flexDirection: 'column', gap: '12px' },
    sectionHeader: { display: 'flex', flexDirection: 'column', gap: '4px' },
    // Navigation footer: the note that sets expectations for the primary action sits directly
    // above it, then primary first and secondary after. The elevation only appears while the
    // content actually overflows, so a short page keeps a flat, quiet footer.
    footer: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        gap: '12px',
        flexShrink: 0,
        padding: '16px 24px',
        backgroundColor: tokens.colorNeutralBackground1,
        borderTop: '1px solid transparent',
        transitionProperty: 'box-shadow, border-top-color',
        transitionDuration: tokens.durationNormal,
        transitionTimingFunction: tokens.curveEasyEase,
    },
    footerActions: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px' },
    footerNote: {
        display: 'flex',
        alignItems: 'flex-start',
        gap: '8px',
        maxWidth: '760px',
        color: tokens.colorNeutralForeground2,
    },
    footerNoteIcon: { color: tokens.colorNeutralForeground3, fontSize: '16px', flexShrink: 0, marginTop: '2px' },
    footerElevated: {
        borderTopColor: tokens.colorNeutralStroke2,
        boxShadow: '0 -2px 6px rgba(0, 0, 0, 0.08)',
    },
    introCopy: { display: 'flex', flexDirection: 'column', gap: '8px' },
    planSection: { display: 'flex', flexDirection: 'column', gap: '12px' },
    planList: { display: 'flex', flexDirection: 'column', gap: '2px', margin: 0, padding: 0, listStyle: 'none' },
    planItem: { display: 'grid', gridTemplateColumns: '22px minmax(0, 1fr)', gap: '0 10px', padding: '7px 0' },
    planIndex: {
        display: 'grid',
        placeItems: 'center',
        width: '20px',
        height: '20px',
        borderRadius: '50%',
        backgroundColor: tokens.colorNeutralBackground4,
        color: tokens.colorNeutralForeground2,
        fontSize: '11px',
    },
    planCopy: { display: 'flex', flexDirection: 'column', gap: '1px', minWidth: 0 },
    settingsTable: {
        display: 'grid',
        gridTemplateColumns: '112px minmax(0, 1fr) auto',
        alignItems: 'center',
        gap: '0 16px',
        borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
        '@media (max-width: 560px)': { gridTemplateColumns: '96px minmax(0, 1fr)' },
    },
    settingLabel: {
        alignSelf: 'stretch',
        display: 'flex',
        alignItems: 'center',
        padding: '12px 0',
        color: tokens.colorNeutralForeground2,
        borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    },
    settingValue: {
        alignSelf: 'stretch',
        display: 'flex',
        alignItems: 'center',
        minWidth: 0,
        gap: '8px',
        padding: '12px 0',
        borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    },
    settingAction: {
        alignSelf: 'stretch',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-end',
        padding: '8px 0',
        borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
        '@media (max-width: 560px)': {
            gridColumn: '2',
            justifyContent: 'flex-start',
            paddingTop: 0,
            paddingBottom: '10px',
        },
    },
    editFields: {
        gridColumn: '2 / 4',
        display: 'grid',
        gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
        gap: '12px',
        padding: '12px 0',
        borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
        '@media (max-width: 560px)': { gridColumn: '1 / 3', gridTemplateColumns: '1fr' },
    },
    imagePath: { overflowWrap: 'anywhere' },
    stageList: {
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        padding: '16px',
        border: `1px solid ${tokens.colorNeutralStroke2}`,
        borderRadius: tokens.borderRadiusMedium,
    },
    stageRow: { display: 'flex', alignItems: 'flex-start', gap: '10px', minHeight: '20px' },
    stageIcon: { width: '18px', height: '20px', flexShrink: 0, display: 'grid', placeItems: 'center' },
    stageCopy: { display: 'flex', flexDirection: 'column', gap: '1px', minWidth: 0, alignItems: 'flex-start' },
    stageAction: { marginTop: '3px' },
    stageDone: { color: tokens.colorPaletteGreenForeground1, fontSize: '18px' },
    stageError: { color: tokens.colorPaletteRedForeground1, fontSize: '18px' },
    stagePending: { color: tokens.colorNeutralForeground4, fontSize: '18px' },
    dockerStatus: { display: 'flex', flexDirection: 'column', gap: '10px' },
    messageBody: { display: 'flex', flexDirection: 'column', gap: '8px' },
    recoveryCommand: { display: 'flex', flexDirection: 'column', gap: '4px' },
    recoveryCommandLine: { overflowWrap: 'anywhere' },
    waitingStatus: { display: 'flex', alignItems: 'center', gap: '8px' },
    dockerAccordionHeader: { minHeight: '30px' },
    dockerAccordionPanel: { paddingTop: '4px' },
    dockerDetails: {
        display: 'grid',
        gridTemplateColumns: '150px minmax(0, 1fr)',
        margin: 0,
        borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
        '@media (max-width: 480px)': { gridTemplateColumns: '110px minmax(0, 1fr)' },
    },
    dockerDetailLabel: {
        margin: 0,
        padding: '9px 0',
        color: tokens.colorNeutralForeground2,
        borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    },
    dockerDetailValue: {
        margin: 0,
        padding: '9px 0',
        overflowWrap: 'anywhere',
        borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    },
    lastCheckedRow: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '8px',
    },
    nextSteps: { display: 'flex', flexDirection: 'column', gap: '4px' },
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

interface PlanItem {
    readonly label: string;
    readonly detail: string;
}

/** Mirrors the wizard's own sequence, so the user recognizes it again on the Set up page. */
const PLAN_ITEMS: readonly PlanItem[] = [
    {
        label: l10n.t('Verify your Docker setup'),
        detail: l10n.t('Confirms Docker is installed and can run containers on this machine.'),
    },
    {
        label: l10n.t('Download the official image'),
        detail: l10n.t('Downloaded once, then reused for later setups.'),
    },
    {
        label: l10n.t('Create and start the container'),
        detail: l10n.t('One container named {0}, using the settings you choose.', QUICK_START_CONTAINER_NAME),
    },
    {
        label: l10n.t('Save the connection'),
        detail: l10n.t('The connection appears in the Connections view, ready to open.'),
    },
];

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

const DOCKER_FAILURE_LABELS: Readonly<Record<DockerFailureKind, string>> = {
    cliMissing: l10n.t('Docker CLI not found'),
    permissionDenied: l10n.t('Docker access denied'),
    daemonUnavailable: l10n.t('Docker daemon unavailable'),
    daemonStarting: l10n.t('Docker daemon starting'),
    contextUnavailable: l10n.t('Docker context unavailable'),
    endpointUnreachable: l10n.t('Docker endpoint unreachable'),
    probeTimedOut: l10n.t('Docker check timed out'),
    unsupportedHost: l10n.t('Unsupported host'),
    windowsContainers: l10n.t('Windows containers enabled'),
    unknown: l10n.t('Unknown Docker problem'),
};

const DOCKER_ENDPOINT_SOURCE_LABELS: Readonly<Record<DockerEndpointProbe['source'], string>> = {
    dockerHostEnv: l10n.t('DOCKER_HOST environment variable'),
    dockerContextEnv: l10n.t('DOCKER_CONTEXT environment variable'),
    currentContext: l10n.t('Current Docker context'),
    platformDefault: l10n.t('Platform default'),
};

const DOCKER_PROVIDER_LABELS: Readonly<Record<DockerProvider, string>> = {
    dockerDesktop: l10n.t('Docker Desktop'),
    dockerEngine: l10n.t('Docker Engine'),
    unknown: l10n.t('Unknown'),
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
    wslIntegrationUnavailable: l10n.t('Enable Docker Desktop integration for this WSL distribution, then check again.'),
    remoteDockerUnavailable: l10n.t(
        'Docker must be available in the remote environment where this extension is running.',
    ),
    endpointUnreachable: l10n.t('The configured Docker endpoint did not respond.'),
    contextUnavailable: l10n.t(
        'The active Docker context is unavailable. Select or repair a valid context, then check again.',
    ),
    checkTimedOut: l10n.t('Docker did not respond before the readiness check timed out.'),
    unsupportedHost: l10n.t('Local Quick Start is supported when the extension runs on Windows, macOS, or Linux.'),
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

const DOCKER_RECOVERY_NOTES: Readonly<Record<DockerRecoveryNoteKey, string>> = {
    groupMembershipNewSession: l10n.t('Group membership applies to new login sessions only.'),
    restartWslDistribution: l10n.t(
        'This stops all running WSL distributions so the new group membership applies when WSL starts again.',
    ),
    runsDockerService: l10n.t('Runs the system Docker service.'),
};

/** Provider names for the stage detail line; an unidentified provider is still "Docker". */
const DOCKER_DETAIL_PROVIDER_LABELS: Readonly<Record<DockerProvider, string>> = {
    dockerDesktop: l10n.t('Docker Desktop'),
    dockerEngine: l10n.t('Docker Engine'),
    unknown: l10n.t('Docker'),
};

const DOCKER_DETAIL_OS_LABELS: Readonly<Record<'linux' | 'windows', string>> = {
    linux: l10n.t('Linux'),
    windows: l10n.t('Windows'),
};

const DOCKER_DETAIL_TARGET_LABELS: Readonly<Record<ReturnType<typeof getDockerExecutionTargetKey>, string>> = {
    local: l10n.t('runs on this machine'),
    wsl: l10n.t('runs in this WSL environment'),
    ssh: l10n.t('runs on the remote SSH host'),
    devContainer: l10n.t('runs in this dev container'),
    codespaces: l10n.t('runs in this Codespace'),
    otherRemote: l10n.t('runs on the remote extension host'),
};

const DOCKER_DETAIL_FAILURE_LABELS: Readonly<Record<DockerDetailFailureKey, string>> = {
    noCli: l10n.t('no Docker CLI found'),
    accessDenied: l10n.t('access denied'),
    notRunning: l10n.t('not running'),
    daemonNotRunning: l10n.t('daemon not running'),
    daemonStarting: l10n.t('daemon starting'),
    notAvailableInWsl: l10n.t('not available in this WSL distribution'),
    endpointUnreachable: l10n.t('endpoint unreachable'),
    contextUnavailable: l10n.t('context unavailable'),
    checkTimedOut: l10n.t('check timed out'),
    unsupportedHost: l10n.t('unsupported host'),
    windowsContainers: l10n.t('Windows containers enabled'),
    daemonUnreachable: l10n.t('daemon unreachable'),
};

function formatDockerDetailSegment(segment: DockerDetailSegment): string | undefined {
    switch (segment.kind) {
        case 'provider': {
            const name = DOCKER_DETAIL_PROVIDER_LABELS[segment.provider];
            return segment.version ? l10n.t('{0} {1}', name, segment.version) : name;
        }
        case 'cli':
            return segment.version ? l10n.t('Docker CLI {0} found', segment.version) : l10n.t('Docker CLI found');
        case 'platform': {
            const osName = segment.osType ? DOCKER_DETAIL_OS_LABELS[segment.osType] : undefined;
            if (osName && segment.architecture) {
                return l10n.t('{0} {1}', osName, segment.architecture);
            }
            return osName ?? segment.architecture;
        }
        case 'executionTarget':
            return DOCKER_DETAIL_TARGET_LABELS[segment.target];
        case 'failure':
            return DOCKER_DETAIL_FAILURE_LABELS[segment.failure];
    }
}

/** Joins the composed evidence segments; a segment whose underlying fact is unknown is dropped. */
function formatDockerDetail(segments: readonly DockerDetailSegment[]): string | undefined {
    const parts = segments
        .map(formatDockerDetailSegment)
        .filter((part): part is string => part !== undefined && part.length > 0);
    return parts.length > 0 ? parts.join(' · ') : undefined;
}

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

interface StageRowProps {
    readonly label: string;
    readonly status: StageStatus;
    /**
     * Evidence about what was actually observed, kept after the stage settles so the list reads
     * as a receipt rather than a transient log.
     */
    readonly detail?: string;
    /** Optional per-stage control, e.g. re-running just this stage's check after a failure. */
    readonly action?: ReactNode;
}

const StageRow = ({ label, status, detail, action }: StageRowProps): JSX.Element => {
    const styles = useStyles();
    let icon: JSX.Element;
    let statusText: string;

    if (status === 'done') {
        icon = <CheckmarkCircleFilled aria-hidden className={styles.stageDone} />;
        statusText = l10n.t('done');
    } else if (status === 'error') {
        icon = <ErrorCircleFilled aria-hidden className={styles.stageError} />;
        statusText = l10n.t('failed');
    } else if (status === 'active') {
        icon = <Spinner size="extra-tiny" aria-hidden />;
        statusText = l10n.t('in progress');
    } else {
        icon = <CircleHintFilled aria-hidden className={styles.stagePending} />;
        statusText = l10n.t('pending');
    }

    // Row-level label reads naturally on every screen reader (e.g. "Pulling official image, done");
    // the icon and visible text are decorative duplicates (WCAG 1.1.1).
    const rowLabel = detail
        ? l10n.t('{0}, {1}. {2}', label, statusText, detail)
        : l10n.t('{0}, {1}', label, statusText);

    return (
        <div className={styles.stageRow} role="listitem" aria-label={rowLabel}>
            <span className={styles.stageIcon}>{icon}</span>
            <div className={styles.stageCopy}>
                <Text aria-hidden className={status === 'pending' ? styles.muted : undefined}>
                    {label}
                </Text>
                {detail && (
                    <Text aria-hidden size={200} className={styles.muted}>
                        {detail}
                    </Text>
                )}
                {action && <div className={styles.stageAction}>{action}</div>}
            </div>
        </div>
    );
};

export const LocalQuickStart = (): JSX.Element => {
    const styles = useStyles();
    const trpcClient = useTrpcClient();

    const [phase, setPhase] = useState<Phase>('introduction');
    /**
     * Readiness backing the `Checking Docker` stage: its detail line in both directions, and its
     * remediation when that stage failed. Loaded in the background while the user reads the
     * Introduction — nothing about it is rendered before the Set up step.
     */
    const [checkReadiness, setCheckReadiness] = useState<DockerReadiness | undefined>(undefined);
    /** A Docker problem reported by a later stage (pull / run), backing that stage's remediation. */
    const [stageDockerFailure, setStageDockerFailure] = useState<DockerReadiness | undefined>(undefined);
    const [willReuse, setWillReuse] = useState(false);
    const [stageStatus, setStageStatus] = useState<Record<ProvisionStage, StageStatus>>(emptyStageStatus);
    const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);
    const [successMessage, setSuccessMessage] = useState<string | undefined>(undefined);
    const [boundPort, setBoundPort] = useState<number | undefined>(undefined);
    const [elapsedMs, setElapsedMs] = useState(0);
    const [startingDocker, setStartingDocker] = useState(false);
    const [checkingDockerAgain, setCheckingDockerAgain] = useState(false);
    const [dockerWaitElapsedMs, setDockerWaitElapsedMs] = useState(0);
    const [relativeTimeNow, setRelativeTimeNow] = useState(0);
    const [dockerActionMessage, setDockerActionMessage] = useState<string | undefined>(undefined);
    const [copyAnnouncementKey, setCopyAnnouncementKey] = useState(0);
    const [dockerRecoveredKey, setDockerRecoveredKey] = useState(0);
    // True when the terminal failure was a readiness timeout (the container was left running),
    // so the failed view offers Wait longer / Start over instead of just Retry (§9.1).
    const [timedOut, setTimedOut] = useState(false);

    // Settings (P1-4). Empty fields fall back to the zero-decision defaults.
    const [advPort, setAdvPort] = useState('');
    const [advUser, setAdvUser] = useState('');
    const [advPass, setAdvPass] = useState('');
    const [advTag, setAdvTag] = useState('');
    const [advLoadSampleData, setAdvLoadSampleData] = useState(true);
    const [editingPort, setEditingPort] = useState(false);
    const [editingImage, setEditingImage] = useState(false);
    const [customCredentials, setCustomCredentials] = useState(false);

    // The service reuses an existing instance (keeping its data volume) whenever stored
    // credentials exist, ignoring any custom credentials / image tag. `willReuse` reflects
    // that exact decision (the same predicate the service uses), so we hide those fields and
    // relabel the settings whenever — and only when — the service will actually reuse.
    const isRecreate = willReuse;
    const useCustomCredentials = customCredentials && !isRecreate;

    const subscriptionRef = useRef<{ unsubscribe: () => void } | null>(null);
    const readinessAbortRef = useRef<AbortController | null>(null);
    // Mirrors `checkReadiness` so the stage-event handler can test it without reading state inside
    // a setState updater (which React may invoke more than once).
    const checkReadinessRef = useRef<DockerReadiness | undefined>(undefined);
    const dockerPollAbortRef = useRef<AbortController | null>(null);
    const dockerWaitTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    // Current settings, synced from the fields below so handleStart (and Retry) always read the
    // latest without re-binding the provisioning subscription.
    const advancedRef = useRef<AdvancedQuickStartOptions | undefined>(undefined);
    // Focused when provisioning ends so keyboard/screen-reader users land on the primary result
    // action instead of being stranded on the now-unmounted Cancel button (WCAG 2.4.3).
    const primaryButtonRef = useRef<HTMLButtonElement>(null);
    const cancelButtonRef = useRef<HTMLButtonElement>(null);
    // True while the in-flight stream is a "Wait longer" resume, so Cancel returns to the
    // timed-out actions view (container is kept) rather than the settings page.
    const isWaitLongerRef = useRef(false);
    // Monotonic id for the current provisioning/resume stream. Callbacks capture it and ignore
    // any invocation from a superseded/cancelled stream, so a late/flushed event can't overwrite
    // state after Cancel / Start over / a new Start.
    const streamGenerationRef = useRef(0);

    // Validate the settings client-side, mirroring the router's zod schema so a valid form never
    // dead-ends on a server rejection. Returns the offending field (for a per-field error state,
    // a11y §3.3.1) plus the message. Credential/image checks are skipped while reusing an existing
    // instance, since those inputs are hidden and their values are ignored.
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
            if (useCustomCredentials && hasUser !== hasPass) {
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
        // Sync the settings into a ref (repo stale-closure pattern) so the provisioning
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
            if (useCustomCredentials && advUser.trim()) opts.username = advUser.trim();
            if (useCustomCredentials && advPass.trim()) opts.password = advPass.trim();
            if (advTag.trim()) opts.imageTag = advTag.trim();
        }
        if (!advLoadSampleData) opts.loadSampleData = false;
        advancedRef.current = Object.keys(opts).length > 0 ? opts : undefined;
    }, [advPort, advUser, advPass, advTag, advLoadSampleData, advError, isRecreate, useCustomCredentials]);

    const step = stepForPhase(phase);
    const isProvisioning = phase === 'provisioning';

    // On step change, move focus to the new step's heading so screen-reader and keyboard users land
    // on the fresh content instead of focus falling back to <body>. Skipped on the initial render.
    // Within the Set up step the footer swaps its buttons instead, so focus follows them there.
    const contentRef = useRef<HTMLDivElement>(null);
    const isInitialRender = useRef(true);
    const previousStepRef = useRef<WizardStepId>(step);
    useEffect(() => {
        if (isInitialRender.current) {
            isInitialRender.current = false;
            previousStepRef.current = step;
            return;
        }
        if (previousStepRef.current !== step) {
            previousStepRef.current = step;
            const heading = contentRef.current?.querySelector<HTMLElement>('h2');
            if (heading) {
                heading.tabIndex = -1;
                heading.focus();
            }
            return;
        }
        if (step === 'setup') {
            // Provisioning started or ended without leaving the step: the button the user clicked
            // has unmounted, so move focus to the control that replaced it (WCAG 2.4.3).
            if (isProvisioning) {
                cancelButtonRef.current?.focus();
            } else {
                primaryButtonRef.current?.focus();
            }
        }
    }, [step, isProvisioning]);

    // Keep the footer's elevation in sync with whether the content actually overflows.
    const scrollAreaRef = useRef<HTMLDivElement>(null);
    const footerRef = useRef<HTMLDivElement>(null);
    const [footerElevated, setFooterElevated] = useState(false);
    const updateFooterElevation = useCallback((): void => {
        const scrollArea = scrollAreaRef.current;
        if (scrollArea) {
            setFooterElevated(scrollArea.scrollTop + scrollArea.clientHeight < scrollArea.scrollHeight - 1);
        }
    }, []);
    useEffect(() => {
        const scrollArea = scrollAreaRef.current;
        const content = contentRef.current;
        const footer = footerRef.current;
        if (!scrollArea || !content || !footer) {
            return;
        }
        const observer = new ResizeObserver(updateFooterElevation);
        observer.observe(scrollArea);
        observer.observe(content);
        observer.observe(footer);
        return () => observer.disconnect();
    }, [updateFooterElevation, phase]);

    const applyReadiness = useCallback((readiness: DockerReadiness): void => {
        checkReadinessRef.current = readiness;
        setCheckReadiness(readiness);
        setRelativeTimeNow(Date.now());
    }, []);

    /**
     * Refresh the Docker facts backing the `Checking Docker` stage. The host memoizes readiness
     * briefly, so a call made right after that stage settles returns exactly the result the
     * service acted on rather than probing Docker a second time.
     */
    const syncDockerStatus = useCallback(
        async (request?: {
            readonly forceRefresh: boolean;
            readonly resetProviderMemory?: boolean;
        }): Promise<DockerStatusResult | undefined> => {
            readinessAbortRef.current?.abort();
            const abortController = new AbortController();
            readinessAbortRef.current = abortController;
            try {
                const result = await trpcClient.localQuickStart.getDockerStatus.query(request, {
                    signal: abortController.signal,
                });
                if (abortController.signal.aborted) {
                    return undefined;
                }
                applyReadiness(result.readiness);
                setWillReuse(result.willReuse);
                return result;
            } catch {
                // Readiness never blocks the wizard: the authoritative check is the first setup
                // stage, which reports its own failure in place.
                return undefined;
            } finally {
                if (readinessAbortRef.current === abortController) {
                    readinessAbortRef.current = null;
                }
            }
        },
        [applyReadiness, trpcClient],
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
            setStageDockerFailure(undefined);
            setDockerActionMessage(undefined);
            setDockerRecoveredKey(0);
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
                        if (event.dockerReadiness) {
                            // Docker became unusable mid-run: the remediation belongs beside the
                            // stage that hit it, not on a screen of its own.
                            setStageDockerFailure(event.dockerReadiness);
                            setRelativeTimeNow(Date.now());
                        } else if (event.stage === 'checking') {
                            // The check stage does not carry its readiness, so pull the classification
                            // the host just computed to drive the detail line and the remediation.
                            void syncDockerStatus();
                        }
                        setPhase('failed');
                    } else {
                        setStageStatus((prev) => ({ ...prev, [event.stage]: event.status }));
                        if (
                            event.stage === 'checking' &&
                            event.status === 'done' &&
                            checkReadinessRef.current?.outcome !== 'ready'
                        ) {
                            // Prove which Docker was accepted, even when the background load ran
                            // before the user installed, started, or fixed Docker.
                            void syncDockerStatus();
                        }
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
                    // The stream ended without a terminal stage event (e.g. the service was already
                    // busy and returned early) — recover to the settings page rather than hang on
                    // 'provisioning' with a runaway timer.
                    if (!settled) {
                        stopTimer();
                        setPhase('configure');
                    }
                    if (subscriptionRef.current === subscription) {
                        subscriptionRef.current = null;
                    }
                },
            });
            subscriptionRef.current = subscription;
        },
        [stopTimer, syncDockerStatus],
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

    // Docker recovered after an explicit remediation action. Setup is NOT resumed automatically:
    // the user re-checked Docker, not the whole run, so the stage list simply records that the
    // blocker cleared and the footer offers the forward step.
    const applyDockerRecovery = useCallback((): void => {
        setStageDockerFailure(undefined);
        setDockerRecoveredKey((current) => current + 1);
        // Only the check stage can be cleared in place; nothing ran after it.
        setStageStatus((prev) => (prev.checking === 'error' ? { ...prev, checking: 'done' } : prev));
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
                dockerWaitTimerRef.current = setInterval(() => setDockerWaitElapsedMs(Date.now() - startedAt), 250);
                let latestResult: DockerStatusResult | undefined;
                const outcome = await pollDockerReadiness({
                    signal: abortController.signal,
                    query: (suppressCommandEcho) =>
                        trpcClient.localQuickStart.getDockerStatus.query(
                            { forceRefresh: true, polled: true, suppressCommandEcho },
                            { signal: abortController.signal },
                        ),
                    onResult: (result) => {
                        latestResult = result;
                        applyReadiness(result.readiness);
                        setWillReuse(result.willReuse);
                    },
                });
                if (abortController.signal.aborted) return;
                stopDockerWait();
                if (outcome === 'ready' && latestResult) {
                    applyDockerRecovery();
                } else if (outcome === 'deadline') {
                    setDockerActionMessage(l10n.t('Docker did not become ready before the wait timed out.'));
                }
            })
            .catch(() => {
                if (abortController.signal.aborted) return;
                stopDockerWait();
                setDockerActionMessage(l10n.t('The Docker readiness check failed.'));
            });
    }, [applyDockerRecovery, applyReadiness, stopDockerWait, trpcClient]);

    // Re-run only the Docker check, after the user follows the guidance. It never starts or resumes
    // provisioning: a pass clears the blocker in place, a fresh failure updates the evidence.
    const handleCheckDockerAgain = useCallback((): void => {
        setDockerActionMessage(undefined);
        setCheckingDockerAgain(true);
        void syncDockerStatus({ forceRefresh: true, resetProviderMemory: true }).then((result) => {
            setCheckingDockerAgain(false);
            if (result?.readiness.outcome === 'ready') {
                applyDockerRecovery();
            }
        });
    }, [applyDockerRecovery, syncDockerStatus]);

    useEffect(() => {
        // Load the instance facts the settings page needs (and rehydrate a resumable readiness
        // timeout) while the user reads the Introduction. Nothing about this check is shown before
        // the Set up step, and a failure here never blocks the wizard.
        void syncDockerStatus().then((result) => {
            if (result?.readiness.outcome === 'ready' && result.status.canResumeReadiness) {
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
            }
        });
        return () => {
            readinessAbortRef.current?.abort();
            dockerPollAbortRef.current?.abort();
            subscriptionRef.current?.unsubscribe();
            if (timerRef.current) clearInterval(timerRef.current);
            if (dockerWaitTimerRef.current) clearInterval(dockerWaitTimerRef.current);
        };
    }, [syncDockerStatus]);

    useEffect(() => {
        const relativeTimeTimer = setInterval(() => setRelativeTimeNow(Date.now()), 30_000);
        return () => clearInterval(relativeTimeTimer);
    }, []);

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
    // return to the settings page. If the discard no-ops because a just-cancelled resume is still
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
                    setPhase('configure');
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
            // timed-out actions (Wait longer / Start over) rather than the settings page.
            isWaitLongerRef.current = false;
            setTimedOut(true);
            setPhase('failed');
        } else {
            setTimedOut(false);
            setPhase('configure');
        }
    }, [stopTimer]);

    // From a failure, return to the settings page (field state is preserved) so the user can
    // correct a bad option (e.g. a busy explicit port) and retry — design feedback.
    const handleBackToConfigure = useCallback((): void => {
        isWaitLongerRef.current = false;
        stopDockerWait();
        setErrorMessage(undefined);
        setTimedOut(false);
        setPhase('configure');
    }, [stopDockerWait]);

    const handleViewOutput = useCallback((): void => {
        void trpcClient.localQuickStart.showOutput.mutate().catch(() => undefined);
    }, [trpcClient]);

    const handleInstallDocker = useCallback((): void => {
        void trpcClient.common.openUrl.mutate({ url: DOCKER_GUIDES.install.href }).catch(() => undefined);
    }, [trpcClient]);

    const handleOpenGuide = useCallback(
        (url: string): void => {
            void trpcClient.common.openUrl.mutate({ url }).catch(() => undefined);
        },
        [trpcClient],
    );

    const handleCopyRecoveryCommand = useCallback(
        (id: DockerRecoveryCommand['id']): void => {
            void trpcClient.localQuickStart.copyRecoveryCommand
                .mutate(id)
                .then(() => setCopyAnnouncementKey((current) => current + 1))
                .catch(() => undefined);
        },
        [trpcClient],
    );

    const handleOpenConnection = useCallback((): void => {
        // Reveal the connection in the Connections view but KEEP this panel open —
        // only the explicit Close button dismisses the page (user feedback).
        void trpcClient.localQuickStart.openConnection.mutate().catch(() => undefined);
    }, [trpcClient]);

    const handleCopyConnString = useCallback((): void => {
        void trpcClient.localQuickStart.copyConnectionString.mutate().catch(() => undefined);
    }, [trpcClient]);

    const goToStep = useCallback((id: string): void => {
        if (id === 'introduction') {
            setErrorMessage(undefined);
            setPhase('introduction');
        } else if (id === 'configure') {
            setErrorMessage(undefined);
            setPhase('configure');
        }
    }, []);

    // ---- derived setup state --------------------------------------------------------------

    const failedStage = PROVISION_STAGES.find((stage) => stageStatus[stage] === 'error');
    const checkStageFailed = phase === 'failed' && failedStage === 'checking';
    // A Docker problem has exactly one home: the stage that hit it. A stale background readiness
    // never renders remediation, so this is only ever the readiness behind the current failure.
    const dockerProblem: DockerReadiness | undefined =
        phase === 'failed'
            ? (stageDockerFailure ??
              (checkStageFailed && checkReadiness && checkReadiness.outcome !== 'ready' ? checkReadiness : undefined))
            : undefined;
    const dockerPresentation = dockerProblem ? getDockerReadinessPresentation(dockerProblem) : undefined;
    const dockerPresentationState = startingDocker ? 'starting' : (dockerPresentation?.state ?? 'notAccessible');
    const recoveryCommand = dockerPresentation?.showCopyCommand ? dockerProblem?.recoveryCommand : undefined;
    // A Docker-only re-check cleared the blocker. When that blocker was the check stage itself,
    // nothing has run yet, so the run can simply go ahead; a later stage's failure still stands.
    const dockerRecovered =
        phase === 'failed' && dockerRecoveredKey > 0 && !dockerProblem && checkReadiness?.outcome === 'ready';
    const canContinueSetup = dockerRecovered && failedStage === undefined;

    const checkStageDetail = useMemo((): string | undefined => {
        const status = stageStatus.checking;
        if (status === 'active') {
            return l10n.t('Checking…');
        }
        if (status === 'pending' || !checkReadiness) {
            return undefined;
        }
        // While a refresh is in flight the cached facts can disagree with the row: say nothing
        // rather than describe a Docker the stage did not actually accept (or reject).
        if ((status === 'done') !== (checkReadiness.outcome === 'ready')) {
            return undefined;
        }
        return formatDockerDetail(getDockerReadinessPresentation(checkReadiness).detail);
    }, [checkReadiness, stageStatus]);

    const stageDetailFor = (stage: ProvisionStage): string | undefined => {
        if (stage === 'checking') {
            return checkStageDetail;
        }
        if (stage === failedStage && stageDockerFailure) {
            return formatDockerDetail(getDockerReadinessPresentation(stageDockerFailure).detail);
        }
        return undefined;
    };

    // Human-readable message for the current in-flight stage, mirrored into a polite live
    // region so screen-reader users hear provisioning progress (WCAG 4.1.3). Suppressed once
    // any stage has errored so a stale "…" utterance can't precede the failure announcement.
    const activeStage = PROVISION_STAGES.find((stage) => stageStatus[stage] === 'active');
    const provisioningStatusMessage = activeStage && !failedStage ? l10n.t('{0}…', STAGE_LABELS[activeStage]) : '';

    const effectivePort = advPort.trim() && advValidation?.field !== 'port' ? advPort.trim() : String(QUICK_START_PORT);
    const effectiveImage =
        !isRecreate && advTag.trim() && advValidation?.field !== 'tag'
            ? `${QUICK_START_IMAGE_REPOSITORY}:${advTag.trim()}`
            : QUICK_START_IMAGE;

    // ---- chrome ---------------------------------------------------------------------------

    const hero = (
        <div className={styles.hero}>
            <RocketRegular aria-hidden className={styles.heroIcon} />
            <div>
                <Text as="h1" size={700} weight="semibold">
                    {l10n.t('DocumentDB Local')}
                </Text>
                <div>
                    <Text className={styles.muted}>
                        {l10n.t('Set up DocumentDB locally for development and testing with Docker.')}
                    </Text>
                </div>
            </div>
        </div>
    );

    const steps: readonly { readonly id: WizardStepId; readonly label: string }[] = [
        { id: 'introduction', label: l10n.t('Introduction') },
        { id: 'configure', label: l10n.t('Configure') },
        { id: 'setup', label: l10n.t('Set up') },
        { id: 'done', label: l10n.t('Done') },
    ];
    const currentStepIndex = steps.findIndex((entry) => entry.id === step);
    // Locked while work is in flight and once the connection is saved; a failure unlocks the
    // earlier steps so the user can change a setting and try again.
    const stepsLocked = isProvisioning || phase === 'success';
    const stepItems: readonly WizardStepMeta[] = steps.map((entry, index) => ({
        id: entry.id,
        label: entry.label,
        isCurrent: index === currentStepIndex,
        isCompleted: index < currentStepIndex || (entry.id === 'done' && index === currentStepIndex),
        canNavigate: index < currentStepIndex && !stepsLocked,
    }));

    // ---- pages ----------------------------------------------------------------------------

    const introduction = (
        <section className={styles.section} aria-labelledby="quickstart-introduction-heading">
            <div className={styles.sectionHeader}>
                <Text id="quickstart-introduction-heading" as="h2" size={500} weight="semibold">
                    {l10n.t('Develop and test locally')}
                </Text>
            </div>
            <div className={styles.introCopy}>
                <Text>
                    {l10n.t(
                        'DocumentDB Local gives you an open-source, fully MongoDB-compatible database for development and testing on your machine.',
                    )}
                </Text>
                <Text>{l10n.t('Nothing is downloaded or created on your machine until you choose to start.')}</Text>
            </div>
            <div className={styles.planSection}>
                <Text as="h3" size={400} weight="semibold">
                    {l10n.t('What will happen in the Set up step')}
                </Text>
                <ol className={styles.planList}>
                    {PLAN_ITEMS.map((item, index) => (
                        <li className={styles.planItem} key={item.label}>
                            <span aria-hidden className={styles.planIndex}>
                                {index + 1}
                            </span>
                            <div className={styles.planCopy}>
                                <Text>{item.label}</Text>
                                <Text size={200} className={styles.muted}>
                                    {item.detail}
                                </Text>
                            </div>
                        </li>
                    ))}
                </ol>
            </div>
        </section>
    );

    const settingRow = (label: string, value: ReactNode, action?: ReactNode): JSX.Element => (
        <>
            <Text className={styles.settingLabel}>{label}</Text>
            <div className={styles.settingValue}>{value}</div>
            <div className={styles.settingAction}>{action}</div>
        </>
    );

    const configure = (
        <section className={styles.section} aria-labelledby="quickstart-configure-heading">
            <div className={styles.sectionHeader}>
                <Text id="quickstart-configure-heading" as="h2" size={500} weight="semibold">
                    {l10n.t('Configure setup')}
                </Text>
                <Text className={styles.muted}>
                    {l10n.t('These defaults work for most people. Change them only if you need to.')}
                </Text>
            </div>
            <div className={styles.settingsTable}>
                {settingRow(
                    l10n.t('Address'),
                    <Text>{l10n.t('localhost:{0}', effectivePort)}</Text>,
                    <Button
                        appearance="subtle"
                        size="small"
                        icon={<EditRegular />}
                        aria-expanded={editingPort}
                        onClick={() => setEditingPort((value) => !value)}
                    >
                        {l10n.t('Edit port')}
                    </Button>,
                )}
                {editingPort && (
                    <div className={styles.editFields}>
                        <Field
                            label={l10n.t('Port')}
                            hint={l10n.t('Host remains localhost. Default {0}.', String(QUICK_START_PORT))}
                            validationState={advValidation?.field === 'port' ? 'error' : 'none'}
                            validationMessage={advValidation?.field === 'port' ? advValidation.message : undefined}
                        >
                            <Input
                                type="number"
                                value={advPort}
                                placeholder={String(QUICK_START_PORT)}
                                onChange={(_event, data) => setAdvPort(data.value)}
                            />
                        </Field>
                    </div>
                )}
                {settingRow(
                    l10n.t('Image'),
                    isRecreate ? (
                        <Text>{l10n.t('Kept from the existing instance')}</Text>
                    ) : (
                        <code className={styles.imagePath}>{effectiveImage}</code>
                    ),
                    isRecreate ? undefined : (
                        <Button
                            appearance="subtle"
                            size="small"
                            icon={<EditRegular />}
                            aria-expanded={editingImage}
                            aria-label={l10n.t('Edit image tag')}
                            onClick={() => setEditingImage((value) => !value)}
                        >
                            {l10n.t('Edit')}
                        </Button>
                    ),
                )}
                {editingImage && !isRecreate && (
                    <div className={styles.editFields}>
                        <Field
                            label={l10n.t('Image tag')}
                            hint={l10n.t(
                                'The official image repository is fixed. Default “{0}”.',
                                QUICK_START_DEFAULT_TAG,
                            )}
                            validationState={advValidation?.field === 'tag' ? 'error' : 'none'}
                            validationMessage={advValidation?.field === 'tag' ? advValidation.message : undefined}
                        >
                            <Input
                                value={advTag}
                                maxLength={128}
                                placeholder={QUICK_START_DEFAULT_TAG}
                                onChange={(_event, data) => setAdvTag(data.value)}
                            />
                        </Field>
                    </div>
                )}
                {settingRow(
                    l10n.t('Credentials'),
                    <Text>
                        {isRecreate
                            ? l10n.t('Reused from the existing instance')
                            : useCustomCredentials
                              ? l10n.t('Custom credentials, stored securely')
                              : l10n.t('Generated automatically, stored securely')}
                    </Text>,
                    isRecreate ? undefined : (
                        <Button appearance="subtle" size="small" onClick={() => setCustomCredentials((v) => !v)}>
                            {useCustomCredentials ? l10n.t('Use generated') : l10n.t('Use custom')}
                        </Button>
                    ),
                )}
                {useCustomCredentials && (
                    <div className={styles.editFields}>
                        <Field
                            label={l10n.t('Username')}
                            validationState={advValidation?.field === 'username' ? 'error' : 'none'}
                            validationMessage={advValidation?.field === 'username' ? advValidation.message : undefined}
                        >
                            <Input
                                value={advUser}
                                maxLength={128}
                                placeholder={l10n.t('Enter a username')}
                                onChange={(_event, data) => setAdvUser(data.value)}
                            />
                        </Field>
                        <Field
                            label={l10n.t('Password')}
                            validationState={advValidation?.field === 'password' ? 'error' : 'none'}
                            validationMessage={advValidation?.field === 'password' ? advValidation.message : undefined}
                        >
                            <Input
                                type="password"
                                value={advPass}
                                maxLength={256}
                                placeholder={l10n.t('Enter a password')}
                                onChange={(_event, data) => setAdvPass(data.value)}
                            />
                        </Field>
                    </div>
                )}
                {settingRow(
                    l10n.t('Sample data'),
                    <Text>{advLoadSampleData ? l10n.t('Included') : l10n.t('Not included')}</Text>,
                    <Switch
                        checked={advLoadSampleData}
                        aria-label={l10n.t('Include sample data')}
                        onChange={(_event, data) => setAdvLoadSampleData(data.checked)}
                    />,
                )}
            </div>
            {isRecreate && (
                <Text size={200} className={styles.muted}>
                    {l10n.t(
                        'Recreating reuses the existing data volume, so the original credentials and image are kept.',
                    )}
                </Text>
            )}
        </section>
    );

    const dockerStatusBlock = dockerProblem && dockerPresentation && (
        <div className={styles.dockerStatus}>
            <MessageBar intent="error" layout="multiline">
                <MessageBarBody className={styles.messageBody}>
                    <div>
                        <MessageBarTitle>
                            {DOCKER_FAILURE_LABELS[dockerProblem.failureKind ?? 'unknown']}
                        </MessageBarTitle>{' '}
                        {
                            DOCKER_GUIDANCE[
                                startingDocker ? 'daemonStarting' : (dockerPresentation.guidance ?? 'notAccessible')
                            ]
                        }
                    </div>
                    {recoveryCommand && (
                        <div className={styles.recoveryCommand}>
                            <code className={styles.recoveryCommandLine}>{recoveryCommand.commandLine}</code>
                            {dockerPresentation.recoveryNote && (
                                <Text size={200} className={styles.muted}>
                                    {DOCKER_RECOVERY_NOTES[dockerPresentation.recoveryNote]}
                                </Text>
                            )}
                        </div>
                    )}
                    {startingDocker && (
                        <div className={styles.waitingStatus}>
                            <Spinner size="extra-tiny" aria-hidden />
                            <Text size={200}>{l10n.t('Waiting {0}', formatElapsed(dockerWaitElapsedMs))}</Text>
                        </div>
                    )}
                    {!dockerPresentation.showInstall && (
                        <Link onClick={() => handleOpenGuide(DOCKER_GUIDES[dockerPresentation.guide].href)}>
                            {DOCKER_GUIDES[dockerPresentation.guide].label}
                        </Link>
                    )}
                </MessageBarBody>
                <MessageBarActions>
                    {dockerPresentation.showInstall && (
                        <Button appearance="secondary" onClick={handleInstallDocker}>
                            {l10n.t('Install Docker')}
                        </Button>
                    )}
                    {startingDocker ? (
                        <Button appearance="secondary" onClick={handleStopWaiting}>
                            {l10n.t('Stop waiting')}
                        </Button>
                    ) : (
                        dockerPresentation.showStartDockerProvider &&
                        dockerPresentation.startLabel && (
                            <Button appearance="secondary" onClick={handleStartDocker}>
                                {DOCKER_START_LABELS[dockerPresentation.startLabel]}
                            </Button>
                        )
                    )}
                    {recoveryCommand && (
                        <Button appearance="secondary" onClick={() => handleCopyRecoveryCommand(recoveryCommand.id)}>
                            {l10n.t('Copy command')}
                        </Button>
                    )}
                    {dockerPresentation.showContinueAnyway && (
                        <Button appearance="secondary" onClick={handleContinueAnyway}>
                            {l10n.t('Continue anyway')}
                        </Button>
                    )}
                    {dockerPresentation.showViewOutput && (
                        <Button appearance="secondary" onClick={handleViewOutput}>
                            {l10n.t('View Docker output')}
                        </Button>
                    )}
                </MessageBarActions>
            </MessageBar>
            <Accordion collapsible>
                <AccordionItem value="docker-details">
                    <AccordionHeader className={styles.dockerAccordionHeader}>
                        {l10n.t('What the Docker check found')}
                    </AccordionHeader>
                    <AccordionPanel className={styles.dockerAccordionPanel}>
                        <dl className={styles.dockerDetails}>
                            {(
                                [
                                    [
                                        l10n.t('Detected problem'),
                                        DOCKER_FAILURE_LABELS[dockerProblem.failureKind ?? 'unknown'],
                                    ],
                                    [
                                        l10n.t('Docker CLI'),
                                        dockerProblem.cliInstalled
                                            ? (dockerProblem.cliVersion ?? l10n.t('Found'))
                                            : l10n.t('Not found'),
                                    ],
                                    [l10n.t('Docker daemon'), DOCKER_DAEMON_VALUES[dockerPresentationState]],
                                    [l10n.t('Provider'), DOCKER_PROVIDER_LABELS[dockerProblem.provider]],
                                    [l10n.t('Platform'), dockerProblem.daemonArchitecture ?? l10n.t('Unknown')],
                                    [
                                        l10n.t('Docker endpoint'),
                                        dockerProblem.endpointSource
                                            ? DOCKER_ENDPOINT_SOURCE_LABELS[dockerProblem.endpointSource]
                                            : l10n.t('Unknown'),
                                    ],
                                    [
                                        l10n.t('Runs on'),
                                        EXECUTION_TARGET_VALUES[
                                            getDockerExecutionTargetKey(dockerProblem.executionTarget)
                                        ],
                                    ],
                                ] as const
                            ).map(([label, value]) => (
                                <Fragment key={label}>
                                    <dt className={styles.dockerDetailLabel}>{label}</dt>
                                    <dd className={styles.dockerDetailValue}>{value}</dd>
                                </Fragment>
                            ))}
                        </dl>
                    </AccordionPanel>
                </AccordionItem>
            </Accordion>
            <div className={styles.lastCheckedRow}>
                <Text size={200} className={styles.muted} role="status" aria-live="polite">
                    {formatLastChecked(dockerProblem.checkedAtMs, relativeTimeNow)}
                </Text>
            </div>
        </div>
    );

    const setupHeading = isProvisioning ? l10n.t('Setting up DocumentDB Local') : l10n.t('Setup did not finish');
    const setupSubtitle = isProvisioning
        ? l10n.t('This can take a few minutes. Elapsed time: {0}', formatElapsed(elapsedMs))
        : canContinueSetup
          ? l10n.t('Docker is ready now. Nothing has been created on your machine yet.')
          : checkStageFailed
            ? l10n.t('Setup stopped at the first stage. Nothing was created on your machine.')
            : undefined;

    // The Docker-only re-check lives on the stage that owns the check, so its scope is unambiguous
    // next to the footer's full-run Retry.
    const stageActionFor = (stage: ProvisionStage): ReactNode => {
        if (stage !== 'checking' || !dockerProblem || !dockerPresentation?.showRetry || startingDocker) {
            return undefined;
        }
        if (checkingDockerAgain) {
            return (
                <Text size={200} className={styles.muted}>
                    {l10n.t('Checking…')}
                </Text>
            );
        }
        return <Link onClick={handleCheckDockerAgain}>{l10n.t('Check Docker again')}</Link>;
    };

    const setup = (
        <section className={styles.section} aria-labelledby="quickstart-setup-heading">
            <div className={styles.sectionHeader}>
                <Text id="quickstart-setup-heading" as="h2" size={500} weight="semibold">
                    {setupHeading}
                </Text>
                {setupSubtitle && <Text className={styles.muted}>{setupSubtitle}</Text>}
            </div>
            <div className={styles.stageList} role="list" aria-label={l10n.t('Setup progress')}>
                {PROVISION_STAGES.map((stage) => (
                    <StageRow
                        key={stage}
                        label={STAGE_LABELS[stage]}
                        status={stageStatus[stage]}
                        detail={stageDetailFor(stage)}
                        action={stageActionFor(stage)}
                    />
                ))}
            </div>
            {checkReadiness?.platformSupported === false && (
                <MessageBar intent="warning">
                    <MessageBarBody>
                        {l10n.t('DocumentDB Local images are published for x64 and arm64 only.')}
                    </MessageBarBody>
                </MessageBar>
            )}
            {dockerRecovered && (
                <MessageBar intent="success">
                    <MessageBarBody>
                        <MessageBarTitle>{l10n.t('Docker is ready')}</MessageBarTitle>{' '}
                        {canContinueSetup
                            ? l10n.t('The setup steps have not run yet.')
                            : l10n.t('The earlier failure is still shown below.')}
                    </MessageBarBody>
                </MessageBar>
            )}
            {phase === 'failed' && !dockerProblem && !canContinueSetup && (
                <MessageBar intent={timedOut ? 'warning' : 'error'} layout="multiline">
                    <MessageBarBody>
                        {timedOut
                            ? (errorMessage ??
                              l10n.t(
                                  'The container is running, but DocumentDB has not accepted connections yet. It may still be initializing. Keep waiting, view the logs, or start over.',
                              ))
                            : (errorMessage ?? l10n.t('Setup failed.'))}
                    </MessageBarBody>
                    <MessageBarActions>
                        <Button appearance="secondary" onClick={handleViewOutput}>
                            {l10n.t('View Docker output')}
                        </Button>
                    </MessageBarActions>
                </MessageBar>
            )}
            {dockerStatusBlock}
            {isProvisioning && <Link onClick={handleViewOutput}>{l10n.t('View Docker output')}</Link>}
        </section>
    );

    const done = (
        <section className={styles.section} aria-labelledby="quickstart-done-heading">
            <div className={styles.sectionHeader}>
                <Text id="quickstart-done-heading" as="h2" size={500} weight="semibold">
                    {l10n.t('DocumentDB Local is ready')}
                </Text>
                {successMessage && <Text className={styles.muted}>{successMessage}</Text>}
            </div>
            <div className={styles.stageList} role="list" aria-label={l10n.t('Completed setup steps')}>
                {PROVISION_STAGES.map((stage) => (
                    <StageRow
                        key={stage}
                        label={STAGE_LABELS[stage]}
                        status="done"
                        detail={stage === 'checking' ? checkStageDetail : undefined}
                    />
                ))}
            </div>
            <MessageBar intent="success">
                <MessageBarBody>
                    <MessageBarTitle>{l10n.t('All set')}</MessageBarTitle>{' '}
                    {l10n.t(
                        'The connection is saved and ready to use at localhost:{0}.',
                        String(boundPort ?? QUICK_START_PORT),
                    )}
                </MessageBarBody>
            </MessageBar>
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
                    {checkReadiness === undefined || checkReadiness.executionTarget === 'local'
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
        </section>
    );

    // ---- footer ---------------------------------------------------------------------------

    let primaryLabel: string;
    let primaryDisabled = false;
    let primaryIcon: JSX.Element | undefined;
    let onPrimary: () => void;
    let secondaryActions: JSX.Element;
    // Sits directly above the primary action and states what pressing it does to the machine.
    let footerNote: string | undefined;

    if (phase === 'introduction') {
        primaryLabel = l10n.t('Continue');
        onPrimary = () => setPhase('configure');
        secondaryActions = (
            <Button appearance="secondary" onClick={handleClose}>
                {l10n.t('Cancel')}
            </Button>
        );
    } else if (phase === 'configure') {
        primaryLabel = l10n.t('Start DocumentDB Local');
        primaryDisabled = advError !== undefined;
        primaryIcon = <RocketRegular />;
        onPrimary = handleStart;
        footerNote = l10n.t(
            'Starting downloads the official image if needed, then creates and starts one container named {0}. Nothing else on your machine is changed.',
            QUICK_START_CONTAINER_NAME,
        );
        secondaryActions = (
            <Button appearance="secondary" icon={<ArrowLeftRegular />} onClick={() => setPhase('introduction')}>
                {l10n.t('Back')}
            </Button>
        );
    } else if (isProvisioning) {
        primaryLabel = l10n.t('Setting up…');
        primaryDisabled = true;
        onPrimary = () => undefined;
        secondaryActions = (
            <Button appearance="secondary" ref={cancelButtonRef} onClick={handleCancel}>
                {l10n.t('Cancel')}
            </Button>
        );
    } else if (phase === 'failed' && timedOut) {
        primaryLabel = l10n.t('Wait longer');
        primaryIcon = <ArrowClockwiseRegular />;
        onPrimary = handleWaitLonger;
        secondaryActions = (
            <Button appearance="secondary" onClick={handleStartOver}>
                {l10n.t('Start over')}
            </Button>
        );
    } else if (phase === 'failed') {
        primaryLabel = canContinueSetup ? l10n.t('Continue setup') : l10n.t('Retry setup');
        primaryIcon = canContinueSetup ? <RocketRegular /> : <ArrowClockwiseRegular />;
        primaryDisabled = startingDocker || checkingDockerAgain;
        onPrimary = handleStart;
        footerNote = canContinueSetup
            ? l10n.t(
                  'Continuing runs every setup step from the beginning, starting with the Docker check. Nothing has been created on your machine yet.',
              )
            : l10n.t('Retrying runs every setup step again from the beginning, starting with the Docker check.');
        secondaryActions = (
            <Button appearance="secondary" icon={<ArrowLeftRegular />} onClick={handleBackToConfigure}>
                {l10n.t('Back')}
            </Button>
        );
    } else {
        primaryLabel = l10n.t('Open Connection');
        onPrimary = handleOpenConnection;
        secondaryActions = (
            <>
                <Button appearance="secondary" onClick={handleCopyConnString}>
                    {l10n.t('Copy Connection String')}
                </Button>
                <Button appearance="secondary" onClick={handleClose}>
                    {l10n.t('Close')}
                </Button>
            </>
        );
    }

    return (
        <main className={styles.root}>
            <div className={styles.scrollArea} ref={scrollAreaRef} onScroll={updateFooterElevation}>
                <div ref={contentRef} className={styles.content}>
                    <Announcer
                        when={phase === 'configure'}
                        message={l10n.t('Review the setup settings, then start DocumentDB Local.')}
                    />
                    <Announcer when={isProvisioning} message={l10n.t('Setting up DocumentDB Local.')} />
                    <Announcer
                        when={phase === 'success'}
                        message={l10n.t('DocumentDB Local is ready. Next steps are shown below.')}
                    />
                    <Announcer
                        when={phase === 'failed'}
                        message={
                            timedOut
                                ? (errorMessage ??
                                  l10n.t(
                                      'DocumentDB is still initializing. Keep waiting, view the logs, or start over.',
                                  ))
                                : l10n.t('Setup did not finish. {0}', errorMessage ?? l10n.t('See the details below.'))
                        }
                        politeness="assertive"
                    />
                    <Announcer when={startingDocker} message={l10n.t('Waiting for Docker to start.')} />
                    <Announcer
                        key={`docker-recovered-${dockerRecoveredKey}`}
                        when={dockerRecoveredKey > 0}
                        message={l10n.t('Docker is ready. Setup has not run yet.')}
                    />
                    <Announcer
                        key={`recovery-copied-${copyAnnouncementKey}`}
                        when={copyAnnouncementKey > 0}
                        message={l10n.t('Recovery command copied.')}
                    />
                    <Announcer
                        when={dockerActionMessage !== undefined}
                        message={dockerActionMessage ?? ''}
                        politeness="assertive"
                    />
                    {/* Streams the current provisioning stage to screen readers (WCAG 4.1.3). */}
                    <div role="status" aria-live="polite" aria-atomic="true" className={styles.srOnly}>
                        {isProvisioning ? provisioningStatusMessage : ''}
                    </div>
                    {hero}
                    <WizardBreadcrumb steps={stepItems} ariaLabel={l10n.t('Setup steps')} onNavigate={goToStep} />
                    {phase === 'introduction' && introduction}
                    {phase === 'configure' && configure}
                    {(isProvisioning || phase === 'failed') && setup}
                    {phase === 'success' && done}
                </div>
            </div>
            <div ref={footerRef} className={mergeClasses(styles.footer, footerElevated && styles.footerElevated)}>
                {footerNote && (
                    <div className={styles.footerNote}>
                        <InfoRegular aria-hidden className={styles.footerNoteIcon} />
                        <Text size={200}>{footerNote}</Text>
                    </div>
                )}
                <div className={styles.footerActions}>
                    <Button
                        appearance="primary"
                        ref={primaryButtonRef}
                        icon={primaryIcon}
                        disabled={primaryDisabled}
                        onClick={onPrimary}
                    >
                        {primaryLabel}
                    </Button>
                    {secondaryActions}
                </div>
            </div>
        </main>
    );
};
