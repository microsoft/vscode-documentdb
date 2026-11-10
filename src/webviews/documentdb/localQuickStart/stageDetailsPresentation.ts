/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import {
    type DockerEndpointKind,
    type DockerEndpointProbe,
    type DockerFailureKind,
    type DockerHostEnvironment,
    type DockerPermissionDetail,
    type DockerProvider,
    type DockerProviderEvidence,
    type DockerReadiness,
    type DockerReadinessOutcome,
    type StageFacts,
} from '../../../services/localQuickStart/quickStartTypes';
import {
    getDockerExecutionTargetKey,
    getDockerReadinessPresentation,
    type DockerReadinessPresentationState,
} from './dockerReadinessPresentation';

export interface StageDetailFact {
    readonly label: string;
    readonly value: string;
    readonly note?: string;
    readonly code?: boolean;
    readonly action?: 'showOutput';
}

export function buildStageDetailRows(facts: StageFacts | undefined): readonly StageDetailFact[] {
    if (!facts) return [];
    const rows: StageDetailFact[] = [];
    switch (facts.kind) {
        case 'checking':
            rows.push({
                label: l10n.t('Port'),
                value: String(facts.port),
                code: true,
                note: facts.portFree ? l10n.t('Free on 127.0.0.1') : l10n.t('In use on 127.0.0.1'),
            });
            if (facts.removedContainerId) {
                rows.push({
                    label: l10n.t('Previous container'),
                    value: facts.removedContainerId,
                    code: true,
                    note: l10n.t('Removed for a clean run'),
                });
            }
            break;
        case 'pulling':
            rows.push({
                label: l10n.t('Image'),
                value: facts.imageRef,
                code: true,
                note:
                    facts.imageOrigin === 'custom'
                        ? l10n.t('Custom tag')
                        : facts.imageOrigin === 'reused'
                          ? l10n.t('Kept from existing data')
                          : undefined,
            });
            if (facts.result) {
                const results = {
                    downloaded: l10n.t('Downloaded'),
                    updated: l10n.t('Updated'),
                    upToDate: l10n.t('Already up to date'),
                };
                rows.push({ label: l10n.t('Result'), value: results[facts.result] });
            }
            if (facts.imageId) {
                rows.push({
                    label: l10n.t('Image ID'),
                    value: facts.imageId.length > 19 ? `${facts.imageId.slice(0, 19)}…` : facts.imageId,
                    code: true,
                });
            }
            if (facts.digest) rows.push({ label: l10n.t('Digest'), value: facts.digest, code: true });
            if (facts.imageVersion) {
                rows.push({ label: l10n.t('Image version'), value: facts.imageVersion, code: true });
            }
            if (facts.createdAtMs !== undefined) {
                rows.push({ label: l10n.t('Created'), value: new Date(facts.createdAtMs).toLocaleDateString() });
            }
            break;
        case 'creating': {
            const containerId =
                facts.containerId && facts.containerId.length > 12
                    ? `${facts.containerId.slice(0, 12)}…`
                    : facts.containerId;
            const volumes = {
                new: l10n.t('New'),
                reused: l10n.t('Kept existing data'),
                replaced: l10n.t('Replaced, Start fresh'),
            };
            rows.push(
                {
                    label: l10n.t('Container'),
                    value: containerId ? `${facts.containerName} ${containerId}` : facts.containerName,
                    code: true,
                },
                {
                    label: l10n.t('Port mapping'),
                    value: `localhost:${facts.hostPort} → ${facts.containerPort}`,
                    code: true,
                },
                {
                    label: l10n.t('Data volume'),
                    value: l10n.t('{0} at {1}', facts.volumeName, facts.dataPath),
                    code: true,
                    note: facts.volume === undefined ? undefined : volumes[facts.volume],
                },
                { label: l10n.t('User'), value: facts.username, code: true },
                {
                    label: l10n.t('Password'),
                    value: '(hidden)',
                    note: l10n.t('Passed in a temporary file, deleted after create'),
                },
            );
            break;
        }
        case 'starting':
            if (facts.running !== undefined) {
                rows.push({ label: l10n.t('State'), value: facts.running ? l10n.t('Running') : l10n.t('Not running') });
            }
            if (facts.startedAtMs !== undefined) {
                rows.push({ label: l10n.t('Started'), value: new Date(facts.startedAtMs).toLocaleTimeString() });
            }
            rows.push(
                {
                    label: l10n.t('Bound port'),
                    value: String(facts.boundPort),
                    code: true,
                    note: facts.boundPortReported ? undefined : l10n.t('As requested'),
                },
                { label: l10n.t('Logs'), value: l10n.t('Streaming to the setup log'), action: 'showOutput' },
            );
            break;
        case 'waiting':
            break;
    }
    return rows;
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

export function dockerFailureLabels(): Readonly<Record<DockerFailureKind, string>> {
    return {
        cliMissing: l10n.t('Docker or Podman CLI not found'),
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
        podman: 'Podman',
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

function dockerEndpointSourceNotes(): Readonly<Record<DockerEndpointProbe['source'], string>> {
    return {
        dockerHostEnv: l10n.t('Taken from the DOCKER_HOST environment variable, which overrides everything else.'),
        dockerContextEnv: l10n.t('Taken from the DOCKER_CONTEXT environment variable.'),
        currentContext: l10n.t('Taken from the Docker context that is currently active.'),
        platformDefault: l10n.t('No override was set, so the default location for this platform was used.'),
    };
}

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

/** Evidence from the readiness check only; do not copy the full host result into the view model. */
export function buildDockerDetailRows(readiness: DockerReadiness): readonly StageDetailFact[] {
    const rows: StageDetailFact[] = [
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
        rows.push({ label: l10n.t('Detected problem'), value: dockerFailureLabels()[readiness.failureKind] });
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
        value: dockerDaemonValues()[getDockerReadinessPresentation(readiness).state],
        note: readiness.daemonReachable
            ? l10n.t('The daemon answered, so everything below was reported by Docker itself.')
            : l10n.t('The daemon did not answer, so anything only Docker can report is still unknown.'),
    });
    rows.push({
        label: l10n.t('Docker endpoint'),
        value: dockerEndpointKindValues()[readiness.endpointKind],
        note: readiness.endpointSource
            ? dockerEndpointSourceNotes()[readiness.endpointSource]
            : undefined,
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
    const osLabels = { linux: l10n.t('Linux'), windows: l10n.t('Windows') };
    const daemonOs = readiness.osType ? osLabels[readiness.osType] : undefined;
    const daemonPlatform =
        daemonOs && readiness.daemonArchitecture
            ? l10n.t('{0} {1}', daemonOs, readiness.daemonArchitecture)
            : (daemonOs ?? readiness.daemonArchitecture);
    if (daemonPlatform) {
        rows.push({
            label: l10n.t('Containers run on'),
            value: daemonPlatform,
            note: l10n.t('The operating system and CPU architecture the daemon builds and runs containers for.'),
        });
    }
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
        value: new Date(readiness.checkedAtMs).toLocaleString(),
        note: readiness.diagnosticFingerprint
            ? l10n.t('Diagnostic reference {0}. Quote it when reporting this.', readiness.diagnosticFingerprint)
            : undefined,
    });
    return rows;
}
