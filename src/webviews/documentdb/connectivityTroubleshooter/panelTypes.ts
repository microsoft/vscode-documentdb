/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const panelRowIds = [
    'setup',
    'connectionSettings',
    'serverAddress',
    'networkConnection',
    'secureConnection',
    'serverResponse',
    'authentication',
    'databaseAccess',
] as const;

export type PanelRowId = (typeof panelRowIds)[number];
export type PanelRowStatus = 'pending' | 'active' | 'done' | 'warning' | 'error' | 'skipped';

export type EvidenceSegment =
    | { readonly kind: 'authMethod'; readonly method: 'native' | 'entraId' | 'managedIdentity' | 'none' }
    | { readonly kind: 'account'; readonly label: string }
    | { readonly kind: 'cloud'; readonly cloud: 'usGovernment' | 'china' | 'custom' }
    | { readonly kind: 'managedIdentityKind'; readonly identityKind: 'systemAssigned' | 'userAssigned' }
    | { readonly kind: 'noSilentSignIn' }
    | { readonly kind: 'signInFailed' }
    /** Microsoft Entra ID or managed identity: a token was obtained, and the cluster rejected the token. */
    | { readonly kind: 'signedInNotAccepted' }
    /** Username and password: the cluster rejected them. */
    | { readonly kind: 'credentialsRejected' }
    /** The driver reached no server, so the credentials were never presented (WI-27). */
    | { readonly kind: 'serverNotReached' }
    | { readonly kind: 'signInNotTested' }
    /** No authentication, and the server refused to list databases until sign-in (WI-27). */
    | { readonly kind: 'listingNeedsSignIn' }
    | { readonly kind: 'clusterCloud'; readonly cloud: string }
    | { readonly kind: 'signedInCloud'; readonly cloud: string }
    | { readonly kind: 'ping'; readonly ms: number }
    | { readonly kind: 'databasesVisible'; readonly count: number }
    | { readonly kind: 'connected' }
    | { readonly kind: 'checking' }
    | { readonly kind: 'location'; readonly remoteKind: string }
    | { readonly kind: 'platform'; readonly platform: string; readonly release?: string }
    | { readonly kind: 'arch'; readonly arch: string }
    | { readonly kind: 'scheme'; readonly scheme: 'mongodb' | 'mongodb+srv' }
    | { readonly kind: 'user'; readonly userName: string }
    | { readonly kind: 'optionCount'; readonly count: number }
    | { readonly kind: 'preparedBy'; readonly providerId: string }
    | { readonly kind: 'preparationFailed'; readonly providerId: string }
    | { readonly kind: 'srvHosts'; readonly count: number }
    | { readonly kind: 'resolved'; readonly resolved: number; readonly total: number }
    | { readonly kind: 'privateEndpoint' }
    | { readonly kind: 'reachable'; readonly reachable: number; readonly total: number }
    | { readonly kind: 'port'; readonly port: number }
    | { readonly kind: 'tlsProtocol'; readonly protocol: string }
    | { readonly kind: 'certificateTrusted' }
    | { readonly kind: 'validUntil'; readonly date: string }
    | { readonly kind: 'topology'; readonly topology: string; readonly setName?: string }
    /** The greeting needs no credentials; says so, so a passing row is not read as a sign-in. */
    | { readonly kind: 'answeredBeforeSignIn' }
    | { readonly kind: 'primaryFound' }
    | { readonly kind: 'clockOffset'; readonly offsetMs: number }
    | { readonly kind: 'finding'; readonly title: string; readonly target?: string }
    | { readonly kind: 'notApplicable'; readonly reason: 'ipAddress' | 'tlsOff' | 'other' }
    | {
          readonly kind: 'notChecked';
          readonly becauseRow?: PanelRowId;
          readonly reason:
              | 'dependencyFailed'
              | 'dependencySkipped'
              | 'inputUnavailable'
              | 'runTimeoutExceeded'
              | 'notRun';
      }
    | { readonly kind: 'timedOut' };

export type PanelFindingSeverity = 'error' | 'warning' | 'info';

/**
 * One finding, already in the user's language: the extension's own messages (`describeFinding`),
 * never a code, an English package detail or raw error text.
 */
export interface PanelFindingDetail {
    readonly severity: PanelFindingSeverity;
    readonly title: string;
    readonly explanation: string;
    readonly nextStep?: string;
    /** The hosts the finding is about, when the check runs per host. Identifiers. */
    readonly targets?: readonly string[];
}

export type PanelAddressClass = 'public' | 'private' | 'loopback' | 'linkLocal';

export interface PanelAddress {
    /** An identifier. */
    readonly address: string;
    readonly family: 4 | 6;
    readonly addressClass: PanelAddressClass;
}

/** `denied`: refused although signed in (a permission); `signInRequired`: refused before sign-in. */
export type PanelCommandOutcome = 'ok' | 'denied' | 'signInRequired' | 'unsupported' | 'timedOut' | 'failed';

/**
 * Semantic evidence for a row's details; the view localizes the labels. Host names, addresses,
 * user names and certificate names are identifiers; the panel shows them in full (decision 0040).
 * No timings, except the database ping (design 5.2).
 */
