/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { Links } from '../../../constants';
import { getCloudDisplayName, type CloudCategory } from '../documentdbTokenResource';

export interface EntraErrorContext {
    readonly code?: string;
    readonly cloudCategory?: CloudCategory;
    readonly recentTokenFailure: boolean;
}

export interface EntraErrorRule {
    readonly id: string;
    readonly aadsts?: readonly string[];
    readonly msal?: readonly string[];
    readonly pattern?: RegExp;
    explain(context: EntraErrorContext): string;
}

export const entraErrorRules: readonly EntraErrorRule[] = [
    {
        id: 'firstPartyPreauthorization',
        aadsts: ['65002'],
        explain: (): string =>
            l10n.t(
                'Microsoft Entra ID sign-in for Azure DocumentDB appears to require Microsoft to preauthorize VS Code. Only Microsoft can change this, not you or your tenant administrator. Use native DocumentDB authentication or managed identity on an Azure VM as a workaround, and report this on GitHub. See {link}',
                { link: Links.SovereignClouds },
            ),
    },
    {
        id: 'resourceNotInTenant',
        aadsts: ['500011'],
        explain: (): string =>
            l10n.t(
                'The selected Azure cloud very likely does not match the cluster. Check the "microsoft-sovereign-cloud.environment" setting. If it already matches, report this on GitHub or ask your tenant administrator to check whether the sign-in resource is available in your tenant. See {link}',
                { link: Links.SovereignClouds },
            ),
    },
    {
        id: 'invalidResource',
        aadsts: ['50001'],
        explain: (): string =>
            l10n.t(
                'The requested Microsoft Entra sign-in resource does not appear to be valid for this cloud. If "documentDB.customEnvironment.ossrdbmsEndpoint" is set, check its value with your cloud administrator. Otherwise, report this on GitHub so the extension maintainers can investigate. See {link}',
                { link: Links.SovereignClouds },
            ),
    },
    {
        id: 'accountNotInTenant',
        aadsts: ['50020', '90072'],
        explain: (): string =>
            l10n.t(
                "This account does not appear to be a member or guest of the organization that owns the cluster. Use Update Credentials to choose another account or tenant, or ask that organization's administrator to grant access. See {link}",
                { link: Links.SovereignClouds },
            ),
    },
    {
        id: 'applicationNotInDirectory',
        aadsts: ['700016'],
        explain: (): string =>
            l10n.t(
                'The sign-in application could not be found in the directory, usually because the wrong Azure cloud or tenant is selected. Check "microsoft-sovereign-cloud.environment" and use Update Credentials to choose the cluster\'s tenant. If both are correct, ask your tenant administrator or report this on GitHub. See {link}',
                { link: Links.SovereignClouds },
            ),
    },
    {
        id: 'tenantNotFound',
        aadsts: ['90002'],
        explain: (): string =>
            l10n.t(
                'The tenant does not appear to exist in the selected Azure cloud. Check "microsoft-sovereign-cloud.environment" and use Update Credentials to select the right tenant. Your organization\'s administrator can confirm which cloud and tenant to use. See {link}',
                { link: Links.SovereignClouds },
            ),
    },
    {
        id: 'crossCloudNotAllowed',
        aadsts: ['1000104'],
        explain: (): string =>
            l10n.t(
                "Sign-in appears to be blocked because the account is from another Azure cloud. Sign in with an account from the cluster's cloud, or ask the organizations' administrators to check their cross-cloud access settings. See {link}",
                { link: Links.SovereignClouds },
            ),
    },
    {
        id: 'conditionalAccess',
        aadsts: ['53003'],
        explain: (): string =>
            l10n.t(
                "Your organization's policy appears to have blocked this sign-in. Contact your IT help desk with code AADSTS53003 and the time of the failure so they can check the sign-in policy. See {link}",
                { link: Links.SovereignClouds },
            ),
    },
    {
        id: 'additionalVerification',
        aadsts: ['50076', '50079'],
        explain: (): string =>
            l10n.t(
                'Microsoft Entra ID appears to require additional verification. Sign in again and complete the verification requested by your organization. If you cannot complete it, contact your IT help desk. See {link}',
                { link: Links.SovereignClouds },
            ),
    },
    {
        id: 'brokerOpaque',
        msal: ['platform_broker_error'],
        explain: (context): string => {
            if (context.recentTokenFailure && context.cloudCategory && context.cloudCategory !== 'public') {
                return l10n.t(
                    'Sign-in failed in {cloud}. If the sign-in window showed AADSTS65002 ("must be configured via preauthorization"), Microsoft Entra ID sign-in for Azure DocumentDB is not enabled yet for VS Code in this cloud. Only Microsoft can change this, not you or your tenant administrator. Use native DocumentDB authentication or managed identity on an Azure VM as a workaround, and report this on GitHub. See {link}',
                    { cloud: cloudDisplayName(context.cloudCategory), link: Links.SovereignClouds },
                );
            }

            const authenticationLog =
                context.cloudCategory && context.cloudCategory !== 'public'
                    ? 'Microsoft Sovereign Cloud Authentication'
                    : 'Microsoft Authentication';
            return l10n.t(
                'The sign-in window reported an error without details. Check the error code shown in that window, or open Developer: Show Logs... > {authenticationLog} in VS Code. Your IT help desk can help interpret the code; if the problem persists, report it on GitHub. See {link}',
                { authenticationLog, link: Links.SovereignClouds },
            );
        },
    },
    {
        id: 'oidcHostNotAllowed',
        pattern: /^Host '[^'\r\n]+' is not valid for OIDC authentication with ALLOWED_HOSTS of '[^'\r\n]*'$/m,
        explain: (): string =>
            l10n.t(
                'The driver does not appear to allow this cluster host for Microsoft Entra ID authentication. For a custom DNS endpoint, verify the trusted DocumentDB service hostname suffix with your cloud administrator and set "documentDB.customEnvironment.mongoClusterHostnameSuffix" in user settings. Only trust your service\'s domain, then connect again. See {link}',
                { link: Links.SovereignClouds },
            ),
    },
    {
        id: 'unknownAadsts',
        explain: (context): string =>
            l10n.t(
                'Microsoft Entra ID rejected the sign-in (AADSTS{code}). See https://login.microsoftonline.com/error?code={code} for details and ask your tenant administrator or IT help desk for help. Report this on GitHub if it persists. See {link}',
                { code: context.code ?? '', link: Links.SovereignClouds },
            ),
    },
];

function cloudDisplayName(category: CloudCategory): string {
    switch (category) {
        case 'public':
            return getCloudDisplayName('AzureCloud');
        case 'usgov':
            return getCloudDisplayName('AzureUSGovernment');
        case 'china':
            return getCloudDisplayName('AzureChinaCloud');
        case 'custom':
            return l10n.t('a custom cloud');
    }
}
