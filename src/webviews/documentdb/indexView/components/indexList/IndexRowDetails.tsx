/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Badge, Button, Card } from '@fluentui/react-components';
import { EyeRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { type JSX } from 'react';
import { useTrpcClient } from '../../../../_integration/useTrpcClient';
import { type IndexRow } from '../../types';
import { formatDate, formatOps } from '../../utils/format';

/** Direction glyph + accessible wording for a single key entry. */
function describeDirection(direction: number | string): { glyph: string; aria: string } {
    if (direction === 1) return { glyph: '↑', aria: l10n.t('ascending') };
    if (direction === -1) return { glyph: '↓', aria: l10n.t('descending') };
    // Special index kinds (text / 2dsphere / 2d / hashed …) carry the kind as
    // the "direction" value — surface it verbatim.
    return { glyph: String(direction), aria: String(direction) };
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
                void trpcClient.common.displayErrorMessage.mutate({
                    message: l10n.t('Failed to open the index definition.'),
                    modal: false,
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
                        const { glyph, aria } = describeDirection(direction);
                        return (
                            <Badge
                                key={`${field}:${String(direction)}`}
                                className="keyBadge"
                                appearance="tint"
                                color="informative"
                                shape="rounded"
                                size="medium"
                                aria-label={l10n.t('{0}, {1}', field, aria)}
                            >
                                <span className="keyBadgeField">{field}</span>
                                <span className="keyBadgeDir" aria-hidden="true">
                                    {glyph}
                                </span>
                            </Badge>
                        );
                    })}
                </div>
            </div>

            <dl className="detailFacts">
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
                {index.partialFilterExpression && (
                    <div className="detailFact">
                        <dt>{l10n.t('Partial filter')}</dt>
                        <dd>
                            <code className="detailFactCode">{JSON.stringify(index.partialFilterExpression)}</code>
                        </dd>
                    </div>
                )}
                {index.collation && (
                    <div className="detailFact">
                        <dt>{l10n.t('Collation')}</dt>
                        <dd>
                            <code className="detailFactCode">{JSON.stringify(index.collation)}</code>
                        </dd>
                    </div>
                )}
            </dl>
        </Card>
    );
};
