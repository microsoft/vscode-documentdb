/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import {
    type DockerEndpointKind,
    type DockerFailureKind,
    type DockerHostEnvironment,
    type DockerPermissionDetail,
    type DockerProvider,
    type DockerReadiness,
    type DockerReadinessOutcome,
    type ProvisionStage,
    type PullingStageFacts,
    type StageFacts,
} from '../../../services/localQuickStart/quickStartTypes';
import { apiCompatibilityText } from '../connectionDiagnostics/formatEvidence';
import {
    formatCliVersion,
    getDockerExecutionTargetKey,
    getDockerReadinessPresentation,
    type DockerReadinessPresentationState,
} from './dockerReadinessPresentation';

export interface StageDetailFact {
    readonly label: string;
    readonly value: string;
    readonly fullValue?: string;
    readonly note?: string;
    readonly qualification?: string;
    readonly action?: 'showOutput';
    readonly message?: 'info';
}

function imagePreparationSummary(disposition: PullingStageFacts['disposition']): string | undefined {
    switch (disposition) {
        case 'reusedPinned':
            return l10n.t('Reused the saved image. No download needed.');
        case 'downloadedPinned':
            return l10n.t('Downloaded the exact saved image.');
        case 'reusedTag':
            return l10n.t('Used the local image without downloading.');
        default:
            return undefined;
    }
}

/** Confirm recreation from execution's volume evidence, not the initial Configure choice. */
export function buildRecreateSuccessMessage(
    facts: Readonly<Partial<Record<ProvisionStage, StageFacts | undefined>>>,
): string | undefined {
    if (facts.creating?.kind !== 'creating' || facts.creating.volume !== 'reused') return undefined;
    const versions =
        facts.waiting?.kind === 'waiting'
            ? facts.waiting.documentdbVersions?.filter((version) => version.trim()).join(', ')
            : undefined;
    const running = versions
        ? l10n.t('DocumentDB {0} is running with your existing data volume and credentials.', versions)
        : l10n.t('DocumentDB is running with your existing data volume and credentials.');
    const disposition = facts.pulling?.kind === 'pulling' ? facts.pulling.disposition : undefined;
    switch (disposition) {
        case 'reusedPinned':
            return l10n.t('{0} The saved image was reused without downloading.', running);
        case 'downloadedPinned':
            return l10n.t('{0} The exact saved image was downloaded.', running);
        case 'reusedTag':
            return l10n.t('{0} The local image was used without downloading.', running);
        default:
            return running;
    }
}

export function buildStageSummary(
    facts: StageFacts | undefined,
    status: 'active' | 'done' | 'error',
): string | undefined {
    if (!facts) return undefined;
    switch (facts.kind) {
        case 'checking':
            return facts.portFree ? l10n.t('Port {0} free', facts.port) : l10n.t('Port {0} in use', facts.port);
        case 'pulling': {
            if (status === 'done' && facts.disposition) {
                return imagePreparationSummary(facts.disposition);
            }
            if (status === 'done' && facts.result) {
                const results = {
                    downloaded: l10n.t('Downloaded'),
                    updated: l10n.t('Updated'),
                    upToDate: l10n.t('Already up to date'),
                };
                return results[facts.result];
            }
            const image = l10n.t('Image {0}', facts.imageRef);
            if (status === 'active' && facts.imageOrigin === 'custom') {
                return l10n.t('{0} · {1}', image, l10n.t('Custom tag'));
            }
            if (status === 'active' && facts.imageOrigin === 'reused') {
                return l10n.t('{0} · {1}', image, l10n.t('Kept from existing data'));
            }
            return image;
        }
        case 'creating':
            return l10n.t('Container {0}', facts.containerName);
        case 'starting':
            return status === 'done' && facts.running
                ? l10n.t('Running on port {0}', facts.boundPort)
                : l10n.t('Port {0}', facts.boundPort);
        case 'waiting':
            if (status === 'done' && facts.sampleData !== undefined) {
                return l10n.t('Accepting connections on localhost:{0}', facts.port);
            }
            if (status === 'error' && facts.exitCode !== undefined) {
                return l10n.t('Exit code {0}', facts.exitCode);
            }
            if (status === 'error' && facts.attempts !== undefined) {
                return facts.attempts === 1 ? l10n.t('1 attempt') : l10n.t('{0} attempts', facts.attempts);
            }
            return l10n.t('Endpoint localhost:{0}', facts.port);
    }
}

