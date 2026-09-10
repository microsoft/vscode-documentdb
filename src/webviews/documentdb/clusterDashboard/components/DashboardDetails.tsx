/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, Card, Tooltip } from '@fluentui/react-components';
import { ChevronDownRegular, ChevronUpRegular, CopyRegular, EyeRegular } from '@fluentui/react-icons';
import { Collapse } from '@fluentui/react-motion-components-preview';
import * as l10n from '@vscode/l10n';
import { Fragment, type JSX } from 'react';

import { regionToDisplayName } from '../../../../utils/regionToDisplayName';
import { type ClusterDashboardAzureInfo } from '../clusterDashboardController';
import { type ClusterDashboardInfo } from '../clusterDashboardRouter';

/** A row in the disclosed details grid. */
export interface DashboardDetail {
    readonly label: string;
    readonly value: string;
    /** Renders a copy affordance beside the value. */
    readonly copyable?: boolean;
}

export interface DashboardDetailGroup {
    readonly title: string;
    readonly details: DashboardDetail[];
}

/** Formats an ISO timestamp as a plain local date, or `null` when it is unusable. */
function formatCreatedAt(iso: string | undefined): string | null {
    if (iso === undefined) {
        return null;
    }

    const parsed = new Date(iso);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toLocaleDateString();
}

/**
 * The facts worth keeping but not worth a permanent row.
 *
 * Two groups, because they answer different questions and come from different places: what the
 * server on the other end of the socket reports, and what the Azure resource record says. A
 * cluster added by connection string simply has no second group.
 *
 * Server comes first and is the group every cluster has, so the panel's first column holds the
 * same kind of content whichever tree view the cluster came from. Ordering by data source would
 * move it whenever a discovery provider happened to have more to say.
 */
export function buildDetailGroups(
    clusterInfo: ClusterDashboardInfo | null,
    azure: ClusterDashboardAzureInfo | undefined,
): DashboardDetailGroup[] {
    const groups: DashboardDetailGroup[] = [];

    const serverDetails: DashboardDetail[] = [];
    const metadata = clusterInfo?.metadata ?? {};
    const pushServer = (label: string, value: string | undefined, copyable = false): void => {
        // `unknown` is what the metadata collector writes when the server declined to answer,
        // and a row saying "unknown" is worse than no row.
        if (value !== undefined && value !== '' && value !== 'unknown') {
            serverDetails.push({ label, value, copyable });
        }
    };

    if (clusterInfo !== null && clusterInfo.hosts.length > 0) {
        pushServer(
            clusterInfo.hosts.length === 1 ? l10n.t('Host') : l10n.t('Hosts'),
            clusterInfo.hosts.join(', '),
            true,
        );
    }

    pushServer(l10n.t('Server version'), metadata['serverInfo_version']);
    pushServer(l10n.t('Platform'), metadata['serverInfo_platform']);
    pushServer(l10n.t('Storage engines'), metadata['serverInfo_storageEngines']);
    pushServer(l10n.t('Topology'), metadata['topology_type']);
    pushServer(l10n.t('Servers in topology'), metadata['topology_numberOfServers']);
    pushServer(l10n.t('Auth mechanisms'), metadata['topology_hello_saslSupportedMechs']);
    pushServer(
        l10n.t('Connection mode'),
        metadata['topology_readOnly'] === undefined
            ? undefined
            : metadata['topology_readOnly'] === 'true'
              ? l10n.t('Read-only')
              : l10n.t('Read-write'),
    );

    if (serverDetails.length > 0) {
        groups.push({ title: l10n.t('Server'), details: serverDetails });
    }

    const azureDetails: DashboardDetail[] = [];
    const push = (label: string, value: string | undefined | null, copyable = false): void => {
        if (value !== undefined && value !== null && value !== '') {
            azureDetails.push({ label, value, copyable });
        }
    };

    if (azure !== undefined) {
        push(l10n.t('Resource name'), azure.resourceName);
        push(l10n.t('Resource group'), azure.resourceGroup);
        push(l10n.t('Subscription ID'), azure.subscriptionId, true);
        push(l10n.t('Region'), azure.location === undefined ? undefined : regionToDisplayName(azure.location));
        push(l10n.t('Compute tier'), azure.sku);
        push(l10n.t('Shards'), azure.nodeCount === undefined ? undefined : String(azure.nodeCount));
        push(
            l10n.t('Provisioned storage'),
            azure.diskSize === undefined ? undefined : l10n.t('{size} GB', { size: String(azure.diskSize) }),
        );
        push(
            l10n.t('High availability'),
            azure.enableHa === undefined ? undefined : azure.enableHa ? l10n.t('Enabled') : l10n.t('Disabled'),
        );
        push(l10n.t('Replication role'), azure.replicaRole);
        push(l10n.t('Capabilities'), azure.capabilities);
        push(l10n.t('Created'), formatCreatedAt(azure.createdAt));
    }

    if (azureDetails.length > 0) {
        groups.push({ title: l10n.t('Azure resource'), details: azureDetails });
    }

    return groups;
}

