/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { PODMAN_MACHINE_NAME } from './dockerReadinessClassification';
import {
    type DockerEndpointKind,
    type DockerFailureKind,
    type DockerHostEnvironment,
    type DockerPermissionDetail,
    type DockerRecoveryCommand,
    type DockerServiceManager,
    type PodmanMachineState,
    type PodmanTarget,
} from './quickStartTypes';

const RECOVERY_COMMANDS: Readonly<
    Record<Exclude<DockerRecoveryCommand['id'], 'podmanMachineStartOnWindows'>, DockerRecoveryCommand>
> = {
    linuxDockerGroup: {
        id: 'linuxDockerGroup',
        commandLine: 'sudo usermod -aG docker $USER',
        requiresElevation: true,
    },
    linuxStartService: {
        id: 'linuxStartService',
        commandLine: 'sudo systemctl start docker',
        requiresElevation: true,
    },
    wslStartServiceNoSystemd: {
        id: 'wslStartServiceNoSystemd',
        commandLine: 'sudo service docker start',
        requiresElevation: true,
    },
    wslRestartFromWindows: {
        id: 'wslRestartFromWindows',
        commandLine: 'wsl --shutdown',
        requiresElevation: false,
    },
    linuxStartPodmanSocket: {
        id: 'linuxStartPodmanSocket',
        commandLine: 'systemctl --user start podman.socket',
        requiresElevation: false,
    },
    podmanMachineInit: {
        id: 'podmanMachineInit',
        commandLine: 'podman machine init',
        requiresElevation: false,
    },
};

export function getDockerRecoveryCommandById(
    id: DockerRecoveryCommand['id'],
    machineName?: string,
): DockerRecoveryCommand {
    if (id === 'podmanMachineStartOnWindows') {
        if (!machineName || !PODMAN_MACHINE_NAME.test(machineName)) {
            throw new Error('Invalid recovery command machine name');
        }
        return {
            id,
            machineName,
            commandLine: `podman machine start ${machineName}`,
            requiresElevation: false,
        };
    }
    if (machineName !== undefined) {
        throw new Error('Invalid recovery command machine name');
    }
    return RECOVERY_COMMANDS[id];
}

export function getDockerRecoveryCommand(
    failureKind: DockerFailureKind,
    environment: DockerHostEnvironment,
    endpointKind: DockerEndpointKind,
    permissionDetail: DockerPermissionDetail = 'unknown',
    serviceManager: DockerServiceManager = 'unknown',
    podman?: { readonly machine?: PodmanMachineState; readonly target?: PodmanTarget },
): DockerRecoveryCommand | undefined {
    if (podman) {
        if (failureKind !== 'daemonUnavailable') {
            return undefined;
        }
        if (environment === 'linux' || environment === 'wsl') {
            if (podman.target?.kind === 'windowsMachineFromWsl') {
                return getDockerRecoveryCommandById('podmanMachineStartOnWindows', podman.target.name);
            }
            return podman.target?.kind === 'userSocket' ? RECOVERY_COMMANDS.linuxStartPodmanSocket : undefined;
        }
        if ((environment === 'macos' || environment === 'windows') && podman.machine?.kind === 'none') {
            return RECOVERY_COMMANDS.podmanMachineInit;
        }
        return undefined;
    }
    if (
        failureKind === 'permissionDenied' &&
        endpointKind === 'unixSocket' &&
        (permissionDetail === 'notInGroup' || permissionDetail === 'unknown') &&
        (environment === 'linux' || environment === 'wsl')
    ) {
        return RECOVERY_COMMANDS.linuxDockerGroup;
    }

    if (
        failureKind === 'permissionDenied' &&
        endpointKind === 'unixSocket' &&
        permissionDetail === 'pendingSessionRestart' &&
        environment === 'wsl'
    ) {
        return RECOVERY_COMMANDS.wslRestartFromWindows;
    }

    if (failureKind === 'daemonUnavailable' && endpointKind === 'unixSocket' && environment === 'linux') {
        return RECOVERY_COMMANDS.linuxStartService;
    }

    if (failureKind === 'daemonUnavailable' && endpointKind === 'unixSocket' && environment === 'wsl') {
        switch (serviceManager) {
            case 'systemd':
                return RECOVERY_COMMANDS.linuxStartService;
            case 'service':
                return RECOVERY_COMMANDS.wslStartServiceNoSystemd;
            case 'unknown':
                return undefined;
        }
    }

    return undefined;
}
