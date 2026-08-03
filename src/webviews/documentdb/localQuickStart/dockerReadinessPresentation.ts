/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    type DockerExecutionTarget,
    type DockerFailureKind,
    type DockerReadiness,
    type DockerStartAction,
} from '../../../services/localQuickStart/quickStartTypes';

export type DockerReadinessPresentationState =
    | 'ready'
    | 'cliMissing'
    | 'accessDenied'
    | 'accessDeniedPendingRestart'
    | 'dockerDesktopNotRunning'
    | 'notRunning'
    | 'starting'
    | 'notAccessibleFromWsl'
    | 'endpointUnreachable'
    | 'contextUnavailable'
    | 'checkTimedOut'
    | 'unsupported'
    | 'windowsContainers'
    | 'notAccessible';

export type DockerGuidanceKey =
    | 'installDocker'
    | 'accessDeniedLinux'
    | 'accessDeniedWsl'
    | 'accessDeniedRemote'
    | 'pendingRestartLinux'
    | 'pendingRestartWsl'
    | 'pendingRestartSsh'
    | 'pendingRestartContainer'
    | 'dockerDesktopNotRunning'
    | 'daemonNotRunning'
    | 'daemonStarting'
    | 'wslIntegrationUnavailable'
    | 'remoteDockerUnavailable'
    | 'endpointUnreachable'
    | 'contextUnavailable'
    | 'checkTimedOut'
    | 'unsupportedHost'
    | 'windowsContainers'
    | 'notAccessible';

export type DockerRecoveryNoteKey = 'groupMembershipNewSession' | 'restartWslDistribution' | 'runsDockerService';

export type DockerGuideKey =
    | 'install'
    | 'linuxPostInstall'
    | 'dockerTroubleshooting'
    | 'dockerContexts'
    | 'wslIntegration'
    | 'remoteDocker'
    | 'linuxContainers'
    | 'learnMore';

export type DockerStartLabelKey = 'startDockerDesktop' | 'startDocker';

export type DockerExecutionTargetKey = 'local' | 'wsl' | 'ssh' | 'devContainer' | 'codespaces' | 'otherRemote';

export interface DockerReadinessPresentation {
    readonly state: DockerReadinessPresentationState;
    readonly guidance?: DockerGuidanceKey;
    readonly recoveryNote?: DockerRecoveryNoteKey;
    readonly guide: DockerGuideKey;
    readonly startLabel?: DockerStartLabelKey;
    readonly showInstall: boolean;
    readonly showStartDockerProvider: boolean;
    readonly showCopyCommand: boolean;
    readonly showContinueAnyway: boolean;
    readonly showRetry: boolean;
    readonly showRefresh: true;
    readonly showViewOutput: boolean;
}

function assertNever(value: never): never {
    throw new Error(`Unexpected Docker failure kind: ${String(value)}`);
}

function getPresentationState(failureKind: DockerFailureKind | undefined): DockerReadinessPresentationState {
    switch (failureKind) {
        case 'cliMissing':
            return 'cliMissing';
        case 'permissionDenied':
            return 'accessDenied';
        case 'daemonUnavailable':
            return 'notRunning';
        case 'daemonStarting':
            return 'starting';
        case 'contextUnavailable':
            return 'contextUnavailable';
        case 'endpointUnreachable':
            return 'endpointUnreachable';
        case 'probeTimedOut':
            return 'checkTimedOut';
        case 'unsupportedHost':
            return 'unsupported';
        case 'windowsContainers':
            return 'windowsContainers';
        case 'unknown':
        case undefined:
            return 'notAccessible';
        default:
            return assertNever(failureKind);
    }
}

function isRemoteEnvironment(readiness: DockerReadiness): boolean {
    return (
        readiness.environment === 'ssh' ||
        readiness.environment === 'devContainer' ||
        readiness.environment === 'codespaces' ||
        readiness.environment === 'otherRemote'
    );
}

export function isDockerArchitectureCompatible(readiness: DockerReadiness): boolean {
    if (readiness.platformSupported === false) {
        return false;
    }
    if (!readiness.arch || !readiness.daemonArchitecture) {
        return true;
    }
    const hostArchitecture = readiness.arch === 'x64' ? 'amd64' : readiness.arch;
    return hostArchitecture === readiness.daemonArchitecture;
}

function refineUnavailableState(
    state: DockerReadinessPresentationState,
    readiness: DockerReadiness,
): DockerReadinessPresentationState {
    if (state !== 'notRunning') {
        return state;
    }
    if (readiness.environment === 'wsl' && readiness.provider === 'dockerDesktop' && !readiness.startAction) {
        return 'notAccessibleFromWsl';
    }
    if (readiness.provider === 'dockerDesktop' && readiness.providerEvidence !== 'installedApplication') {
        return 'dockerDesktopNotRunning';
    }
    return state;
}

function getPermissionGuidance(readiness: DockerReadiness): DockerGuidanceKey {
    if (readiness.permissionDetail === 'pendingSessionRestart') {
        switch (readiness.environment) {
            case 'linux':
                return 'pendingRestartLinux';
            case 'wsl':
                return 'pendingRestartWsl';
            case 'ssh':
                return 'pendingRestartSsh';
            case 'devContainer':
            case 'codespaces':
                return 'pendingRestartContainer';
            case 'otherRemote':
            case 'windows':
            case 'macos':
            case 'unsupported':
                return 'accessDeniedRemote';
        }
    }

    switch (readiness.environment) {
        case 'linux':
            return 'accessDeniedLinux';
        case 'wsl':
            return 'accessDeniedWsl';
        case 'ssh':
        case 'devContainer':
        case 'codespaces':
        case 'otherRemote':
        case 'windows':
        case 'macos':
        case 'unsupported':
            return 'accessDeniedRemote';
    }
}