/**
 * The header's disclosure control.
 *
 * Both labels are always in the DOM, stacked in one grid cell so the button is sized by the longer
 * of the two. Swapping a single label shifted every control beside it on each toggle, and a
 * hardcoded width would only hold for English.
 */
export const DetailsDisclosureButton = ({
    expanded,
    onToggle,
}: {
    expanded: boolean;
    onToggle: () => void;
}): JSX.Element => (
    <Button
        appearance="transparent"
        size="small"
        className="dashboardDisclosure"
        aria-expanded={expanded}
        icon={expanded ? <ChevronUpRegular /> : <ChevronDownRegular />}
        iconPosition="after"
        onClick={onToggle}
    >
        <span className="dashboardDisclosureLabel">
            <span aria-hidden={!expanded} data-inactive={!expanded}>
                {l10n.t('Hide details')}
            </span>
            <span aria-hidden={expanded} data-inactive={expanded}>
                {l10n.t('Show details')}
            </span>
        </span>
    </Button>
);

/**
 * The disclosed panel of cold facts.
 *
 * Copy affordances sit on the values a user actually retypes today — the host list and the
 * subscription id — because those are the reason this panel exists at all.
 *
 * Raw diagnostics lives here rather than only in the overflow menu: this panel is already the
 * answer to "what exactly am I connected to", and the export is the same question asked in full.
 */
export const DashboardDetailsRegion = ({
    expanded,
    groups,
    onShowRawDiagnostics,
    isExportingDiagnostics,
}: {
    expanded: boolean;
    groups: DashboardDetailGroup[];
    onShowRawDiagnostics?: () => void;
    isExportingDiagnostics?: boolean;
}): JSX.Element => (
    <Collapse visible={expanded} unmountOnExit>
        <div className="dashboardDetailsRegion">
            <Card className="dashboardDetailsPanel" appearance="filled">
                <div className="dashboardDetailsGroups">
                    {groups.map((group) => (
                        <section className="dashboardDetailsGroup" key={group.title}>
                            <h2 className="dashboardDetailsGroupTitle">{group.title}</h2>
                            <dl className="dashboardDetailsGrid">
                                {group.details.map((detail) => (
                                    <Fragment key={detail.label}>
                                        <dt className="dashboardDetailLabel">{detail.label}</dt>
                                        <dd className="dashboardDetailValue">
                                            <span className="dashboardDetailText" title={detail.value}>
                                                {detail.value}
                                            </span>
                                            {detail.copyable === true && (
                                                <Tooltip
                                                    content={l10n.t('Copy {0}', detail.label)}
                                                    relationship="label"
                                                    withArrow
                                                >
                                                    <Button
                                                        appearance="transparent"
                                                        size="small"
                                                        className="dashboardDetailCopy"
                                                        icon={<CopyRegular />}
                                                        onClick={() => void navigator.clipboard.writeText(detail.value)}
                                                    />
                                                </Tooltip>
                                            )}
                                        </dd>
                                    </Fragment>
                                ))}
                            </dl>
                        </section>
                    ))}
                </div>

                {onShowRawDiagnostics !== undefined && (
                    <div className="dashboardDetailsFooter">
                        <Button
                            appearance="secondary"
                            size="small"
                            icon={<EyeRegular />}
                            disabled={isExportingDiagnostics === true}
                            onClick={onShowRawDiagnostics}
                        >
                            {l10n.t('Show Raw Diagnostics')}
                        </Button>
                    </div>
                )}
            </Card>
        </div>
    </Collapse>
);
