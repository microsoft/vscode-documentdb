/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getDockerRecoveryCommand } from './dockerRecoveryCommands';

describe('getDockerRecoveryCommand', () => {
    it.each([
        ['permissionDenied', 'linux', 'notInGroup', 'unknown', 'linuxDockerGroup'],
        ['permissionDenied', 'wsl', 'unknown', 'unknown', 'linuxDockerGroup'],
        ['permissionDenied', 'wsl', 'pendingSessionRestart', 'unknown', 'wslRestartFromWindows'],
        ['permissionDenied', 'linux', 'pendingSessionRestart', 'unknown', undefined],
        ['daemonUnavailable', 'linux', 'unknown', 'unknown', 'linuxStartService'],
        ['daemonUnavailable', 'wsl', 'unknown', 'systemd', 'linuxStartService'],
        ['daemonUnavailable', 'wsl', 'unknown', 'service', 'wslStartServiceNoSystemd'],
        ['daemonUnavailable', 'wsl', 'unknown', 'unknown', undefined],
    ] as const)(
        'selects %s for %s, %s, and %s',
        (failureKind, environment, permissionDetail, serviceManager, expectedId) => {
            expect(
                getDockerRecoveryCommand(failureKind, environment, 'unixSocket', permissionDetail, serviceManager)?.id,
            ).toBe(expectedId);
        },
    );
});
