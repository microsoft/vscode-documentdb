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
    CounterBadge,
    Field,
    Input,
    Link,
    makeStyles,
    mergeClasses,
    MessageBar,
    MessageBarActions,
    MessageBarBody,
    MessageBarTitle,
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
    CheckmarkCircleFilled,
    CircleHintFilled,
    CopyRegular,
    EditRegular,
    ErrorCircleFilled,
    InfoRegular,
    RocketRegular,
    WarningRegular,
} from '@fluentui/react-icons';
import { Collapse } from '@fluentui/react-motion-components-preview';
import { WizardBreadcrumb, type WizardStepMeta } from '@microsoft/vscode-ext-webview-fluentui/components';
import * as l10n from '@vscode/l10n';
import { Fragment, type JSX, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatQuickStartMessage } from '../../../services/localQuickStart/quickStartMessages';
import {
    type AdvancedQuickStartOptions,
    type DockerEndpointKind,
    type DockerEndpointProbe,
    type DockerFailureKind,
    type DockerHostEnvironment,
    type DockerPermissionDetail,
    type DockerProvider,
    type DockerProviderEvidence,
    type DockerReadiness,
    type DockerReadinessOutcome,
    type DockerRecoveryCommand,
    type DockerStatusResult,
    InstanceState,
    type InstanceStatusUpdate,
    type PortAvailability,
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
import { pollDockerReadiness } from './dockerReadinessPolling';
import {
    type DockerDetailFailureKey,
    type DockerDetailSegment,
    type DockerGuidanceKey,
    type DockerGuideKey,
    type DockerReadinessPresentation,
    type DockerReadinessPresentationState,
    type DockerRecoveryNoteKey,
    type DockerStartLabelKey,
    getDockerExecutionTargetKey,
    getDockerReadinessPresentation,
} from './dockerReadinessPresentation';
import { getExistingInstanceGuard, guardBlocksSetup } from './existingInstanceGuard';
import './localQuickStart.scss';

/**
 * Wizard phases. `provisioning` and `failed` are both the "Set up" step: a setup failure — Docker
 * problems included — is reported in place, beside the stage that failed, rather than on a screen
 * of its own.
 */
type Phase = 'introduction' | 'configure' | 'provisioning' | 'failed' | 'success';
type WizardStepId = 'introduction' | 'configure' | 'setup' | 'done';
type StageStatus = 'pending' | 'active' | 'done' | 'error';

const DOCUMENTDB_LOCAL_LEARN_MORE_URL = 'https://aka.ms/vscode-documentdb-local';

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
    root: {
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        overflow: 'hidden',
        // Containing block for absolutely-positioned descendants (the visually-hidden status text).
        position: 'relative',
    },
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
    // A heading belongs to what follows it, so it keeps more air above than below: the section's
    // own 12px gap plus this 8px sits above the heading, and 8px separates it from its content.
    subsection: { display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px' },
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
    footerLearnMore: { marginLeft: 'auto' },
    footerNote: {
        display: 'flex',
        alignItems: 'flex-start',
        gap: '8px',
        color: tokens.colorNeutralForeground2,
    },
    // Block layout drops the inline descender space, so the glyph shares the text's first line box.
    footerNoteIcon: {
        color: tokens.colorNeutralForeground3,
        display: 'block',
        fontSize: '16px',
        height: tokens.lineHeightBase200,
        flexShrink: 0,
    },
    footerElevated: {
        borderTopColor: tokens.colorNeutralStroke2,
        boxShadow: '0 -2px 6px rgba(0, 0, 0, 0.08)',
    },
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
    // The re-check sits on the evidence line, so it has to drop to that line's type scale.
    stageInlineLink: { fontSize: tokens.fontSizeBase200, lineHeight: tokens.lineHeightBase200 },
    // Keeps the in-flight spinner on the evidence line rather than starting a block of its own.
    stageInlineSpinner: {
        display: 'inline-flex',
        verticalAlign: 'text-bottom',
        gap: '6px',
        '& .fui-Spinner__label': {
            fontSize: tokens.fontSizeBase200,
            lineHeight: tokens.lineHeightBase200,
            color: tokens.colorNeutralForeground2,
        },
    },
    stageDone: { color: tokens.colorPaletteGreenForeground1, fontSize: '18px' },
    stageError: { color: tokens.colorPaletteRedForeground1, fontSize: '18px' },
    stagePending: { color: tokens.colorNeutralForeground4, fontSize: '18px' },
    dockerStatus: { display: 'flex', flexDirection: 'column', gap: '10px' },
    stackedMessageBarBody: { display: 'flex', flexDirection: 'column', gap: '8px' },
    titleAndMessageBarBody: { display: 'flex', flexDirection: 'column', gap: '8px' },
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
    dockerAccordionHeader: { minHeight: '30px' },
    accordionHeaderBrand: { color: tokens.colorBrandForeground1 },
    dockerAccordionPanel: { paddingTop: '4px' },
    dockerDetailsIntro: { display: 'block', paddingBottom: '8px', color: tokens.colorNeutralForeground2 },
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
        display: 'flex',
        flexDirection: 'column',
        gap: '2px',
        margin: 0,
        padding: '9px 0',
        overflowWrap: 'anywhere',
        borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    },
    // How the fact above was established — the part that is worth the extra room behind a
    // collapsed panel.
    dockerDetailNote: { color: tokens.colorNeutralForeground3 },
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

// Every lookup below is built at CALL time, never at module scope. `WebviewRegistry` imports this
// component eagerly, so module bodies run before `l10n.config()` in `render()` — a module-scope
// `l10n.t(...)` is extracted for translation but permanently resolves to the English source string.
function stageLabels(): Record<ProvisionStage, string> {
    return {
        checking: l10n.t('Checking Docker'),
        pulling: l10n.t('Pulling official image'),
        creating: l10n.t('Creating container'),
        starting: l10n.t('Starting container'),
        waiting: l10n.t('Waiting for DocumentDB to accept connections'),
        done: l10n.t('Done'),
        error: l10n.t('Error'),
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
}

function dockerDaemonValues(): Readonly<Record<DockerReadinessPresentationState, string>> {
    return {
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
}

function dockerFailureLabels(): Readonly<Record<DockerFailureKind, string>> {
    return {
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
}

function dockerProviderLabels(): Readonly<Record<DockerProvider, string>> {
    return {
        dockerDesktop: l10n.t('Docker Desktop'),
        dockerEngine: l10n.t('Docker Engine'),
        unknown: l10n.t('Unknown'),
    };
}

function dockerOutcomeValues(): Readonly<Record<DockerReadinessOutcome, string>> {
    return {
        ready: l10n.t('Docker is ready'),
        diagnosed: l10n.t('A specific problem was identified'),
        indeterminate: l10n.t('No clear answer'),
    };
}

function dockerEndpointKindValues(): Readonly<Record<DockerEndpointKind, string>> {
    return {
        unixSocket: l10n.t('Unix socket'),
        namedPipe: l10n.t('Windows named pipe'),
        tcp: l10n.t('TCP address'),
        ssh: l10n.t('SSH tunnel'),
        unknown: l10n.t('Could not be resolved'),
    };
}

/** How the endpoint the check dialled was chosen. */
function dockerEndpointSourceNotes(): Readonly<Record<DockerEndpointProbe['source'], string>> {
    return {
        dockerHostEnv: l10n.t('Taken from the DOCKER_HOST environment variable, which overrides everything else.'),
        dockerContextEnv: l10n.t('Taken from the DOCKER_CONTEXT environment variable.'),
        currentContext: l10n.t('Taken from the Docker context that is currently active.'),
        platformDefault: l10n.t('No override was set, so the default location for this platform was used.'),
    };
}

/** How the provider above was identified — strongest evidence first. */
function dockerProviderEvidenceNotes(): Readonly<Record<DockerProviderEvidence, string>> {
    return {
        liveDaemon: l10n.t('Read from the daemon that answered the check.'),
        activeContext: l10n.t('Inferred from the Docker context that is currently active.'),
        installedApplication: l10n.t('Inferred from the Docker application installed on this machine.'),
        rememberedProvider: l10n.t('Remembered from the last check on this machine that did reach a daemon.'),
        none: l10n.t('Nothing identified it: the check reached neither a daemon nor a usable context.'),
    };
}

function dockerHostEnvironmentValues(): Readonly<Record<DockerHostEnvironment, string>> {
    return {
        windows: l10n.t('Windows'),
        macos: l10n.t('macOS'),
        linux: l10n.t('Linux'),
        wsl: l10n.t('Windows Subsystem for Linux'),
        ssh: l10n.t('Remote SSH host'),
        devContainer: l10n.t('Dev container'),
        codespaces: l10n.t('GitHub Codespaces'),
        otherRemote: l10n.t('Remote extension host'),
        unsupported: l10n.t('Unsupported platform'),
    };
}

function dockerPermissionDetailValues(): Readonly<Record<DockerPermissionDetail, string>> {
    return {
        notInGroup: l10n.t('Your user is not a member of the docker group'),
        pendingSessionRestart: l10n.t('Your user is in the docker group, but this session predates the change'),
        unknown: l10n.t('Denied for a reason the check could not narrow down'),
    };
}

function dockerGuidance(): Readonly<Record<DockerGuidanceKey, string>> {
    return {
        installDocker: l10n.t('Install Docker Engine or Docker Desktop, then reopen DocumentDB Local setup.'),
        installDockerWindows: l10n.t(
            'Install Docker Desktop, then restart VS Code. A VS Code that was already running does not pick up the PATH the installer adds, so Docker stays undetected until it is restarted. Reloading the window is not enough. Start Docker Desktop and wait until it is ready, then check again.',
        ),
        installDockerMac: l10n.t(
            'Install Docker Desktop, then restart VS Code. A VS Code that was already running does not pick up the PATH the installer adds, so Docker stays undetected until it is restarted. Start Docker Desktop and wait until it is ready, then check again.',
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
    };
}

function executionTargetValues(): Readonly<Record<ReturnType<typeof getDockerExecutionTargetKey>, string>> {
    return {
        local: l10n.t('This machine (Docker)'),
        wsl: l10n.t('This WSL environment (Docker)'),
        ssh: l10n.t('Remote SSH host (Docker)'),
        devContainer: l10n.t('This dev container environment (Docker)'),
        codespaces: l10n.t('This Codespaces environment (Docker)'),
        otherRemote: l10n.t('This remote extension host (Docker)'),
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

/** Provider names for the stage detail line; an unidentified provider is still "Docker". */
function dockerDetailProviderLabels(): Readonly<Record<DockerProvider, string>> {
    return {
        dockerDesktop: l10n.t('Docker Desktop'),
        dockerEngine: l10n.t('Docker Engine'),
        unknown: l10n.t('Docker'),
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
        local: l10n.t('runs on this machine'),
        wsl: l10n.t('runs in this WSL environment'),
        ssh: l10n.t('runs on the remote SSH host'),
        devContainer: l10n.t('runs in this dev container'),
        codespaces: l10n.t('runs in this Codespace'),
        otherRemote: l10n.t('runs on the remote extension host'),
    };
}

function dockerDetailFailureLabels(): Readonly<Record<DockerDetailFailureKey, string>> {
    return {
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
}

function formatDockerDetailSegment(segment: DockerDetailSegment): string | undefined {
    switch (segment.kind) {
        case 'provider': {
            const name = dockerDetailProviderLabels()[segment.provider];
            return segment.version ? l10n.t('{0} {1}', name, segment.version) : name;
        }
        case 'cli':
            return segment.version ? l10n.t('Docker CLI {0} found', segment.version) : l10n.t('Docker CLI found');
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

interface DockerDetailRow {
    readonly label: string;
    readonly value: string;
    /** How the value above was established, or why it could not be. */
    readonly note?: string;
}

/**
 * Full report of the Docker readiness check, for the collapsed "What the Docker check found"
 * panel. Every fact carries how it was established, because the panel's job is to show the user
 * what was actually probed rather than to be scanned quickly.
 */
function buildDockerDetailRows(
    readiness: DockerReadiness,
    daemonState: DockerReadinessPresentationState,
    now: number,
): readonly DockerDetailRow[] {
    const rows: DockerDetailRow[] = [
        {
            label: l10n.t('Check result'),
            value: dockerOutcomeValues()[readiness.outcome],
            note:
                readiness.outcome === 'indeterminate'
                    ? l10n.t('Docker answered too vaguely to name a cause, so setup can still be attempted.')
                    : undefined,
        },
    ];

    if (readiness.outcome !== 'ready') {
        rows.push({
            label: l10n.t('Detected problem'),
            value: dockerFailureLabels()[readiness.failureKind ?? 'unknown'],
        });
    }

    rows.push({
        label: l10n.t('Docker CLI'),
        value: readiness.cliInstalled
            ? readiness.cliVersion
                ? l10n.t('Found, version {0}', readiness.cliVersion)
                : l10n.t('Found, version not reported')
            : l10n.t('Not found'),
        note: readiness.cliInstalled
            ? l10n.t('The docker command was located and run to read its version.')
            : l10n.t('The docker command is not on PATH, so no further probe could run.'),
    });

    rows.push({
        label: l10n.t('Docker daemon'),
        value: dockerDaemonValues()[daemonState],
        note: readiness.daemonReachable
            ? l10n.t('The daemon answered, so everything below was reported by Docker itself.')
            : l10n.t('The daemon did not answer, so anything only Docker can report is still unknown.'),
    });

    rows.push({
        label: l10n.t('Docker endpoint'),
        value: dockerEndpointKindValues()[readiness.endpointKind],
        note: readiness.endpointSource
            ? dockerEndpointSourceNotes()[readiness.endpointSource]
            : l10n.t('No endpoint could be resolved, so the check had nothing to dial.'),
    });

    if (readiness.permissionDetail) {
        rows.push({
            label: l10n.t('Socket access'),
            value: dockerPermissionDetailValues()[readiness.permissionDetail],
            note: l10n.t('Checked by comparing the Docker socket owner group against your user and this process.'),
        });
    }

    rows.push({
        label: l10n.t('Provider'),
        value: dockerProviderLabels()[readiness.provider],
        note: dockerProviderEvidenceNotes()[readiness.providerEvidence],
    });

    const daemonOs = readiness.osType ? dockerDetailOsLabels()[readiness.osType] : undefined;
    const daemonPlatform =
        daemonOs && readiness.daemonArchitecture
            ? l10n.t('{0} {1}', daemonOs, readiness.daemonArchitecture)
            : (daemonOs ?? readiness.daemonArchitecture);
    rows.push({
        label: l10n.t('Containers run on'),
        value: daemonPlatform ?? l10n.t('Not reported yet'),
        note: daemonPlatform
            ? l10n.t('The operating system and CPU architecture the daemon builds and runs containers for.')
            : l10n.t('Docker reports this only once a connection succeeds, so it stays unknown until then.'),
    });

    rows.push({
        label: l10n.t('This machine'),
        value: readiness.arch
            ? l10n.t('{0}, {1}', dockerHostEnvironmentValues()[readiness.environment], readiness.arch)
            : dockerHostEnvironmentValues()[readiness.environment],
        note:
            readiness.platformSupported === false
                ? l10n.t('DocumentDB Local images are published for x64 and arm64 only.')
                : l10n.t('Where VS Code is running the extension, detected before Docker was contacted.'),
    });

    rows.push({
        label: l10n.t('Container host'),
        value: executionTargetValues()[getDockerExecutionTargetKey(readiness.executionTarget)],
        note: l10n.t('The container is created here, so localhost refers to this environment.'),
    });

    rows.push({
        label: l10n.t('Check run'),
        value: formatLastChecked(readiness.checkedAtMs, now),
        note: readiness.diagnosticFingerprint
            ? l10n.t('Diagnostic reference {0}. Quote it when reporting this.', readiness.diagnosticFingerprint)
            : undefined,
    });

    return rows;
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
    /** Appended to the evidence line, e.g. when the evidence was gathered. */
    readonly meta?: string;
    /** Inline control on the evidence line, e.g. re-running just this stage's check. */
    readonly action?: ReactNode;
    /** Holds the evidence line's space from the first render, so the row never grows later. */
    readonly reserveDetail?: boolean;
}

const StageRow = ({ label, status, detail, meta, action, reserveDetail }: StageRowProps): JSX.Element => {
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

    const evidence = detail && meta ? l10n.t('{0} · {1}', detail, meta) : (detail ?? meta);
    const hasEvidence = Boolean(evidence || action);

    // The row is not aria-labelled: an inline action lives on the evidence line, and a row-level
    // label would leave it unreachable. The status is voiced by a visually-hidden span instead.
    return (
        <div className={styles.stageRow} role="listitem">
            <span className={styles.stageIcon}>{icon}</span>
            <div className={styles.stageCopy}>
                <Text className={status === 'pending' ? styles.muted : undefined}>
                    {label}
                    <span className={styles.srOnly}>{l10n.t(', {0}', statusText)}</span>
                </Text>
                {(hasEvidence || reserveDetail) && (
                    <Text size={200} className={styles.muted}>
                        {hasEvidence ? (
                            <>
                                {evidence}
                                {evidence && action ? ' · ' : ''}
                                {action}
                            </>
                        ) : (
                            <span aria-hidden>{'\u00a0'}</span>
                        )}
                    </Text>
                )}
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
    const [canReuseExistingData, setCanReuseExistingData] = useState(false);
    /**
     * Live state of the managed instance, backing the Configure step's guard (review §9.2 Q2).
     * Reaching the wizard while an instance exists should not normally be possible — the tree does
     * not link to it in that state — but the command palette, a stale panel and cross-window races
     * all still get here.
     */
    const [instanceState, setInstanceState] = useState<InstanceState | undefined>(undefined);
    /**
     * True when the container was removed outside VS Code. This is NOT a separate
     * {@link InstanceState}: the service reports such an instance as `Stopped` with `missing` set,
     * so a guard that reads only the state would offer "Start" for a container that no longer
     * exists — a button that cannot do anything.
     */
    const [instanceMissing, setInstanceMissing] = useState(false);
    /**
     * The user's explicit recreate-vs-fresh choice (review M4). Nothing is inferred from
     * {@link canReuseExistingData} any more, which is what resolves N1 (a stale inferred value).
     */
    const [dataChoice, setDataChoice] = useState<'reuse' | 'fresh'>('reuse');
    const [stageStatus, setStageStatus] = useState<Record<ProvisionStage, StageStatus>>(emptyStageStatus);
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

    // Settings (P1-4). The port and tag fields carry the real defaults rather than placeholder
    // text, so what the user sees in the box is what will be used. The port is seeded from the
    // host's suggestion (the first free port) as soon as the status query returns, and is then
    // ALWAYS sent explicitly — setup binds exactly this port and never relocates it (review L3).
    const [advPort, setAdvPort] = useState(String(QUICK_START_PORT));
    const [suggestedPort, setSuggestedPort] = useState(QUICK_START_PORT);
    const [portStatus, setPortStatus] = useState<PortAvailability | 'checking' | undefined>(undefined);
    const [advUser, setAdvUser] = useState('');
    const [advPass, setAdvPass] = useState('');
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

    // Validate the settings client-side, mirroring the router's zod schema so a valid form never
    // dead-ends on a server rejection. Returns the offending field (for a per-field error state,
    // a11y §3.3.1) plus the message. Credential/image checks are skipped while reusing an existing
    // instance, since those inputs are hidden and their values are ignored.
    // eslint-disable-next-line no-control-regex
    const credForbidden = /[\u0000-\u001f\u007f]/;
    const advValidation = (():
        | { field: 'port' | 'credentials' | 'username' | 'password' | 'tag'; message: string }
        | undefined => {
        const port = advPort.trim();
        if (port && (!/^\d+$/.test(port) || Number(port) < 1024 || Number(port) > 65535)) {
            return { field: 'port', message: l10n.t('Port must be a whole number between 1024 and 65535.') };
        }
        if (portStatus === 'inUse') {
            return {
                field: 'port',
                message: l10n.t('Port {0} is already in use. Pick a different one.', port),
            };
        }
        if (portStatus === 'takenByAnotherInstance') {
            return {
                field: 'port',
                message: l10n.t('Port {0} belongs to another DocumentDB Local instance. Pick a different one.', port),
            };
        }
        if (!isRecreate) {
            const user = advUser.trim();
            const pass = advPass.trim();
            const hasUser = user.length > 0;
            const hasPass = pass.length > 0;
            if (useCustomCredentials && hasUser !== hasPass) {
                return {
                    field: 'credentials',
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
        // The port is ALWAYS sent (review L3): the field already holds the port the user was shown
        // and validated against, and the service binds exactly that one rather than relocating on
        // a conflict. Comparing against the default here used to make an explicitly-typed 10260
        // silently mean "pick something for me".
        if (advPort.trim()) opts.port = Number(advPort.trim());
        // Credentials and image tag are ignored by the service when reusing an existing
        // instance, so don't send them (the fields are hidden in that case anyway). Send the
        // trimmed credentials so what we transmit is exactly what the service stores/encodes.
        if (!isRecreate) {
            if (useCustomCredentials && advUser.trim()) opts.username = advUser.trim();
            if (useCustomCredentials && advPass.trim()) opts.password = advPass.trim();
            if (advTag.trim() && advTag.trim() !== QUICK_START_DEFAULT_TAG) opts.imageTag = advTag.trim();
        }
        if (!advLoadSampleData) opts.loadSampleData = false;
        // The recreate-vs-fresh decision is sent EXPLICITLY (review M4): the service no longer
        // infers it from the presence of stored credentials, so nothing can go stale between the
        // choice the user was shown and the volume the provision drops.
        if (startFresh) opts.startFresh = true;
        advancedRef.current = Object.keys(opts).length > 0 ? opts : undefined;
    }, [advPort, advUser, advPass, advTag, advLoadSampleData, advError, isRecreate, useCustomCredentials, startFresh]);

    // Built during render, after `l10n.config()` has run, so these ARE translated. Memoized because
    // the maps are rebuilt on every call by design (see the note on the lookup functions above).
    const stageLabelsMap = useMemo(() => stageLabels(), []);
    const planItemList = useMemo(() => planItems(), []);
    const dockerFailureLabelMap = useMemo(() => dockerFailureLabels(), []);
    const dockerGuidanceMap = useMemo(() => dockerGuidance(), []);
    const dockerGuideMap = useMemo(() => dockerGuides(), []);
    const dockerStartLabelMap = useMemo(() => dockerStartLabels(), []);
    const dockerRecoveryNoteMap = useMemo(() => dockerRecoveryNotes(), []);

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

    const scrollAreaRef = useRef<HTMLDivElement>(null);
    const [footerElevated, setFooterElevated] = useState(false);
    // The footer takes a border and shadow only while the scroll area still has content below the
    // fold, so a short step does not get a divider that separates nothing.
    const updateFooterLayout = useCallback((): void => {
        const scrollArea = scrollAreaRef.current;
        if (scrollArea) {
            setFooterElevated(scrollArea.scrollTop + scrollArea.clientHeight < scrollArea.scrollHeight - 1);
        }
    }, []);
    useEffect(() => {
        const scrollArea = scrollAreaRef.current;
        const content = contentRef.current;
        if (!scrollArea || !content) {
            return;
        }
        // The scroll area resizes when the footer does, so watching it and the content is enough.
        const observer = new ResizeObserver(updateFooterLayout);
        observer.observe(scrollArea);
        observer.observe(content);
        return () => observer.disconnect();
    }, [updateFooterLayout, phase]);

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
                setCanReuseExistingData(result.canReuseExistingData);
                setInstanceState(result.status.state);
                setInstanceMissing(result.status.missing === true);
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
                        setSuccessMessage(event.message && formatQuickStartMessage(event.message));
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
                        setCanReuseExistingData(result.canReuseExistingData);
                        setInstanceState(result.status.state);
                        setInstanceMissing(result.status.missing === true);
                    },
                });
                if (abortController.signal.aborted) return;
                stopDockerWait();
                if (outcome === 'ready' && latestResult) {
                    applyDockerRecovery();
                } else if (outcome === 'deadline') {
                    setDockerActionMessage(l10n.t('Docker did not become ready before the wait timed out.'));
                } else if (outcome === 'stopped') {
                    // Docker answered, but with a non-transient problem (e.g. permission denied). The
                    // readiness card below already updated via onResult; announce the transition too,
                    // otherwise the spinner just disappears and the Announcer says nothing.
                    setDockerActionMessage(l10n.t('Docker started, but it is not usable yet. See the details below.'));
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
        // Keep the instance facts live for as long as the panel is open (review N1). Reading them
        // once on mount left the Configure guard describing an instance that a tree action, another
        // window, or a `docker rm` in a terminal had already changed underneath it.
        const subscription = trpcClient.localQuickStart.onInstanceChanged.subscribe(undefined, {
            onData(update: InstanceStatusUpdate) {
                setInstanceState(update.status.state);
                setInstanceMissing(update.status.missing === true);
                setCanReuseExistingData(update.canReuseExistingData);
            },
            onError() {
                // The mount-time query already seeded these; a dropped stream only stops updates.
            },
        });
        return () => subscription.unsubscribe();
    }, [trpcClient]);

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

    // Validate the port's availability HERE, while the user can still react, rather than letting
    // setup fail on a Docker bind error minutes later (review L3). Debounced so typing a port digit
    // by digit doesn't issue a probe per keystroke.
    useEffect(() => {
        const port = advPort.trim();
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
    }, [advPort, trpcClient]);

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
    // Held so the block keeps its content while it collapses away, instead of blanking first and
    // then closing an empty gap.
    if (dockerProblem && dockerPresentation) {
        lastDockerProblemRef.current = { problem: dockerProblem, presentation: dockerPresentation };
    }
    const shownDocker = lastDockerProblemRef.current;
    const dockerPresentationState = startingDocker ? 'starting' : (shownDocker?.presentation.state ?? 'notAccessible');
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
    const provisioningStatusMessage = activeStage && !failedStage ? l10n.t('{0}…', stageLabelsMap[activeStage]) : '';

    const effectivePort = advPort.trim() && advValidation?.field !== 'port' ? advPort.trim() : String(suggestedPort);
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
        // "Introduction" opens pre-satisfied — there is nothing on it to complete — so it carries a
        // check from the start, mirroring the Atlas view's first step.
        isCompleted:
            entry.id === 'introduction' ||
            index < currentStepIndex ||
            (entry.id === 'done' && index === currentStepIndex),
        canNavigate: index < currentStepIndex && !stepsLocked,
    }));

    // ---- pages ----------------------------------------------------------------------------

    const introduction = (
        <section className={styles.section} aria-labelledby="quickstart-introduction-heading">
            <div className={styles.sectionHeader}>
                <Text id="quickstart-introduction-heading" as="h2" size={500} weight="semibold">
                    {l10n.t('Develop and test locally')}
                </Text>
                <Text className={styles.muted}>
                    {/* Approved product copy, taken verbatim from documentdb.io — exempt from the
                        repo's "never MongoDB as a bare product name" terminology rule. Do not sweep. */}
                    {l10n.t(
                        'DocumentDB Local gives you an open-source, fully MongoDB-compatible database for development and testing on your machine.',
                    )}
                </Text>
            </div>
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
        </section>
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
                    validationState={advValidation?.field === 'port' ? 'error' : 'none'}
                    validationMessage={advValidation?.field === 'port' ? advValidation.message : undefined}
                >
                    <Input
                        type="number"
                        value={advPort}
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
                    validationState={advValidation?.field === 'tag' ? 'error' : 'none'}
                    validationMessage={advValidation?.field === 'tag' ? advValidation.message : undefined}
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
                        validationState={advValidation?.field === 'username' ? 'error' : 'none'}
                        validationMessage={advValidation?.field === 'username' ? advValidation.message : undefined}
                    >
                        <Input
                            value={advUser}
                            maxLength={128}
                            placeholder={l10n.t('Enter a username')}
                            aria-invalid={advValidation?.field === 'credentials' || undefined}
                            aria-describedby={
                                advValidation?.field === 'credentials' ? 'quickstart-credentials-error' : undefined
                            }
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
                            aria-invalid={advValidation?.field === 'credentials' || undefined}
                            aria-describedby={
                                advValidation?.field === 'credentials' ? 'quickstart-credentials-error' : undefined
                            }
                            onChange={(_event, data) => setAdvPass(data.value)}
                        />
                    </Field>
                    {advValidation?.field === 'credentials' && (
                        <Text
                            id="quickstart-credentials-error"
                            role="alert"
                            size={200}
                            className={styles.credentialsValidation}
                        >
                            <ErrorCircleFilled aria-hidden />
                            {advValidation.message}
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
        <MessageBar intent={existingInstanceGuard === 'credentialsMissing' ? 'warning' : 'info'} layout="multiline">
            <MessageBarBody className={styles.titleAndMessageBarBody}>
                {existingInstanceGuard === 'healthy' ? (
                    <>
                        <MessageBarTitle>{l10n.t('DocumentDB Local is already running')}</MessageBarTitle>
                        {l10n.t('There is nothing to set up. Open the connection to start using it.')}
                    </>
                ) : existingInstanceGuard === 'stopped' ? (
                    <>
                        <MessageBarTitle>{l10n.t('DocumentDB Local is already set up')}</MessageBarTitle>
                        {l10n.t('It is stopped. Start it to use it again, with all your data.')}
                    </>
                ) : (
                    <>
                        <MessageBarTitle>{l10n.t('DocumentDB Local needs attention')}</MessageBarTitle>
                        {l10n.t(
                            'We found an existing DocumentDB Local instance, but its saved credentials are unavailable. Without them, we cannot reopen or reuse the existing data, so you need to start fresh. Nothing has been changed yet. Starting fresh deletes the existing container and its data, then creates a new instance.',
                        )}
                    </>
                )}
            </MessageBarBody>
            <MessageBarActions>
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
            </MessageBarActions>
        </MessageBar>
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
        <MessageBar intent="info" layout="multiline">
            <MessageBarBody className={styles.stackedMessageBarBody}>
                {instanceMissing && (
                    <div>
                        {l10n.t(
                            'The DocumentDB Local container was removed outside VS Code. Its data is still on this machine, and setting up creates the container again.',
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
            </MessageBarBody>
        </MessageBar>
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
            {existingInstanceNotice}
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
        </section>
    );

    // The wrapper is unconditional: a Collapse that mounts already visible skips its enter
    // motion, so it has to exist (hidden) before the failure arrives.
    const dockerStatusBlock = (
        <div className={styles.dockerStatus}>
            {shownDocker && (
                <>
                    <MessageBar intent="error" layout="multiline" icon={<ErrorCircleFilled />}>
                        <MessageBarBody className={styles.stackedMessageBarBody}>
                            <div>
                                <MessageBarTitle>
                                    {dockerFailureLabelMap[shownDocker.problem.failureKind ?? 'unknown']}
                                </MessageBarTitle>{' '}
                                {
                                    dockerGuidanceMap[
                                        startingDocker
                                            ? 'daemonStarting'
                                            : (shownDocker.presentation.guidance ?? 'notAccessible')
                                    ]
                                }
                            </div>
                            {recoveryCommand && (
                                <div className={styles.recoveryCommand}>
                                    {/* Copy sits in the block it copies, where the command is being read. */}
                                    <div className={styles.recoveryCommandBlock}>
                                        <code className={styles.recoveryCommandLine}>
                                            {recoveryCommand.commandLine}
                                        </code>
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
                        </MessageBarBody>
                        <MessageBarActions>
                            {shownDocker.presentation.showInstall && (
                                // Route the install CTA through the guide the host resolved for
                                // THIS platform. It used to hardcode the Docker Engine page, so
                                // Windows and macOS users were sent to a Linux-only install (#856).
                                <Button
                                    appearance="secondary"
                                    onClick={() => handleOpenGuide(dockerGuides()[shownDocker.presentation.guide].href)}
                                >
                                    {dockerGuides()[shownDocker.presentation.guide].label}
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
                                    onClick={() => handleOpenGuide(dockerGuideMap[shownDocker.presentation.guide].href)}
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
                        </MessageBarActions>
                    </MessageBar>
                    <Accordion collapsible>
                        <AccordionItem value="docker-details">
                            <AccordionHeader className={styles.dockerAccordionHeader}>
                                <Text weight="semibold" className={styles.accordionHeaderBrand}>
                                    {l10n.t('What the Docker check found')}
                                </Text>
                            </AccordionHeader>
                            <AccordionPanel className={styles.dockerAccordionPanel}>
                                <Text size={200} className={styles.dockerDetailsIntro}>
                                    {l10n.t(
                                        'Everything the readiness check established, in the order it was established.',
                                    )}
                                </Text>
                                <dl className={styles.dockerDetails}>
                                    {buildDockerDetailRows(
                                        shownDocker.problem,
                                        dockerPresentationState,
                                        relativeTimeNow,
                                    ).map((row) => (
                                        <Fragment key={row.label}>
                                            <dt className={styles.dockerDetailLabel}>{row.label}</dt>
                                            <dd className={styles.dockerDetailValue}>
                                                <span>{row.value}</span>
                                                {row.note && (
                                                    <Text size={200} className={styles.dockerDetailNote}>
                                                        {row.note}
                                                    </Text>
                                                )}
                                            </dd>
                                        </Fragment>
                                    ))}
                                </dl>
                            </AccordionPanel>
                        </AccordionItem>
                    </Accordion>
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
          ? l10n.t('Docker is ready now. Nothing has been created on your machine yet.')
          : checkStageFailed
            ? l10n.t('Setup stopped at the first stage. Nothing was created on your machine.')
            : undefined;

    // The Docker-only re-check lives on the stage that owns the check, so its scope is unambiguous
    // next to the footer's full-run Retry. It shares the evidence line, and so its type scale.
    const stageActionFor = (stage: ProvisionStage): ReactNode => {
        if (stage !== 'checking' || !dockerProblem || !dockerPresentation?.showRetry || startingDocker) {
            return undefined;
        }
        if (checkingDockerAgain) {
            return (
                <Spinner
                    size="extra-tiny"
                    className={styles.stageInlineSpinner}
                    labelPosition="after"
                    label={l10n.t('Checking…')}
                />
            );
        }
        return (
            <Link className={styles.stageInlineLink} onClick={handleCheckDockerAgain}>
                {l10n.t('Check Docker again')}
            </Link>
        );
    };

    // When the evidence was gathered belongs next to the evidence, not at the foot of the block.
    const stageMetaFor = (stage: ProvisionStage): string | undefined =>
        stage === 'checking' && dockerProblem
            ? formatLastChecked(dockerProblem.checkedAtMs, relativeTimeNow)
            : undefined;

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
                        label={stageLabelsMap[stage]}
                        status={stageStatus[stage]}
                        detail={stageDetailFor(stage)}
                        meta={stageMetaFor(stage)}
                        action={stageActionFor(stage)}
                        reserveDetail={stage === 'checking'}
                    />
                ))}
            </div>
            {/* Everything below arrives while the step is already on screen, so it expands into
                place. None of these carry `appear`: a state restored at mount renders instantly. */}
            <Collapse visible={checkReadiness?.platformSupported === false} unmountOnExit>
                <div>
                    <MessageBar intent="warning" icon={<WarningRegular />}>
                        <MessageBarBody>
                            {l10n.t('DocumentDB Local images are published for x64 and arm64 only.')}
                        </MessageBarBody>
                    </MessageBar>
                </div>
            </Collapse>
            {/* Only when a later failure still stands: otherwise the heading already says it. */}
            <Collapse visible={dockerRecovered && !canContinueSetup} unmountOnExit>
                <div>
                    <MessageBar intent="success" layout="multiline">
                        <MessageBarBody className={styles.titleAndMessageBarBody}>
                            <MessageBarTitle>{l10n.t('Docker is ready')}</MessageBarTitle>
                            {l10n.t('The earlier failure is still shown below.')}
                        </MessageBarBody>
                    </MessageBar>
                </div>
            </Collapse>
            <Collapse visible={phase === 'failed' && !dockerProblem && !canContinueSetup} unmountOnExit>
                <div>
                    <MessageBar
                        intent={timedOut ? 'warning' : 'error'}
                        layout="multiline"
                        icon={timedOut ? <WarningRegular /> : <ErrorCircleFilled />}
                    >
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
                                {l10n.t('View setup log')}
                            </Button>
                        </MessageBarActions>
                    </MessageBar>
                </div>
            </Collapse>
            <Collapse visible={dockerProblem !== undefined} unmountOnExit>
                {dockerStatusBlock}
            </Collapse>{' '}
            {isProvisioning && <Link onClick={handleViewOutput}>{l10n.t('View setup log')}</Link>}
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
                        label={stageLabelsMap[stage]}
                        status="done"
                        detail={stage === 'checking' ? checkStageDetail : undefined}
                        reserveDetail={stage === 'checking'}
                    />
                ))}
            </div>
            <MessageBar intent="success" layout="multiline">
                <MessageBarBody className={styles.titleAndMessageBarBody}>
                    <MessageBarTitle>{l10n.t('All set')}</MessageBarTitle>
                    {l10n.t('The instance is ready in the Connections view as “DocumentDB Local”.')}
                </MessageBarBody>
            </MessageBar>
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
        footerNote = l10n.t(
            'Nothing is downloaded or created on your machine until you choose to start in the Configure step.',
        );
        secondaryActions = (
            <Button appearance="secondary" onClick={handleClose}>
                {l10n.t('Cancel')}
            </Button>
        );
    } else if (phase === 'configure') {
        // The label stays fixed; the note below it is what follows the choice. "Nothing else on your
        // machine is changed" is true only for a genuinely fresh install and must not render for
        // either recreate path (review M4 / §10.6).
        primaryLabel = forcedFresh ? l10n.t('Start fresh') : l10n.t('Start DocumentDB Local');
        primaryDisabled = advError !== undefined || startBlockedByGuard;
        primaryIcon = <RocketRegular />;
        onPrimary = handleStart;
        footerNote = isRecreate
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
        secondaryActions = (
            <Button appearance="secondary" onClick={() => setPhase('introduction')}>
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
            <Button appearance="secondary" onClick={handleBackToConfigure}>
                {l10n.t('Back')}
            </Button>
        );
    } else {
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
    }

    return (
        <main className={styles.root}>
            <div className={styles.scrollArea} ref={scrollAreaRef} onScroll={updateFooterLayout}>
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
                    <WizardBreadcrumb
                        steps={stepItems}
                        ariaLabel={l10n.t('Setup steps')}
                        onNavigate={goToStep}
                        overflowAriaLabel={(count) => l10n.t('{0} more steps', String(count))}
                    />
                    {phase === 'introduction' && introduction}
                    {phase === 'configure' && configure}
                    {(isProvisioning || phase === 'failed') && setup}
                    {phase === 'success' && done}
                </div>
            </div>
            <div className={mergeClasses(styles.footer, footerElevated && styles.footerElevated)}>
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
                    <Button
                        appearance="secondary"
                        className={styles.footerLearnMore}
                        onClick={() => handleOpenGuide(DOCUMENTDB_LOCAL_LEARN_MORE_URL)}
                    >
                        {l10n.t('Learn more')}
                    </Button>
                </div>
            </div>
        </main>
    );
};
