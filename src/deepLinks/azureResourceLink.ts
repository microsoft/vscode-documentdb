/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

import { DISCOVERY_PROVIDER_ID as RU_PROVIDER_ID } from '../plugins/service-azure-mongo-ru/config';
import { DISCOVERY_PROVIDER_ID as VCORE_PROVIDER_ID } from '../plugins/service-azure-mongo-vcore/config';

export type AzureResourceKind = 'vcore' | 'ru';

export interface AzureResourceLink {
    readonly resourceId: string;
    readonly subscriptionId: string;
    readonly resourceGroup: string;
    readonly name: string;
    readonly kind: AzureResourceKind;
    readonly providerId: string;
    readonly tenantId?: string;
}

/** Validates and parses an Azure resource link's resource and optional tenant IDs. */
export function parseAzureResourceLink(resourceId: string, tenantId?: string): AzureResourceLink {
    const segments = resourceId.split('/');
    const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    if (
        segments[0] !== '' ||
        segments[1]?.toLowerCase() !== 'subscriptions' ||
        !guid.test(segments[2] ?? '') ||
        segments[3]?.toLowerCase() !== 'resourcegroups' ||
        !segments[4] ||
        segments[5]?.toLowerCase() !== 'providers' ||
        (segments.length === 9 && !segments[8])
    ) {
        throw new Error(vscode.l10n.t('This DocumentDB link has an invalid Azure resource ID.'));
    }

    const resourceType = segments[7]?.toLowerCase();
    if (
        segments.length !== 9 ||
        segments[6]?.toLowerCase() !== 'microsoft.documentdb' ||
        (resourceType !== 'mongoclusters' && resourceType !== 'databaseaccounts')
    ) {
        throw new Error(
            vscode.l10n.t('This link points to an Azure resource type the DocumentDB extension cannot open.'),
        );
    }

    if (tenantId !== undefined && !guid.test(tenantId)) {
        throw new Error(vscode.l10n.t('This DocumentDB link has an invalid Azure tenant ID.'));
    }

    const kind: AzureResourceKind = resourceType === 'mongoclusters' ? 'vcore' : 'ru';
    return {
        resourceId,
        subscriptionId: segments[2],
        resourceGroup: segments[4],
        name: segments[8],
        kind,
        providerId: kind === 'vcore' ? VCORE_PROVIDER_ID : RU_PROVIDER_ID,
        ...(tenantId !== undefined ? { tenantId } : {}),
    };
}
