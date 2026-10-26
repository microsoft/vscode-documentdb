/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { summarizeAtlasTlsHandshakeRejection } from '../../../plugins/service-atlas-mongodb/atlasConnectionErrors';
import { type ConnectionDiagnosis } from '../../../services/connectionDiagnosticsService';
import { describeAuthError } from '../../../utils/authTrace';
import {
    getCloudDisplayName,
    type ResolvedTokenResource,
    TokenResourceResolutionError,
} from '../documentdbTokenResource';
import { classifyEntraError } from '../entraErrors/classifyEntraError';
import { entraErrorRules } from '../entraErrors/entraErrorRules';
import { getCloudForTokenResource, getTokenResourceForCloud, parseTokenResource } from '../entraScopes';

export type PreviewSurface = 'extension' | 'shell' | 'playground';
export type PreviewStep = 1 | 2 | 3;
export type PreviewRows = readonly (readonly [string, string])[];

export interface PreviewProbe {
    readonly probe: 'ping' | 'listDatabases' | 'connectionStatus';
    readonly ok: boolean;
    readonly count?: number;
    readonly error?: unknown;
}

export interface PreviewReport {
    readonly step: PreviewStep;
    readonly surface: PreviewSurface;
    readonly extensionVersion: unknown;
    readonly vscodeVersion: unknown;
    readonly platform: string;
    readonly arch: string;
    readonly timestamp: string;
    readonly startupCorrelationId?: string;
    readonly resolved?: ResolvedTokenResource;
    readonly error?: unknown;
    readonly token?: string;
    readonly tenantId?: string;
    readonly managedIdentity?: boolean;
    readonly userAssigned?: boolean;
    readonly elapsedMs?: number;
    readonly probes?: readonly PreviewProbe[];
    readonly diagnosis?: ConnectionDiagnosis;
}

const detailValues: Readonly<Record<string, readonly (string | boolean)[]>> = {
    flow: ['interactive', 'managedIdentity', 'copy'],
    configuredCloud: ['AzureCloud', 'AzureUSGovernment', 'AzureChinaCloud', 'custom', 'unreadable'],
    authProvider: ['microsoft', 'microsoft-sovereign-cloud', 'unknown'],
    brokerImplementation: ['default', 'msal', 'msal-no-broker', 'other'],
    hostCloud: ['AzureCloud', 'AzureUSGovernment', 'AzureChinaCloud', 'none'],
    cloudCategory: ['public', 'usgov', 'china', 'custom'],
    reason: ['setting', 'customOverride', 'customLoginHost', 'armMetadata', 'host', 'imds', 'copyDefault'],
    customOssrdbmsEndpointState: ['absent', 'valid', 'invalid'],
    customOssrdbmsEndpointApplicable: [true, false],
    customHostnameSuffixSet: [true, false],
    customHostnameSuffixSource: ['user', 'workspace', 'none'],
    armMetadata: ['notNeeded', 'found', 'missingKey', 'unavailable'],
    imdsAzEnvironment: ['notQueried', 'AZUREPUBLICCLOUD', 'unavailable', 'other'],
    errorKind: [
        'customCloudUnresolved',
        'customCloudDefinitionInvalid',
        'invalidCustomOverride',
        'cloudMismatch',
        'managedIdentityCloudUnknown',
    ],
};

function selected(value: unknown, allowed: readonly unknown[], fallback = 'other'): string {
    return allowed.includes(value) ? String(value) : fallback;
}

export function safeResource(value: unknown): string {
    const resource = parseTokenResource(value);
    if (!resource) {
        return vscode.l10n.t('unknown or malformed');
    }
    const cloud = getCloudForTokenResource(resource);
    if (cloud) {
        return getTokenResourceForCloud(cloud);
    }
    return selected(
        resource,
        ['https://ossrdbms-aad.database.sovcloud-api.fr', 'https://ossrdbms-aad.database.sovcloud-api.de'],
        vscode.l10n.t('custom resource (value withheld)'),
    );
}

