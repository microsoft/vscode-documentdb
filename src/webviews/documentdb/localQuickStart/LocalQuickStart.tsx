/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    CounterBadge,
    Field,
    Input,
    Link,
    makeStyles,
    Radio,
    RadioGroup,
    Spinner,
    Switch,
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
    ArrowClockwiseRegular,
    ArrowResetRegular,
    CopyRegular,
    EditRegular,
    EmojiRegular,
    ErrorCircleFilled,
    RocketRegular,
    WarningRegular,
} from '@fluentui/react-icons';
import { Collapse } from '@fluentui/react-motion-components-preview';
import {
    ContainerFooter,
    ContainerHeader,
    StatusList,
    type StatusListItemStatus,
    Wizard,
    WizardStep,
} from '@microsoft/vscode-ext-webview-fluentui/components';
import { useConfiguration } from '@microsoft/vscode-ext-webview/react';
import * as l10n from '@vscode/l10n';
import { Fragment, type JSX, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type ContainerCli } from '../../../services/localQuickStart/containerCli';
import { formatQuickStartMessage } from '../../../services/localQuickStart/quickStartMessages';
import {
    type AdvancedQuickStartOptions,
    type DockerProvider,
    type DockerLaunchResult,
    type DockerReadiness,
    type DockerRecoveryCommand,
    type DockerStatusResult,
    InstanceState,
    type InstanceStatusUpdate,
    type PortAvailability,
    type PodmanMachineState,
    PROVISION_STAGES,
    type ProvisionStage,
    QUICK_START_CONTAINER_NAME,
    QUICK_START_DEFAULT_TAG,
    QUICK_START_IMAGE,
    QUICK_START_IMAGE_REPOSITORY,
    QUICK_START_PORT,
    type QuickStartWizardPhase,
    type QuickStartWizardStepTrigger,
    type StageEvent,
    type StageFacts,
} from '../../../services/localQuickStart/quickStartTypes';
import { useTrpcClient } from '../../_integration/useTrpcClient';
import { Announcer } from '../../components/accessibility/Announcer';
import { MessageBlock } from '../../components/MessageBlock';
import { buildAdvancedOptions, getEffectivePort } from './advancedOptions';
import {
    describePasswordEncodingProblem,
    getCredentialValidation,
    getPasswordEncodingState,
    needsPasswordEncodingCheck,
    type PasswordEncodingCheck,
} from './credentialValidation';
import { pollDockerReadiness } from './dockerReadinessPolling';
import {
    type DockerDetailFailureKey,
    type DockerDetailSegment,
    type DockerGuidanceKey,
    type DockerGuideKey,
    type DockerReadinessPresentation,
    type DockerRecoveryNoteKey,
    type DockerStartLabelKey,
    type getDockerExecutionTargetKey,
    getDockerReadinessPresentation,
} from './dockerReadinessPresentation';
import { getExistingInstanceGuard, guardBlocksSetup } from './existingInstanceGuard';
import './localQuickStart.scss';
import { type LocalQuickStartConfigurationType } from './localQuickStartController';
import { SetupStageRow } from './SetupStageRow';
import {
    buildDockerDetailRows,
    buildStageDetailRows,
    buildStageSummary,
    dockerFailureLabels,
} from './stageDetailsPresentation';

/**
 * Wizard phases. `provisioning` and `failed` are both the "Set up" step: a setup failure — Docker
 * problems included — is reported in place, beside the stage that failed, rather than on a screen
 * of its own.
 */
type Phase = QuickStartWizardPhase;
type WizardStepId = 'introduction' | 'configure' | 'setup' | 'done';
/** The subset of `StatusListItemStatus` this flow raises; it never reports a `warning`. */
type StageStatus = Extract<StatusListItemStatus, 'pending' | 'active' | 'done' | 'error'>;

const DOCUMENTDB_LOCAL_LEARN_MORE_URL = 'https://aka.ms/vscode-documentdb-local';
const DOCUMENTDB_LOCAL_PRIVACY_URL = 'https://github.com/documentdb/documentdb/blob/main/documentdb-local/PRIVACY.md';

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
    muted: { color: tokens.colorNeutralForeground2 },
    // A Link sets its own font size; in the footer note it should match the sentence around it.
    inheritFont: { fontSize: 'inherit', lineHeight: 'inherit' },
    // A heading belongs to what follows it, so it keeps more air above than below: the section's
    // own 12px gap plus this 8px sits above the heading, and 8px separates it from its content.
    subsection: { display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px' },
    planList: { display: 'flex', flexDirection: 'column', gap: '2px', margin: 0, padding: 0, listStyle: 'none' },
    planItem: { display: 'grid', gridTemplateColumns: '24px minmax(0, 1fr)', gap: '0 10px', padding: '7px 0' },
    // Centred against the whole entry, not just its first line, so the number reads as belonging
    // to the title and its explanation together.
    planBadge: { justifySelf: 'start', alignSelf: 'center' },
    planCopy: { display: 'flex', flexDirection: 'column', gap: '1px', minWidth: 0 },
    // Fluent's Table is `table-layout: fixed`, so every column that must not take the leftover
    // space needs an explicit width. The value column is the only one left unsized.
    settingsColLabel: { width: '140px', '@media (max-width: 560px)': { width: '96px' } },
    settingsColActions: { width: '72px' },
    settingValueCell: { minWidth: 0, overflowWrap: 'anywhere' },
    // Right-aligned with flex, never `text-align`: Fluent's Switch positions its thumb as an
    // inline element, so an inherited `text-align: right` pushes the thumb out of its track.
    settingAction: { display: 'flex', justifyContent: 'flex-end' },
    // The editor row is always present so its content can animate in and out; collapsed, it
    // contributes no height, so the settings list never carries an empty band.
    editorRow: { borderBottom: 'none' },
    editorCell: { display: 'table-cell', height: 'auto', padding: 0 },
    // The separator rides with the collapsing content, so it disappears along with it.
    editorBody: {
        padding: '10px 12px 14px 148px',
        borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
        '@media (max-width: 560px)': { paddingLeft: '12px' },
    },
    // `flex-start` keeps a field whose validation message appeared from stretching its sibling's
    // input; the flexible basis lets a lone field fill the row and a pair split it.
    editFields: {
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'flex-start',
        gap: '12px',
        '> *': { flexGrow: 1, flexBasis: '200px', minWidth: 0 },
        // A native input's default intrinsic width would otherwise hold the row open, and the
        // whole page with it, once the panel is narrower than about 300px.
        '& .fui-Input': { minWidth: 0 },
        '& .fui-Input > input': { minWidth: 0 },
    },
    credentialFields: {
        display: 'grid',
        gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
        gap: '12px',
        width: '100%',
        '@media (max-width: 560px)': { gridTemplateColumns: 'minmax(0, 1fr)' },
    },
    credentialsValidation: {
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        gridColumn: '1 / -1',
        color: tokens.colorPaletteRedForeground1,
    },
    imagePath: { overflowWrap: 'anywhere' },
    pullActivity: {
        display: 'block',
        minWidth: 0,
        maxWidth: '100%',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
    },
    dockerStatus: { display: 'flex', flexDirection: 'column', gap: '10px' },
    recoveryCommand: { display: 'flex', flexDirection: 'column', gap: '8px' },
    // Copy stays pinned top-right: a multi-line command must not push it down or wrap it away.
    recoveryCommandBlock: {
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: '8px',
        padding: '6px 6px 6px 8px',
        borderRadius: tokens.borderRadiusSmall,
        backgroundColor: tokens.colorNeutralBackground1,
        border: `1px solid ${tokens.colorStatusDangerBorder1}`,
    },
    // Sits inside the error bar, so it reads as a neutral surface outlined in the danger hue
    // rather than a second alert nested inside the first.
    recoveryCommandLine: {
        minWidth: 0,
        // `pre-wrap` keeps the line breaks of a multi-line command instead of collapsing them.
        whiteSpace: 'pre-wrap',
        paddingTop: '3px',
        fontFamily: tokens.fontFamilyMonospace,
        fontSize: tokens.fontSizeBase300,
        color: tokens.colorNeutralForeground1,
        overflowWrap: 'anywhere',
    },
    recoveryCommandCopy: { flexShrink: 0 },
    waitingStatus: { display: 'flex', alignItems: 'center', gap: '8px' },
    lastCheckedRow: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '8px',
    },
    nextSteps: { display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '12px' },
    nextStepsList: { display: 'flex', flexDirection: 'column', gap: '4px', margin: 0, paddingLeft: '20px' },
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

// Build every lookup at call time, never at module scope. `WebviewRegistry` now loads this
// component after `render()` configures l10n, but call-time translation remains defensive:
// it avoids freezing strings if the module is imported before configuration elsewhere.
function stageLabels(): Record<ProvisionStage, string> {
    return {
        checking: l10n.t('Checking container engine'),
        pulling: l10n.t('Pulling official image'),
        creating: l10n.t('Creating container'),
        starting: l10n.t('Starting container'),
        waiting: l10n.t('Waiting for DocumentDB to accept connections'),
        done: l10n.t('Done'),
        error: l10n.t('Error'),
    };
}

/** The word a screen reader hears after each stage's label. The package defaults to English. */
function stageStatusWords(): Partial<Record<StatusListItemStatus, string>> {
    return {
        pending: l10n.t('pending'),
        active: l10n.t('in progress'),
        done: l10n.t('done'),
        error: l10n.t('failed'),
    };
}

interface PlanItem {
    readonly label: string;
    readonly detail: string;
}

/** One row of the Configure step: a read-only summary line plus the editor it reveals. */
interface SettingItem {
    readonly key: string;
    readonly label: string;
    readonly value: ReactNode;
    readonly action?: ReactNode;
    /** Built whenever the setting is editable at all, so it survives its own exit motion. */
    readonly editor?: ReactNode;
    readonly editorOpen?: boolean;
}

