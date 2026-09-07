/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, Card, Text } from '@fluentui/react-components';
import { EyeRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { type JSX } from 'react';

import { type ClusterHealthSample } from '../../../../documentdb/utils/getClusterHealth';
import { regionToDisplayName } from '../../../../utils/regionToDisplayName';
import { useTrpcClient } from '../../../_integration/useTrpcClient';
// TODO(dashboard): promote summaryCard to src/webviews/components/ so views don't reach into
// each other. Reused as-is meanwhile so this column is visually identical to Query Insights'.
import { GenericCell } from '../../collectionView/queryInsightsTab/components/summaryCard';
import { type ClusterDashboardAzureInfo } from '../clusterDashboardController';
import { type ClusterDashboardInfo } from '../clusterDashboardRouter';
import { describeCompute, describeProduct, extractHostName, formatEngineVersions } from '../clusterFacts';
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
    const trpcClient = useTrpcClient();
    const metadata = clusterInfo?.metadata;

    const viewRawClusterInfo = (): void => {
        void trpcClient.clusterDashboard.viewRawClusterInfo.mutate().catch((error: unknown) => {
            void trpcClient.common.displayErrorMessage.mutate({
                message: l10n.t('Failed to open the cluster details.'),
                modal: true,
                cause: error instanceof Error ? error.message : String(error),
            });
        });
    };

    // `undefined` renders each cell's skeleton, so the card holds its shape during the one
    // round trip it takes for the metadata to land.
    const loading = clusterInfo === null;
    const orLoading = <T,>(value: T): T | undefined => (loading ? undefined : value);

    const uptime =
        latestSample?.uptimeSeconds === null || latestSample?.uptimeSeconds === undefined
            ? null
            : formatUptime(latestSample.uptimeSeconds);

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
        <Card className="summaryCard clusterFactsCard">
            {/*
             * Built from `Card` rather than `SummaryCard` only because the title row carries
             * an action; the classes below are `SummaryCard`'s own, so the two cards stay one
             * object.
             */}
            <div className="summaryCardHeader">
                <Text weight="semibold" size={400}>
                    {l10n.t('About this cluster')}
                </Text>
                {/*
                 * The grid below shows the facts worth a permanent row. Which fields a server
                 * actually answers varies enough between platforms that no fixed grid covers
                 * them, so the whole reply stays one click away — the escape hatch the index
                 * list and Query Insights already offer for their own raw payloads.
                 */}
                <Button
                    size="small"
                    appearance="subtle"
                    icon={<EyeRegular />}
                    className="summaryCardAction"
                    onClick={viewRawClusterInfo}
                >
                    {l10n.t('View Raw Cluster Info')}
                </Button>
            </div>

            <div className="summaryGrid">
                {/*
                 * `null`, not a dash: `GenericCell` renders an unavailable value as a dimmed
                 * "N/A", which says "the server did not report this" where an em dash only
                 * says "something is missing here" and reads as a value in its own right.
                 */}
                <GenericCell
                    label={l10n.t('Server version')}
                    value={orLoading(metadata?.['serverInfo_version'] ?? null)}
                />
                {optionalFacts.map((fact) => (
                    <GenericCell key={fact.label} label={fact.label} value={fact.value} />
                ))}
                {/*
                 * No Topology row here. The card below owns that question and answers it from a
                 * live probe that can name the members; this card could only restate a count
                 * derived from the one-shot metadata. Two derivations of one fact, taken at
                 * different moments, disagree — a single-member reply read as "Replica set
                 * (1 server)" here while the probe called it "Standalone server" there. The
                 * Topology card falls back to this metadata reading when its own probe comes
                 * back empty, so nothing is lost by removing the row.
                 */}
                {/*
                 * Kept even when empty, unlike the optional rows above: `uptimeSeconds` comes
                 * from the live sample rather than the one-shot metadata, so it can arrive on a
                 * later poll and must hold its place in the layout.
                 */}
                <GenericCell label={l10n.t('Uptime')} value={orLoading(uptime)} />
            </div>
        </Card>
    );
};
