/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type Finding } from '@documentdb-js/connection-diagnostics';
import * as vscode from 'vscode';
import { AuthMethodId } from '../documentdb/auth/AuthMethod';
import { getCloudDisplayName } from '../documentdb/auth/documentdbTokenResource';
import { type DocumentDBEntraCloud } from '../documentdb/auth/entraScopes';
import { type FindingCode } from './types';

export interface FindingMessage {
    readonly title: string;
    readonly explanation: string;
    readonly nextStep?: string;
}

type FindingData = Readonly<Record<string, unknown>>;

function stringField(data: FindingData, key: string): string | undefined {
    const value = data[key];
    return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function numberField(data: FindingData, key: string): number | undefined {
    const value = data[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function firewallAdvice(nextStep: string): string {
    return `${nextStep} ${vscode.l10n.t('A firewall or IP allowlist may be blocking this connection. Check access from the computer or remote host where these checks ran, including VPN and network rules.')}`;
}

function compressorMessage(data: FindingData, negotiated: boolean): FindingMessage {
    const compressor = stringField(data, 'compressor');
    let explanation = vscode.l10n.t('A requested compressor is not available in the extension.');
    if (compressor !== undefined) {
        explanation = negotiated
            ? vscode.l10n.t(
                  'The server accepted {0}, but the extension cannot use it for commands after sign-in.',
                  compressor,
              )
            : vscode.l10n.t('The connection requests {0}, but the extension cannot use it.', compressor);
    }
    return {
        title: vscode.l10n.t('Compressor unavailable'),
        explanation,
        nextStep:
            compressor === undefined
                ? vscode.l10n.t('Remove the unavailable compressor from the compressors option, or put zlib first.')
                : vscode.l10n.t('Remove {0} from the compressors option, or put zlib first.', compressor),
    };
}

function missingCredentialsMessage(data: FindingData): FindingMessage {
    switch (stringField(data, 'missing')) {
        case 'method':
            return {
                title: vscode.l10n.t('No authentication method chosen'),
                explanation: vscode.l10n.t('No authentication method has been chosen. Network checks can still run.'),
                nextStep: vscode.l10n.t(
                    'Connect to the cluster and choose an authentication method, then run the diagnosis again.',
                ),
            };
        case 'password':
            if (stringField(data, 'passwordSource') === 'kubernetes') {
                switch (stringField(data, 'passwordReadIssue')) {
                    case 'accessDenied':
                        return {
                            title: vscode.l10n.t('Kubernetes Secret password unreadable'),
                            explanation: vscode.l10n.t(
                                'Access to the Kubernetes Secret holding the password was denied. Network checks can still run.',
                            ),
                            nextStep: vscode.l10n.t(
                                'Check that the kubeconfig context can read the credential Secret in Kubernetes, then run the diagnosis again.',
                            ),
                        };
                    case 'notFound':
                        return {
                            title: vscode.l10n.t('Kubernetes Secret password not found'),
                            explanation: vscode.l10n.t(
                                'The Kubernetes Secret holding the password was not found. Network checks can still run.',
                            ),
                            nextStep: vscode.l10n.t(
                                'Check that the credential Secret exists in the service namespace in Kubernetes, then run the diagnosis again.',
                            ),
                        };
                }
            }
            return {
                title: vscode.l10n.t('Stored password unavailable'),
                explanation: vscode.l10n.t('No stored password is available. Network checks can still run.'),
                nextStep: vscode.l10n.t('Connect to the cluster and enter the password, then run the diagnosis again.'),
            };
        case 'entraSession':
            return {
                title: vscode.l10n.t('Sign-in needed'),
                explanation: vscode.l10n.t(
                    'No Microsoft Entra ID sign-in is available without a prompt, and connection diagnosis does not open one.',
                ),
                nextStep: vscode.l10n.t('Connect to the cluster once, then run the diagnosis again.'),
            };
        default:
            return {
                title: vscode.l10n.t('Authentication input unavailable'),
                explanation: vscode.l10n.t('Required authentication input is unavailable without a prompt.'),
                nextStep: vscode.l10n.t('Connect to the cluster once, then run the diagnosis again.'),
            };
    }
}

function tokenFailureMessage(data: FindingData): FindingMessage {
    const title = vscode.l10n.t('Microsoft Entra ID sign-in failed');
    const method = stringField(data, 'authMethod');
    const ruleId = stringField(data, 'ruleId');
    // Use the classifier's stable rule ID, never classify or display its raw error again.
    switch (
        method === AuthMethodId.ManagedIdentity &&
        (ruleId === 'applicationNotInDirectory' || ruleId === 'tenantNotFound' || ruleId === 'accountNotInTenant')
            ? undefined
            : ruleId
    ) {
        case 'firstPartyPreauthorization':
            return {
                title,
                explanation: vscode.l10n.t(
                    'Microsoft Entra ID sign-in appears to require Microsoft to preauthorize VS Code. Only Microsoft can change this.',
                ),
                nextStep: vscode.l10n.t(
                    'Use native DocumentDB authentication or managed identity on an Azure VM, and report this on GitHub.',
                ),
            };
        case 'resourceNotInTenant':
            if (method === AuthMethodId.ManagedIdentity) {
                return {
                    title,
                    explanation: vscode.l10n.t(
                        'The managed identity token may target a different Azure cloud than the cluster.',
                    ),
                    nextStep: vscode.l10n.t(
                        'If documentDB.customEnvironment.ossrdbmsEndpoint is set, check or clear it. Then check that the virtual machine and the cluster are in the same Azure cloud.',
                    ),
                };
            }
            return {
                title,
                explanation: vscode.l10n.t(
                    'The selected Azure cloud may not match the cluster, or the sign-in resource may be unavailable in this tenant.',
                ),
                nextStep: vscode.l10n.t(
                    'Check microsoft-sovereign-cloud.environment. If it matches the cluster, ask your tenant administrator to check resource availability.',
                ),
            };
        case 'invalidResource':
            return {
                title,
                explanation: vscode.l10n.t(
                    'The requested sign-in resource does not appear to be valid for this cloud.',
                ),
                nextStep: vscode.l10n.t(
                    'Check documentDB.customEnvironment.ossrdbmsEndpoint with your cloud administrator. If no override is set, report this on GitHub.',
                ),
            };
        case 'accountNotInTenant':
            return {
                title,
                explanation: vscode.l10n.t("This account does not appear to belong to the cluster's organization."),
                nextStep: vscode.l10n.t(
                    'Use Update Credentials to choose another account or tenant, or ask the organization administrator to grant access.',
                ),
            };
        case 'applicationNotInDirectory':
            return {
                title,
                explanation: vscode.l10n.t('The sign-in application could not be found in the selected directory.'),
                nextStep: vscode.l10n.t(
                    'Check microsoft-sovereign-cloud.environment and use Update Credentials to choose the cluster tenant. If both are correct, contact your tenant administrator.',
                ),
            };
        case 'tenantNotFound':
            return {
                title,
                explanation: vscode.l10n.t('The tenant does not appear to exist in the selected Azure cloud.'),
                nextStep: vscode.l10n.t(
                    'Check microsoft-sovereign-cloud.environment and use Update Credentials to select the right tenant.',
                ),
            };
        case 'crossCloudNotAllowed':
            return {
                title,
                explanation: vscode.l10n.t(
                    'Sign-in appears to be blocked because the account belongs to another Azure cloud.',
                ),
                nextStep: vscode.l10n.t(
                    'Use an account from the cluster cloud, or ask your administrator to check cross-cloud access settings.',
                ),
            };
        case 'conditionalAccess':
            return {
                title,
                explanation: vscode.l10n.t('Your organization policy appears to have blocked sign-in.'),
                nextStep: vscode.l10n.t(
                    'Contact your IT help desk with the diagnostic report and the time of the failure.',
                ),
            };
        case 'additionalVerification':
            return {
                title,
                explanation: vscode.l10n.t('Microsoft Entra ID appears to require additional verification.'),
                nextStep: vscode.l10n.t(
                    'Connect to the cluster and complete the verification requested by your organization. Contact your IT help desk if you cannot complete it.',
                ),
            };
        case 'oidcHostNotAllowed':
            return findingMessages['auth.oidcHostNotAllowed']({});
        case 'brokerOpaque':
            return {
                title,
                explanation: vscode.l10n.t('The sign-in service reported an error without further details.'),
                nextStep: vscode.l10n.t(
                    'Open Developer: Show Logs… and check Microsoft Authentication or Microsoft Sovereign Cloud Authentication for your selected cloud. Ask your IT help desk for help interpreting the error.',
                ),
            };
        default:
            return {
                title,
                explanation: vscode.l10n.t('Microsoft Entra ID could not provide a sign-in token.'),
                nextStep: vscode.l10n.t(
                    'Review the sign-in details in the diagnostic report with your tenant administrator or IT help desk.',
                ),
            };
    }
}

function notFoundMessage(data: FindingData): FindingMessage {
    switch (stringField(data, 'source')) {
        case 'azure':
            return {
                title: vscode.l10n.t('Azure resource not found'),
                explanation: vscode.l10n.t(
                    'Azure reports that this resource no longer exists, or that it moved to another resource group or subscription.',
                ),
                nextStep: vscode.l10n.t('Refresh the view, then run the diagnosis again from the resource.'),
            };
        case 'kubernetes':
            return {
                title: vscode.l10n.t('Kubernetes service not found'),
                explanation: vscode.l10n.t('The Kubernetes API reports that this service no longer exists.'),
                nextStep: vscode.l10n.t('Refresh the Kubernetes view, then run the diagnosis again from the service.'),
            };
        default:
            return {
                title: vscode.l10n.t('Connection not found'),
                explanation: vscode.l10n.t('This connection no longer exists. It may have been removed.'),
                nextStep: vscode.l10n.t('Refresh the view, then run the diagnosis again from the connection.'),
            };
    }
}

function sourceInaccessibleMessage(data: FindingData): FindingMessage {
    const source = stringField(data, 'source');
    const reason = stringField(data, 'reason');
    if (source === 'atlas' && reason === 'notConnectable') {
        return {
            title: vscode.l10n.t('Atlas cluster not available'),
            explanation: vscode.l10n.t(
                'MongoDB Atlas reports that this cluster cannot accept connections right now, for example while it is paused or being created.',
            ),
            nextStep: vscode.l10n.t('Check the cluster state in MongoDB Atlas, then run the diagnosis again.'),
        };
    }
    if (source === 'azure') {
        switch (reason) {
            case 'signInRequired':
                return {
                    title: vscode.l10n.t('Azure sign-in needed'),
                    explanation: vscode.l10n.t(
                        'The connection details could not be read from Azure because the Azure sign-in is missing or expired. Connection diagnosis does not open sign-in.',
                    ),
                    nextStep: vscode.l10n.t('Sign in to Azure in VS Code, then run the diagnosis again.'),
                };
            case 'accessDenied':
                return {
                    title: vscode.l10n.t('Azure access denied'),
                    explanation: vscode.l10n.t("Azure denied access to this resource's connection details."),
                    nextStep: vscode.l10n.t(
                        'Ask for read access to the resource, or sign in with an account that has it, then run the diagnosis again.',
                    ),
                };
            case 'unreachable':
                return {
                    title: vscode.l10n.t('Azure unreachable'),
                    explanation: vscode.l10n.t(
                        'The connection details could not be read because Azure Resource Manager could not be reached from the host running these checks.',
                    ),
                    nextStep: vscode.l10n.t(
                        'Check the network connection and proxy settings, then run the diagnosis again.',
                    ),
                };
            default:
                return {
                    title: vscode.l10n.t('Azure details unavailable'),
                    explanation: vscode.l10n.t('The connection details could not be read from Azure.'),
                    nextStep: vscode.l10n.t(
                        'Review the error name in the diagnostic report, refresh the view, then run the diagnosis again.',
                    ),
                };
        }
    }
    if (source === 'kubernetes') {
        switch (reason) {
            case 'signInRequired':
            case 'accessDenied':
                return {
                    title: vscode.l10n.t('Kubernetes access denied'),
                    explanation: vscode.l10n.t("The Kubernetes API rejected the request for this service's details."),
                    nextStep: vscode.l10n.t(
                        'Check the credentials of the kubeconfig context and its permission to read services, endpoints and secrets in the namespace.',
                    ),
                };
            case 'unreachable':
                return {
                    title: vscode.l10n.t('Kubernetes API unreachable'),
                    explanation: vscode.l10n.t(
                        "The Kubernetes API server could not be reached to read this service's details.",
                    ),
                    nextStep: vscode.l10n.t(
                        'Check that the cluster is running and that the kubeconfig context points to a reachable API server.',
                    ),
                };
            default:
                return {
                    title: vscode.l10n.t('Kubernetes details unavailable'),
                    explanation: vscode.l10n.t("The service's connection details could not be read from Kubernetes."),
                    nextStep: vscode.l10n.t(
                        'Check the kubeconfig source and context, review the error name in the diagnostic report, then run the diagnosis again.',
                    ),
                };
        }
    }
    if (source === 'atlas') {
        return {
            title: vscode.l10n.t('Atlas details unavailable'),
            explanation: vscode.l10n.t('The connection details could not be read from MongoDB Atlas.'),
            nextStep: vscode.l10n.t('Refresh the MongoDB Atlas view, then run the diagnosis again.'),
        };
    }
    return {
        title: vscode.l10n.t('Connection details unavailable'),
        explanation: vscode.l10n.t('The connection details could not be read.'),
        nextStep: vscode.l10n.t('Review the error name in the diagnostic report, then run the diagnosis again.'),
    };
}

function endpointMissingMessage(data: FindingData): FindingMessage {
    const source = stringField(data, 'source');
    switch (stringField(data, 'reason')) {
        case 'pending':
            return {
                title: vscode.l10n.t('Service address pending'),
                explanation: vscode.l10n.t('Kubernetes has not assigned an external address to this service yet.'),
                nextStep: vscode.l10n.t(
                    'Wait until the service has an external address, then run the diagnosis again.',
                ),
            };
        case 'unreachable':
            return {
                title: vscode.l10n.t('No reachable service address'),
                explanation: vscode.l10n.t(
                    'This service type has no address that can be reached from the host running these checks.',
                ),
                nextStep: vscode.l10n.t(
                    'Expose the service with a load balancer or node port, or use a ClusterIP service, which the extension reaches through port forwarding.',
                ),
            };
        default:
            return {
                title: vscode.l10n.t('Connection string unavailable'),
                explanation:
                    source === 'azure'
                        ? vscode.l10n.t('Azure did not return a connection string for this resource.')
                        : source === 'atlas'
                          ? vscode.l10n.t('MongoDB Atlas did not return a connection string for this cluster.')
                          : vscode.l10n.t('This connection has no connection string.'),
                nextStep: vscode.l10n.t(
                    'Check that the resource is fully provisioned and that its connection details are complete, then run the diagnosis again.',
                ),
            };
    }
}

/**
 * The probe codes whose own message describes a timeout of that probe. A `check.timeout` on one of
 * these checks reads as that finding (WI-27), so the row, the card and the report say what timed out.
 */
const timeoutWordingByCheck: Readonly<Record<string, 'tcp.timeout' | 'hello.noReply'>> = {
    tcp: 'tcp.timeout',
    hello: 'hello.noReply',
};

/**
 * Whether a `check.timeout` finding has its probe's own wording. A whole-run timeout keeps the
 * generic text: the run's limit, not the probe, ended the step.
 */
export function hasSpecificTimeoutWording(finding: Pick<Finding<FindingCode>, 'code' | 'data'>): boolean {
    if (finding.code !== 'check.timeout') {
        return false;
    }
    const data = finding.data ?? {};
    const operation = stringField(data, 'operation');
    return (
        operation !== undefined &&
        Object.hasOwn(timeoutWordingByCheck, operation) &&
        stringField(data, 'source') !== 'run'
    );
}

export const findingMessages: {
    readonly [C in FindingCode]: (data: Readonly<Record<string, unknown>>) => FindingMessage;
} = {
    'check.timeout': (data): FindingMessage => {
        const operation = stringField(data, 'operation');
        const source = stringField(data, 'source');
        let nextStep: string;
        if (source === 'connection') {
            nextStep = vscode.l10n.t(
                'Increase the timeout configured on this connection, then run the diagnosis again.',
            );
        } else if (source === 'check' || source === 'run') {
            nextStep = vscode.l10n.t(
                'Choose Retry with longer timeouts, or Retry without diagnostic timeouts, which may wait until cancelled.',
            );
        } else {
            nextStep = vscode.l10n.t(
                'Choose Retry with longer timeouts, or Retry without diagnostic timeouts, which may wait until cancelled. If a connection timeout limited this step, change that connection setting first.',
            );
        }
        const generic: FindingMessage = {
            title: vscode.l10n.t('Step timed out'),
            explanation: vscode.l10n.t(
                'This step did not finish within the time limit. This alone does not show that the server is unreachable.',
            ),
            nextStep:
                operation !== undefined && ['srv', 'dns', 'tcp', 'tls', 'hello', 'authenticate'].includes(operation)
                    ? firewallAdvice(nextStep)
                    : nextStep,
        };
        if (operation === undefined || !hasSpecificTimeoutWording({ code: 'check.timeout', data })) {
            return generic;
        }
        const specific = findingMessages[timeoutWordingByCheck[operation]]({});
        // A connection's own timeout keeps the advice to change that setting.
        return source === 'connection' ? { ...specific, nextStep: generic.nextStep } : specific;
    },
    'env.proxyConfigured': (): FindingMessage => ({
        title: vscode.l10n.t('Proxy settings detected'),
        explanation: vscode.l10n.t(
            'Proxy environment variables are set. They and the VS Code proxy setting do not automatically apply to database traffic.',
        ),
        nextStep: vscode.l10n.t(
            'Check how database traffic should reach this cluster from the host running these checks.',
        ),
    }),
    // No next step: the SRV fallback is on unless an environment variable turns it off, and no fixed
    // VS Code release exists yet. `srv.compressedReplyRejected` says what to do when it matters.
    'env.caresRejectsCompressedSrv': (): FindingMessage => ({
        title: vscode.l10n.t('Known DNS issue in this VS Code version'),
        explanation: vscode.l10n.t(
            "Some DNS servers send server list (SRV) replies that this VS Code version can't read. The extension works around this automatically.",
        ),
    }),
    'cs.unparseable': (): FindingMessage => ({
        title: vscode.l10n.t('Connection string not recognized'),
        explanation: vscode.l10n.t('The connection string could not be read as a valid MongoDB API connection string.'),
        nextStep: vscode.l10n.t('Check the connection string scheme, host names, ports and option syntax.'),
    }),
    'cs.srvWithPort': (): FindingMessage => ({
        title: vscode.l10n.t('Port not allowed with SRV'),
        explanation: vscode.l10n.t('The SRV connection string includes an explicit port.'),
        nextStep: vscode.l10n.t('Remove the port. SRV records supply the server ports.'),
    }),
    'cs.srvMultipleHosts': (): FindingMessage => ({
        title: vscode.l10n.t('SRV requires one host'),
        explanation: vscode.l10n.t('The SRV connection string lists more than one seed host.'),
        nextStep: vscode.l10n.t('Use the single SRV host name supplied for the cluster.'),
    }),
    'cs.unknownOption': (data): FindingMessage => {
        const option = stringField(data, 'option');
        const suggestion = stringField(data, 'suggestion');
        return {
            title: vscode.l10n.t('Unsupported connection option'),
            explanation:
                option === undefined
                    ? vscode.l10n.t('The connection string contains an option the driver does not recognize.')
                    : vscode.l10n.t('The driver does not recognize the connection option {0}.', option),
            nextStep:
                suggestion === undefined
                    ? vscode.l10n.t('Remove the unsupported option or correct its spelling.')
                    : vscode.l10n.t('Check whether you meant {0}, or remove the unsupported option.', suggestion),
        };
    },
    'cs.optionIgnoredByDriver': (data): FindingMessage => {
        const option = stringField(data, 'option');
        const replacement = stringField(data, 'replacement');
        return {
            title: vscode.l10n.t('Deprecated connection option'),
            explanation:
                option === undefined
                    ? vscode.l10n.t(
                          'The connection string uses a deprecated driver option. This does not establish that the driver ignores it.',
                      )
                    : vscode.l10n.t(
                          'The connection option {0} is deprecated. This does not establish that the driver ignores it.',
                          option,
                      ),
            nextStep:
                replacement === undefined
                    ? vscode.l10n.t('Review the driver documentation and remove or replace the deprecated option.')
                    : vscode.l10n.t('Use {0} instead of the deprecated option.', replacement),
        };
    },
    'cs.conflictingTlsOptions': (): FindingMessage => ({
        title: vscode.l10n.t('Conflicting secure connection settings'),
        explanation: vscode.l10n.t('The ssl and tls options disagree.'),
        nextStep: vscode.l10n.t('Keep one tls option with the value required by your cluster.'),
    }),
    'cs.tlsVerificationDisabled': (): FindingMessage => ({
        title: vscode.l10n.t('Certificate checks weakened'),
        explanation: vscode.l10n.t('Connection options disable certificate or host name verification.'),
        nextStep: vscode.l10n.t(
            'Restore certificate verification and configure a trusted CA and matching server host name.',
        ),
    }),
    'cs.directConnectionWithMultipleHosts': (): FindingMessage => ({
        title: vscode.l10n.t('Direct connection has multiple hosts'),
        explanation: vscode.l10n.t('A direct connection is requested with more than one seed host.'),
        nextStep: vscode.l10n.t(
            'Use a single host for a direct connection, or remove directConnection to allow discovery.',
        ),
    }),
    'cs.unencodedReservedCharacter': (data): FindingMessage => {
        let explanation = vscode.l10n.t('A credential contains a reserved character that is not percent-encoded.');
        if (stringField(data, 'part') === 'username') {
            explanation = vscode.l10n.t('The username contains a reserved character that is not percent-encoded.');
        } else if (stringField(data, 'part') === 'password') {
            explanation = vscode.l10n.t('The password contains a reserved character that is not percent-encoded.');
        }
        return {
            title: vscode.l10n.t('Credential character needs encoding'),
            explanation,
            nextStep: vscode.l10n.t('Percent-encode reserved characters in connection-string credentials.'),
        };
    },
    'cs.authSourceUnusual': (data): FindingMessage => {
        const authSource = stringField(data, 'authSource');
        return {
            title: vscode.l10n.t('Uncommon authentication database'),
            explanation:
                authSource === undefined
                    ? vscode.l10n.t(
                          'The authentication database is neither admin nor $external. This may be intentional.',
                      )
                    : vscode.l10n.t(
                          'The authentication database is {0}, rather than admin or $external. This may be intentional.',
                          authSource,
                      ),
            nextStep: vscode.l10n.t('Confirm that authSource names the database where this user is defined.'),
        };
    },
    'cs.compressorUnavailable': (data): FindingMessage => compressorMessage(data, false),
    'srv.notFound': (): FindingMessage => ({
        title: vscode.l10n.t('Server addresses not found'),
        explanation: vscode.l10n.t('DNS returned no usable SRV server addresses for this connection.'),
        nextStep: vscode.l10n.t(
            'Check the SRV host name and the DNS configuration on this network, including VPN access.',
        ),
    }),
    'srv.compressedReplyRejected': (data): FindingMessage => {
        switch (stringField(data, 'fallbackOutcome')) {
            case 'succeeded':
                return {
                    title: vscode.l10n.t('DNS workaround used for the server list'),
                    explanation: vscode.l10n.t(
                        "This VS Code version couldn't read your DNS server's reply for the server list (SRV record), so the extension read it another way. Nothing needs to change.",
                    ),
                };
            case 'disabled':
                return {
                    title: vscode.l10n.t('Server list could not be read'),
                    explanation: vscode.l10n.t(
                        "This VS Code version couldn't read your DNS server's reply for the server list (SRV record), and the extension's workaround is turned off.",
                    ),
                    nextStep: vscode.l10n.t(
                        'Remove the DOCUMENTDB_DISABLE_SRV_FALLBACK environment variable, restart VS Code, then run the diagnosis again.',
                    ),
                };
            default:
                return {
                    title: vscode.l10n.t('Server list could not be read'),
                    explanation: vscode.l10n.t(
                        "This VS Code version couldn't read your DNS server's reply for the server list (SRV record), and the extension's workaround could not read it either.",
                    ),
                    nextStep: vscode.l10n.t(
                        'Check that the computer or remote host running these checks can reach its DNS servers, including over VPN, then run the diagnosis again.',
                    ),
                };
        }
    },
    'srv.txtUnsupportedOption': (): FindingMessage => ({
        title: vscode.l10n.t('DNS connection options invalid'),
        explanation: vscode.l10n.t('The DNS TXT record contains unsupported or invalid connection options.'),
        nextStep: vscode.l10n.t('Ask the DNS or cluster administrator to correct the TXT record.'),
    }),
    'srv.targetOutsideDomain': (): FindingMessage => ({
        title: vscode.l10n.t('DNS target outside the expected domain'),
        explanation: vscode.l10n.t('An SRV target does not meet the parent-domain rule for this connection.'),
        nextStep: vscode.l10n.t(
            'Check the cluster SRV record with your DNS administrator. Do not bypass the domain check.',
        ),
    }),
    'dns.notFound': (): FindingMessage => ({
        title: vscode.l10n.t('Host name not found'),
        explanation: vscode.l10n.t("Your system's lookup could not find this host name."),
        nextStep: vscode.l10n.t(
            'Check the host name and the DNS settings used by the computer or remote host running these checks.',
        ),
    }),
    'dns.temporaryFailure': (): FindingMessage => ({
        title: vscode.l10n.t('DNS lookup temporarily failed'),
        explanation: vscode.l10n.t("Your system's lookup reported a temporary failure."),
        nextStep: vscode.l10n.t('Check your DNS server and VPN connection, then run the diagnosis again.'),
    }),
    'dns.resolversDisagree': (data): FindingMessage => ({
        title: vscode.l10n.t('Name lookups disagree'),
        explanation:
            stringField(data, 'caresErrorCode') !== undefined && numberField(data, 'caresAddressCount') === 0
                ? vscode.l10n.t(
                      'Your system found this host name, but a direct query to your DNS servers did not. A VPN, split DNS or a hosts file entry can cause this.',
                  )
                : vscode.l10n.t(
                      'Your system and a direct query to your DNS servers returned different addresses for this host name. A VPN, split DNS or a hosts file entry can cause this.',
                  ),
        // The driver connects to host names through the system lookup, but reads a mongodb+srv
        // server list with a direct DNS query, so neither answer alone is "the one that counts".
        nextStep: vscode.l10n.t(
            "If the connection fails or reaches the wrong server, check your hosts file, VPN and split DNS settings. Connections use your system's answer for host names; the server list of a mongodb+srv connection comes from a direct DNS query.",
        ),
    }),
    'dns.privateEndpoint': (): FindingMessage => ({
        title: vscode.l10n.t('Private address for this Azure host name'),
        explanation: vscode.l10n.t(
            "The name goes through Azure's private-link alias and resolves to a private address. This does not prove how the cluster is configured.",
        ),
        nextStep: vscode.l10n.t(
            'Make sure the host running these checks can reach the private network or VPN used by the endpoint.',
        ),
    }),
    'dns.privateEndpointPublicAddress': (): FindingMessage => ({
        title: vscode.l10n.t('Public address for this Azure host name'),
        explanation: vscode.l10n.t(
            "The name goes through Azure's private-link alias and resolves to a public address. That is normal outside the cluster's private network.",
        ),
    }),
    'dns.loopback': (): FindingMessage => ({
        title: vscode.l10n.t('Host name resolves to localhost'),
        explanation: vscode.l10n.t('The host name resolves to a loopback address on the host running these checks.'),
        nextStep: vscode.l10n.t(
            'Confirm that the database or local tunnel is running on that host, especially in remote VS Code sessions.',
        ),
    }),
    'dns.mixedHostDomains': (data): FindingMessage => {
        const clouds = Array.isArray(data.clouds)
            ? data.clouds
                  .filter((cloud): cloud is DocumentDBEntraCloud =>
                      ['AzureCloud', 'AzureUSGovernment', 'AzureChinaCloud'].includes(cloud as string),
                  )
                  .map(getCloudDisplayName)
            : [];
        if (stringField(data, 'kind') === 'crossCloud') {
            return {
                title: vscode.l10n.t('Host names in different Azure clouds'),
                explanation:
                    clouds.length > 1
                        ? vscode.l10n.t(
                              "The host names belong to different Azure clouds ({0}). One connection can't use more than one cloud.",
                              clouds.join(', '),
                          )
                        : vscode.l10n.t(
                              "The host names belong to different Azure clouds. One connection can't use more than one cloud.",
                          ),
                nextStep: vscode.l10n.t('Check the host names in the connection string.'),
            };
        }
        return {
            title: vscode.l10n.t('Host names outside the Azure domains'),
            explanation:
                clouds.length === 1
                    ? vscode.l10n.t(
                          "Some host names are in {0}, others are outside the built-in Azure domains. Microsoft Entra ID sends tokens only to recognized or trusted hosts, and the cloud check can't use the other names.",
                          clouds[0],
                      )
                    : vscode.l10n.t(
                          "Some host names are in an Azure cloud, others are outside the built-in Azure domains. Microsoft Entra ID sends tokens only to recognized or trusted hosts, and the cloud check can't use the other names.",
                      ),
            nextStep: vscode.l10n.t(
                'If they are private names for this cluster, set documentDB.customEnvironment.hostnameSuffix to their trusted suffix.',
            ),
        };
    },
    'tcp.refused': (data): FindingMessage => ({
        title: vscode.l10n.t('Network connection refused'),
        explanation:
            data.addressClass === 'loopback'
                ? vscode.l10n.t('Nothing accepted the connection on this port on this computer.')
                : vscode.l10n.t(
                      'The TCP connection was refused. The service may be stopped or listening on a different port.',
                  ),
        nextStep:
            data.addressClass === 'loopback'
                ? vscode.l10n.t('Start the local database, container or tunnel that should listen on this port.')
                : firewallAdvice(vscode.l10n.t('Check the port and that the database service or tunnel is running.')),
    }),
    'tcp.timeout': (data): FindingMessage => ({
        title: vscode.l10n.t('Network connection timed out'),
        explanation: vscode.l10n.t(
            'The TCP connection attempt timed out without connecting. This does not identify what blocked it.',
        ),
        nextStep:
            data.addressClass === 'loopback'
                ? vscode.l10n.t(
                      'Check the local database, container or tunnel on this computer, then run the diagnosis again.',
                  )
                : firewallAdvice(vscode.l10n.t('Check the endpoint and network path, then run the diagnosis again.')),
    }),
    'tcp.unreachable': (data): FindingMessage => ({
        title: vscode.l10n.t('Network route unavailable'),
        explanation:
            data.addressClass === 'loopback'
                ? vscode.l10n.t('The local address could not be reached on this computer.')
                : vscode.l10n.t('The host or its network could not be reached through the current route.'),
        nextStep:
            data.addressClass === 'loopback'
                ? vscode.l10n.t(
                      'Check the local database, container or tunnel on this computer, then run the diagnosis again.',
                  )
                : firewallAdvice(
                      vscode.l10n.t('Check routing and whether the required VPN or private network is connected.'),
                  ),
    }),
    'tcp.reset': (data): FindingMessage => ({
        title: vscode.l10n.t('Network connection reset'),
        explanation:
            data.addressClass === 'loopback'
                ? vscode.l10n.t('The TCP connection on this computer was reset.')
                : vscode.l10n.t('The TCP connection was reset by the peer or something on the network path.'),
        nextStep:
            data.addressClass === 'loopback'
                ? vscode.l10n.t(
                      'Check the local database, container or tunnel on this computer, then run the diagnosis again.',
                  )
                : firewallAdvice(vscode.l10n.t('Check that the endpoint and port accept database connections.')),
    }),
    'tls.notTlsServer': (): FindingMessage => ({
        title: vscode.l10n.t('Endpoint did not speak TLS'),
        explanation: vscode.l10n.t('The endpoint returned a non-TLS reply to the secure handshake.'),
        nextStep: vscode.l10n.t(
            'Check the endpoint, port and TLS requirements. Use the secure endpoint supplied by the cluster administrator.',
        ),
    }),
    'tls.handshakeRejectedByServer': (data): FindingMessage => ({
        title: vscode.l10n.t('Secure handshake closed'),
        explanation:
            data.addressClass === 'loopback'
                ? vscode.l10n.t(
                      'The connection on this computer was accepted, then closed during the secure handshake, before a certificate arrived.',
                  )
                : vscode.l10n.t('The connection closed during the secure handshake, before a certificate arrived.'),
        nextStep:
            data.addressClass === 'loopback'
                ? vscode.l10n.t(
                      'Check that the local database is running. If you use a local tunnel or proxy, check that it can reach its destination.',
                  )
                : firewallAdvice(vscode.l10n.t('Check the endpoint and its secure connection requirements.')),
    }),
    'tls.selfSigned': (): FindingMessage => ({
        title: vscode.l10n.t('Self-signed certificate detected'),
        explanation: vscode.l10n.t('The certificate or its chain contains a self-signed certificate.'),
        nextStep: vscode.l10n.t(
            'Obtain the trusted CA certificate from your administrator and configure tlsCAFile. Do not disable certificate checks.',
        ),
    }),
    'tls.untrustedIssuer': (): FindingMessage => ({
        title: vscode.l10n.t('Certificate issuer not trusted'),
        explanation: vscode.l10n.t('The certificate issuer could not be verified using the configured trust store.'),
        nextStep: vscode.l10n.t(
            'Check the CA bundle and any corporate TLS inspection certificate with your administrator.',
        ),
    }),
    'tls.hostnameMismatch': (): FindingMessage => ({
        title: vscode.l10n.t('Certificate host name mismatch'),
        explanation: vscode.l10n.t('The certificate does not match the host name used for the connection.'),
        nextStep: vscode.l10n.t(
            'Use the host name covered by the certificate, or ask your administrator to correct the certificate.',
        ),
    }),
    'tls.expired': (): FindingMessage => ({
        title: vscode.l10n.t('Certificate expired'),
        explanation: vscode.l10n.t('A certificate in the server certificate chain has expired.'),
        nextStep: vscode.l10n.t(
            'Check the clock on the host running these checks and ask your administrator to renew the expired certificate.',
        ),
    }),
    'tls.notYetValid': (): FindingMessage => ({
        title: vscode.l10n.t('Certificate not yet valid'),
        explanation: vscode.l10n.t('A certificate in the server certificate chain has a validity date in the future.'),
        nextStep: vscode.l10n.t(
            'Check the clock on the host running these checks and the certificate validity dates with your administrator.',
        ),
    }),
    'tls.verificationBypassed': (): FindingMessage => ({
        title: vscode.l10n.t('Certificate exception used'),
        explanation: vscode.l10n.t(
            'A configured TLS exception allowed the connection despite a certificate verification problem.',
        ),
        nextStep: vscode.l10n.t(
            'Correct the certificate or trust configuration, then remove the verification exception.',
        ),
    }),
    'hello.noReply': (data): FindingMessage => ({
        title: vscode.l10n.t('No server response'),
        explanation: vscode.l10n.t(
            'No handshake reply arrived before the reply deadline. This alone does not show that the server is unreachable.',
        ),
        nextStep:
            data.addressClass === 'loopback'
                ? vscode.l10n.t(
                      'Check that the local database, container or tunnel accepts MongoDB API connections, then try a longer timeout.',
                  )
                : firewallAdvice(
                      vscode.l10n.t(
                          'Confirm that the endpoint accepts MongoDB API connections and try a longer timeout.',
                      ),
                  ),
    }),
    'hello.notWireProtocol': (): FindingMessage => ({
        title: vscode.l10n.t('Unexpected server protocol'),
        explanation: vscode.l10n.t('The endpoint replied, but not using the MongoDB API wire protocol.'),
        nextStep: vscode.l10n.t(
            'Check that the host and port belong to the database endpoint, not a web or management endpoint.',
        ),
    }),
    'hello.closedWithoutReply': (data): FindingMessage => ({
        title: vscode.l10n.t('Server closed without a reply'),
        explanation:
            data.tls === false
                ? vscode.l10n.t(
                      'The endpoint closed before a complete reply to the plaintext handshake. It may require TLS.',
                  )
                : vscode.l10n.t('The endpoint closed before a complete handshake reply arrived.'),
        nextStep:
            data.tls === false
                ? vscode.l10n.t('Check whether this endpoint requires TLS and enable it when required.')
                : vscode.l10n.t('Check the database endpoint and its connection requirements with your administrator.'),
    }),
    'hello.inconclusive': (): FindingMessage => ({
        title: vscode.l10n.t('Server greeting inconclusive'),
        explanation: vscode.l10n.t(
            'The bounded handshake reply could not establish a successful server response. The reply may be incomplete, invalid or rejected.',
        ),
        nextStep: vscode.l10n.t(
            'Check the endpoint and review the reply evidence in the diagnostic report. The real connection attempt is tested separately.',
        ),
    }),
    'hello.mechanismNotOffered': (data): FindingMessage => {
        const mechanism = stringField(data, 'mechanism');
        return {
            title: vscode.l10n.t('Authentication mechanism not offered'),
            explanation:
                mechanism === undefined
                    ? vscode.l10n.t('The server did not advertise the expected authentication mechanism for this user.')
                    : vscode.l10n.t('The server did not advertise {0} for this user.', mechanism),
            nextStep: vscode.l10n.t(
                'Check the user authentication mechanism and authentication database with the cluster administrator.',
            ),
        };
    },
    'hello.compressorUnavailable': (data): FindingMessage => compressorMessage(data, true),
    'hello.clockOffset': (data): FindingMessage => {
        const offset = numberField(data, 'offsetMs');
        let explanation = vscode.l10n.t(
            'The clock where these checks ran differs from the server clock. The measurement is an estimate.',
        );
        if (offset !== undefined) {
            const minutes = Math.round(Math.abs(offset) / 60000);
            explanation =
                offset > 0
                    ? vscode.l10n.t(
                          'The clock where these checks ran is {0} min behind the server. The measurement is an estimate.',
                          minutes,
                      )
                    : vscode.l10n.t(
                          'The clock where these checks ran is {0} min ahead of the server. The measurement is an estimate.',
                          minutes,
                      );
        }
        return {
            title: vscode.l10n.t('Clock difference detected'),
            explanation,
            nextStep: vscode.l10n.t(
                'Synchronize the clock on the host running these checks. Clock differences can affect certificates and Microsoft Entra ID tokens.',
            ),
        };
    },
    'env.remoteExtensionHost': (data): FindingMessage => {
        const remoteKind = stringField(data, 'remoteKind');
        let explanation = vscode.l10n.t('Database checks run on the remote extension host, not on this computer.');
        switch (remoteKind) {
            case 'wsl':
                explanation = vscode.l10n.t('Database checks run in WSL, not on this computer.');
                break;
            case 'ssh':
                explanation = vscode.l10n.t('Database checks run on the SSH host, not on this computer.');
                break;
            case 'devContainer':
                explanation = vscode.l10n.t('Database checks run in a dev container, not on this computer.');
                break;
            case 'codespaces':
                explanation = vscode.l10n.t('Database checks run in Codespaces, not on this computer.');
                break;
        }
        return {
            title: vscode.l10n.t('Checks run on a remote host'),
            explanation,
            nextStep: vscode.l10n.t(
                'Check network access, DNS and certificates on that remote host. VS Code sign-in runs on your local computer.',
            ),
        };
    },
    'target.notFound': (data): FindingMessage => notFoundMessage(data),
    'target.inputCancelled': (): FindingMessage => ({
        title: vscode.l10n.t('Port not provided'),
        explanation: vscode.l10n.t('The port prompt was closed without a value, so nothing was tested.'),
        nextStep: vscode.l10n.t('Run the diagnosis again and enter the port the server listens on.'),
    }),
    'target.sourceInaccessible': (data): FindingMessage => sourceInaccessibleMessage(data),
    'target.endpointMissing': (data): FindingMessage => endpointMissingMessage(data),
    'cs.credentialsMissing': (data): FindingMessage => missingCredentialsMessage(data),
    'prepare.failed': (data): FindingMessage => {
        if (stringField(data, 'providerId') === 'kubernetes-port-forward') {
            switch (stringField(data, 'reason')) {
                case 'sourceUnreachable':
                    return sourceInaccessibleMessage({ source: 'kubernetes', reason: 'unreachable' });
                case 'accessDenied':
                    return sourceInaccessibleMessage({ source: 'kubernetes', reason: 'accessDenied' });
                case 'targetNotFound':
                    return notFoundMessage({ source: 'kubernetes' });
                case 'noReadyBackend':
                    return {
                        title: vscode.l10n.t('No ready pods behind the service'),
                        explanation: vscode.l10n.t("Kubernetes reports no ready endpoint for the service's port."),
                        nextStep: vscode.l10n.t(
                            'Check that the database pods are running and ready and that the service selects them.',
                        ),
                    };
                case 'sourceMissing':
                    return {
                        title: vscode.l10n.t('Kubeconfig source not found'),
                        explanation: vscode.l10n.t(
                            'The kubeconfig source needed to prepare the connection was not found.',
                        ),
                        nextStep: vscode.l10n.t(
                            'Check the kubeconfig source and context, then run the diagnosis again.',
                        ),
                    };
            }
        }
        return {
            title: vscode.l10n.t('Connection preparation failed'),
            explanation: vscode.l10n.t('The connection could not be prepared for diagnosis.'),
            nextStep: vscode.l10n.t('Review the error name in the diagnostic report, then run the diagnosis again.'),
        };
    },
    'prepare.localPortInUse': (data): FindingMessage => {
        const localPort = numberField(data, 'localPort');
        const otherTunnel = stringField(data, 'holder') === 'otherTunnel';
        let explanation = otherTunnel
            ? vscode.l10n.t('The local port for the port-forward tunnel is used by another Kubernetes tunnel.')
            : vscode.l10n.t('The local port for the port-forward tunnel is used by another program.');
        if (localPort !== undefined) {
            explanation = otherTunnel
                ? vscode.l10n.t(
                      'Local port {0} is used by another Kubernetes tunnel, so the tunnel could not start.',
                      localPort,
                  )
                : vscode.l10n.t('Local port {0} is used by another program, so the tunnel could not start.', localPort);
        }
        return {
            title: vscode.l10n.t('Local port in use'),
            explanation,
            nextStep: vscode.l10n.t(
                'Free the port, then run the diagnosis again. For a service in the Discovery view, setting documentDB.serviceDiscovery.kubernetes.portForward.localPortStrategy to autoSelect picks a free port. Connection diagnosis never uses a port another program holds.',
            ),
        };
    },
    'prepare.sharedTunnel': (data): FindingMessage => {
        const tunnel = stringField(data, 'tunnel');
        if (tunnel === 'started') {
            return {
                title: vscode.l10n.t('Kubernetes port forward stays open'),
                explanation: vscode.l10n.t(
                    "This check started a Kubernetes port forward to reach this service's database through a local port. It is shared with other connections to this service and stays open after the check.",
                ),
                nextStep: vscode.l10n.t('It closes when you close or reload the VS Code window.'),
            };
        }
        if (tunnel === 'reused') {
            return {
                title: vscode.l10n.t('Kubernetes port forward stays open'),
                explanation: vscode.l10n.t(
                    'This check used a Kubernetes port forward that was already open. It stays open after the check.',
                ),
                nextStep: vscode.l10n.t('It closes when you close or reload the VS Code window.'),
            };
        }
        if (tunnel === 'externalAssumed') {
            return {
                title: vscode.l10n.t('Kubernetes port forward may be in use'),
                explanation: vscode.l10n.t(
                    'The local port was already in use by another program. It may be a Kubernetes port forward, but the extension did not verify it.',
                ),
            };
        }
        return {
            title: vscode.l10n.t('Kubernetes port forward status unknown'),
            explanation: vscode.l10n.t('The status of the Kubernetes port forward is not available.'),
        };
    },
    'hello.advertisedMembersUnreachable': (data): FindingMessage => {
        const count = numberField(data, 'unreachableCount');
        return {
            title: vscode.l10n.t('Advertised members unreachable'),
            explanation:
                count === undefined
                    ? vscode.l10n.t('The driver reported that advertised server members could not be reached.')
                    : vscode.l10n.t(
                          'The driver reported {0} advertised server members that could not be reached.',
                          count,
                      ),
            nextStep: firewallAdvice(
                vscode.l10n.t(
                    'Check that advertised member addresses are reachable from the host running these checks. For a local single-node setup only, directConnection=true can avoid discovery but changes failover behavior.',
                ),
            ),
        };
    },
    'auth.failed': (data): FindingMessage => {
        const method = stringField(data, 'authMethod');
        const entra = method === 'MicrosoftEntraID' || method === 'ManagedIdentity';
        return {
            title: vscode.l10n.t('Authentication rejected'),
            explanation: entra
                ? vscode.l10n.t('Sign-in succeeded, but the cluster did not accept this identity.')
                : vscode.l10n.t('The server rejected the selected authentication credentials.'),
            nextStep: entra
                ? vscode.l10n.t('Check that this identity is added as a user on the cluster.')
                : vscode.l10n.t('Check the username and password, and the authentication database.'),
        };
    },
    'auth.mechanismMismatch': (data): FindingMessage => {
        const requested = stringField(data, 'requested');
        return {
            title: vscode.l10n.t('Authentication mechanism mismatch'),
            explanation:
                requested === undefined
                    ? vscode.l10n.t('The selected authentication mechanism does not match what the server offers.')
                    : vscode.l10n.t('The server does not offer the requested authentication mechanism {0}.', requested),
            nextStep: vscode.l10n.t('Choose an authentication mechanism supported by this user and cluster.'),
        };
    },
    'auth.credentialsUnavailable': (data): FindingMessage => missingCredentialsMessage(data),
    'auth.serverSelectionTimeout': (data): FindingMessage => {
        if (stringField(data, 'timeoutSource') === 'extensionPolicy') {
            // The extension's emulator/local fail-fast, not a setting the user can change.
            return {
                title: vscode.l10n.t('No server selected'),
                explanation: vscode.l10n.t(
                    'The driver could not select a server within the short time limit the extension uses for emulator and local connections. This does not show that credentials were rejected.',
                ),
                nextStep: firewallAdvice(
                    vscode.l10n.t(
                        'Review the per-server errors in the diagnostic report, and check that the server is running and listening on the configured host and port.',
                    ),
                ),
            };
        }
        return {
            title: vscode.l10n.t('No server selected'),
            explanation: vscode.l10n.t(
                'The driver could not select a server before its time limit. This does not show that credentials were rejected.',
            ),
            nextStep: firewallAdvice(
                vscode.l10n.t(
                    'Review the per-server errors in the diagnostic report and check the cluster endpoints. If a connection timeout limited the attempt, change that connection setting before retrying.',
                ),
            ),
        };
    },
    'auth.driverOptionsRejected': (): FindingMessage => ({
        title: vscode.l10n.t('Connection options rejected'),
        explanation: vscode.l10n.t(
            'The driver rejected the connection options before connecting, so nothing was sent to the server.',
        ),
        nextStep: vscode.l10n.t(
            'Check the option values in the connection string, such as true or false for switches and numbers for timeouts, then connect again.',
        ),
    }),
    'auth.connectFailed': (): FindingMessage => ({
        title: vscode.l10n.t('Connection attempt failed'),
        explanation: vscode.l10n.t(
            'The connection attempt failed, and the diagnosis could not identify a more specific cause.',
        ),
        nextStep: vscode.l10n.t(
            'Review the earlier steps and the error name in the diagnostic report, check the connection settings, then connect again.',
        ),
    }),
    'auth.cloudMismatch': (): FindingMessage => ({
        title: vscode.l10n.t('Azure cloud mismatch'),
        explanation: vscode.l10n.t('The Azure cloud selected for sign-in does not match the cluster cloud.'),
        nextStep: vscode.l10n.t('Set microsoft-sovereign-cloud.environment to the cluster cloud, then connect again.'),
    }),
    'auth.tokenResourceUnresolved': (data): FindingMessage => {
        const kind = stringField(data, 'kind');
        let nextStep = vscode.l10n.t(
            'Check microsoft-sovereign-cloud.environment and the custom cloud settings with your cloud administrator.',
        );
        switch (kind) {
            case 'invalidCustomOverride':
                nextStep = vscode.l10n.t(
                    'Correct documentDB.customEnvironment.ossrdbmsEndpoint with your cloud administrator.',
                );
                break;
            case 'customCloudDefinitionInvalid':
                nextStep = vscode.l10n.t(
                    'Check the custom cloud definition in microsoft-sovereign-cloud.customEnvironment and select it with microsoft-sovereign-cloud.environment.',
                );
                break;
            case 'customCloudUnresolved':
                nextStep = vscode.l10n.t(
                    'Ask your cloud administrator for the DocumentDB sign-in resource and configure documentDB.customEnvironment.ossrdbmsEndpoint.',
                );
                break;
            case 'managedIdentityCloudUnknown':
                nextStep = vscode.l10n.t(
                    'Confirm the Azure VM cloud and configure documentDB.customEnvironment.ossrdbmsEndpoint when the cloud cannot be determined.',
                );
                break;
        }
        return {
            title: vscode.l10n.t('Sign-in resource unavailable'),
            explanation: vscode.l10n.t('The sign-in resource could not be determined from the cloud configuration.'),
            nextStep,
        };
    },
    'auth.oidcHostNotAllowed': (): FindingMessage => ({
        title: vscode.l10n.t('Host not allowed for sign-in'),
        explanation: vscode.l10n.t("Microsoft Entra ID isn't allowed for this server."),
        nextStep: vscode.l10n.t(
            'Verify the trusted service domain with your cloud administrator and set documentDB.customEnvironment.hostnameSuffix in user settings. Only trust your service domain.',
        ),
    }),
    'auth.entraTokenFailed': (data): FindingMessage => tokenFailureMessage(data),
    'auth.entraAudienceMismatch': (): FindingMessage => ({
        title: vscode.l10n.t('Sign-in token may target another resource'),
        explanation: vscode.l10n.t(
            'The token audience differs from the requested sign-in resource. This is an unverified hint from the token claims.',
        ),
        nextStep: vscode.l10n.t(
            'Check the selected cloud and sign-in resource with your administrator, then connect again.',
        ),
    }),
    'auth.entraTenantMismatch': (): FindingMessage => ({
        title: vscode.l10n.t('Sign-in token may belong to another tenant'),
        explanation: vscode.l10n.t(
            'The token tenant differs from the tenant configured for the connection. This is an unverified hint from the token claims.',
        ),
        nextStep: vscode.l10n.t('Use Update Credentials to choose the cluster tenant and the correct account.'),
    }),
    'access.listDatabasesDenied': (): FindingMessage => ({
        title: vscode.l10n.t('Listing databases denied'),
        explanation: vscode.l10n.t(
            'The connection succeeded, but the server denied the database-list request used by the extension.',
        ),
        nextStep: vscode.l10n.t(
            'Ask the cluster administrator for permission to list the databases you need. The connection itself is working.',
        ),
    }),
    // "Update Credentials…" is the command title in package.json.
    'access.signInRequired': (): FindingMessage => ({
        title: vscode.l10n.t('Sign-in required to use this connection'),
        explanation: vscode.l10n.t(
            'The server answered, but it requires sign-in to list or read databases. This connection is set to No authentication.',
        ),
        nextStep: vscode.l10n.t(
            'Use Update Credentials to choose an authentication method for this connection, then run the diagnosis again.',
        ),
    }),
    'access.noDatabasesVisible': (): FindingMessage => ({
        title: vscode.l10n.t('No databases visible'),
        explanation: vscode.l10n.t(
            'The connection succeeded, but the database-list request returned no databases visible to this user.',
        ),
        nextStep: vscode.l10n.t('Confirm that databases exist and that this user has access to the ones you need.'),
    }),
    'access.readRoleReported': (data): FindingMessage => {
        const role = stringField(data, 'role');
        const database = stringField(data, 'database');
        return {
            title: vscode.l10n.t('Read role reported'),
            explanation:
                role !== undefined && database !== undefined
                    ? vscode.l10n.t(
                          'The server reported the read role {0} on database {1}. This is not a full permissions audit.',
                          role,
                          database,
                      )
                    : vscode.l10n.t('The server reported a known read role. This is not a full permissions audit.'),
            nextStep: vscode.l10n.t(
                'Ask the cluster administrator if you need additional access. No write operation was tested.',
            ),
        };
    },
};

export function describeFinding(finding: Finding<FindingCode>): FindingMessage {
    if (!Object.hasOwn(findingMessages, finding.code)) {
        throw new Error('Unknown finding code');
    }
    return findingMessages[finding.code](finding.data ?? {});
}

/**
 * The report's wording for findings whose panel text leaves out how Node.js resolves names. Support
 * engineers read the report, so it names the resolvers; the title stays the panel's, so a user can
 * match the two. Every other code reads the same in both.
 */
const reportFindingMessages: Partial<Record<FindingCode, (data: FindingData) => Omit<FindingMessage, 'title'>>> = {
    'env.caresRejectsCompressedSrv': (data): Omit<FindingMessage, 'title'> => ({
        explanation: vscode.l10n.t(
            "This VS Code version runs c-ares (Node.js's DNS resolver) {0}, which rejects SRV replies with compressed target names. While the SRV fallback is on, which is the default, the extension resolves those replies itself.",
            stringField(data, 'aresVersion') ?? vscode.l10n.t('(version unknown)'),
        ),
        nextStep: vscode.l10n.t(
            'No action is needed while the SRV fallback is on; DOCUMENTDB_DISABLE_SRV_FALLBACK=1 turns it off. A VS Code release with a corrected c-ares version removes the limitation.',
        ),
    }),
    'srv.compressedReplyRejected': (data): Omit<FindingMessage, 'title'> => {
        const error = stringField(data, 'nodeErrorCode') ?? vscode.l10n.t('no error code');
        switch (stringField(data, 'fallbackOutcome')) {
            case 'succeeded':
                return {
                    explanation: vscode.l10n.t(
                        "c-ares (Node.js's DNS resolver) rejected the SRV reply ({0}). The extension's SRV fallback queried the configured DNS servers directly and resolved it.",
                        error,
                    ),
                };
            case 'disabled':
                return {
                    explanation: vscode.l10n.t(
                        "c-ares (Node.js's DNS resolver) rejected the SRV reply ({0}). The SRV fallback is turned off by DOCUMENTDB_DISABLE_SRV_FALLBACK=1.",
                        error,
                    ),
                    nextStep: vscode.l10n.t(
                        'Unset DOCUMENTDB_DISABLE_SRV_FALLBACK, restart VS Code and run the diagnosis again.',
                    ),
                };
            default:
                return {
                    explanation: vscode.l10n.t(
                        "c-ares (Node.js's DNS resolver) rejected the SRV reply ({0}), and the extension's SRV fallback returned no server addresses.",
                        error,
                    ),
                    nextStep: vscode.l10n.t(
                        'Check that the host running these checks can reach its configured DNS servers, including over VPN.',
                    ),
                };
        }
    },
    'dns.resolversDisagree': (data): Omit<FindingMessage, 'title'> => {
        const error = stringField(data, 'caresErrorCode');
        return {
            explanation:
                error === undefined
                    ? vscode.l10n.t(
                          "The operating system resolver (getaddrinfo, which honours the hosts file, VPN and split DNS) and c-ares (Node.js's DNS resolver, which queries the DNS servers directly) returned different addresses ({0} and {1}).",
                          numberField(data, 'osAddressCount') ?? 0,
                          numberField(data, 'caresAddressCount') ?? 0,
                      )
                    : vscode.l10n.t(
                          "The operating system resolver (getaddrinfo, which honours the hosts file, VPN and split DNS) answered, but c-ares (Node.js's DNS resolver, which queries the DNS servers directly) failed with {0}.",
                          error,
                      ),
            nextStep: vscode.l10n.t(
                'Check the hosts file, VPN and split-DNS configuration. The driver connects to host names resolved by the operating system resolver, and reads mongodb+srv SRV and TXT records with c-ares.',
            ),
        };
    },
};

/** The report's description of a finding: the panel's, with resolver names where the report needs them. */
export function describeFindingForReport(finding: Finding<FindingCode>): FindingMessage {
    const message = describeFinding(finding);
    const technical = Object.hasOwn(reportFindingMessages, finding.code)
        ? reportFindingMessages[finding.code]
        : undefined;
    return technical ? { title: message.title, ...technical(finding.data ?? {}) } : message;
}