export function safeResolutionDetails(report: PreviewReport): Record<string, string> {
    const raw =
        report.resolved?.details ?? (report.error instanceof TokenResourceResolutionError ? report.error.details : {});
    const result: Record<string, string> = {};
    for (const [key, allowed] of Object.entries(detailValues)) {
        if (key in raw) {
            result[key] = selected(raw[key], allowed);
        }
    }
    if (report.resolved || 'tokenResource' in raw) {
        result.tokenResource = safeResource(report.resolved?.resource ?? raw.tokenResource);
    }
    if (report.resolved) {
        result.cloudCategory = selected(report.resolved.cloudCategory, detailValues.cloudCategory);
        result.reason = selected(report.resolved.reason, detailValues.reason);
    }
    if (report.error instanceof TokenResourceResolutionError) {
        result.errorKind = selected(report.error.kind, detailValues.errorKind);
    }
    const suffixes: Readonly<Record<string, string>> = {
        AzureCloud: '*.azure.com',
        AzureUSGovernment: '*.azure.us',
        AzureChinaCloud: '*.azure.cn',
    };
    result.allowlist = suffixes[result.hostCloud] ?? vscode.l10n.t('private (custom suffix withheld)');
    return result;
}

function comparison(value: unknown, configured: string | undefined): string {
    if (!configured) {
        return vscode.l10n.t('not configured');
    }
    return typeof value === 'string' && value.toLowerCase() === configured.toLowerCase()
        ? vscode.l10n.t('yes')
        : vscode.l10n.t('no');
}

function duration(value: number | undefined): string {
    return typeof value === 'number' && Number.isFinite(value)
        ? String(Math.max(0, Math.round(value)))
        : vscode.l10n.t('unknown');
}

export function describeTokenClaims(
    token: string,
    requestedResource: string,
    tenantId?: string,
    managedIdentity = false,
): PreviewRows {
    try {
        const parts = token.split('.');
        if (parts.length !== 3 || !/^[A-Za-z0-9_-]+$/.test(parts[1]) || parts[1].length > 100_000) {
            throw new Error();
        }
        const claims: unknown = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
        if (!claims || typeof claims !== 'object' || Array.isArray(claims)) {
            throw new Error();
        }
        const { aud, iss, ver, appid, azp, tid, exp } = claims as Record<string, unknown>;
        let issuer = vscode.l10n.t('unknown issuer (value withheld)');
        try {
            if (typeof iss !== 'string') {
                throw new Error();
            }
            const url = new URL(iss);
            if (url.protocol === 'https:' && !url.username && !url.password && !url.port) {
                const knownIssuers: Readonly<Record<string, string>> = {
                    'login.microsoftonline.com': 'public',
                    'sts.windows.net': 'public',
                    'login.microsoftonline.us': 'usgov',
                    'sts.microsoftonline.us': 'usgov',
                    'login.chinacloudapi.cn': 'china',
                    'sts.chinacloudapi.cn': 'china',
                    'login.sovcloud-identity.fr': 'custom (France)',
                    'login.sovcloud-identity.de': 'custom (Germany)',
                };
                if (Object.hasOwn(knownIssuers, url.hostname)) {
                    issuer = `${url.hostname} (${knownIssuers[url.hostname]})`;
                }
            }
        } catch {
            // An unreadable issuer does not invalidate the remaining payload diagnostics.
        }
        const client = azp ?? appid;
        const vscodeClient = client === 'aebc6443-996d-45c2-90f0-388ff96faa56';
        return [
            [vscode.l10n.t('Requested resource'), safeResource(requestedResource)],
            [vscode.l10n.t('Token audience (aud)'), safeResource(aud)],
            [
                vscode.l10n.t('Audience matches'),
                comparison(parseTokenResource(aud), parseTokenResource(requestedResource)),
            ],
            [vscode.l10n.t('Issuer host / cloud'), issuer],
            [vscode.l10n.t('Token version'), selected(ver, ['1.0', '2.0'])],
            [
                vscode.l10n.t('Client category'),
                managedIdentity
                    ? vscode.l10n.t('managed identity')
                    : vscodeClient
                      ? vscode.l10n.t('VS Code')
                      : vscode.l10n.t('other'),
            ],
            [
                vscode.l10n.t('Tenant (tid)'),
                typeof tid === 'string' && tid.length > 0 ? vscode.l10n.t('present') : vscode.l10n.t('absent'),
            ],
            [vscode.l10n.t('Tenant matches configured cluster tenant'), comparison(tid, tenantId)],
            [
                vscode.l10n.t('Expires in (seconds)'),
                typeof exp === 'number' ? duration(exp - Date.now() / 1000) : vscode.l10n.t('unknown'),
            ],
        ];
    } catch {
        return [[vscode.l10n.t('Token claims'), vscode.l10n.t('malformed or opaque token; payload unavailable')]];
    }
}

