/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type StatusListItemStatus } from '@microsoft/vscode-ext-webview-fluentui/components';
import * as l10n from '@vscode/l10n';
import { type EvidenceSegment, type PanelRowId, type PanelRowStatus } from './panelTypes';

// `KubernetesReachabilityProvider.id`; the webview cannot import the extension-side provider.
const KUBERNETES_PORT_FORWARD_PROVIDER_ID = 'kubernetes-port-forward';

/** The static row labels (design 5.2, decision 0030). They never change during a run. */
export function rowLabels(): Readonly<Record<PanelRowId, string>> {
    return {
        setup: l10n.t('Diagnosis setup'),
        connectionSettings: l10n.t('Connection settings'),
        serverAddress: l10n.t('Server address (DNS)'),
        networkConnection: l10n.t('Network connection (TCP)'),
        secureConnection: l10n.t('Secure connection (TLS)'),
        serverResponse: l10n.t('Server greeting (hello)'),
        authentication: l10n.t('Authentication'),
        databaseAccess: l10n.t('Database access'),
    };
}

/** The word a screen reader hears after each row's label. The package defaults to English. */
export function statusWords(): Readonly<Record<PanelRowStatus, string>> {
    return {
        pending: l10n.t('pending'),
        active: l10n.t('in progress'),
        done: l10n.t('done'),
        warning: l10n.t('warning'),
        error: l10n.t('failed'),
        skipped: l10n.t('skipped'),
    };
}

export function toStatusListStatus(status: PanelRowStatus): StatusListItemStatus {
    return status;
}

export function isSettled(status: PanelRowStatus): boolean {
    return status === 'done' || status === 'warning' || status === 'error' || status === 'skipped';
}

export function locationText(remoteKind: string): string {
    switch (remoteKind) {
        case 'local':
            return l10n.t('Running on this computer');
        case 'wsl':
            return l10n.t('Running on remote host {0}, not this computer', l10n.t('WSL'));
        case 'ssh':
            return l10n.t('Running on remote host {0}, not this computer', l10n.t('SSH'));
        case 'devContainer':
            return l10n.t('Running on remote host {0}, not this computer', l10n.t('Dev Container'));
        case 'codespaces':
            return l10n.t('Running on remote host {0}, not this computer', l10n.t('Codespaces'));
        default:
            return l10n.t('Running on a remote host, not this computer');
    }
}

export function platformText(platform: string): string {
    switch (platform) {
        case 'win32':
            return l10n.t('Windows');
        case 'darwin':
            return l10n.t('macOS');
        case 'linux':
            return l10n.t('Linux');
        default:
            return platform;
    }
}

/** The MongoDB API release that introduced each wire version; rapid releases in between are omitted. */
const apiReleases: readonly (readonly [wireVersion: number, release: string])[] = [
    [25, '8.0'],
    [21, '7.0'],
    [17, '6.0'],
    [13, '5.0'],
    [9, '4.4'],
    [8, '4.2'],
    [7, '4.0'],
    [6, '3.6'],
];

/**
 * The server's highest wire version as MongoDB API compatibility: "MongoDB API 8.0 (wire 25)", or
 * "… or later" between releases, since a wire version is supported by every later release.
 */
export function apiCompatibilityText(maxWireVersion: number): string {
    const release = apiReleases.find(([wireVersion]): boolean => wireVersion <= maxWireVersion);
    if (!release) {
        return l10n.t('Wire version {0}', maxWireVersion);
    }
    return release[0] === maxWireVersion
        ? l10n.t('MongoDB API {0} (wire {1})', release[1], maxWireVersion)
        : l10n.t('MongoDB API {0} or later (wire {1})', release[1], maxWireVersion);
}

export function topologyText(topology: string, setName: string | undefined): string | undefined {
    switch (topology) {
        case 'documentdbGateway':
            return l10n.t('DocumentDB gateway');
        case 'replicaSet':
            return setName ? l10n.t('Replica set {0}', setName) : l10n.t('Replica set');
        case 'shardedRouter':
            return l10n.t('Sharded cluster router');
        case 'loadBalanced':
            return l10n.t('Load balanced');
        case 'standalone':
            return l10n.t('Standalone server');
        default:
            return undefined;
    }
}

