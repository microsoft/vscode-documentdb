/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type DockerFailureKind, type DockerReadiness } from '../../../services/localQuickStart/quickStartTypes';

export type DockerReadinessPresentationState =
    | 'ready'
    | 'cliMissing'
    | 'accessDenied'
    | 'notRunning'
    | 'checkTimedOut'
    | 'notAccessible';

export interface DockerReadinessPresentation {
    readonly state: DockerReadinessPresentationState;
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
        case 'unknown':
        case undefined:
            return 'notAccessible';
        default:
            return assertNever(failureKind);
    }
}

export function getDockerReadinessPresentation(readiness: DockerReadiness): DockerReadinessPresentation {
    const ready = readiness.outcome === 'ready' && readiness.cliInstalled && readiness.daemonReachable;
    if (ready) {
        return {
            state: 'ready',
            showInstall: false,
            showStartDockerDesktop: false,
            showCopyCommand: false,
            showContinueAnyway: false,
            showRetry: false,
            showRefresh: true,
            showViewOutput: false,
        };
    }

    const state = getPresentationState(readiness.failureKind);
    const isLocalDesktopHost = readiness.environment === 'windows' || readiness.environment === 'macos';
    return {
        state,
        showInstall: state === 'cliMissing',
        showStartDockerDesktop: readiness.cliInstalled && isLocalDesktopHost,
        showCopyCommand: readiness.recoveryCommand !== undefined,
        showContinueAnyway: readiness.outcome === 'indeterminate' && readiness.canContinueAnyway,
        showRetry: true,
        showRefresh: true,
        showViewOutput: true,
    };
}
