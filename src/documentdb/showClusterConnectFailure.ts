/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { ErrorExplanationService } from '../services/errorExplanationService';

export interface ShowClusterConnectFailureOptions {
    /** Stable cluster ID (never treeId); the diagnostics service and its providers key on it. */
    readonly clusterId: string;
    /** Display name used in the fallback heading. */
    readonly clusterName: string;
    /** Heading used when no diagnosis applies; defaults to 'Failed to connect to "<clusterName>"'. */
    readonly fallbackHeading?: string;
    /** The original connection error, passed through unchanged. */
    readonly error: unknown;
    /** Receives the `diagnosisProviderId` telemetry property. */
    readonly context: IActionContext;
    /** Optional paragraph appended to the detail (used by the decoded-password hint). */
    readonly extraDetail?: string;
    /** Optional extra modal buttons. */
    readonly buttons?: readonly string[];
}

/**
 * Shows the blocking modal for a failed first (non-cached) connection. Await it BEFORE evicting
 * CredentialCache entries or deleting the client: diagnostics providers read them.
 * @returns The button the user chose, or undefined.
 */
export async function showClusterConnectFailure(
    options: ShowClusterConnectFailureOptions,
): Promise<string | undefined> {
    const { clusterId, clusterName, fallbackHeading, error, context, extraDetail, buttons } = options;
    const diagnosis = await ErrorExplanationService.explain({ clusterId, error });
    context.telemetry.properties.diagnosisProviderId = diagnosis?.providerId ?? 'none';

    const errorMessage = error instanceof Error ? error.message : String(error);
    const heading =
        diagnosis?.message ?? fallbackHeading ?? l10n.t('Failed to connect to "{cluster}"', { cluster: clusterName });
    let detail = diagnosis
        ? errorMessage
        : l10n.t('Revisit connection details and try again.') +
          '\n\n' +
          l10n.t('Error: {error}', { error: errorMessage });

    if (extraDetail) {
        detail += '\n\n' + extraDetail;
    }

    return await vscode.window.showErrorMessage(heading, { modal: true, detail }, ...(buttons ?? []));
}
