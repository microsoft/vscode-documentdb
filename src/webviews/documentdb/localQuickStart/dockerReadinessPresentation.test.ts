/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type DockerReadiness } from '../../../services/localQuickStart/quickStartTypes';
import { getDockerReadinessPresentation } from './dockerReadinessPresentation';

function readiness(overrides: Partial<DockerReadiness> = {}): DockerReadiness {
    return {
        outcome: 'diagnosed',
        environment: 'linux',
        endpointKind: 'unixSocket',
        failureKind: 'daemonUnavailable',
        canContinueAnyway: false,
        checkedAtMs: 1,
        cliInstalled: true,
        daemonReachable: false,
        ...overrides,
    };
}

describe('getDockerReadinessPresentation', () => {
    it.each([
        ['permission denied', { failureKind: 'permissionDenied' as const }, 'accessDenied'],
        ['daemon unavailable', { failureKind: 'daemonUnavailable' as const }, 'notRunning'],
        [
            'probe timeout',
            { outcome: 'indeterminate' as const, failureKind: 'probeTimedOut' as const, canContinueAnyway: true },
            'checkTimedOut',
        ],
        [
            'unknown failure',
            { outcome: 'indeterminate' as const, failureKind: 'unknown' as const, canContinueAnyway: true },
            'notAccessible',
        ],
    ])('maps %s to %s', (_name, overrides, expectedState) => {
        expect(getDockerReadinessPresentation(readiness(overrides))).toMatchObject({
            state: expectedState,
            showRefresh: true,
            showRetry: true,
            showViewOutput: true,
        });
    });

    it('offers Continue anyway only for an indeterminate result', () => {
        expect(
            getDockerReadinessPresentation(
                readiness({ outcome: 'indeterminate', failureKind: 'unknown', canContinueAnyway: true }),
            ).showContinueAnyway,
        ).toBe(true);
        expect(
            getDockerReadinessPresentation(
                readiness({ outcome: 'diagnosed', failureKind: 'permissionDenied', canContinueAnyway: true }),
            ).showContinueAnyway,
        ).toBe(false);
    });

    it('offers a copy action only when the host returned a fixed recovery command', () => {
        expect(
            getDockerReadinessPresentation(
                readiness({
                    failureKind: 'permissionDenied',
                    recoveryCommand: {
                        id: 'linuxDockerGroup',
                        commandLine: 'sudo usermod -aG docker $USER',
                        requiresElevation: true,
                    },
                }),
            ).showCopyCommand,
        ).toBe(true);
    });

    it.each([
        ['windows', true],
        ['macos', true],
        ['linux', false],
        ['wsl', false],
        ['ssh', false],
    ] as const)('sets the legacy Desktop action for %s to %s', (environment, expected) => {
        expect(getDockerReadinessPresentation(readiness({ environment })).showStartDockerDesktop).toBe(expected);
    });

    it('returns refresh as the only readiness action when ready', () => {
        expect(
            getDockerReadinessPresentation(
                readiness({ outcome: 'ready', failureKind: undefined, daemonReachable: true }),
            ),
        ).toEqual({
            state: 'ready',
            showInstall: false,
            showStartDockerDesktop: false,
            showCopyCommand: false,
            showContinueAnyway: false,
            showRetry: false,
            showRefresh: true,
            showViewOutput: false,
        });
    });
});
