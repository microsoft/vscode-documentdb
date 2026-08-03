/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    type DockerEndpointKind,
    type DockerFailureKind,
    type DockerHostEnvironment,
    type DockerRecoveryCommand,
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
    wslRestartFromWindows: {
        id: 'wslRestartFromWindows',
        commandLine: 'wsl --shutdown',
        requiresElevation: false,
    },
};

export function getDockerRecoveryCommand(
    failureKind: DockerFailureKind,
    environment: DockerHostEnvironment,
    endpointKind: DockerEndpointKind,
): DockerRecoveryCommand | undefined {
    if (
        failureKind === 'permissionDenied' &&
        endpointKind === 'unixSocket' &&
        (environment === 'linux' || environment === 'wsl')
    ) {
        return RECOVERY_COMMANDS.linuxDockerGroup;
    }

    if (failureKind === 'daemonUnavailable' && endpointKind === 'unixSocket' && environment === 'linux') {
        return RECOVERY_COMMANDS.linuxStartService;
    }

    return undefined;
}