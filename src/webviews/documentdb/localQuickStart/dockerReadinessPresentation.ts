/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type DockerFailureKind, type DockerReadiness } from '../../../services/localQuickStart/quickStartTypes';

export type DockerReadinessPresentationState =
    | 'ready'
    | 'cliMissing'
    | 'accessDenied'
    | 'accessDeniedPendingRestart'
    | 'notRunning'
    | 'checkTimedOut'
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
    | 'daemonNotRunning'
    | 'checkTimedOut'
    | 'notAccessible';

export type DockerRecoveryNoteKey = 'groupMembershipNewSession' | 'restartWslDistribution' | 'runsDockerService';

export interface DockerReadinessPresentation {
    readonly state: DockerReadinessPresentationState;
    readonly guidance?: DockerGuidanceKey;
    readonly recoveryNote?: DockerRecoveryNoteKey;
    readonly showInstall: boolean;
    readonly showStartDockerDesktop: boolean;
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
        case 'probeTimedOut':
            return 'checkTimedOut';
        case 'daemonStarting':
        case 'contextUnavailable':
        case 'endpointUnreachable':
        case 'unsupportedHost':
        case 'windowsContainers':
        case 'unknown':
        case undefined:
            return 'notAccessible';
        default:
            return assertNever(failureKind);
    }
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
            return 'daemonNotRunning';
        case 'probeTimedOut':
            return 'checkTimedOut';
        case 'daemonStarting':
        case 'contextUnavailable':
        case 'endpointUnreachable':
        case 'unsupportedHost':
        case 'windowsContainers':
        case 'unknown':
        case undefined:
            return 'notAccessible';
        default:
            return assertNever(failureKind);
    }
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
            showInstall: false,
            showStartDockerDesktop: false,
            showCopyCommand: false,
            showContinueAnyway: false,
            showRetry: false,
            showRefresh: true,
            showViewOutput: false,
        };
    }

    const baseState = getPresentationState(readiness.failureKind);
    const state =
        baseState === 'accessDenied' && readiness.permissionDetail === 'pendingSessionRestart'
            ? 'accessDeniedPendingRestart'
            : baseState;
    const isLocalDesktopHost = readiness.environment === 'windows' || readiness.environment === 'macos';
    return {
        state,
        guidance: getGuidance(readiness),
        recoveryNote: getRecoveryNote(readiness),
        showInstall: state === 'cliMissing',
        showStartDockerDesktop: readiness.cliInstalled && isLocalDesktopHost,
        showCopyCommand: readiness.recoveryCommand !== undefined,
        showContinueAnyway: readiness.outcome === 'indeterminate' && readiness.canContinueAnyway,
        showRetry: true,
        showRefresh: true,
        showViewOutput: true,
    };
}
