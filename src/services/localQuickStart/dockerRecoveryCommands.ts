/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    type DockerEndpointKind,
    type DockerFailureKind,
    type DockerHostEnvironment,
    type DockerPermissionDetail,
    type DockerRecoveryCommand,
    type DockerServiceManager,
} from './quickStartTypes';

const RECOVERY_COMMANDS: Readonly<Record<DockerRecoveryCommand['id'], DockerRecoveryCommand>> = {
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
};

export function getDockerRecoveryCommandById(id: DockerRecoveryCommand['id']): DockerRecoveryCommand {
    return RECOVERY_COMMANDS[id];
}

export function getDockerRecoveryCommand(
    failureKind: DockerFailureKind,
    environment: DockerHostEnvironment,
    endpointKind: DockerEndpointKind,
    permissionDetail: DockerPermissionDetail = 'unknown',
    serviceManager: DockerServiceManager = 'unknown',
): DockerRecoveryCommand | undefined {
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