function errorText(error: unknown): string {
    const messages: string[] = [];
    for (let depth = 0; depth < 4; depth++) {
        if (typeof error === 'string') {
            messages.push(error);
            break;
        }
        if (!(error instanceof Error)) {
            break;
        }
        messages.push(error.message);
        error = error.cause;
    }
    return messages.join('\n');
}

export function tokenFailureRows(error: unknown, resolved?: ResolvedTokenResource): PreviewRows {
    const classification = classifyEntraError(errorText(error));
    const rule = entraErrorRules.find((candidate) => candidate.id === classification?.ruleId);
    return [
        [vscode.l10n.t('Token error'), describeAuthError(error)],
        [vscode.l10n.t('Classifier rule'), rule?.id ?? vscode.l10n.t('unclassified')],
        [
            vscode.l10n.t('Explanation'),
            rule?.explain({
                code: classification?.code,
                cloudCategory: resolved?.cloudCategory,
                recentTokenFailure: true,
            }) ?? vscode.l10n.t('Token acquisition failed. Check the authentication log and the selected cloud.'),
        ],
    ];
}

export function connectionFailureRows(error: unknown): PreviewRows {
    const record = typeof error === 'object' && error !== null ? (error as Record<string, unknown>) : {};
    const name = selected(
        record.name,
        [
            'Error',
            'MongoServerError',
            'MongoServerSelectionError',
            'MongoNetworkError',
            'MongoNetworkTimeoutError',
            'MongoOIDCError',
            'MongoMissingCredentialsError',
        ],
        'unknown',
    );
    const code = selected(
        record.code,
        [13, 18, 59, 8000, 'ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN'],
        'unknown',
    );
    const codeName = selected(record.codeName, ['AuthenticationFailed', 'Unauthorized', 'CommandNotFound'], 'unknown');
    let interpretation = vscode.l10n.t('The connection failed; no conclusion about token acceptance is possible.');
    if (code === '18' || codeName === 'AuthenticationFailed') {
        interpretation = vscode.l10n.t(
            'The cluster rejected authentication. A wrong audience or missing role is likely.',
        );
    } else if (code === '13' || codeName === 'Unauthorized') {
        interpretation = vscode.l10n.t(
            'The command lacks permission. Authentication may have succeeded; check the identity database roles.',
        );
    } else if (classifyEntraError(errorText(error))?.ruleId === 'oidcHostNotAllowed') {
        interpretation = vscode.l10n.t(
            'The token was not sent: the driver rejected the host allowlist. Check the trusted custom suffix in user settings.',
        );
    } else if (name.includes('Network') || name === 'MongoServerSelectionError' || code.startsWith('E')) {
        interpretation = vscode.l10n.t(
            'A network or timeout failure does not establish whether the cluster would accept the token.',
        );
    }
    return [
        [vscode.l10n.t('Error name'), name],
        [vscode.l10n.t('Error code'), code],
        [vscode.l10n.t('Error codeName'), codeName],
        [vscode.l10n.t('Interpretation'), interpretation],
    ];
}

