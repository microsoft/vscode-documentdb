/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Badge, Button, Card, Tooltip } from '@fluentui/react-components';
import { EyeRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { type JSX } from 'react';
import { useTrpcClient } from '../../../../../_integration/useTrpcClient';
import '../../../../components/focusableBadge/focusableBadge.scss';
import { type IndexRow } from '../../types';
import { formatDate, formatOps, formatShellJson } from '../../utils/format';
import { formatVectorAlgorithm } from '../../utils/vectorIndex';

/**
 * Describe a single key entry: the compact glyph shown on the badge and the
 * plain-language name of the index type for the tooltip / screen readers.
 * `↑`/`↓` are obvious to some but not everyone, so the words carry the meaning.
 */
function describeKeyType(direction: number | string): { glyph: string; label: string } {
    if (direction === 1) {
        return { glyph: '↑', label: l10n.t('ascending') };
    }
    if (direction === -1) {
        return { glyph: '↓', label: l10n.t('descending') };
    }
    switch (direction) {
        case 'text':
            return { glyph: 'text', label: l10n.t('text') };
        case '2dsphere':
            return { glyph: '2dsphere', label: l10n.t('2dsphere (geospatial)') };
        case '2d':
            return { glyph: '2d', label: l10n.t('2d (geospatial)') };
        case 'geoHaystack':
            return { glyph: 'geoHaystack', label: l10n.t('geoHaystack (geospatial)') };
        case 'hashed':
            return { glyph: 'hashed', label: l10n.t('hashed') };
        case 'cosmosSearch':
            return { glyph: 'vector', label: l10n.t('vector') };
        default:
            return { glyph: String(direction), label: String(direction) };
    }
}

function formatVectorSimilarity(similarity: string): string {
    switch (similarity) {
        case 'COS':
            return l10n.t('Cosine (COS)');
        case 'L2':
            return l10n.t('Euclidean (L2)');
        case 'IP':
            return l10n.t('Inner product (IP)');
        default:
            return similarity;
    }
}

function formatVectorCompression(compression: string | undefined): string {
    switch (compression) {
        case 'half':
            return l10n.t('Half precision');
        case 'pq':
            return l10n.t('Product quantization');
        case undefined:
            return l10n.t('None');
        default:
            return compression;
    }
}

export interface IndexRowDetailsProps {
    index: IndexRow;
}

/**
 * Expanded detail panel for a single index. Shows the key definition as a row
 * of inline, wrapping badges, a present-only list of secondary facts, and a
 * button to open the full raw definition in a new editor for anything the UI
 * does not surface explicitly.
 */
export const IndexRowDetails = ({ index }: IndexRowDetailsProps): JSX.Element => {
    const trpcClient = useTrpcClient();

    const openRawDefinition = (): void => {
        void trpcClient.mongoClusters.indexView.openIndexDefinition
            .mutate({ indexName: index.name })
            .catch((error: unknown) => {
                const message = error instanceof Error ? error.message : String(error);
                // A failed *user action* is surfaced modally (house rule): the user
                // explicitly asked to open this definition, so the failure must not be
                // missable the way a passive toast can be.
                void trpcClient.common.displayErrorMessage.mutate({
                    message: l10n.t('Failed to open the index definition.'),
                    modal: true,
                    cause: message,
                });
            });
    };

    return (
        <Card className="indexDetailsCard" appearance="filled">
            <div className="detailHeaderRow">
                <div className="detailSectionLabel">{l10n.t('Fields')}</div>
                <Button
                    size="small"
                    appearance="subtle"
                    icon={<EyeRegular />}
                    onClick={openRawDefinition}
                    className="detailRawButton"
                >
                    {l10n.t('View Raw Index Definition')}
                </Button>
            </div>
            <div className="detailSection">
                <div className="keyBadges" role="group" aria-label={l10n.t('Indexed fields')}>
                    {index.key.map(({ field, direction }) => {
                        const { glyph, label } = describeKeyType(direction);
                        const description = l10n.t('Field "{0}", {1} index', field, label);
                        return (
                            <Tooltip
                                key={`${field}:${String(direction)}`}
                                content={description}
                                relationship="label"
                                withArrow
                            >
                                <Badge
                                    className="keyBadge focusableBadge"
                                    appearance="tint"
                                    color="brand"
                                    shape="rounded"
                                    size="medium"
                                    tabIndex={0}
                                    aria-label={description}
                                >
                                    <span className="keyBadgeField" aria-hidden="true">
                                        {field}
                                    </span>
                                    <span className="keyBadgeDir" aria-hidden="true">
                                        {glyph}
                                    </span>
                                </Badge>
                            </Tooltip>
                        );
                    })}
                </div>
            </div>

            <dl className="detailFacts">
                {index.vectorOptions?.kind && (
                    <div className="detailFact">
                        <dt>{l10n.t('Algorithm')}</dt>
                        <dd>{formatVectorAlgorithm(index.vectorOptions.kind)}</dd>
                    </div>
                )}
                {index.vectorOptions?.dimensions !== undefined && (
                    <div className="detailFact">
                        <dt>{l10n.t('Dimensions')}</dt>
                        <dd>{index.vectorOptions.dimensions}</dd>
                    </div>
                )}
                {index.vectorOptions?.similarity && (
                    <div className="detailFact">
                        <dt>{l10n.t('Similarity')}</dt>
                        <dd>{formatVectorSimilarity(index.vectorOptions.similarity)}</dd>
                    </div>
                )}
                {index.vectorOptions?.numLists !== undefined && (
                    <div className="detailFact">
                        <dt>{l10n.t('Lists')}</dt>
                        <dd>{index.vectorOptions.numLists}</dd>
                    </div>
                )}
                {index.vectorOptions?.m !== undefined && (
                    <div className="detailFact">
                        <dt>{l10n.t('Connections (m)')}</dt>
                        <dd>{index.vectorOptions.m}</dd>
                    </div>
                )}
                {index.vectorOptions?.efConstruction !== undefined && (
                    <div className="detailFact">
                        <dt>{l10n.t('Build candidates (efConstruction)')}</dt>
                        <dd>{index.vectorOptions.efConstruction}</dd>
                    </div>
                )}
                {index.vectorOptions?.maxDegree !== undefined && (
                    <div className="detailFact">
                        <dt>{l10n.t('Maximum degree')}</dt>
                        <dd>{index.vectorOptions.maxDegree}</dd>
                    </div>
                )}
                {index.vectorOptions?.lBuild !== undefined && (
                    <div className="detailFact">
                        <dt>{l10n.t('Build candidates (lBuild)')}</dt>
                        <dd>{index.vectorOptions.lBuild}</dd>
                    </div>
                )}
                {index.vectorOptions && (
                    <div className="detailFact">
                        <dt>{l10n.t('Compression')}</dt>
                        <dd>{formatVectorCompression(index.vectorOptions.compression)}</dd>
                    </div>
                )}
                {index.vectorOptions?.pqCompressedDims !== undefined && (
                    <div className="detailFact">
                        <dt>{l10n.t('Compressed dimensions')}</dt>
                        <dd>{index.vectorOptions.pqCompressedDims}</dd>
                    </div>
                )}
                {index.vectorOptions?.pqSampleSize !== undefined && (
                    <div className="detailFact">
                        <dt>{l10n.t('Training sample size')}</dt>
                        <dd>{index.vectorOptions.pqSampleSize}</dd>
                    </div>
                )}
                {index.statsAvailable && (
                    <div className="detailFact">
                        <dt>{l10n.t('Usage')}</dt>
                        <dd>
                            {index.usageSince
                                ? l10n.t(
                                      '{0} operations since {1}',
                                      formatOps(index.usageOps),
                                      formatDate(index.usageSince),
                                  )
                                : l10n.t('{0} operations', formatOps(index.usageOps))}
                        </dd>
                    </div>
                )}
                {index.expireAfterSeconds !== undefined && (
                    <div className="detailFact">
                        <dt>{l10n.t('Expires after')}</dt>
                        <dd>{l10n.t('{0} seconds', index.expireAfterSeconds)}</dd>
                    </div>
                )}
                {index.state !== 'creating' && index.partialFilterExpression && (
                    <div className="detailFact">
                        <dt>{l10n.t('Partial filter')}</dt>
                        <dd>
                            <code className="detailFactCode">{formatShellJson(index.partialFilterExpression)}</code>
                        </dd>
                    </div>
                )}
                {index.state !== 'creating' && index.collation && (
                    <div className="detailFact">
                        <dt>{l10n.t('Collation')}</dt>
                        <dd>
                            <code className="detailFactCode">{formatShellJson(index.collation)}</code>
                        </dd>
                    </div>
                )}
                {index.wildcardProjection && (
                    <div className="detailFact">
                        <dt>{l10n.t('Wildcard projection')}</dt>
                        <dd>
                            <code className="detailFactCode">{formatShellJson(index.wildcardProjection)}</code>
                        </dd>
                    </div>
                )}
            </dl>
        </Card>
    );
};