/** Mirrors the wizard's own sequence, so the user recognizes it again on the Set up page. */
function planItems(): readonly PlanItem[] {
    return [
        {
            label: l10n.t('Check your container engine'),
            detail: l10n.t(
                'Confirms Docker or Podman is installed and can run Linux containers on this machine. You choose a preferred engine in the next step; setup uses the other if it is not installed.',
            ),
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
}

function dockerGuidance(podmanMachine?: PodmanMachineState): Readonly<Record<DockerGuidanceKey, string>> {
    return {
        installDocker: l10n.t('Install Docker or Podman, then reopen DocumentDB Local setup.'),
        installDockerWindows: l10n.t(
            'Install Docker Desktop or Podman, then restart VS Code. A VS Code that was already running does not pick up the PATH the installer adds, so the CLI stays undetected until it is restarted. Reloading the window is not enough. Start Docker Desktop or the Podman machine and wait until it is ready, then check again.',
        ),
        installDockerMac: l10n.t(
            'Install Docker Desktop or Podman, then restart VS Code. A VS Code that was already running does not pick up the PATH the installer adds, so the CLI stays undetected until it is restarted. Start Docker Desktop or the Podman machine and wait until it is ready, then check again.',
        ),
        installDockerWsl: l10n.t(
            'Neither Docker nor Podman was found in this WSL distribution. If you use Docker Desktop, turn on its WSL integration for this distribution. Otherwise install Docker Engine or Podman here. Then check again.',
        ),
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
            'Your Docker group change requires a new WSL session. Run this command in a Windows terminal. This VS Code window will disconnect. Reconnect to WSL, then open DocumentDB Local setup again.',
        ),
        pendingRestartSsh: l10n.t(
            'You are in the Docker group on the remote host, but the VS Code server started before that change. Run "Remote-SSH: Kill VS Code Server on Host", then reconnect.',
        ),
        pendingRestartContainer: l10n.t(
            'You are in the Docker group, but this container started before that change. Rebuild the container.',
        ),
        dockerDesktopNotRunning: l10n.t('Start Docker Desktop and wait until it is ready.'),
        daemonNotRunning: l10n.t('Start the Docker service, then check again.'),
        podmanNotRunning: l10n.t(
            'Podman is not reachable. Start its machine in Podman Desktop or check its connection, then check again.',
        ),
        podmanSocketNotRunning: l10n.t(
            'Start the Podman user socket with this command, then check again.',
        ),
        podmanMachineMissing: l10n.t(
            'No Podman machine was found. Run this command to create one, then check again.',
        ),
        podmanMachineAmbiguous: l10n.t(
            'Several Podman machines were found without a unique default: {0}. Start the machine you want, then check again.',
            podmanMachine?.kind === 'ambiguous' ? podmanMachine.names.join(', ') : '',
        ),
        podmanMachineOtherActive: l10n.t(
            'Another Podman machine is already starting or running: {0}. Check that machine, then check again.',
            podmanMachine?.kind === 'otherActive' ? podmanMachine.active : '',
        ),
        podmanMachineRunning: l10n.t(
            'The Podman machine "{0}" is running, but its engine is not reachable. Check the machine and its connection, then check again.',
            podmanMachine?.kind === 'running' ? podmanMachine.name : '',
        ),
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
            'DocumentDB Local setup is supported when the extension runs on Windows, macOS, or Linux.',
        ),
        windowsContainers: l10n.t('Switch Docker to Linux containers, then check again.'),
        notAccessible: l10n.t('The extension could not connect to the Docker daemon.'),
    };
}

function dockerGuides(): Readonly<Record<DockerGuideKey, { readonly label: string; readonly href: string }>> {
    return {
        install: { label: l10n.t('Open Docker install guide'), href: 'https://docs.docker.com/engine/install/' },
        installWindowsDesktop: {
            label: l10n.t('Get Docker Desktop for Windows'),
            href: 'https://docs.docker.com/desktop/setup/install/windows-install/',
        },
        installMacDesktop: {
            label: l10n.t('Get Docker Desktop for Mac'),
            href: 'https://docs.docker.com/desktop/setup/install/mac-install/',
        },
        linuxPostInstall: {
            label: l10n.t('Open Linux setup guide'),
            href: 'https://docs.docker.com/engine/install/linux-postinstall/',
        },
        dockerTroubleshooting: {
            label: l10n.t('Open Docker troubleshooting guide'),
            href: 'https://docs.docker.com/engine/daemon/troubleshoot/',
        },
        podmanMachine: {
            label: l10n.t('Open Podman machine guide'),
            href: 'https://docs.podman.io/en/latest/markdown/podman-machine-start.1.html',
        },
        dockerContexts: {
            label: l10n.t('Open Docker context guide'),
            href: 'https://docs.docker.com/engine/manage-resources/contexts/',
        },
        wslIntegration: {
            label: l10n.t('Open WSL integration guide'),
            href: 'https://docs.docker.com/desktop/features/wsl/',
        },
        remoteDocker: {
            label: l10n.t('Open remote Docker guide'),
            href: 'https://docs.docker.com/engine/security/protect-access/',
        },
        linuxContainers: {
            label: l10n.t('Open Linux containers guide'),
            href: 'https://docs.docker.com/desktop/setup/install/windows-install/',
        },
        learnMore: { label: l10n.t('Open Docker documentation'), href: 'https://docs.docker.com/engine/install/' },
    };
}

function dockerStartLabels(): Readonly<Record<DockerStartLabelKey, string>> {
    return {
        startDockerDesktop: l10n.t('Start Docker Desktop'),
        startDocker: l10n.t('Start Docker'),
        startPodmanMachine: l10n.t('Start Podman machine'),
    };
}

function dockerRecoveryNotes(): Readonly<Record<DockerRecoveryNoteKey, string>> {
    return {
        groupMembershipNewSession: l10n.t('Group membership applies to new login sessions only.'),
        restartWslDistribution: l10n.t(
            'This stops all running WSL distributions so the new group membership applies when WSL starts again.',
        ),
        runsDockerService: l10n.t('Runs the system Docker service.'),
    };
}

/** Provider names for the stage detail line. */
function dockerDetailProviderLabels(): Readonly<Record<DockerProvider, string>> {
    return {
        dockerDesktop: l10n.t('Docker Desktop'),
        dockerEngine: l10n.t('Docker Engine'),
        podman: 'Podman',
        unknown: l10n.t('Engine'),
    };
}

function dockerDetailOsLabels(): Readonly<Record<'linux' | 'windows', string>> {
    return {
        linux: l10n.t('Linux'),
        windows: l10n.t('Windows'),
    };
}

function dockerDetailTargetLabels(): Readonly<Record<ReturnType<typeof getDockerExecutionTargetKey>, string>> {
    return {
        local: l10n.t('Runs on this machine'),
        wsl: l10n.t('Runs in this WSL environment'),
        ssh: l10n.t('Runs on the remote SSH host'),
        devContainer: l10n.t('Runs in this dev container'),
        codespaces: l10n.t('Runs in this Codespace'),
        otherRemote: l10n.t('Runs on the remote extension host'),
    };
}

function dockerDetailFailureLabels(): Readonly<Record<DockerDetailFailureKey, string>> {
    return {
        noCli: l10n.t('No Docker or Podman CLI found'),
        accessDenied: l10n.t('Access denied'),
        notRunning: l10n.t('Not running'),
        daemonNotRunning: l10n.t('Daemon not running'),
        daemonStarting: l10n.t('Daemon starting'),
        notAvailableInWsl: l10n.t('Not available in this WSL distribution'),
        endpointUnreachable: l10n.t('Endpoint unreachable'),
        contextUnavailable: l10n.t('Context unavailable'),
        checkTimedOut: l10n.t('Check timed out'),
        unsupportedHost: l10n.t('Unsupported host'),
        windowsContainers: l10n.t('Windows containers enabled'),
        daemonUnreachable: l10n.t('Daemon unreachable'),
    };
}

