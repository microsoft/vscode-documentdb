/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { type JSX } from 'react';

import { type ClusterHealthSample } from '../../../../documentdb/utils/getClusterHealth';
import { regionToDisplayName } from '../../../../utils/regionToDisplayName';
// TODO(dashboard): promote summaryCard to src/webviews/components/ so views don't reach into
// each other. Reused as-is meanwhile so this column is visually identical to Query Insights'.
import { GenericCell, SummaryCard } from '../../collectionView/components/queryInsightsTab/components/summaryCard';
import { type ClusterDashboardAzureInfo } from '../clusterDashboardController';
import { type ClusterDashboardInfo } from '../clusterDashboardRouter';
import {
    describeCompute,
    describeProduct,
    describeTopology,
    extractHostName,
    formatEngineVersions,
    PLACEHOLDER,
} from '../clusterFacts';
import { formatUptime } from '../formatUtils';

export interface ClusterFactsCardProps {
    clusterInfo: ClusterDashboardInfo | null;
    latestSample: ClusterHealthSample | null;
    /** Azure resource facts, absent for a non-Azure cluster. */
    azure?: ClusterDashboardAzureInfo;
}

/**
 * "What is this cluster?" — the static description that used to occupy the full-width
 * header.
 *
 * It sits in the narrow right-hand column because it is reference material: read once when
 * the panel opens, then ignored while the reader works in the lists on the left. Rendered
 * with Query Insights' own `SummaryCard`/`GenericCell` pair so the two views' right columns
 * are the same object.
 */
export const ClusterFactsCard = ({ clusterInfo, latestSample, azure }: ClusterFactsCardProps): JSX.Element => {
    const metadata = clusterInfo?.metadata;

    // `undefined` renders each cell's skeleton, so the card holds its shape during the one
    // round trip it takes for the metadata to land.
    const loading = clusterInfo === null;
    const orLoading = <T,>(value: T): T | undefined => (loading ? undefined : value);

    // Rows the server may not answer at all. Azure DocumentDB (vCore) returns no
    // `buildInfo.platform` and a `hostInfo` with empty `os`/`system` fields, so rendering
    // these unconditionally left several cells showing a bare dash. They are dropped
    // instead, and the product/engine rows below — which vCore *does* report — take their
    // place. Nothing here arrives later in the session, so a row can never pop in.
    const optionalFacts: Array<{ label: string; value: string }> = [];

    const product = describeProduct(metadata);
    if (product !== null) {
        optionalFacts.push({ label: l10n.t('Product'), value: product });
    }

    const engineVersions = formatEngineVersions(metadata?.['topology_hello_internal_documentdb_versions']);
    if (engineVersions !== null) {
        optionalFacts.push({ label: l10n.t('Engine'), value: engineVersions });
    }

    const platform = metadata?.['serverInfo_platform'];
    if (platform !== undefined && platform !== '') {
        optionalFacts.push({ label: l10n.t('Platform'), value: platform });
    }

    const host = extractHostName(metadata?.['hostInfo_json']);
    if (host !== null) {
        optionalFacts.push({ label: l10n.t('Host'), value: host });
    }

    // Azure facts the discovery views already fetched from ARM — the cluster's shape, which
    // the data plane cannot report at all on vCore.
    if (azure?.location !== undefined) {
        optionalFacts.push({ label: l10n.t('Region'), value: regionToDisplayName(azure.location) });
    }

    const compute = describeCompute(azure);
    if (compute !== null) {
        optionalFacts.push({ label: l10n.t('Compute'), value: compute });
    }

    if (azure?.replicaRole !== undefined) {
        optionalFacts.push({ label: l10n.t('Replication role'), value: azure.replicaRole });
    }

    return (
        <SummaryCard title={l10n.t('Cluster')}>
            <GenericCell
                label={l10n.t('Server version')}
                value={orLoading(metadata?.['serverInfo_version'] ?? PLACEHOLDER)}
            />
            {optionalFacts.map((fact) => (
                <GenericCell key={fact.label} label={fact.label} value={fact.value} />
            ))}
            {/*
             * `topology_type` is `hello.msg`, which only mongos sets ('isdbgrid'); every
             * standalone, emulator, and replica-set primary would render the literal word
             * 'unknown', and a mongos would render a raw wire token. Report the server count
             * instead, which is meaningful everywhere.
             */}
            <GenericCell label={l10n.t('Topology')} value={orLoading(describeTopology(metadata))} />
            {/*
             * Kept even when empty, unlike the optional rows above: `uptimeSeconds` comes
             * from the live sample rather than the one-shot metadata, so it can arrive on a
             * later poll and must hold its place in the layout.
             */}
            <GenericCell
                label={l10n.t('Uptime')}
                value={orLoading(formatUptime(latestSample?.uptimeSeconds, PLACEHOLDER))}
            />
        </SummaryCard>
    );
};
