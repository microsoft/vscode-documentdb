/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';
import { classifyDockerFailure } from './dockerReadinessClassification';
import { type DockerEndpointProbe, type DockerProbeEvidence } from './quickStartTypes';

function readFixture(name: string): string {
    return fs.readFileSync(path.join(__dirname, '__fixtures__', 'docker', name), 'utf8');
}

describe('classifyDockerFailure', () => {
    it('classifies the reported Ubuntu socket EACCES as permission denied', () => {
        const infoProbe: DockerProbeEvidence = {
            probe: 'info',
            exitCode: 1,
            stdout: '',
            stderr: readFixture('ubuntu-version-unknown-permission-denied.txt'),
            endedBy: 'exit',
            durationMs: 12,
        };
        const endpointProbe: DockerEndpointProbe = {
            kind: 'unixSocket',
            accessErrorCode: 'EACCES',
            source: 'platformDefault',
        };

        expect(classifyDockerFailure({ infoProbe, endpointProbe })).toEqual({
            failureKind: 'permissionDenied',
            outcome: 'diagnosed',
        });
    });

    it.each([
        ['missing local socket', 'ENOENT'],
        ['refused local socket', 'ECONNREFUSED'],
    ])('classifies %s as an unavailable daemon', (_name, accessErrorCode) => {
        const infoProbe: DockerProbeEvidence = {
            probe: 'info',
            exitCode: 1,
            stdout: '',
            stderr: '',
            endedBy: 'exit',
            durationMs: 8,
        };
        const endpointProbe: DockerEndpointProbe = {
            kind: 'unixSocket',
            accessErrorCode,
            source: 'platformDefault',
        };

        expect(classifyDockerFailure({ infoProbe, endpointProbe })).toEqual({
            failureKind: 'daemonUnavailable',
            outcome: 'diagnosed',
        });
    });

    it('uses a structured permission error when the endpoint errno is unavailable', () => {
        const infoProbe: DockerProbeEvidence = {
            probe: 'info',
            exitCode: 1,
            stdout: '',
            stderr: '',
            endedBy: 'exit',
            durationMs: 10,
        };

        expect(classifyDockerFailure({ infoProbe, serverErrors: ['permission denied opening Docker endpoint'] })).toEqual(
            {
                failureKind: 'permissionDenied',
                outcome: 'diagnosed',
            },
        );
    });

    it.each([
        {
            name: 'missing CLI',
            probe: { spawnErrorCode: 'ENOENT', endedBy: 'exit' } as const,
            expected: { failureKind: 'cliMissing', outcome: 'diagnosed' },
        },
        {
            name: 'deadline expiry',
            probe: { endedBy: 'deadline' } as const,
            expected: { failureKind: 'probeTimedOut', outcome: 'indeterminate' },
        },
        {
            name: 'unrecognized failure',
            probe: { endedBy: 'exit' } as const,
            expected: { failureKind: 'unknown', outcome: 'indeterminate' },
        },
    ])('classifies $name', ({ probe, expected }) => {
        const infoProbe: DockerProbeEvidence = {
            probe: 'info',
            exitCode: 1,
            stdout: '',
            stderr: 'unrecognized Docker error',
            durationMs: 5,
            ...probe,
        };

        expect(classifyDockerFailure({ infoProbe })).toEqual(expected);
    });
});