function resolutionFailure(report: PreviewReport): string {
    const kind = report.error instanceof TokenResourceResolutionError ? report.error.kind : undefined;
    const details = report.error instanceof TokenResourceResolutionError ? report.error.details : {};
    switch (kind) {
        case 'cloudMismatch': {
            const hostCloud = details.hostCloud;
            const host =
                hostCloud === 'AzureCloud' || hostCloud === 'AzureUSGovernment' || hostCloud === 'AzureChinaCloud'
                    ? getCloudDisplayName(hostCloud)
                    : vscode.l10n.t('a custom cloud');
            const audienceCloud =
                typeof details.tokenResource === 'string' ? getCloudForTokenResource(details.tokenResource) : undefined;
            return vscode.l10n.t(
                'This cluster is in {clusterCloud}, but VS Code is signed in to {signedInCloud}. Change the "{setting}" setting to the cloud of the cluster, then connect again.',
                {
                    clusterCloud: host,
                    signedInCloud: audienceCloud ? getCloudDisplayName(audienceCloud) : vscode.l10n.t('a custom cloud'),
                    setting: 'microsoft-sovereign-cloud.environment',
                },
            );
        }
        case 'customCloudDefinitionInvalid':
            return vscode.l10n.t(
                'The VS Code custom cloud definition could not be read. Configure "microsoft-sovereign-cloud.customEnvironment" with all six required fields: name, portalUrl, managementEndpointUrl, resourceManagerEndpointUrl, activeDirectoryEndpointUrl, activeDirectoryResourceId. Then connect again.',
            );
        case 'invalidCustomOverride':
            return vscode.l10n.t(
                '"{setting}" must be an HTTPS resource such as "https://ossrdbms-aad.database.usgovcloudapi.net", with no path or "/.default". Clear the setting to use automatic resource selection.',
                { setting: 'documentDB.customEnvironment.ossrdbmsEndpoint' },
            );
        case 'managedIdentityCloudUnknown':
            return vscode.l10n.t(
                'We could not determine which Azure cloud this virtual machine is in, so we do not know which Microsoft Entra resource to request a token for. Set "{setting}" to the open-source database resource of your cloud, for example "{example}".',
                {
                    setting: 'documentDB.customEnvironment.ossrdbmsEndpoint',
                    example: getTokenResourceForCloud('AzureUSGovernment'),
                },
            );
        case 'customCloudUnresolved':
            return vscode.l10n.t(
                'VS Code is signed in to a custom cloud, and we could not find which Microsoft Entra resource to request a token for. Set "{setting}" to the open-source database resource of your cloud, usually "https://ossrdbms-aad.database.<your-cloud-domain>". Your cloud operator or Azure administrator can tell you the exact value.',
                { setting: 'documentDB.customEnvironment.ossrdbmsEndpoint' },
            );
        default:
            return vscode.l10n.t(
                'The token resource could not be resolved. Check the selected cloud and custom environment settings.',
            );
    }
}

function safeDiagnosis(report: PreviewReport): string {
    switch (report.diagnosis?.providerId) {
        case 'entra-sign-in':
            return tokenFailureRows(report.error, report.resolved)[2][1];
        case 'atlas':
            return summarizeAtlasTlsHandshakeRejection();
        case 'kubernetes-port-forward':
            return vscode.l10n.t(
                'The port-forward tunnel or its service did not answer. The pod may have restarted, or the tunnel may need to be re-established by collapsing and expanding the connection. Service, namespace and endpoint values are withheld.',
            );
        case 'localQuickStart':
            return vscode.l10n.t(
                'The managed DocumentDB Local instance cannot currently be reached. Check Docker and the instance state in the Connections view.',
            );
        default:
            return vscode.l10n.t(
                'Infrastructure guidance is available in the connection error dialog; endpoint-bearing details are withheld here.',
            );
    }
}

export function previewTitle(report: PreviewReport): string {
    if (report.step === 1) {
        return report.error
            ? vscode.l10n.t('Cloud resolution failed')
            : vscode.l10n.t('About to request a Microsoft Entra ID token');
    }
    if (report.step === 2) {
        return report.error ? vscode.l10n.t('Token request failed') : vscode.l10n.t('Token received');
    }
    return report.error ? vscode.l10n.t('Connection failed') : vscode.l10n.t('Connected and authenticated');
}

