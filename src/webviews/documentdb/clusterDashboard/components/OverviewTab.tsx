/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Card } from '@fluentui/react-components';
import * as l10n from '@vscode/l10n';
import { type JSX } from 'react';

import { type ClusterHealthSample } from '../../../../documentdb/utils/getClusterHealth';
import { formatCount } from '../../collectionView/components/queryInsightsTab/components/metricsRow';
import { Sparkline } from './Sparkline';

export interface OverviewTabProps {
    samples: ClusterHealthSample[];
}

interface OpcounterRate {
    name: string;
    /** Operations per second between the last two samples. */
    perSecond: number;
}

/**
 * Derives per-second opcounter rates from the last two samples.
 *
 * `serverStatus.opcounters` is a monotonic total, so the rate is the delta divided by the
 * elapsed time. Returns an empty list when the server does not expose opcounters (vCore)
 * or when a counter reset (server restart) makes the delta meaningless.
 */
function computeOpcounterRates(samples: ClusterHealthSample[]): OpcounterRate[] {
    if (samples.length < 2) {
        return [];
    }

    const current = samples[samples.length - 1];
    const previous = samples[samples.length - 2];

    if (!current.opcounters || !previous.opcounters) {
        return [];
    }

    const elapsedSeconds = (current.timestampMs - previous.timestampMs) / 1000;
    if (elapsedSeconds <= 0) {
        return [];
    }

    return Object.entries(current.opcounters)
        .map(([name, value]) => {
            const previousValue = previous.opcounters?.[name];
            if (previousValue === undefined || value < previousValue) {
                return null;
            }
            return { name, perSecond: (value - previousValue) / elapsedSeconds };
        })
        .filter((rate): rate is OpcounterRate => rate !== null);
}

function ChartCard({
    title,
    caption,
    series,
    color,
}: {
    title: string;
    caption: string;
    series: Array<number | null>;
    color?: string;
}): JSX.Element {
    return (
        <Card className="chartCard" appearance="filled">
            <div className="chartTitle">{title}</div>
            <div className="chartValue">{caption}</div>
            <div className="chartCanvas">
                <Sparkline data={series} width={600} height={120} color={color} filled={true} />
            </div>
        </Card>
    );
}

export const OverviewTab = ({ samples }: OverviewTabProps): JSX.Element => {
    const latestSample = samples.length > 0 ? samples[samples.length - 1] : null;
    const opcounterRates = computeOpcounterRates(samples);

    const latencyCaption =
        latestSample?.pingLatencyMs === null || latestSample?.pingLatencyMs === undefined
            ? '—'
            : l10n.t('{latency} ms', { latency: latestSample.pingLatencyMs.toFixed(2) });

    const operationsCaption =
        latestSample?.activeOperations === null || latestSample?.activeOperations === undefined
            ? '—'
            : formatCount(latestSample.activeOperations);

    return (
        <div className="overviewTab">
            <ChartCard
                title={l10n.t('Ping latency')}
                caption={latencyCaption}
                series={samples.map((sample) => sample.pingLatencyMs)}
            />

            <ChartCard
                title={l10n.t('Active operations')}
                caption={operationsCaption}
                series={samples.map((sample) => sample.activeOperations)}
                color="var(--vscode-charts-green, currentColor)"
            />

            <Card className="chartCard" appearance="filled">
                <div className="chartTitle">{l10n.t('Operations per second')}</div>
                {opcounterRates.length === 0 ? (
                    <div className="emptyState">
                        {l10n.t(
                            'Operation counters are not reported by this cluster. Azure DocumentDB (vCore) does not support the serverStatus command.',
                        )}
                    </div>
                ) : (
                    <ul className="opcounterList">
                        {opcounterRates.map((rate) => (
                            <li key={rate.name} className="opcounterItem">
                                <span className="opcounterName">{rate.name}</span>
                                <span className="opcounterValue">{rate.perSecond.toFixed(1)}/s</span>
                            </li>
                        ))}
                    </ul>
                )}
            </Card>
        </div>
    );
};