function idFact(label: string, value: string, limit: number): StageDetailFact {
    return value.length > limit ? { label, value: `${value.slice(0, limit)}…`, fullValue: value } : { label, value };
}

export function buildStageDetailRows(facts: StageFacts | undefined): readonly StageDetailFact[] {
    if (!facts) return [];
    const rows: StageDetailFact[] = [];
    switch (facts.kind) {
        case 'checking':
            rows.push(
                { label: l10n.t('Port'), value: String(facts.port) },
                {
                    label: l10n.t('Port status'),
                    value: facts.portFree ? l10n.t('Free on 127.0.0.1') : l10n.t('In use on 127.0.0.1'),
                },
            );
            if (facts.removedContainerId) {
                rows.push({
                    label: l10n.t('Removed container'),
                    value: facts.removedContainerId,
                });
            }
            break;
        case 'pulling':
            rows.push({
                label: l10n.t('Image'),
                value: facts.imageRef,
                note:
                    facts.imageOrigin === 'custom'
                        ? l10n.t('Custom tag')
                        : facts.imageOrigin === 'reused'
                          ? l10n.t('Kept from existing data')
                          : undefined,
            });
            if (facts.disposition) {
                const summary = imagePreparationSummary(facts.disposition);
                if (summary) rows.push({ label: l10n.t('Result'), value: summary });
            } else if (facts.result) {
                const results = {
                    downloaded: l10n.t('Downloaded'),
                    updated: l10n.t('Updated'),
                    upToDate: l10n.t('Already up to date'),
                };
                rows.push({ label: l10n.t('Result'), value: results[facts.result] });
            }
            if (facts.imageId) {
                rows.push(idFact(l10n.t('Image ID'), facts.imageId, 19));
            }
            if (facts.result === 'updated' && facts.previousImageId) {
                rows.push(idFact(l10n.t('Previous image ID'), facts.previousImageId, 19));
            }
            if (facts.digest) rows.push({ label: l10n.t('Digest'), value: facts.digest });
            if (facts.imageVersion) {
                rows.push({ label: l10n.t('Image version'), value: facts.imageVersion });
            }
            if (facts.createdAtMs !== undefined) {
                rows.push({ label: l10n.t('Created'), value: new Date(facts.createdAtMs).toLocaleDateString() });
            }
            break;
        case 'creating': {
            const volumes = {
                new: l10n.t('New'),
                reused: l10n.t('Kept existing data'),
                replaced: l10n.t('Replaced, Start fresh'),
            };
            rows.push(
                {
                    label: l10n.t('Container'),
                    value: facts.containerName,
                },
                ...(facts.containerId ? [idFact(l10n.t('Container ID'), facts.containerId, 12)] : []),
                {
                    label: l10n.t('Port mapping'),
                    value: `localhost:${facts.hostPort} → ${facts.containerPort}`,
                },
                {
                    label: l10n.t('Data volume'),
                    value: l10n.t('{0} at {1}', facts.volumeName, facts.dataPath),
                    note: facts.volume === undefined ? undefined : volumes[facts.volume],
                },
                { label: l10n.t('User'), value: facts.username },
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
                    qualification: facts.boundPortReported ? undefined : l10n.t('As requested'),
                },
                { label: l10n.t('Logs'), value: l10n.t('Streaming to the setup log'), action: 'showOutput' },
            );
            break;
        case 'waiting': {
            rows.push({
                label: l10n.t('Endpoint'),
                value: `localhost:${facts.port}`,
                note: l10n.t('TLS (self-signed certificate accepted)'),
            });
            if (facts.attempts !== undefined) {
                let probe = facts.attempts === 1 ? l10n.t('1 attempt') : l10n.t('{0} attempts', facts.attempts);
                if (facts.sampleData !== undefined) {
                    probe =
                        facts.attempts === 1
                            ? l10n.t('Ping on admin answered after 1 attempt')
                            : l10n.t('Ping on admin answered after {0} attempts', facts.attempts);
                }
                rows.push({
                    label: l10n.t('Probe'),
                    value: probe,
                });
            }
            const server = [
                facts.documentdbVersions?.length
                    ? l10n.t('DocumentDB {0}', facts.documentdbVersions.join(', '))
                    : undefined,
                facts.maxWireVersion !== undefined ? apiCompatibilityText(facts.maxWireVersion) : undefined,
            ]
                .filter((value) => value !== undefined)
                .join(' · ');
            if (server) rows.push({ label: l10n.t('Server'), value: server });
            if (facts.sampleData !== undefined) {
                const outcomes = {
                    loaded: l10n.t('Loaded'),
                    notRequested: l10n.t('Not requested'),
                    keptExisting: l10n.t('Not loaded, existing data kept'),
                    failed: l10n.t('Not loaded'),
                };
                rows.push({ label: l10n.t('Sample data'), value: outcomes[facts.sampleData] });
                if (facts.sampleData === 'failed') {
                    rows.push({
                        label: l10n.t('Sample data was not loaded'),
                        value: l10n.t('The instance is ready to use without sample data.'),
                        message: 'info',
                        action: 'showOutput',
                    });
                }
            }
            if (facts.displayName) {
                rows.push({
                    label: l10n.t('Saved as'),
                    value: l10n.t('“{0}” in the Connections view', facts.displayName),
                    note: l10n.t('Credentials in VS Code secret storage'),
                });
            }
            if (facts.lastProbeError) {
                rows.push({ label: l10n.t('Last probe error'), value: facts.lastProbeError });
            }
            if (facts.exitCode !== undefined) {
                rows.push({ label: l10n.t('Exit code'), value: String(facts.exitCode) });
            }
            if (facts.lastLogLine) {
                rows.push({ label: l10n.t('Last log line'), value: facts.lastLogLine });
            }
            break;
        }
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

function dockerFailureLabels(): Readonly<Record<DockerFailureKind, string>> {
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

function engineFailureLabels(): Readonly<Record<DockerFailureKind, string>> {
    return {
        cliMissing: l10n.t('Docker or Podman CLI not found'),
        permissionDenied: l10n.t('Engine access denied'),
        daemonUnavailable: l10n.t('Engine unavailable'),
        daemonStarting: l10n.t('Engine starting'),
        contextUnavailable: l10n.t('Engine context unavailable'),
        endpointUnreachable: l10n.t('Engine endpoint unreachable'),
        probeTimedOut: l10n.t('Engine check timed out'),
        unsupportedHost: l10n.t('Unsupported host'),
        windowsContainers: l10n.t('Windows containers enabled'),
        unknown: l10n.t('Unknown engine problem'),
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
        ready: l10n.t('Engine is ready'),
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
        local: l10n.t('This machine'),
        wsl: l10n.t('This WSL environment'),
        ssh: l10n.t('Remote SSH host'),
        devContainer: l10n.t('This dev container environment'),
        codespaces: l10n.t('This Codespaces environment'),
        otherRemote: l10n.t('This remote extension host'),
    };
}

/** Names Docker only when the check ran the Docker CLI against a Docker engine. */
export function dockerFailureLabel(readiness: Pick<DockerReadiness, 'cli' | 'engine' | 'failureKind'>): string {
    const labels =
        readiness.cli === 'docker' && readiness.engine !== 'podman' ? dockerFailureLabels() : engineFailureLabels();
    return labels[readiness.failureKind ?? 'unknown'];
}

/** Evidence from the readiness check only; do not copy the full host result into the view model. */
export function buildDockerDetailRows(readiness: DockerReadiness): readonly StageDetailFact[] {
    const rows: StageDetailFact[] = [
        {
            label: l10n.t('Check result'),
            value: dockerOutcomeValues()[readiness.outcome],
        },
    ];

    if (readiness.outcome !== 'ready') {
        rows.push({ label: l10n.t('Detected problem'), value: dockerFailureLabel(readiness) });
    }

    if (readiness.preferredEngine) {
        const preferred = readiness.preferredEngine === 'docker' ? l10n.t('Docker') : l10n.t('Podman');
        const fallback = readiness.cliFallback && readiness.cli && readiness.cli !== readiness.preferredEngine;
        rows.push({
            label: l10n.t('Preferred engine'),
            value: fallback
                ? l10n.t(
                      '{0} · not found, used {1}',
                      preferred,
                      readiness.cli === 'docker' ? l10n.t('Docker') : l10n.t('Podman'),
                  )
                : preferred,
        });
    }
    const cliLabels = { docker: l10n.t('Docker CLI'), podman: l10n.t('Podman CLI') };
    if (readiness.cli) {
        rows.push({
            label: cliLabels[readiness.cli],
            value: readiness.cliInstalled
                ? readiness.cliVersion
                    ? l10n.t('Found, version {0}', formatCliVersion(readiness.cliVersion))
                    : l10n.t('Found, version not reported')
                : l10n.t('Not found'),
        });
    } else if (readiness.cliInstalled) {
        rows.push({
            label: l10n.t('Container CLI'),
            value: readiness.cliVersion
                ? l10n.t('Found, version {0}', formatCliVersion(readiness.cliVersion))
                : l10n.t('Found, version not reported'),
        });
    }
    if (readiness.cliOnPath) {
        for (const cli of ['docker', 'podman'] as const) {
            if (cli !== readiness.cli) {
                rows.push({
                    label: cliLabels[cli],
                    value: readiness.cliOnPath[cli] ? l10n.t('Found on PATH, not checked') : l10n.t('Not found'),
                });
            }
        }
    }
    const state = getDockerReadinessPresentation(readiness).state;
    if (state !== 'cliMissing') {
        rows.push({ label: l10n.t('Engine'), value: dockerDaemonValues()[state] });
    }
    if (readiness.endpointKind !== 'unknown') {
        rows.push({ label: l10n.t('Endpoint'), value: dockerEndpointKindValues()[readiness.endpointKind] });
    }
    if (readiness.permissionDetail) {
        rows.push({
            label: l10n.t('Socket access'),
            value: dockerPermissionDetailValues()[readiness.permissionDetail],
        });
    }
    if (readiness.provider !== 'unknown') {
        rows.push({ label: l10n.t('Provider'), value: dockerProviderLabels()[readiness.provider] });
    }
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
        });
    }
    rows.push({
        label: l10n.t('This machine'),
        value: readiness.arch
            ? l10n.t('{0}, {1}', dockerHostEnvironmentValues()[readiness.environment], readiness.arch)
            : dockerHostEnvironmentValues()[readiness.environment],
    });
    rows.push({
        label: l10n.t('Container host'),
        value: executionTargetValues()[getDockerExecutionTargetKey(readiness.executionTarget)],
    });
    rows.push({
        label: l10n.t('Check run'),
        value: new Date(readiness.checkedAtMs).toLocaleString(),
    });
    if (readiness.diagnosticFingerprint) {
        rows.push({ label: l10n.t('Diagnostic reference'), value: readiness.diagnosticFingerprint });
    }
    return rows;
}