function cloudText(cloud: string): string {
    switch (cloud) {
        case 'AzureCloud':
            return l10n.t('Azure');
        case 'AzureUSGovernment':
        case 'usGovernment':
            return l10n.t('Azure US Government');
        case 'AzureChinaCloud':
        case 'china':
            return l10n.t('Azure China');
        default:
            return l10n.t('a custom cloud');
    }
}

/**
 * Node's protocol name as people write it, for each host's Details: `TLSv1.3` is "TLS 1.3", `TLSv1`
 * is "TLS 1.0" (decision 0050). Anything else is shown as it is. The evidence line names no version.
 */
export function tlsProtocolText(protocol: string): string {
    const match = /^TLSv1(?:\.([0-3]))?$/.exec(protocol);
    return match ? `TLS 1.${match[1] ?? '0'}` : protocol;
}

export function formatDate(isoDate: string): string | undefined {
    const time = Date.parse(isoDate);
    if (!Number.isFinite(time)) {
        return undefined;
    }
    return new Date(time).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function notApplicableText(reason: Extract<EvidenceSegment, { kind: 'notApplicable' }>['reason']): string {
    switch (reason) {
        case 'ipAddress':
            return l10n.t('Not needed: the host is an IP address');
        case 'tlsOff':
            return l10n.t('Not used: TLS is off for this connection');
        case 'other':
            return l10n.t('Not needed for this connection');
    }
}

function notCheckedText(segment: Extract<EvidenceSegment, { kind: 'notChecked' }>): string {
    switch (segment.reason) {
        case 'dependencyFailed':
        case 'dependencySkipped':
            return segment.becauseRow
                ? l10n.t('Not checked: {0} did not succeed', rowLabels()[segment.becauseRow])
                : l10n.t('Not checked');
        case 'inputUnavailable':
            return l10n.t('Not checked: no stored credentials');
        case 'runTimeoutExceeded':
            return l10n.t('Not started: time limit reached');
        case 'notRun':
            return l10n.t('Not checked');
    }
}

/** One semantic segment in the user's language; `undefined` drops a segment the view cannot name. */
export function formatEvidenceSegment(segment: EvidenceSegment): string | undefined {
    switch (segment.kind) {
        case 'authMethod':
            switch (segment.method) {
                case 'native':
                    return l10n.t('Username and password');
                case 'entraId':
                    return l10n.t('Microsoft Entra ID');
                case 'managedIdentity':
                    return l10n.t('Managed identity');
                case 'none':
                    return l10n.t('No authentication');
            }
        // Falls through only for an unrecognized authentication method.
        case 'account':
            return segment.label;
        case 'authMechanism':
            return segment.mechanism;
        case 'cloud':
            return segment.cloud === 'custom' ? l10n.t('Custom cloud') : cloudText(segment.cloud);
        case 'managedIdentityKind':
            return segment.identityKind === 'userAssigned' ? l10n.t('User-assigned') : l10n.t('System-assigned');
        case 'noSilentSignIn':
            return l10n.t('No sign-in available without a prompt');
        case 'signInFailed':
            return l10n.t('Sign-in failed');
        case 'signedInNotAccepted':
            return l10n.t('Token obtained · The cluster rejected the token');
        case 'credentialsRejected':
            return l10n.t('The cluster rejected the user name or password');
        case 'serverNotReached':
            return l10n.t('Could not reach a server');
        case 'signInNotTested':
            return l10n.t('Sign-in not tested');
        case 'listingNeedsSignIn':
            return l10n.t('Listing databases needs sign-in');
        case 'clusterCloud':
            return l10n.t('Cluster in {0}', cloudText(segment.cloud));
        case 'signedInCloud':
            return l10n.t('Sign-in set to {0}', cloudText(segment.cloud));
        case 'ping':
            return l10n.t('Ping {0}', formatDuration(segment.ms));
        case 'databasesVisible':
            return segment.count === 1 ? l10n.t('1 database visible') : l10n.t('{0} databases visible', segment.count);
        case 'connected':
            return l10n.t('Connected');
        case 'checking':
            return l10n.t('Checking…');
        case 'location':
            return locationText(segment.remoteKind);
        case 'platform':
            return platformText(segment.platform);
        case 'arch':
            return segment.arch;
        case 'scheme':
            return segment.scheme;
        case 'user':
            return l10n.t('User {0}', segment.userName);
        case 'optionCount':
            return segment.count === 1 ? l10n.t('1 option') : l10n.t('{0} options', segment.count);
        case 'preparedBy':
            return segment.providerId === KUBERNETES_PORT_FORWARD_PROVIDER_ID
                ? l10n.t('Port forward ready')
                : l10n.t('Prepared');
        case 'preparationFailed':
            return segment.providerId === KUBERNETES_PORT_FORWARD_PROVIDER_ID
                ? l10n.t('Port forward failed')
                : l10n.t('Preparation failed');
        case 'srvHosts':
            return segment.count === 1
                ? l10n.t('SRV record lists 1 host')
                : l10n.t('SRV record lists {0} hosts', segment.count);
        case 'resolved':
            return segment.resolved === segment.total
                ? l10n.t('All resolve')
                : l10n.t('{0} of {1} resolve', segment.resolved, segment.total);
        case 'privateEndpoint':
            return l10n.t('Private endpoint');
        case 'reachable':
            return l10n.t('{0} of {1} hosts reachable', segment.reachable, segment.total);
        case 'port':
            return l10n.t('Port {0}', segment.port);
        case 'certificateTrusted':
            return l10n.t('Certificate trusted');
        case 'validUntil': {
            const date = formatDate(segment.date);
            return date === undefined ? undefined : l10n.t('Valid until {0}', date);
        }
        case 'topology':
            return topologyText(segment.topology, segment.setName);
        case 'answeredBeforeSignIn':
            return l10n.t('Answered before sign-in');
        case 'primaryFound':
            return l10n.t('Primary found');
        case 'clockOffset': {
            const minutes = Math.round(Math.abs(segment.offsetMs) / 60_000);
            // A positive offset means the server's clock is ahead of the clock where these checks ran.
            return segment.offsetMs > 0
                ? l10n.t('Clock {0} min behind the server', minutes)
                : l10n.t('Clock {0} min ahead of the server', minutes);
        }
        case 'finding':
            return segment.target === undefined ? segment.title : l10n.t('{0} ({1})', segment.title, segment.target);
        case 'notApplicable':
            return notApplicableText(segment.reason);
        case 'notChecked':
            return notCheckedText(segment);
        case 'timedOut':
            return l10n.t('Did not finish in time');
    }
    const exhaustive: never = segment;
    return exhaustive;
}

/** Joins a row's segments into its single evidence line, as Local Quick Start's Docker line does. */
export function formatEvidence(segments: readonly EvidenceSegment[]): string | undefined {
    const parts = segments
        .map(formatEvidenceSegment)
        .filter((part): part is string => part !== undefined && part.length > 0);
    return parts.length > 0 ? parts.join(' · ') : undefined;
}

function formatUnit(
    value: number,
    unit: 'millisecond' | 'second' | 'minute',
    options: Intl.NumberFormatOptions,
): string {
    return new Intl.NumberFormat(undefined, { style: 'unit', unit, unitDisplay: 'short', ...options }).format(value);
}

/**
 * A row's elapsed time in the user's locale (decision 0050): whole milliseconds below a second,
 * three significant digits of seconds below a minute, then minutes and whole seconds. No "slow" or
 * "fast" rating. `Intl.DurationFormat` is not used: VS Code's Electron may not have it.
 */
export function formatDuration(durationMs: number): string {
    const milliseconds = Math.round(Math.max(0, durationMs));
    if (milliseconds < 1) {
        return l10n.t('< {0}', formatUnit(1, 'millisecond', { maximumFractionDigits: 0 }));
    }
    if (milliseconds < 1000) {
        return formatUnit(milliseconds, 'millisecond', { maximumFractionDigits: 0 });
    }
    const seconds = Number((milliseconds / 1000).toPrecision(3));
    if (seconds < 60) {
        return formatUnit(seconds, 'second', { maximumSignificantDigits: 3 });
    }
    const totalSeconds = Math.round(milliseconds / 1000);
    const minutes = formatUnit(Math.floor(totalSeconds / 60), 'minute', { maximumFractionDigits: 0 });
    const remainder = totalSeconds % 60;
    return remainder === 0
        ? minutes
        : l10n.t('{0} {1}', minutes, formatUnit(remainder, 'second', { maximumFractionDigits: 0 }));
}