function formatDockerDetailSegment(segment: DockerDetailSegment): string | undefined {
    switch (segment.kind) {
        case 'provider':
            return dockerDetailProviderLabels()[segment.provider];
        case 'cli': {
            const name =
                segment.cli === 'docker'
                    ? l10n.t('Docker CLI')
                    : segment.cli === 'podman'
                      ? l10n.t('Podman CLI')
                      : l10n.t('Container CLI');
            return segment.version ? l10n.t('{0} {1} found', name, segment.version) : l10n.t('{0} found', name);
        }
        case 'platform': {
            const osName = segment.osType ? dockerDetailOsLabels()[segment.osType] : undefined;
            if (osName && segment.architecture) {
                return l10n.t('{0} {1}', osName, segment.architecture);
            }
            return osName ?? segment.architecture;
        }
        case 'executionTarget':
            return dockerDetailTargetLabels()[segment.target];
        case 'failure':
            return dockerDetailFailureLabels()[segment.failure];
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

function emptyStageFacts(): Record<ProvisionStage, StageFacts | undefined> {
    return {
        checking: undefined,
        pulling: undefined,
        creating: undefined,
        starting: undefined,
        waiting: undefined,
        done: undefined,
        error: undefined,
    };
}

export const LocalQuickStart = (): JSX.Element => {
    const styles = useStyles();
    const trpcClient = useTrpcClient();
    const configuration = useConfiguration<LocalQuickStartConfigurationType>();

    const [phase, setPhase] = useState<Phase>(configuration.initialPhase ?? 'introduction');
    // Mirrors the committed phase, so a step change is reported once with what caused it.
    const reportedPhaseRef = useRef<Phase>(phase);
    const stepTriggerRef = useRef<QuickStartWizardStepTrigger | undefined>(undefined);
    /** A user-initiated phase change; anything that calls `setPhase` directly is reported as `auto`. */
    const navigate = useCallback((to: Phase, trigger: QuickStartWizardStepTrigger): void => {
        if (reportedPhaseRef.current !== to) {
            stepTriggerRef.current = trigger;
        }
        setPhase(to);
    }, []);
    useEffect(() => {
        if (reportedPhaseRef.current === phase) {
            return;
        }
        reportedPhaseRef.current = phase;
        const trigger = stepTriggerRef.current ?? 'auto';
        stepTriggerRef.current = undefined;
        void trpcClient.localQuickStart.reportStepChange.mutate({ to: phase, trigger }).catch(() => undefined);
    }, [phase, trpcClient]);
    /**
     * Readiness backing the `Checking container engine` stage: its detail line in both
     * directions, and its remediation when that stage failed. Collected only during execution.
     */
    const [checkReadiness, setCheckReadiness] = useState<DockerReadiness | undefined>(undefined);
    /** A Docker problem reported by a later stage (pull / run), backing that stage's remediation. */
    const [stageDockerFailure, setStageDockerFailure] = useState<DockerReadiness | undefined>(undefined);
    const [canReuseExistingData, setCanReuseExistingData] = useState(false);
    const [instanceEngine, setInstanceEngine] = useState<ContainerCli | 'notRecorded'>();
    const [preferredEngine, setPreferredEngine] = useState<ContainerCli>('docker');
    const [editingEngine, setEditingEngine] = useState(false);
    /**
     * Live state of the managed instance, backing the Configure step's guard (review §9.2 Q2).
     * Reaching the wizard while an instance exists should not normally be possible — the tree does
     * not link to it in that state — but the command palette, a stale panel and cross-window races
     * all still get here.
     */
    const [instanceState, setInstanceState] = useState<InstanceState | undefined>(configuration.initialInstanceState);
    /**
     * True when the container was removed outside VS Code. This is NOT a separate
     * {@link InstanceState}: the service reports such an instance as `Stopped` with `missing` set,
     * so a guard that reads only the state would offer "Start" for a container that no longer
     * exists — a button that cannot do anything.
     */
    const [instanceMissing, setInstanceMissing] = useState(configuration.initialInstanceMissing === true);
    /** The container and its data were both found gone, so setup creates a new, empty instance. */
    const [instanceDataRemoved, setInstanceDataRemoved] = useState(false);
    /**
     * The user's explicit recreate-vs-fresh choice (review M4). Nothing is inferred from
     * {@link canReuseExistingData} any more, which is what resolves N1 (a stale inferred value).
     */
    const [dataChoice, setDataChoice] = useState<'reuse' | 'fresh'>('reuse');
    const [stageStatus, setStageStatus] = useState<Record<ProvisionStage, StageStatus>>(emptyStageStatus);
    const [facts, setFacts] = useState<Record<ProvisionStage, StageFacts | undefined>>(emptyStageFacts);
    const [expandedStages, setExpandedStages] = useState<ReadonlySet<ProvisionStage>>(() => new Set());
    const handleExpandedChange = useCallback(
        (stage: ProvisionStage, expanded: boolean): void => {
            if (expanded && !expandedStages.has(stage) && stage !== 'done' && stage !== 'error') {
                void trpcClient.localQuickStart.reportDetailsOpened.mutate({ stage }).catch((error: unknown) => {
                    void trpcClient.common.reportError
                        .mutate({
                            message: error instanceof Error ? error.message : String(error),
                            stack: error instanceof Error ? (error.stack ?? '') : '',
                        })
                        .catch(() => undefined);
                });
            }
            setExpandedStages((previous) => {
                const next = new Set(previous);
                if (expanded) {
                    next.add(stage);
                } else {
                    next.delete(stage);
                }
                return next;
            });
        },
        [expandedStages, trpcClient],
    );
    const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);
    const [successMessage, setSuccessMessage] = useState<string | undefined>(undefined);
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
    // Read by the long-lived instance-status subscription, which would otherwise see a stale value.
    const timedOutRef = useRef(false);
    useEffect(() => {
        timedOutRef.current = timedOut;
    }, [timedOut]);

    // Settings (P1-4). The port and tag fields carry the real defaults rather than placeholder
    // text, so what the user sees in the box is what will be used. The port is seeded from the
    // host's suggestion (the first free port) as soon as the status query returns, and is then
    // ALWAYS sent explicitly — setup binds exactly this port and never relocates it (review L3).
    const [advPort, setAdvPort] = useState(String(QUICK_START_PORT));
    const [suggestedPort, setSuggestedPort] = useState(QUICK_START_PORT);
    const [portStatus, setPortStatus] = useState<PortAvailability | 'checking' | undefined>(undefined);
    const [advUser, setAdvUser] = useState('');
    const [advPass, setAdvPass] = useState('');
    // The host's SASLprep verdict on the last non-ASCII custom password it checked.
    const [passwordCheck, setPasswordCheck] = useState<PasswordEncodingCheck>();
    // The password as of the last pause in typing.
    const [settledPassword, setSettledPassword] = useState('');
    const [advTag, setAdvTag] = useState(QUICK_START_DEFAULT_TAG);
    const [advLoadSampleData, setAdvLoadSampleData] = useState(true);
    const [editingPort, setEditingPort] = useState(false);
    const [editingImage, setEditingImage] = useState(false);
    const [customCredentials, setCustomCredentials] = useState(false);

    // The Configure step ASKS whether to keep the existing data (review M4): the service reuses an
    // instance's stored credentials and data volume only when told to. `canReuseExistingData` says
    // the choice is available (the same predicate the service uses); `dataChoice` is the answer.
    //
    // A CredentialsMissing instance has no readable secret, so the choice collapses to the guarded
    // "Start fresh" path explained by the Configure warning rather than a radio.
    const forcedFresh = instanceState === InstanceState.CredentialsMissing;
    const startFresh = forcedFresh || (canReuseExistingData && dataChoice === 'fresh');
    const isRecreate = canReuseExistingData && !startFresh;
    const useCustomCredentials = customCredentials && !isRecreate;
    const passwordEncoding = getPasswordEncodingState({
        useCustomCredentials,
        password: advPass,
        lastCheck: passwordCheck,
    });

    /**
     * Which existing-instance guard the Configure step shows, if any. See
     * {@link getExistingInstanceGuard} for why `missing` is checked before the state.
     */
    const existingInstanceGuard = getExistingInstanceGuard({ state: instanceState, missing: instanceMissing });
    // A usable instance is never walked into a destructive recreate: the user is offered the action
    // they almost certainly meant (open it / start it) instead.
    const startBlockedByGuard = guardBlocksSetup(existingInstanceGuard);

    const subscriptionRef = useRef<{ unsubscribe: () => void } | null>(null);
    const readinessAbortRef = useRef<AbortController | null>(null);
    // Mirrors `checkReadiness` so the stage-event handler can test it without reading state inside
    // a setState updater (which React may invoke more than once).
    const checkReadinessRef = useRef<DockerReadiness | undefined>(undefined);
    const dockerPollAbortRef = useRef<AbortController | null>(null);
    const lastDockerProblemRef = useRef<
        { readonly problem: DockerReadiness; readonly presentation: DockerReadinessPresentation } | undefined
    >(undefined);
    const dockerWaitTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    // True once the user edits the port, so a later status refresh never overwrites their choice
    // with the host's suggestion.
    const portTouchedRef = useRef(false);
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
    const autoWaitGenRef = useRef(-1);

    // Validate the settings client-side, mirroring the router's zod schema so a valid form never
    // dead-ends on a server rejection. Returns the offending field (for a per-field error state,
    // a11y §3.3.1) plus the message. Credential/image checks are skipped while reusing an existing
    // instance, since those inputs are hidden and their values are ignored.
    const advValidation = (():
        | { field: 'port' | 'credentials' | 'username' | 'password' | 'tag'; message: string; transient?: boolean }
        | undefined => {
        const port = advPort.trim();
        if (port && (!/^\d+$/.test(port) || Number(port) < 1024 || Number(port) > 65535)) {
            return { field: 'port', message: l10n.t('Port must be a whole number between 1024 and 65535.') };
        }
        if (portStatus === 'inUse') {
            return {
                field: 'port',
                message: l10n.t(
                    'Port {0} is already in use. Pick a different one.',
                    getEffectivePort(advPort, suggestedPort),
                ),
            };
        }
        if (portStatus === 'takenByAnotherInstance') {
            return {
                field: 'port',
                message: l10n.t(
                    'Port {0} belongs to another DocumentDB Local instance. Pick a different one.',
                    getEffectivePort(advPort, suggestedPort),
                ),
            };
        }
        if (!isRecreate) {
            const credentialError = getCredentialValidation({
                useCustomCredentials,
                username: advUser,
                password: advPass,
            });
            if (credentialError) {
                return credentialError;
            }
            if (passwordEncoding !== 'ok' && passwordEncoding !== 'checking') {
                return describePasswordEncodingProblem(passwordEncoding);
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
    // What the fields show. A transient error blocks Start at once but only appears once typing
    // pauses, so a passphrase isn't flagged (and announced) at every space between words.
    const shownValidation = advValidation?.transient && advPass !== settledPassword ? undefined : advValidation;

    useEffect(() => {
        // Sync the settings into a ref (repo stale-closure pattern) so the provisioning
        // subscription reads current values. Skip building options while invalid.
        advancedRef.current = advError
            ? undefined
            : buildAdvancedOptions({
                  preferredEngine,
                  port: advPort,
                  suggestedPort,
                  username: advUser,
                  password: advPass,
                  imageTag: advTag,
                  loadSampleData: advLoadSampleData,
                  isRecreate,
                  useCustomCredentials,
                  startFresh,
              });
    }, [
        preferredEngine,
        advPort,
        suggestedPort,
        advUser,
        advPass,
        advTag,
        advLoadSampleData,
        advError,
        isRecreate,
        useCustomCredentials,
        startFresh,
    ]);

    // Built during render, after `l10n.config()` has run, so these ARE translated. Memoized because
    // the maps are rebuilt on every call by design (see the note on the lookup functions above).
    const stageLabelsMap = useMemo(() => stageLabels(), []);
    const stageStatusLabels = useMemo(() => stageStatusWords(), []);
    const planItemList = useMemo(() => planItems(), []);
    const dockerFailureLabelMap = useMemo(() => dockerFailureLabels(), []);
    const dockerGuideMap = useMemo(() => dockerGuides(), []);
    const dockerStartLabelMap = useMemo(() => dockerStartLabels(), []);
    const dockerRecoveryNoteMap = useMemo(() => dockerRecoveryNotes(), []);

    const step = stepForPhase(phase);
    const isProvisioning = phase === 'provisioning';

    // A step change moves focus to the new step's heading — `Wizard` does that, because the step's
    // section mounts. What stays here is the case it cannot see: the footer swapping its buttons
    // without leaving the Set up step.
    const previousStepRef = useRef<WizardStepId>(step);
    useEffect(() => {
        if (previousStepRef.current !== step) {
            previousStepRef.current = step;
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

    const applyReadiness = useCallback((readiness: DockerReadiness): void => {
        checkReadinessRef.current = readiness;
        setCheckReadiness(readiness);
        setRelativeTimeNow(Date.now());
    }, []);

    /**
     * Refresh the Docker facts backing the `Checking container engine` stage. The host memoizes
     * readiness briefly, so a call made right after that stage settles returns exactly the result
     * the service acted on rather than probing Docker a second time.
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
                const result = await trpcClient.localQuickStart.getDockerStatus.query(
                    { ...request, preferredEngine },
                    { signal: abortController.signal },
                );
                if (abortController.signal.aborted) {
                    return undefined;
                }
                applyReadiness(result.readiness);
                setCanReuseExistingData(result.canReuseExistingData);
                setInstanceState(result.status.state);
                setInstanceMissing(result.status.missing === true);
                setInstanceDataRemoved(result.status.dataRemoved === true);
                // Absent on polled calls (M6-b); keep the last suggestion in that case.
                if (result.suggestedPort !== undefined) {
                    setSuggestedPort(result.suggestedPort);
                    // Pre-fill the port with the host's suggestion until the user edits it, so the
                    // Configure summary shows the port that will actually be bound (review L1/L3).
                    if (!portTouchedRef.current) {
                        setAdvPort(String(result.suggestedPort));
                    }
                }
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
        [applyReadiness, preferredEngine, trpcClient],
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
            options?: { resetStages?: boolean; trigger?: QuickStartWizardStepTrigger },
        ): void => {
            // Cancel any prior in-flight subscription so a fast double-click can't leak
            // an uncancellable stream (mirrors the Query Insights pattern).
            //
            // FOLLOW-UP (retry stability): this unsubscribe is not awaited before the new
            // subscription goes out, so the previous run may still be unwinding on the host when
            // the next one arrives and trips its "Setup is already in progress." guard. The
            // service now buffers every terminal event until that guard is clear, which fixed the
            // case we hit (Retry working only on every second click), but the race itself is still
            // here and wants an explicit "wait for the old stream to end" handshake.
            subscriptionRef.current?.unsubscribe();
            subscriptionRef.current = null;
            // Supersede any prior stream: its in-flight callbacks will see a newer generation and no-op.
            const myGeneration = ++streamGenerationRef.current;

            setExpandedStages(new Set());
            // "Wait longer" resumes at the waiting stage, so keep the earlier stages' done state
            // rather than resetting the whole list to pending.
            if (options?.resetStages !== false) {
                setStageStatus(emptyStageStatus());
                setFacts(emptyStageFacts());
            } else {
                setFacts((previous) => ({ ...previous, waiting: undefined }));
            }
            setErrorMessage(undefined);
            setSuccessMessage(undefined);
            setStageDockerFailure(undefined);
            setDockerActionMessage(undefined);
            setDockerRecoveredKey(0);
            setTimedOut(false);
            setElapsedMs(0);
            navigate('provisioning', options?.trigger ?? 'startSetup');

            const startedAt = Date.now();
            timerRef.current = setInterval(() => setElapsedMs(Date.now() - startedAt), 250);

            let settled = false;
            const subscription = subscribe({
                onData(event: StageEvent) {
                    if (myGeneration !== streamGenerationRef.current) return; // superseded/cancelled stream
                    if (event.facts || event.status !== 'active') {
                        const stageFacts = event.facts;
                        setFacts((previous) => {
                            const next = stageFacts ? { ...previous, [stageFacts.kind]: stageFacts } : previous;
                            if (
                                event.status === 'active' ||
                                next.pulling?.kind !== 'pulling' ||
                                next.pulling.progress === undefined
                            ) {
                                return next;
                            }
                            return { ...next, pulling: { ...next.pulling, progress: undefined } };
                        });
                    }
                    if (event.stage === 'done' && event.status === 'done') {
                        settled = true;
                        stopTimer();
                        setStageStatus((prev) =>
                            prev[event.stage] === event.status ? prev : { ...prev, [event.stage]: event.status },
                        );
                        setSuccessMessage(event.message && formatQuickStartMessage(event.message));
                        setPhase('success');
                    } else if (event.status === 'error') {
                        settled = true;
                        stopTimer();
                        // Also flip the still-active real stage to 'error' so its row shows the error
                        // icon + "failed" status instead of a stuck spinner / "in progress" that would
                        // contradict the failure message for sighted and screen-reader users alike.
                        setStageStatus((prev) => {
                            const active = PROVISION_STAGES.find((s) => prev[s] === 'active');
                            if (prev[event.stage] === event.status && !active) return prev;
                            const next = { ...prev, [event.stage]: event.status };
                            if (active) next[active] = 'error';
                            return next;
                        });
                        setErrorMessage(
                            event.message ? formatQuickStartMessage(event.message) : l10n.t('Setup failed.'),
                        );
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
                        if (event.canReuseExistingData !== undefined) {
                            setCanReuseExistingData(event.canReuseExistingData);
                        }
                        setPhase('failed');
                    } else {
                        setStageStatus((prev) =>
                            prev[event.stage] === event.status ? prev : { ...prev, [event.stage]: event.status },
                        );
                        if (
                            event.stage === 'checking' &&
                            event.status === 'done' &&
                            checkReadinessRef.current?.outcome !== 'ready'
                        ) {
                            // Read the engine evidence only after execution's check has completed.
                            void syncDockerStatus();
                        }
                    }
                },
                onError(error: unknown) {
                    if (myGeneration !== streamGenerationRef.current) return; // superseded/cancelled stream
                    settled = true;
                    stopTimer();
                    setFacts((previous) =>
                        previous.pulling?.kind === 'pulling' && previous.pulling.progress !== undefined
                            ? { ...previous, pulling: { ...previous.pulling, progress: undefined } }
                            : previous,
                    );
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
        [navigate, stopTimer, syncDockerStatus],
    );

    const startProvisioning = useCallback(
        (continueAnyway: boolean): void => {
            isWaitLongerRef.current = false;
            const options = continueAnyway
                ? { ...(advancedRef.current ?? {}), continueAnyway: true }
                : advancedRef.current;
            runStream((handlers) => trpcClient.localQuickStart.startQuickStart.subscribe(options, handlers), {
                trigger: continueAnyway ? 'continueAnyway' : 'startSetup',
            });
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
        // Only the check stage can be cleared in place; nothing ran after it. `active` is accepted
        // as well as `error` because a re-check in flight puts the stage there (see
        // `handleCheckDockerAgain`), and a successful re-check must still land on `done`.
        setStageStatus((prev) =>
            prev.checking === 'error' || prev.checking === 'active' ? { ...prev, checking: 'done' } : prev,
        );
    }, []);

    const handleStopWaiting = useCallback((): void => {
        stopDockerWait();
        setDockerActionMessage(
            lastDockerProblemRef.current?.problem.startAction === 'startPodmanMachine' ||
                lastDockerProblemRef.current?.problem.engine === 'podman'
                ? l10n.t('Stopped waiting for Podman.')
                : l10n.t('Stopped waiting for Docker.'),
        );
    }, [stopDockerWait]);

    const beginDockerWait = useCallback((launch: () => Promise<DockerLaunchResult>, isPodman: boolean): void => {
        stopDockerWait();
        setDockerActionMessage(undefined);
        setStartingDocker(true);
        setDockerWaitElapsedMs(0);
        const abortController = new AbortController();
        dockerPollAbortRef.current = abortController;
        const startedAt = Date.now();
        dockerWaitTimerRef.current = setInterval(() => setDockerWaitElapsedMs(Date.now() - startedAt), 250);
        void launch()
            .then(async (launchResult) => {
                if (abortController.signal.aborted) return;
                if (launchResult === 'notAvailable' || launchResult === 'failed') {
                    stopDockerWait();
                    setDockerActionMessage(
                        isPodman ? l10n.t('Podman could not be started.') : l10n.t('Docker could not be started.'),
                    );
                    return;
                }
                let latestResult: DockerStatusResult | undefined;
                const outcome = await pollDockerReadiness({
                    signal: abortController.signal,
                    query: (suppressCommandEcho) =>
                        trpcClient.localQuickStart.getDockerStatus.query(
                            { forceRefresh: true, polled: true, suppressCommandEcho, preferredEngine },
                            { signal: abortController.signal },
                        ),
                    onResult: (result) => {
                        latestResult = result;
                        applyReadiness(result.readiness);
                        setCanReuseExistingData(result.canReuseExistingData);
                        setInstanceState(result.status.state);
                        setInstanceMissing(result.status.missing === true);
                        setInstanceDataRemoved(result.status.dataRemoved === true);
                    },
                });
                if (abortController.signal.aborted) return;
                stopDockerWait();
                if (outcome === 'ready' && latestResult) {
                    applyDockerRecovery();
                } else if (outcome === 'deadline') {
                    setDockerActionMessage(
                        isPodman
                            ? l10n.t('Podman did not become ready before the wait timed out.')
                            : l10n.t('Docker did not become ready before the wait timed out.'),
                    );
                } else if (outcome === 'stopped') {
                    // Docker answered, but with a non-transient problem (e.g. permission denied). The
                    // readiness card below already updated via onResult; announce the transition too,
                    // otherwise the spinner just disappears and the Announcer says nothing.
                    setDockerActionMessage(
                        isPodman
                            ? l10n.t('Podman started, but it is not usable yet. See the details below.')
                            : l10n.t('Docker started, but it is not usable yet. See the details below.'),
                    );
                }
            })
            .catch(() => {
                if (abortController.signal.aborted) return;
                stopDockerWait();
                setDockerActionMessage(
                    isPodman ? l10n.t('The Podman readiness check failed.') : l10n.t('The Docker readiness check failed.'),
                );
            });
    }, [applyDockerRecovery, applyReadiness, preferredEngine, stopDockerWait, trpcClient]);

    const handleStartDocker = useCallback((): void => {
        beginDockerWait(
            () => trpcClient.localQuickStart.startDockerProvider.mutate({ preferredEngine }),
            lastDockerProblemRef.current?.problem.startAction === 'startPodmanMachine',
        );
    }, [beginDockerWait, preferredEngine, trpcClient]);

    // Re-run only the Docker check, after the user follows the guidance. It never starts or resumes
    // provisioning: a pass clears the blocker in place, a fresh failure updates the evidence.
    const handleCheckDockerAgain = useCallback((): void => {
        setDockerActionMessage(undefined);
        setCheckingDockerAgain(true);
        setFacts((previous) => ({ ...previous, checking: undefined }));
        setExpandedStages((previous) => {
            const next = new Set(previous);
            next.delete('checking');
            return next;
        });
        // The stage's own status carries the in-flight signal, so its icon spins and a screen
        // reader stops hearing "failed" while a re-check is actively running.
        setStageStatus((prev) => ({ ...prev, checking: 'active' }));
        void syncDockerStatus({ forceRefresh: true, resetProviderMemory: true }).then((result) => {
            setCheckingDockerAgain(false);
            if (result?.readiness.outcome === 'ready') {
                applyDockerRecovery();
            } else {
                setStageStatus((prev) => (prev.checking === 'active' ? { ...prev, checking: 'error' } : prev));
            }
        });
    }, [applyDockerRecovery, syncDockerStatus]);

    useEffect(() => {
        // Keep the instance facts live for as long as the panel is open (review N1). Reading them
        // once on mount left the Configure guard describing an instance that a tree action, another
        // window, or a `docker rm` in a terminal had already changed underneath it.
        const subscription = trpcClient.localQuickStart.onInstanceChanged.subscribe(undefined, {
            onData(update: InstanceStatusUpdate) {
                setInstanceState(update.status.state);
                setInstanceMissing(update.status.missing === true);
                setInstanceDataRemoved(update.status.dataRemoved === true);
                setCanReuseExistingData(update.canReuseExistingData);
                // The timed-out container is gone (e.g. deleted from the tree), so "Wait longer" has
                // nothing left to wait for. While it is still retained the instance stays in Error.
                if (
                    timedOutRef.current &&
                    !update.status.canResumeReadiness &&
                    update.status.state !== InstanceState.Error
                ) {
                    setTimedOut(false);
                    setErrorMessage(undefined);
                    setStageStatus(emptyStageStatus());
                    setFacts(emptyStageFacts());
                    setPhase((current) => (current === 'failed' ? 'configure' : current));
                }
            },
            onError() {
                // The mount-time query already seeded these; a dropped stream only stops updates.
            },
        });
        return () => subscription.unsubscribe();
    }, [trpcClient]);

    useEffect(() => {
        const abortController = new AbortController();
        void trpcClient.localQuickStart.getWizardContext
            .query(undefined, { signal: abortController.signal })
            .then((result) => {
                if (abortController.signal.aborted) return;
                setCanReuseExistingData(result.canReuseExistingData);
                setInstanceState(result.status.state);
                setInstanceMissing(result.status.missing === true);
                setInstanceDataRemoved(result.status.dataRemoved === true);
                setInstanceEngine(result.instanceEngine);
                setSuggestedPort(result.suggestedPort);
                if (!portTouchedRef.current) {
                    setAdvPort(String(result.suggestedPort));
                }
                if (result.status.canResumeReadiness) {
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
            })
            .catch(() => undefined);
        return () => {
            abortController.abort();
            readinessAbortRef.current?.abort();
            dockerPollAbortRef.current?.abort();
            subscriptionRef.current?.unsubscribe();
            if (timerRef.current) clearInterval(timerRef.current);
            if (dockerWaitTimerRef.current) clearInterval(dockerWaitTimerRef.current);
        };
    }, [trpcClient]);

    useEffect(() => {
        const relativeTimeTimer = setInterval(() => setRelativeTimeNow(Date.now()), 30_000);
        return () => clearInterval(relativeTimeTimer);
    }, []);

    // Validate the port's availability HERE, while the user can still react, rather than letting
    // setup fail on a Docker bind error minutes later (review L3). Debounced so typing a port digit
    // by digit doesn't issue a probe per keystroke.
    useEffect(() => {
        // An empty field means the suggested port, so that is the one to check.
        const port = getEffectivePort(advPort, suggestedPort);
        if (!/^\d+$/.test(port) || Number(port) < 1024 || Number(port) > 65535) {
            setPortStatus(undefined);
            return;
        }
        setPortStatus('checking');
        let cancelled = false;
        const handle = setTimeout(() => {
            void trpcClient.localQuickStart.checkPort
                .query({ port: Number(port) })
                .then((result) => {
                    if (!cancelled) setPortStatus(result);
                })
                .catch(() => {
                    // Never block the wizard on a probe failure; setup re-checks the port anyway.
                    if (!cancelled) setPortStatus(undefined);
                });
        }, 400);
        return () => {
            cancelled = true;
            clearTimeout(handle);
        };
    }, [advPort, suggestedPort, trpcClient]);

    useEffect(() => {
        const handle = setTimeout(() => setSettledPassword(advPass), 800);
        return () => clearTimeout(handle);
    }, [advPass]);

    // SASLprep a custom password on the host while the user can still fix it. Without this, a
    // password the driver rejects (an emoji, say) only fails as a readiness timeout. Printable ASCII
    // always passes, so most passwords never leave the webview before Start.
    useEffect(() => {
        if (!useCustomCredentials || !needsPasswordEncodingCheck(advPass)) {
            return;
        }
        let cancelled = false;
        const handle = setTimeout(() => {
            void trpcClient.localQuickStart.checkPassword
                .query({ password: advPass })
                .then((result) => {
                    if (!cancelled) setPasswordCheck({ password: advPass, result });
                })
                .catch(() => {
                    // Never block the wizard on a failed check; the router runs it again at Start.
                    if (!cancelled) setPasswordCheck({ password: advPass, result: 'ok' });
                });
        }, 300);
        return () => {
            cancelled = true;
            clearTimeout(handle);
        };
    }, [advPass, useCustomCredentials, trpcClient]);

    // "Wait longer" (§9.1): re-probe the container the service kept running after a readiness
    // timeout, keeping the already-completed stages visible. Optimistically flip the waiting row
    // back to active so it doesn't flash the error icon before the first server event arrives.
    const handleWaitLonger = useCallback((): void => {
        isWaitLongerRef.current = true;
        setStageStatus((prev) => ({ ...prev, waiting: 'active' }));
        runStream((handlers) => trpcClient.localQuickStart.waitLonger.subscribe(undefined, handlers), {
            resetStages: false,
            trigger: 'waitLonger',
        });
    }, [trpcClient, runStream]);

    // "Start over" (§9.1): discard the timed-out container (a fresh attempt's volume is wiped) and
    // return to the settings page. If the discard no-ops because a just-cancelled resume is still
    // unwinding, keep the timed-out actions (the container is intact) so nothing is stranded.
    const handleStartOver = useCallback((): void => {
        setExpandedStages(new Set());
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
                    setFacts(emptyStageFacts());
                    navigate('configure', 'startOver');
                } else {
                    setTimedOut(true);
                    setPhase('failed');
                }
            })
            .catch(() => {
                setTimedOut(true);
                setPhase('failed');
            });
    }, [navigate, trpcClient, stopTimer]);

    const handleClose = useCallback((): void => {
        void trpcClient.localQuickStart.closePanel.mutate().catch(() => undefined);
    }, [trpcClient]);

    const handleCancel = useCallback((): void => {
        subscriptionRef.current?.unsubscribe();
        subscriptionRef.current = null;
        streamGenerationRef.current++; // ignore any trailing callbacks from the cancelled stream
        stopTimer();
        setFacts((previous) =>
            previous.pulling?.kind === 'pulling' && previous.pulling.progress !== undefined
                ? { ...previous, pulling: { ...previous.pulling, progress: undefined } }
                : previous,
        );
        if (isWaitLongerRef.current) {
            // Cancelling a "Wait longer" resume leaves the container running, so return to the
            // timed-out actions (Wait longer / Start over) rather than the settings page.
            isWaitLongerRef.current = false;
            setTimedOut(true);
            navigate('failed', 'cancel');
        } else {
            setTimedOut(false);
            navigate('configure', 'cancel');
        }
    }, [navigate, stopTimer]);

    // From a failure, return to the settings page (field state is preserved) so the user can
    // correct a bad option (e.g. a busy explicit port) and retry — design feedback.
    const handleBackToConfigure = useCallback((): void => {
        isWaitLongerRef.current = false;
        stopDockerWait();
        setErrorMessage(undefined);
        setTimedOut(false);
        navigate('configure', 'back');
    }, [navigate, stopDockerWait]);

    const handleViewOutput = useCallback((): void => {
        void trpcClient.localQuickStart.showOutput.mutate().catch(() => undefined);
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

    /**
     * Configure-step guard action for a stopped instance: start what is already there instead of
     * recreating it. The status refresh flips the guard to "healthy" once it comes up.
     */
    const handleStartExisting = useCallback((): void => {
        void trpcClient.localQuickStart.startInstance
            .mutate()
            .then(() => syncDockerStatus({ forceRefresh: true }))
            .catch(() => undefined);
    }, [syncDockerStatus, trpcClient]);

    const goToStep = useCallback(
        (id: string): void => {
            if (id === 'introduction') {
                setErrorMessage(undefined);
                navigate('introduction', 'stepper');
            } else if (id === 'configure') {
                setErrorMessage(undefined);
                navigate('configure', 'stepper');
            }
        },
        [navigate],
    );

    // ---- derived setup state --------------------------------------------------------------

    // A Docker-only re-check moves the check stage to `active` while it runs. The failure it is
    // re-testing is still the reason this step is showing, so the stage keeps counting as the
    // failed one — otherwise the remediation below would collapse away and reopen on every attempt.
    const failedStage =
        PROVISION_STAGES.find((stage) => stageStatus[stage] === 'error') ??
        (checkingDockerAgain ? 'checking' : undefined);
    const checkStageFailed = phase === 'failed' && failedStage === 'checking';
    // A Docker problem has exactly one home: the stage that hit it. A stale background readiness
    // never renders remediation, so this is only ever the readiness behind the current failure.
    const dockerProblem: DockerReadiness | undefined =
        phase === 'failed'
            ? (stageDockerFailure ??
              (checkStageFailed && checkReadiness && checkReadiness.outcome !== 'ready' ? checkReadiness : undefined))
            : undefined;
    useEffect(() => {
        if (
            phase !== 'failed' ||
            startingDocker ||
            checkingDockerAgain ||
            dockerProblem?.failureKind !== 'daemonStarting' ||
            dockerProblem.podmanMachine?.kind !== 'starting' ||
            autoWaitGenRef.current === streamGenerationRef.current
        ) {
            return;
        }
        autoWaitGenRef.current = streamGenerationRef.current;
        beginDockerWait(() => Promise.resolve('launchAttempted'), true);
    }, [beginDockerWait, checkingDockerAgain, dockerProblem, phase, startingDocker]);

    const dockerPresentation = dockerProblem ? getDockerReadinessPresentation(dockerProblem) : undefined;
    // Held so the block keeps its content while it collapses away, instead of blanking first and
    // then closing an empty gap.
    if (dockerProblem && dockerPresentation) {
        lastDockerProblemRef.current = { problem: dockerProblem, presentation: dockerPresentation };
    }
    const shownDocker = lastDockerProblemRef.current;
    const dockerGuidanceMap = useMemo(
        () => dockerGuidance(shownDocker?.problem.podmanMachine),
        [shownDocker?.problem.podmanMachine],
    );
    const shownPodman = shownDocker?.problem.cli === 'podman' || shownDocker?.problem.engineEvidence === 'podmanShim';
    const recoveryCommand = shownDocker?.presentation.showCopyCommand ? shownDocker.problem.recoveryCommand : undefined;
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
            if (checkStageDetail) return checkStageDetail;
        }
        const status = stageStatus[stage];
        const summary =
            status === 'active' || status === 'done' || status === 'error'
                ? buildStageSummary(facts[stage], status)
                : undefined;
        if (summary) return summary;
        if (stage === failedStage && stageDockerFailure) {
            return formatDockerDetail(getDockerReadinessPresentation(stageDockerFailure).detail);
        }
        return undefined;
    };

    const stageFactsFor = (stage: ProvisionStage): ReturnType<typeof buildDockerDetailRows> | undefined => {
        const rows = buildStageDetailRows(facts[stage]).filter(
            (row) => stageStatus[stage] !== 'error' || row.action !== 'showOutput',
        );
        if (stage === 'checking') {
            if (checkReadiness && (stageStatus.checking === 'done') === (checkReadiness.outcome === 'ready')) {
                rows.unshift(...buildDockerDetailRows(checkReadiness));
            }
        } else if (stage === failedStage && stageDockerFailure) {
            rows.unshift(...buildDockerDetailRows(stageDockerFailure));
        }
        return rows.length ? rows : undefined;
    };

    // Human-readable message for the current in-flight stage, mirrored into a polite live
    // region so screen-reader users hear provisioning progress (WCAG 4.1.3). Suppressed once
    // any stage has errored so a stale "…" utterance can't precede the failure announcement.
    const activeStage = PROVISION_STAGES.find((stage) => stageStatus[stage] === 'active');
    const provisioningStatusMessage = activeStage && !failedStage ? l10n.t('{0}…', stageLabelsMap[activeStage]) : '';

    const effectivePort =
        advValidation?.field === 'port' ? String(suggestedPort) : getEffectivePort(advPort, suggestedPort);
    const effectiveImage =
        !isRecreate && advTag.trim() && advValidation?.field !== 'tag'
            ? `${QUICK_START_IMAGE_REPOSITORY}:${advTag.trim()}`
            : QUICK_START_IMAGE;

    // ---- chrome ---------------------------------------------------------------------------

    const header = (
        <ContainerHeader
            media={<RocketRegular aria-hidden />}
            title={l10n.t('DocumentDB Local')}
            subtitle={l10n.t('Set up DocumentDB locally for development and testing with Docker or Podman.')}
            action={
                configuration.feedbackPermitted === true ? (
                    <Button
                        appearance="secondary"
                        icon={<EmojiRegular />}
                        onClick={() => void trpcClient.common.openFeedback.mutate({})}
                    >
                        {l10n.t('Give Feedback')}
                    </Button>
                ) : undefined
            }
        />
    );

    // Locked while work is in flight and once the connection is saved; a failure unlocks the
    // earlier steps so the user can change a setting and try again.
    const stepsLocked = isProvisioning || phase === 'success';

    // ---- pages ----------------------------------------------------------------------------

    const introduction = (
        <div className={styles.subsection}>
            <Text as="h3" size={400} weight="semibold">
                {l10n.t('What will happen in the Set up step')}
            </Text>
            <ol className={styles.planList}>
                {planItemList.map((item, index) => (
                    <li className={styles.planItem} key={item.label}>
                        {/* Fluent's own default: filled, brand, circular. No colour override. */}
                        <CounterBadge aria-hidden count={index + 1} className={styles.planBadge} />
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
    );

    // Reset lives in the input's own trailing slot, so it stays on the line it resets instead of
    // drifting down beside the field's hint.
    const resetButton = (label: string, onReset: () => void): JSX.Element => (
        <Button
            appearance="subtle"
            size="small"
            icon={<ArrowResetRegular />}
            aria-label={label}
            title={label}
            onClick={onReset}
        />
    );

    // Icon-only row action. `relationship="label"` promotes the tooltip text to the button's
    // accessible name, so dropping the visible label costs assistive tech nothing.
    const rowAction = (label: string, expanded: boolean, onToggle: () => void): JSX.Element => (
        <Tooltip content={label} relationship="label" withArrow>
            <Button
                appearance="subtle"
                size="small"
                icon={<EditRegular />}
                aria-expanded={expanded}
                onClick={onToggle}
            />
        </Tooltip>
    );

    const settingItems: readonly SettingItem[] = [
        {
            key: 'engine',
            label: l10n.t('Container engine'),
            value: instanceEngine
                ? instanceEngine === 'notRecorded'
                    ? l10n.t('Not recorded')
                    : l10n.t('{0} · kept from the existing instance', instanceEngine === 'docker' ? 'Docker' : 'Podman')
                : preferredEngine === 'docker'
                  ? 'Docker'
                  : 'Podman',
            action: instanceEngine
                ? undefined
                : rowAction(
                      editingEngine
                          ? l10n.t('Hide the container engine setting')
                          : l10n.t('Change the container engine'),
                      editingEngine,
                      () => setEditingEngine((value) => !value),
                  ),
            editorOpen: editingEngine && !instanceEngine,
            editor: instanceEngine ? undefined : (
                <Field
                    label={l10n.t('Preferred container engine')}
                    hint={l10n.t('Setup uses your preferred engine if installed, or the other one otherwise.')}
                >
                    <RadioGroup
                        value={preferredEngine}
                        onChange={(_event, data) => setPreferredEngine(data.value === 'podman' ? 'podman' : 'docker')}
                    >
                        <Radio value="docker" label="Docker" />
                        <Radio value="podman" label="Podman" />
                    </RadioGroup>
                </Field>
            ),
        },
        {
            key: 'address',
            label: l10n.t('Address'),
            value: l10n.t('localhost:{0}', effectivePort),
            action: rowAction(
                editingPort ? l10n.t('Hide the port setting') : l10n.t('Change the port'),
                editingPort,
                () => setEditingPort((value) => !value),
            ),
            editorOpen: editingPort,
            editor: (
                <Field
                    label={l10n.t('Port')}
                    hint={l10n.t(
                        'The host is always localhost. This exact port is used. Setup checks it here and never picks a different one later.',
                    )}
                    validationState={shownValidation?.field === 'port' ? 'error' : 'none'}
                    validationMessage={shownValidation?.field === 'port' ? shownValidation.message : undefined}
                >
                    <Input
                        type="number"
                        value={advPort}
                        placeholder={String(suggestedPort)}
                        onChange={(_event, data) => {
                            portTouchedRef.current = true;
                            setAdvPort(data.value);
                        }}
                        contentAfter={resetButton(l10n.t('Reset port to {0}', String(suggestedPort)), () => {
                            portTouchedRef.current = true;
                            setAdvPort(String(suggestedPort));
                        })}
                    />
                </Field>
            ),
        },
        {
            key: 'image',
            label: l10n.t('Image'),
            value: isRecreate ? (
                l10n.t('Kept from the existing instance')
            ) : (
                <code className={styles.imagePath}>{effectiveImage}</code>
            ),
            action: isRecreate
                ? undefined
                : rowAction(
                      editingImage ? l10n.t('Hide the image tag setting') : l10n.t('Change the image tag'),
                      editingImage,
                      () => setEditingImage((value) => !value),
                  ),
            editorOpen: editingImage && !isRecreate,
            editor: isRecreate ? undefined : (
                <Field
                    label={l10n.t('Image tag')}
                    hint={l10n.t('The official image repository is fixed.')}
                    validationState={shownValidation?.field === 'tag' ? 'error' : 'none'}
                    validationMessage={shownValidation?.field === 'tag' ? shownValidation.message : undefined}
                >
                    <Input
                        value={advTag}
                        maxLength={128}
                        onChange={(_event, data) => setAdvTag(data.value)}
                        contentAfter={resetButton(l10n.t('Reset image tag to {0}', QUICK_START_DEFAULT_TAG), () =>
                            setAdvTag(QUICK_START_DEFAULT_TAG),
                        )}
                    />
                </Field>
            ),
        },
        {
            key: 'credentials',
            label: l10n.t('Credentials'),
            value: isRecreate
                ? l10n.t('Reused from the existing instance')
                : useCustomCredentials
                  ? l10n.t('Your own username and password')
                  : l10n.t('Generated automatically'),
            action: isRecreate ? undefined : (
                <Switch
                    checked={!useCustomCredentials}
                    aria-label={l10n.t('Generate credentials automatically')}
                    onChange={(_event, data) => setCustomCredentials(!data.checked)}
                />
            ),
            editorOpen: useCustomCredentials,
            editor: isRecreate ? undefined : (
                <div className={styles.credentialFields}>
                    <Field
                        label={l10n.t('Username')}
                        hint={l10n.t(
                            'Up to 63 ASCII characters; fewer for non-ASCII text. No spaces. Names starting with pg, citus, documentdb, or internal_role are reserved.',
                        )}
                        validationState={shownValidation?.field === 'username' ? 'error' : 'none'}
                        validationMessage={shownValidation?.field === 'username' ? shownValidation.message : undefined}
                    >
                        <Input
                            value={advUser}
                            maxLength={128}
                            placeholder={l10n.t('Enter a username')}
                            aria-invalid={shownValidation?.field === 'credentials' || undefined}
                            aria-describedby={
                                shownValidation?.field === 'credentials' ? 'quickstart-credentials-error' : undefined
                            }
                            onChange={(_event, data) => setAdvUser(data.value)}
                        />
                    </Field>
                    <Field
                        label={l10n.t('Password')}
                        validationState={shownValidation?.field === 'password' ? 'error' : 'none'}
                        validationMessage={shownValidation?.field === 'password' ? shownValidation.message : undefined}
                    >
                        <Input
                            type="password"
                            value={advPass}
                            placeholder={l10n.t('Enter a password')}
                            aria-invalid={shownValidation?.field === 'credentials' || undefined}
                            aria-describedby={
                                shownValidation?.field === 'credentials' ? 'quickstart-credentials-error' : undefined
                            }
                            onChange={(_event, data) => setAdvPass(data.value)}
                        />
                    </Field>
                    {shownValidation?.field === 'credentials' && (
                        <Text
                            id="quickstart-credentials-error"
                            role="alert"
                            size={200}
                            className={styles.credentialsValidation}
                        >
                            <ErrorCircleFilled aria-hidden />
                            {shownValidation.message}
                        </Text>
                    )}
                </div>
            ),
        },
        {
            key: 'sampleData',
            label: l10n.t('Sample data'),
            value: advLoadSampleData ? l10n.t('Included') : l10n.t('Not included'),
            action: (
                <Switch
                    checked={advLoadSampleData}
                    aria-label={l10n.t('Include sample data')}
                    onChange={(_event, data) => setAdvLoadSampleData(data.checked)}
                />
            ),
        },
    ];

    /**
     * Existing-instance guard (review §9.2 Q2, I2-3). It lives on the Configure step — the one
     * screen where the decision is actually made — rather than on the Introduction step. A healthy
     * or stopped instance is never walked into a destructive recreate. A credential-unavailable one
     * is explained here before the user can choose the explicit "Start fresh" action.
     */
    const existingInstanceNotice = existingInstanceGuard && (
        <MessageBlock
            intent={existingInstanceGuard === 'credentialsMissing' ? 'warning' : 'info'}
            title={
                existingInstanceGuard === 'healthy'
                    ? l10n.t('DocumentDB Local is already running')
                    : existingInstanceGuard === 'stopped'
                      ? l10n.t('DocumentDB Local is already set up')
                      : l10n.t('DocumentDB Local needs attention')
            }
            actions={
                <>
                    {existingInstanceGuard === 'healthy' && (
                        <Button appearance="secondary" onClick={handleOpenConnection}>
                            {l10n.t('Open Connection')}
                        </Button>
                    )}
                    {existingInstanceGuard === 'stopped' && (
                        <Button appearance="secondary" onClick={handleStartExisting}>
                            {l10n.t('Start')}
                        </Button>
                    )}
                    {startBlockedByGuard && (
                        <Button appearance="secondary" onClick={handleClose}>
                            {l10n.t('Close')}
                        </Button>
                    )}
                </>
            }
        >
            {existingInstanceGuard === 'healthy'
                ? l10n.t('There is nothing to set up. Open the connection to start using it.')
                : existingInstanceGuard === 'stopped'
                  ? l10n.t('It is stopped. Start it to use it again, with all your data.')
                  : l10n.t(
                        'We found an existing DocumentDB Local instance, but its saved credentials are unavailable. Without them, we cannot reopen or reuse the existing data, so you need to start fresh. Nothing has been changed yet. Starting fresh erases the existing instance and its data, then creates a new one.',
                    )}
        </MessageBlock>
    );

    /**
     * The recreate-vs-fresh choice (review M4, I2-2). It sits above the settings table because it
     * decides what those settings mean: reusing keeps the instance's stored credentials and image,
     * so the credential/image rows are hidden. Per I2-Q4 there is NO extra confirmation dialog:
     * the destructive option states the data loss in its own label and is never pre-selected.
     *
     * The explanation and the choice share one block so they cannot read as competing controls.
     * `MessageBar` is `role="group"`, which is the right container for a set of related controls.
     *
     * Hidden whenever setup cannot run (a healthy or stopped instance): offering a choice next to a
     * disabled primary action reads as a third, broken control.
     */
    const dataChoiceBlock = canReuseExistingData && !forcedFresh && !startBlockedByGuard && (
        <MessageBlock intent="info">
            {instanceMissing && (
                <div>
                    {/* Not "removed outside VS Code": Start over on a recreate lands here too. */}
                    {l10n.t(
                        'The DocumentDB Local container no longer exists, but its data is still on this machine. Setting up creates the container again.',
                    )}
                </div>
            )}
            <Field
                label={
                    // Only restate where the data came from when the sentence above did not.
                    instanceMissing
                        ? l10n.t('What should setup do with the existing data?')
                        : l10n.t('DocumentDB Local already has data on this machine. What should setup do with it?')
                }
            >
                <RadioGroup
                    value={dataChoice}
                    onChange={(_event, data) => setDataChoice(data.value === 'fresh' ? 'fresh' : 'reuse')}
                >
                    <Radio value="reuse" label={l10n.t('Keep the existing data')} />
                    <Radio value="fresh" label={l10n.t('Erase the existing data and start empty')} />
                </RadioGroup>
            </Field>
        </MessageBlock>
    );

    // The instance vanished without anyone deleting it here; say why, and how to get it back when the
    // cause is Docker pointing somewhere else. Setup keeps the old credentials unless custom ones are set.
    const dataRemovedNotice = instanceDataRemoved && !existingInstanceGuard && (
        <MessageBlock intent="info">
            {l10n.t(
                'The DocumentDB Local container and its data are no longer in Docker, so setup creates a new, empty instance. If you switched Docker to a different engine or context, switch back and refresh DocumentDB Local in the Connections view instead.',
            )}
        </MessageBlock>
    );

    const configure = (
        <>
            {existingInstanceNotice}
            {dataRemovedNotice}
            {dataChoiceBlock}
            <Table size="small" aria-label={l10n.t('Setup settings')}>
                <colgroup>
                    <col className={styles.settingsColLabel} />
                    <col />
                    <col className={styles.settingsColActions} />
                </colgroup>
                <TableBody>
                    {settingItems.map((item) => (
                        <Fragment key={item.key}>
                            <TableRow>
                                <TableCell>
                                    <TableCellLayout appearance="primary">{item.label}</TableCellLayout>
                                </TableCell>
                                <TableCell className={styles.settingValueCell}>{item.value}</TableCell>
                                <TableCell>
                                    <div className={styles.settingAction}>{item.action}</div>
                                </TableCell>
                            </TableRow>
                            {item.editor && (
                                <TableRow
                                    className={styles.editorRow}
                                    // Collapsed the row is empty and 0px tall; every toggle that
                                    // closes it lives outside it, so nothing focusable is hidden.
                                    aria-hidden={item.editorOpen !== true}
                                >
                                    <TableCell colSpan={3} className={styles.editorCell}>
                                        {/* No `appear`: an editor left open across a step change opens instantly. */}
                                        <Collapse visible={item.editorOpen === true} unmountOnExit>
                                            <div className={styles.editorBody}>
                                                <div className={styles.editFields}>{item.editor}</div>
                                            </div>
                                        </Collapse>
                                    </TableCell>
                                </TableRow>
                            )}
                        </Fragment>
                    ))}
                </TableBody>
            </Table>
            {isRecreate && (
                <Text size={200} className={styles.muted}>
                    {l10n.t(
                        'Recreating reuses the existing data volume, so the original credentials and image are kept.',
                    )}
                </Text>
            )}
        </>
    );

    // The wrapper is unconditional: a Collapse that mounts already visible skips its enter
    // motion, so it has to exist (hidden) before the failure arrives.
    const dockerStatusBlock = (
        <div className={styles.dockerStatus}>
            {shownDocker && (
                <>
                    <MessageBlock
                        intent="error"
                        icon={<ErrorCircleFilled />}
                        title={dockerFailureLabelMap[shownDocker.problem.failureKind ?? 'unknown']}
                        actions={
                            <>
                                {shownDocker.presentation.showInstall && (
                                    // Route the install CTA through the guide the host resolved for
                                    // THIS platform. It used to hardcode the Docker Engine page, so
                                    // Windows and macOS users were sent to a Linux-only install (#856).
                                    <Button
                                        appearance="secondary"
                                        onClick={() =>
                                            handleOpenGuide(dockerGuideMap[shownDocker.presentation.guide].href)
                                        }
                                    >
                                        {dockerGuideMap[shownDocker.presentation.guide].label}
                                    </Button>
                                )}
                                {startingDocker ? (
                                    <Button appearance="secondary" onClick={handleStopWaiting}>
                                        {l10n.t('Stop waiting')}
                                    </Button>
                                ) : (
                                    shownDocker.presentation.showStartDockerProvider &&
                                    shownDocker.presentation.startLabel && (
                                        <Button appearance="secondary" onClick={handleStartDocker}>
                                            {dockerStartLabelMap[shownDocker.presentation.startLabel]}
                                        </Button>
                                    )
                                )}
                                {!shownDocker.presentation.showInstall && (
                                    <Button
                                        appearance="secondary"
                                        onClick={() =>
                                            handleOpenGuide(dockerGuideMap[shownDocker.presentation.guide].href)
                                        }
                                    >
                                        {dockerGuideMap[shownDocker.presentation.guide].label}
                                    </Button>
                                )}
                                {shownDocker.presentation.showContinueAnyway && (
                                    <Button appearance="secondary" onClick={handleContinueAnyway}>
                                        {l10n.t('Continue anyway')}
                                    </Button>
                                )}
                                {shownDocker.presentation.showViewOutput && (
                                    <Button appearance="secondary" onClick={handleViewOutput}>
                                        {l10n.t('View setup log')}
                                    </Button>
                                )}
                            </>
                        }
                    >
                        <div>
                            {shownPodman && (startingDocker || shownDocker.problem.failureKind === 'daemonStarting')
                                ? l10n.t('Waiting for Podman to start. This can take a minute.')
                                : dockerGuidanceMap[
                                    startingDocker
                                        ? 'daemonStarting'
                                        : (shownDocker.presentation.guidance ?? 'notAccessible')
                                ]}
                        </div>
                        {recoveryCommand && (
                            <div className={styles.recoveryCommand}>
                                {/* Copy sits in the block it copies, where the command is being read. */}
                                <div className={styles.recoveryCommandBlock}>
                                    <code className={styles.recoveryCommandLine}>{recoveryCommand.commandLine}</code>
                                    <Button
                                        appearance="secondary"
                                        size="small"
                                        className={styles.recoveryCommandCopy}
                                        icon={<CopyRegular />}
                                        onClick={() => handleCopyRecoveryCommand(recoveryCommand.id)}
                                    >
                                        {l10n.t('Copy')}
                                    </Button>
                                </div>
                                {shownDocker.presentation.recoveryNote && (
                                    <Text>{dockerRecoveryNoteMap[shownDocker.presentation.recoveryNote]}</Text>
                                )}
                            </div>
                        )}
                        {startingDocker && (
                            <div className={styles.waitingStatus}>
                                <Spinner size="extra-tiny" aria-hidden />
                                <Text>{l10n.t('Waiting {0}', formatElapsed(dockerWaitElapsedMs))}</Text>
                            </div>
                        )}
                    </MessageBlock>
                </>
            )}
        </div>
    );

    const setupHeading = isProvisioning
        ? l10n.t('Setting up DocumentDB Local')
        : canContinueSetup
          ? l10n.t('Ready to set up')
          : l10n.t('Setup did not finish');
    const setupSubtitle = isProvisioning
        ? l10n.t('This can take a few minutes. Elapsed time: {0}', formatElapsed(elapsedMs))
        : canContinueSetup
          ? shownPodman
              ? l10n.t('Podman is ready now. Nothing has been created on your machine yet.')
              : l10n.t('Docker is ready now. Nothing has been created on your machine yet.')
          : checkStageFailed
            ? l10n.t('Setup stopped at the first stage. Nothing was created on your machine.')
            : undefined;

    // The Docker-only re-check lives on the stage that owns the check, so its scope is unambiguous
    // next to the footer's full-run Retry. While the re-check runs the stage's own status is
    // `active`, so its icon spins and this link simply steps aside.
    const stageActionFor = (stage: ProvisionStage): ReactNode => {
        if (
            stage !== 'checking' ||
            !dockerProblem ||
            !dockerPresentation?.showRetry ||
            startingDocker ||
            checkingDockerAgain
        ) {
            return undefined;
        }
        return (
            <Link
                onClick={(event) => {
                    if (event.currentTarget.ownerDocument.activeElement === event.currentTarget) {
                        primaryButtonRef.current?.focus();
                    }
                    handleCheckDockerAgain();
                }}
            >
                {l10n.t('Check Docker again')}
            </Link>
        );
    };

    // When the evidence was gathered belongs next to the evidence, not at the foot of the block.
    // Suppressed while a re-check is in flight: "Last checked …" contradicts "Checking…".
    const stageMetaFor = (stage: ProvisionStage): string | undefined =>
        stage === 'checking' && dockerProblem && stageStatus.checking !== 'active'
            ? formatLastChecked(dockerProblem.checkedAtMs, relativeTimeNow)
            : undefined;

    /** The evidence line: what was observed, when it was observed, and the control that re-runs it. */
    const stageDetailNode = (stage: ProvisionStage): ReactNode => {
        const evidence = stageDetailFor(stage);
        const meta = stageMetaFor(stage);
        const action = stageActionFor(stage);
        const text = evidence && meta ? l10n.t('{0} · {1}', evidence, meta) : (evidence ?? meta);
        if (!text && !action) {
            return undefined;
        }
        const stageFacts = facts[stage];
        if (stage === 'pulling' && stageStatus.pulling === 'active') {
            const activity =
                stageFacts?.kind === 'pulling' && stageFacts.progress?.trim()
                    ? l10n.t('Engine output: {0}', stageFacts.progress)
                    : text;
            return (
                <span className={styles.pullActivity} title={activity}>
                    {activity}
                </span>
            );
        }
        return (
            <>
                {text}
                {text && action ? ' · ' : ''}
                {action}
            </>
        );
    };

    const setup = (
        <>
            <StatusList ariaLabel={l10n.t('Setup progress')} statusLabels={stageStatusLabels} highlightRowsOnHover>
                {PROVISION_STAGES.map((stage) => (
                    <SetupStageRow
                        key={stage}
                        stage={stage}
                        label={stageLabelsMap[stage]}
                        status={stageStatus[stage]}
                        detail={stageDetailNode(stage)}
                        facts={stageFactsFor(stage)}
                        failureTitle={
                            stage === failedStage && dockerProblem
                                ? dockerFailureLabelMap[dockerProblem.failureKind ?? 'unknown']
                                : undefined
                        }
                        expanded={expandedStages.has(stage)}
                        onExpandedChange={handleExpandedChange}
                        focusFallback={primaryButtonRef}
                        mutedClassName={styles.muted}
                        onShowOutput={handleViewOutput}
                    />
                ))}
            </StatusList>
            {/* Everything below arrives while the step is already on screen, so it expands into
                place. None of these carry `appear`: a state restored at mount renders instantly. */}
            <Collapse visible={checkReadiness?.platformSupported === false} unmountOnExit>
                <div>
                    <MessageBlock intent="warning" icon={<WarningRegular />}>
                        {l10n.t('DocumentDB Local images are published for x64 and arm64 only.')}
                    </MessageBlock>
                </div>
            </Collapse>
            {/* Only when a later failure still stands: otherwise the heading already says it. */}
            <Collapse visible={dockerRecovered && !canContinueSetup} unmountOnExit>
                <div>
                    <MessageBlock intent="success" title={l10n.t('Docker is ready')}>
                        {l10n.t('The earlier failure is still shown below.')}
                    </MessageBlock>
                </div>
            </Collapse>
            <Collapse visible={phase === 'failed' && !dockerProblem && !canContinueSetup} unmountOnExit>
                <div>
                    <MessageBlock
                        intent={timedOut ? 'warning' : 'error'}
                        icon={timedOut ? <WarningRegular /> : <ErrorCircleFilled />}
                        actions={
                            <Button appearance="secondary" onClick={handleViewOutput}>
                                {l10n.t('View setup log')}
                            </Button>
                        }
                    >
                        {timedOut
                            ? (errorMessage ??
                              l10n.t(
                                  'The container is running, but DocumentDB has not accepted connections yet. It may still be initializing. Keep waiting, view the logs, or start over.',
                              ))
                            : (errorMessage ?? l10n.t('Setup failed.'))}
                    </MessageBlock>
                </div>
            </Collapse>
            <Collapse visible={dockerProblem !== undefined} unmountOnExit>
                {dockerStatusBlock}
            </Collapse>
            {isProvisioning && <Link onClick={handleViewOutput}>{l10n.t('View setup log')}</Link>}
        </>
    );

    const done = (
        <>
            <StatusList
                ariaLabel={l10n.t('Completed setup steps')}
                statusLabels={stageStatusLabels}
                highlightRowsOnHover
            >
                {PROVISION_STAGES.map((stage) => (
                    <SetupStageRow
                        key={stage}
                        stage={stage}
                        label={stageLabelsMap[stage]}
                        status="done"
                        detail={stageDetailFor(stage)}
                        facts={stageFactsFor(stage)}
                        expanded={expandedStages.has(stage)}
                        onExpandedChange={handleExpandedChange}
                        focusFallback={primaryButtonRef}
                        mutedClassName={styles.muted}
                        onShowOutput={handleViewOutput}
                    />
                ))}
            </StatusList>
            <MessageBlock intent="success" title={l10n.t('All set')}>
                {l10n.t('The instance is ready in the Connections view as “DocumentDB Local”.')}
                {facts.waiting?.kind === 'waiting' && facts.waiting.sampleData === 'failed' && (
                    <> {l10n.t('Sample data was not loaded. View the setup log for the reason.')}</>
                )}
            </MessageBlock>
            <div className={styles.nextSteps}>
                <Text size={300} weight="regular">
                    {l10n.t('Next steps')}
                </Text>
                <ul className={styles.nextStepsList}>
                    <li>
                        <Text size={300}>
                            {l10n.t(
                                'Click Open Connection to browse your databases under “DocumentDB Local” in the Connections view.',
                            )}
                        </Text>
                    </li>
                    <li>
                        <Text size={300}>
                            {l10n.t(
                                'The container keeps running after VS Code closes. Manage it with Stop, Restart, or Delete in the Connections view.',
                            )}
                        </Text>
                    </li>
                </ul>
            </div>
        </>
    );

    // ---- footer ---------------------------------------------------------------------------

    let primaryLabel: string;
    let primaryDisabled = false;
    let primaryIcon: JSX.Element | undefined;
    let onPrimary: () => void;
    let secondaryActions: JSX.Element;
    // Sits directly above the primary action and states what pressing it does to the machine.
    let footerNote: ReactNode;

    // `isProvisioning` is just `phase === 'provisioning'`, so this switches on `phase` throughout;
    // `'failed'` alone has two footers, split on `timedOut` inside its case.
    switch (phase) {
        case 'introduction': {
            primaryLabel = l10n.t('Continue');
            onPrimary = () => navigate('configure', 'next');
            footerNote = l10n.t(
                'Nothing is downloaded or created on your machine until you choose to start in the Configure step.',
            );
            secondaryActions = (
                <Button appearance="secondary" onClick={handleClose}>
                    {l10n.t('Cancel')}
                </Button>
            );
            break;
        }
        case 'configure': {
            // The label stays fixed; the note below it is what follows the choice. "Nothing else on your
            // machine is changed" is true only for a genuinely fresh install and must not render for
            // either recreate path (review M4 / §10.6).
            primaryLabel = forcedFresh ? l10n.t('Start fresh') : l10n.t('Start DocumentDB Local');
            primaryDisabled = advError !== undefined || passwordEncoding === 'checking' || startBlockedByGuard;
            primaryIcon = <RocketRegular />;
            onPrimary = handleStart;
            // Every Configure path creates a new container, which takes the telemetry setting at creation.
            const telemetryNote = (
                <>
                    {l10n.t('DocumentDB Local follows your VS Code telemetry setting.')}{' '}
                    <Link
                        inline
                        className={styles.inheritFont}
                        onClick={() => handleOpenGuide(DOCUMENTDB_LOCAL_PRIVACY_URL)}
                    >
                        {l10n.t('Open DocumentDB Local privacy statement')}
                    </Link>
                    .
                </>
            );
            const actionNote = isRecreate
                ? l10n.t(
                      'Recreating replaces the container named {0} and keeps its data volume, so your documents, credentials and image version are preserved.',
                      QUICK_START_CONTAINER_NAME,
                  )
                : startFresh
                  ? l10n.t(
                        'This deletes the container named {0} and its data volume, then creates a new one. Everything stored in DocumentDB Local is erased.',
                        QUICK_START_CONTAINER_NAME,
                    )
                  : l10n.t(
                        'Starting downloads the official image if needed, then creates and starts one container named {0}. Nothing else on your machine is changed.',
                        QUICK_START_CONTAINER_NAME,
                    );
            footerNote = (
                <>
                    {actionNote} {telemetryNote}
                </>
            );
            secondaryActions = (
                <Button appearance="secondary" onClick={() => navigate('introduction', 'back')}>
                    {l10n.t('Back')}
                </Button>
            );
            break;
        }
        case 'provisioning': {
            primaryLabel = l10n.t('Setting up…');
            primaryDisabled = true;
            onPrimary = () => undefined;
            secondaryActions = (
                <Button appearance="secondary" ref={cancelButtonRef} onClick={handleCancel}>
                    {l10n.t('Cancel')}
                </Button>
            );
            break;
        }
        case 'failed': {
            if (timedOut) {
                primaryLabel = l10n.t('Wait longer');
                primaryIcon = <ArrowClockwiseRegular />;
                onPrimary = handleWaitLonger;
                secondaryActions = (
                    <Button appearance="secondary" onClick={handleStartOver}>
                        {l10n.t('Start over')}
                    </Button>
                );
            } else {
                primaryLabel = forcedFresh
                    ? l10n.t('Start fresh')
                    : canContinueSetup
                      ? l10n.t('Continue setup')
                      : l10n.t('Retry setup');
                primaryIcon = canContinueSetup ? <RocketRegular /> : <ArrowClockwiseRegular />;
                primaryDisabled = startingDocker || checkingDockerAgain;
                onPrimary = handleStart;
                // Data this profile can't open makes the next run a Start fresh (#946), so say so here
                // rather than letting "Retry" erase it.
                footerNote = forcedFresh
                    ? l10n.t(
                          'This deletes the container named {0} and its data volume, then creates a new one. Everything stored in DocumentDB Local is erased.',
                          QUICK_START_CONTAINER_NAME,
                      )
                    : canContinueSetup
                      ? l10n.t(
                            'Continuing runs every setup step from the beginning, starting with the Docker check. Nothing has been created on your machine yet.',
                        )
                      : l10n.t(
                            'Retrying runs every setup step again from the beginning, starting with the Docker check.',
                        );
                secondaryActions = (
                    <Button appearance="secondary" onClick={handleBackToConfigure}>
                        {l10n.t('Back')}
                    </Button>
                );
            }
            break;
        }
        case 'success': {
            primaryLabel = l10n.t('Open Connection');
            onPrimary = handleOpenConnection;
            footerNote = l10n.t(
                'The connection already exists in the Connections view. Opening it selects and expands it there.',
            );
            secondaryActions = (
                <Button appearance="secondary" onClick={handleClose}>
                    {l10n.t('Close')}
                </Button>
            );
            break;
        }
    }

    return (
        <>
            {/* Out of the wizard's flow: every announcer is absolutely positioned and must stay
                mounted across step changes, or the false → true transition it listens for is lost. */}
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
                          l10n.t('DocumentDB is still initializing. Keep waiting, view the logs, or start over.'))
                        : l10n.t('Setup did not finish. {0}', errorMessage ?? l10n.t('See the details below.'))
                }
                politeness="assertive"
            />
            <Announcer
                when={startingDocker}
                message={shownPodman ? l10n.t('Waiting for Podman to start.') : l10n.t('Waiting for Docker to start.')}
            />
            <Announcer
                key={`docker-recovered-${dockerRecoveredKey}`}
                when={dockerRecoveredKey > 0}
                message={
                    shownPodman
                        ? l10n.t('Podman is ready. Setup has not run yet.')
                        : l10n.t('Docker is ready. Setup has not run yet.')
                }
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
            <Wizard
                activeStep={step}
                onStepChange={goToStep}
                contentMaxWidth="760px"
                headerBehavior="sticky-navigation"
                stepsLocked={stepsLocked}
                stepsAriaLabel={l10n.t('Setup steps')}
                overflowAriaLabel={(count) => l10n.t('{0} more steps', String(count))}
                header={header}
                footer={
                    <ContainerFooter
                        note={footerNote}
                        contentEnd={
                            <Button
                                appearance="secondary"
                                onClick={() => handleOpenGuide(DOCUMENTDB_LOCAL_LEARN_MORE_URL)}
                            >
                                {l10n.t('Learn more')}
                            </Button>
                        }
                    >
                        <Button
                            appearance="primary"
                            ref={primaryButtonRef}
                            icon={primaryIcon}
                            disabled={primaryDisabled}
                            disabledFocusable={checkingDockerAgain}
                            onClick={onPrimary}
                        >
                            {primaryLabel}
                        </Button>
                        {secondaryActions}
                    </ContainerFooter>
                }
            >
                <WizardStep
                    value="introduction"
                    label={l10n.t('Introduction')}
                    title={l10n.t('Develop and test locally')}
                    subtitle={
                        /* Approved product copy, taken verbatim from documentdb.io — exempt from the
                           repo's "never MongoDB as a bare product name" terminology rule. Do not sweep. */
                        l10n.t(
                            'DocumentDB Local gives you an open-source, fully MongoDB-compatible database for development and testing on your machine.',
                        )
                    }
                >
                    {introduction}
                </WizardStep>
                <WizardStep
                    value="configure"
                    label={l10n.t('Configure')}
                    title={l10n.t('Configure setup')}
                    subtitle={l10n.t('These defaults work for most people. Change them only if you need to.')}
                >
                    {configure}
                </WizardStep>
                <WizardStep value="setup" label={l10n.t('Set up')} title={setupHeading} subtitle={setupSubtitle}>
                    {setup}
                </WizardStep>
                <WizardStep
                    value="done"
                    label={l10n.t('Done')}
                    title={l10n.t('DocumentDB Local is ready')}
                    subtitle={successMessage}
                >
                    {done}
                </WizardStep>
            </Wizard>
        </>
    );
};