function getGuidance(readiness: DockerReadiness): DockerGuidanceKey {
    const failureKind = readiness.failureKind;
    switch (failureKind) {
        case 'cliMissing':
            return 'installDocker';
        case 'permissionDenied':
            return getPermissionGuidance(readiness);
        case 'daemonUnavailable':
            if (readiness.environment === 'wsl' && readiness.provider === 'dockerDesktop' && !readiness.startAction) {
                return 'wslIntegrationUnavailable';
            }
            if (isRemoteEnvironment(readiness)) {
                return 'remoteDockerUnavailable';
            }
            if (readiness.provider === 'dockerDesktop' && readiness.providerEvidence !== 'installedApplication') {
                return 'dockerDesktopNotRunning';
            }
            return 'daemonNotRunning';
        case 'daemonStarting':
            return 'daemonStarting';
        case 'contextUnavailable':
            return 'contextUnavailable';
        case 'endpointUnreachable':
            return 'endpointUnreachable';
        case 'probeTimedOut':
            return 'checkTimedOut';
        case 'unsupportedHost':
            return 'unsupportedHost';
        case 'windowsContainers':
            return 'windowsContainers';
        case 'unknown':
        case undefined:
            return 'notAccessible';
        default:
            return assertNever(failureKind);
    }
}

function getGuide(readiness: DockerReadiness): DockerGuideKey {
    const failureKind = readiness.failureKind;
    switch (failureKind) {
        case 'cliMissing':
            return 'install';
        case 'permissionDenied':
            return 'linuxPostInstall';
        case 'contextUnavailable':
            return 'dockerContexts';
        case 'endpointUnreachable':
            return 'dockerTroubleshooting';
        case 'daemonUnavailable':
            if (readiness.environment === 'wsl' && readiness.provider === 'dockerDesktop' && !readiness.startAction) {
                return 'wslIntegration';
            }
            return isRemoteEnvironment(readiness) ? 'remoteDocker' : 'dockerTroubleshooting';
        case 'windowsContainers':
            return 'linuxContainers';
        case 'unsupportedHost':
            return 'learnMore';
        case 'daemonStarting':
        case 'probeTimedOut':
        case 'unknown':
        case undefined:
            return 'dockerTroubleshooting';
        default:
            return assertNever(failureKind);
    }
}

function getStartLabel(startAction: DockerStartAction | undefined): DockerStartLabelKey | undefined {
    switch (startAction) {
        case 'startRootlessDockerEngineLinux':
            return 'startDocker';
        case 'startDockerDesktopWindows':
        case 'startDockerDesktopMacOS':
        case 'startDockerDesktopLinux':
        case 'startDockerDesktopWindowsFromWsl':
            return 'startDockerDesktop';
        case undefined:
            return undefined;
    }
}

export function getDockerExecutionTargetKey(target: DockerExecutionTarget): DockerExecutionTargetKey {
    switch (target) {
        case 'local':
            return 'local';
        case 'wsl':
            return 'wsl';
        case 'ssh':
            return 'ssh';
        case 'devContainer':
            return 'devContainer';
        case 'codespaces':
            return 'codespaces';
        case 'otherRemote':
            return 'otherRemote';
    }
}

export function getDockerLastCheckedAtMs(readiness: DockerReadiness): number {
    if (readiness.providerEvidence === 'rememberedProvider' && readiness.providerRecordedAtMs !== undefined) {
        return readiness.providerRecordedAtMs;
    }
    return readiness.checkedAtMs;
}

function getRecoveryNote(readiness: DockerReadiness): DockerRecoveryNoteKey | undefined {
    switch (readiness.recoveryCommand?.id) {
        case 'linuxDockerGroup':
            return 'groupMembershipNewSession';
        case 'wslRestartFromWindows':
            return 'restartWslDistribution';
        case 'linuxStartService':
        case 'wslStartServiceNoSystemd':
            return 'runsDockerService';
        case undefined:
            return undefined;
    }
}

export function getDockerReadinessPresentation(readiness: DockerReadiness): DockerReadinessPresentation {
    const ready = readiness.outcome === 'ready' && readiness.cliInstalled && readiness.daemonReachable;
    if (ready) {
        return {
            state: 'ready',
            guidance: undefined,
            recoveryNote: undefined,
            guide: 'dockerTroubleshooting',
            startLabel: undefined,
            showInstall: false,
            showStartDockerProvider: false,
            showCopyCommand: false,
            showContinueAnyway: false,
            showRetry: false,
            showRefresh: true,
            showViewOutput: false,
        };
    }

    const baseState = getPresentationState(readiness.failureKind);
    const permissionState =
        baseState === 'accessDenied' && readiness.permissionDetail === 'pendingSessionRestart'
            ? 'accessDeniedPendingRestart'
            : baseState;
    const state = refineUnavailableState(permissionState, readiness);
    const startLabel = getStartLabel(readiness.startAction);
    return {
        state,
        guidance: getGuidance(readiness),
        recoveryNote: getRecoveryNote(readiness),
        guide: getGuide(readiness),
        startLabel,
        showInstall: state === 'cliMissing',
        showStartDockerProvider: startLabel !== undefined,
        showCopyCommand: readiness.recoveryCommand !== undefined,
        showContinueAnyway: readiness.outcome === 'indeterminate' && readiness.canContinueAnyway,
        showRetry: readiness.failureKind !== 'unsupportedHost',
        showRefresh: true,
        showViewOutput: true,
    };
}
