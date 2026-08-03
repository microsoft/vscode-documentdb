/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { type AtlasClusterState } from './models/AtlasProjectModel';

/**
 * The subset of a cluster that decides whether it can be connected to. Both the raw Atlas API
 * payload (`AtlasCluster`) and the normalized tree model (`AtlasClusterModel`) can be reduced to
 * this shape, which is what lets the discovery tree and the connection wizard share one verdict.
 */
export interface AtlasClusterAvailability {
    /** Atlas reports a paused cluster as IDLE, so this has to be carried separately. */
    readonly paused?: boolean;
    readonly stateName: AtlasClusterState;
    /** Absent while Atlas is still provisioning the cluster. */
    readonly connectionString?: string;
}

/** Whether Atlas has paused the cluster, including automatic inactivity pauses. */
export function isAtlasClusterPaused(cluster: AtlasClusterAvailability): boolean {
    return cluster.paused === true;
}

/**
 * A running, IDLE cluster with a published connection string is the only thing that can be
 * opened. Every surface that offers a connect affordance must agree on this, otherwise the tree
 * and the wizard disagree about the same cluster.
 */
export function isAtlasClusterConnectable(cluster: AtlasClusterAvailability): boolean {
    return !isAtlasClusterPaused(cluster) && cluster.stateName === 'IDLE' && !!cluster.connectionString;
}

/**
 * Short, localized annotation for a cluster that is not simply running, or `undefined` when it
 * needs none. Shown next to the cluster name in the tree description and in the quick pick.
 */
export function getAtlasClusterStateLabel(cluster: AtlasClusterAvailability): string | undefined {
    if (isAtlasClusterPaused(cluster)) {
        return l10n.t('Paused');
    }

    const labels: Record<AtlasClusterState, string | undefined> = {
        IDLE: undefined,
        CREATING: l10n.t('Creating…'),
        UPDATING: l10n.t('Updating…'),
        REPAIRING: l10n.t('Repairing…'),
        DELETING: l10n.t('Deleting…'),
        UNKNOWN: l10n.t('Unknown state'),
    };

    return labels[cluster.stateName];
}

/**
 * Why a paused cluster cannot be opened, and what to do about it. Shared verbatim so the tree
 * tooltip and the wizard's modal give the same instruction.
 *
 * The remaining state explanations stay with their surface on purpose: the wizard says "from the
 * wizard" and points at the quick pick, while the tree tooltip is phrased for the tree.
 */
export function getAtlasPausedExplanation(): string {
    return l10n.t('This cluster is paused. Resume it in MongoDB Atlas before connecting.');
}
