/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getConfiguredAuthProviderId, getConfiguredAzureEnv } from '@microsoft/vscode-azext-azureauth';
import * as vscode from 'vscode';
import { toEntraScope } from './entraScopes';

export interface EntraSignInEnvironment {
    readonly providerId: string;
    readonly cloudName: string;
    readonly authority?: string;
}

export function readEntraSignInEnvironment(): EntraSignInEnvironment {
    const providerId = getConfiguredAuthProviderId();
    const { name: cloudName, activeDirectoryEndpointUrl: authority } = getConfiguredAzureEnv();
    return { providerId, cloudName, authority };
}

interface EntraSessionRequest {
    providerId: string;
    resource: string;
    tenantId?: string;
    account?: vscode.AuthenticationSessionAccountInformation;
    mode: 'interactive' | 'silent' | 'forceNew';
}

export async function getEntraSession({
    providerId,
    resource,
    tenantId,
    account,
    mode,
}: EntraSessionRequest): Promise<vscode.AuthenticationSession | undefined> {
    const scopes = [resource.endsWith('.default') ? resource : toEntraScope(resource)];
    if (tenantId) {
        scopes.push(`VSCODE_TENANT:${tenantId}`);
    }
    const options = account ? { account } : {};
    switch (mode) {
        case 'interactive':
            return await vscode.authentication.getSession(providerId, scopes, { ...options, createIfNone: true });
        case 'silent':
            return await vscode.authentication.getSession(providerId, scopes, { ...options, silent: true });
        case 'forceNew':
            return await vscode.authentication.getSession(providerId, scopes, { ...options, forceNewSession: true });
    }
}