export function previewBody(report: PreviewReport): string {
    const rows: (readonly [string, string])[] = [];
    if (report.step === 1) {
        rows.push(...Object.entries(safeResolutionDetails(report)));
        rows.push([
            vscode.l10n.t('Authentication'),
            report.managedIdentity
                ? report.userAssigned
                    ? vscode.l10n.t('Managed identity (user-assigned)')
                    : vscode.l10n.t('Managed identity (system-assigned)')
                : vscode.l10n.t('Microsoft Entra ID, VS Code account'),
        ]);
        if (report.error) {
            rows.push([vscode.l10n.t('Explanation'), resolutionFailure(report)]);
        }
    } else if (report.step === 2) {
        rows.push(
            ...(report.error
                ? tokenFailureRows(report.error, report.resolved)
                : describeTokenClaims(
                      report.token ?? '',
                      report.resolved?.resource ?? '',
                      report.tenantId,
                      report.managedIdentity,
                  )),
        );
        rows.push([vscode.l10n.t('Token acquisition (ms)'), duration(report.elapsedMs)]);
    } else {
        rows.push([vscode.l10n.t('Connect (ms)'), duration(report.elapsedMs)]);
        if (report.error) {
            rows.push(...connectionFailureRows(report.error));
            if (report.diagnosis) {
                // Providers may interpolate names. Use only closed, identifier-free explanations.
                rows.push([vscode.l10n.t('ConnectionDiagnosticsService'), safeDiagnosis(report)]);
            }
        } else {
            for (const probe of report.probes ?? []) {
                const labels = {
                    ping: vscode.l10n.t('ping (admin)'),
                    listDatabases: vscode.l10n.t('listDatabases (nameOnly)'),
                    connectionStatus: vscode.l10n.t('connectionStatus'),
                };
                const label = Object.hasOwn(labels, probe.probe) ? labels[probe.probe] : vscode.l10n.t('unknown probe');
                const outcome = probe.ok
                    ? probe.count === undefined
                        ? vscode.l10n.t('ok')
                        : probe.probe === 'listDatabases'
                          ? vscode.l10n.t('ok; {0} databases visible', duration(probe.count))
                          : vscode.l10n.t('ok; {0} roles assigned', duration(probe.count))
                    : vscode.l10n.t(
                          'failed or unsupported; {0}',
                          connectionFailureRows(probe.error)
                              .map(([key, value]) => `${key}: ${value}`)
                              .join('; '),
                      );
                rows.push([label, outcome]);
            }
            rows.push([
                vscode.l10n.t('What this proves'),
                vscode.l10n.t(
                    'The cluster accepted authentication for the requested resource: {0}. The probes report permissions separately.',
                    safeResource(report.resolved?.resource),
                ),
            ]);
        }
    }
    const next = report.error
        ? vscode.l10n.t('Next: correct the reported configuration or authentication problem, then retry.')
        : report.step === 1
          ? report.managedIdentity
              ? vscode.l10n.t('Next: the driver requests a token from this machine identity endpoint.')
              : vscode.l10n.t(
                    'Next: VS Code may open sign-in. Record any AADSTS code before closing the sign-in window.',
                )
          : report.step === 2
            ? vscode.l10n.t('Next: the cluster decides whether it accepts the token audience and identity role.')
            : vscode.l10n.t('Please paste the copied report into the GitHub issue.');
    return `${rows.map(([key, value]) => `${key}: ${value}`).join('\n')}\n\n${next}`;
}

export function formatPreviewReport(report: PreviewReport): string {
    const version = (value: unknown): string =>
        typeof value === 'string' && /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(value) ? value : 'unknown';
    const correlation =
        report.startupCorrelationId &&
        /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(report.startupCorrelationId)
            ? report.startupCorrelationId
            : 'unavailable';
    const context = [
        vscode.l10n.t('Preview build: connection check {0} of 3', report.step),
        previewTitle(report),
        vscode.l10n.t('Extension version: {0}', version(report.extensionVersion)),
        vscode.l10n.t('VS Code version: {0}', version(report.vscodeVersion)),
        vscode.l10n.t(
            'Platform / arch: {0} / {1}',
            selected(report.platform, ['linux', 'win32', 'darwin', 'freebsd', 'openbsd']),
            selected(report.arch, ['x64', 'arm64', 'arm', 'ia32', 'riscv64', 'ppc64', 's390x']),
        ),
        vscode.l10n.t(
            'UTC: {0}',
            /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(report.timestamp) ? report.timestamp : 'unknown',
        ),
        vscode.l10n.t('Startup correlation ID: {0}', correlation),
        vscode.l10n.t('Surface: {0}', selected(report.surface, ['extension', 'shell', 'playground'])),
    ];
    // The only rows come from explicit projections above, never a spread of driver/claim objects.
    return `\`\`\`text\n${context.join('\n')}\n\n${previewBody(report)}\n\n${vscode.l10n.t('Safe resolution details')}: ${JSON.stringify(safeResolutionDetails(report))}\n\`\`\``;
}