export interface PanelConnectionOption {
    readonly name: string;
    /** Absent when `hidden`: a secret-bearing or unknown option's value never leaves the host. */
    readonly value?: string;
    readonly hidden: boolean;
    /** `dns`: from the SRV host's TXT record rather than the connection string. */
    readonly source: 'uri' | 'dns';
}

export type PanelAuthMethod = 'native' | 'entraId' | 'managedIdentity' | 'none';

/**
 * One stage of signing in. Username and password has one stage; Microsoft Entra ID and managed
 * identity have two (get a token, then present it), plus the preparation stage when it failed.
 */
export interface PanelAuthStage {
    readonly stage: 'sendPassword' | 'prepareSignIn' | 'getToken' | 'sendToken';
    /** `rejected`: the cluster answered and refused the credentials; `failed`: any other failure. */
    readonly outcome: 'done' | 'rejected' | 'failed' | 'notRun';
}

/** Where authentication looks up the user; `default` is the driver's `admin`. */
export interface PanelAuthSource {
    readonly value: string;
    readonly origin: 'uri' | 'dns' | 'path' | 'default';
}

export type PanelEvidenceDetail =
    | {
          readonly kind: 'connectionSettings';
          readonly scheme?: 'mongodb' | 'mongodb+srv';
          /** `host` or `host:port`. Identifiers. */
          readonly hosts: readonly string[];
          readonly user?: string;
          /** The connection string carries a password; its value is never sent. */
          readonly passwordPresent: boolean;
          readonly authMethod?: PanelAuthMethod;
          readonly authSource?: PanelAuthSource;
          readonly options: readonly PanelConnectionOption[];
      }
    | {
          readonly kind: 'setup';
          readonly remoteKind?: string;
          readonly platform?: string;
          readonly release?: string;
          readonly arch?: string;
      }
    | {
          readonly kind: 'srv';
          readonly query?: string;
          /** `host:port` for each SRV target. */
          readonly targets: readonly string[];
          readonly omittedTargets: number;
          readonly resolver: 'system' | 'fallback';
          readonly dnsServers: readonly string[];
          readonly txtOptions: readonly { readonly name: string; readonly value: string }[];
          readonly failed: boolean;
      }
    | {
          readonly kind: 'dnsHost';
          readonly host: string;
          readonly cnameChain: readonly string[];
          /** What this computer's own name lookup returned (hosts file, VPN and split DNS included). */
          readonly system: readonly PanelAddress[];
          /** What a direct query to the DNS servers returned. */
          readonly direct: readonly PanelAddress[];
          readonly systemFailed: boolean;
          readonly directFailed: boolean;
          /** Both lookups answered with the same set of addresses. */
          readonly agree: boolean;
      }
    | {
          readonly kind: 'tcpHost';
          readonly host: string;
          readonly port?: number;
          readonly connectedAddress?: string;
          readonly failedAddresses: readonly string[];
      }
    | {
          readonly kind: 'tlsHost';
          readonly host: string;
          readonly protocol?: string;
          readonly subject?: string;
          readonly issuer?: string;
          readonly validTo?: string;
          readonly trusted: boolean;
          /** `undefined` when the handshake did not get far enough to tell. */
          readonly hostNameMatched?: boolean;
      }
    | {
          readonly kind: 'serverHost';
          readonly host: string;
          /** The unauthenticated greeting command sent: `hello`, or `isMaster` for older servers. */
          readonly command?: 'hello' | 'isMaster';
          readonly topology?: string;
          readonly setName?: string;
          readonly documentdbVersion?: string;
          readonly maxWireVersion?: number;
          /** Password mechanisms the server offered for the user (`saslSupportedMechs`). */
          readonly passwordMechanisms: readonly string[];
          /** Replica set members only: whether this member is the primary. */
          readonly role?: 'primary' | 'notPrimary';
      }
    | {
          readonly kind: 'auth';
          readonly method?: PanelAuthMethod;
          readonly mechanism?: string;
          /** The driver chooses the mechanism from what the server offered; none was configured. */
          readonly mechanismNegotiated?: boolean;
          readonly user?: string;
          /** Username and password only. */
          readonly authSource?: PanelAuthSource;
          readonly stages: readonly PanelAuthStage[];
      }
    | {
          readonly kind: 'access';
          readonly commands: readonly { readonly command: string; readonly outcome: PanelCommandOutcome }[];
          readonly pingMs?: number;
          readonly databaseCount?: number;
          readonly serverVersion?: string;
          readonly answeredBy?: string;
      };

export interface PanelRowDetails {
    /** Ordered by severity: errors, then warnings, then information. */
    readonly findings: readonly PanelFindingDetail[];
    readonly evidence: readonly PanelEvidenceDetail[];
}

export interface PanelRow {
    readonly id: PanelRowId;
    readonly status: PanelRowStatus;
    /** At most four semantic pieces; formatting and localization belong to the view. */
    readonly segments: readonly EvidenceSegment[];
    /**
     * Prototype (WI-18): what the row's disclosure shows. Absent on a row with nothing to show and on
     * every pending or active row; always present on a warning or error row. Always shows full
     * identifiers: Hide identifiers applies to the report only (decision 0040).
     */
    readonly details?: PanelRowDetails;
}
