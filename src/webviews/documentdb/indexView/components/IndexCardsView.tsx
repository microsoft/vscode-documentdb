/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Badge,
    Body1,
    Button,
    Caption1,
    Card,
    CardFooter,
    CardHeader,
    Subtitle2,
    Text,
    Tooltip,
} from '@fluentui/react-components';
import {
    DataUsageRegular,
    DeleteRegular,
    EyeOffRegular,
    EyeRegular,
    SquareMultipleRegular,
    StorageRegular,
} from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { type JSX } from 'react';
import '../../../../components/focusableBadge/focusableBadge.scss';
import { type IndexRow } from '../types';
import { formatBytes, formatOps } from '../utils/format';
import { classifyIndex } from '../utils/indexType';
import { IndexTypeBadgeView } from './IndexTypeBadgeView';

export interface IndexCardsViewProps {
    indexes: ReadonlyArray<IndexRow>;
    onDelete: (index: IndexRow) => void;
    onToggleHidden: (index: IndexRow) => void;
}

interface IndexCardProps {
    index: IndexRow;
    onDelete: (index: IndexRow) => void;
    onToggleHidden: (index: IndexRow) => void;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function formatDirection(direction: number | string): string {
    if (direction === 1) return l10n.t('asc');
    if (direction === -1) return l10n.t('desc');
    return String(direction);
}

function keySummary(index: IndexRow): string {
    return index.key.map((k) => `${k.field}: ${formatDirection(k.direction)}`).join(', ');
}

/**
 * Leading index icon. Uses SquareMultiple (visually mirrors the `combine`
 * codicon used for indexes in the tree view) tinted with the theme accent.
 */
const IndexIcon = (): JSX.Element => (
    <span className="cardTypeIcon cardTypeIconAccent" aria-hidden="true">
        <SquareMultipleRegular />
    </span>
);

/**
 * Standard card header: accent index icon + name + key summary, with the type
 * badge as the trailing action. Title and subtitle truncate with an ellipsis
 * rather than wrapping.
 */
const CardHeaderStd = ({ index }: { index: IndexRow }): JSX.Element => (
    <CardHeader
        image={<IndexIcon />}
        header={
            <Body1 className="cardName" title={index.name}>
                {index.name}
            </Body1>
        }
        description={
            <Caption1 className="cardSubtitle cardMuted" title={keySummary(index)}>
                {keySummary(index)}
            </Caption1>
        }
        action={<IndexTypeBadgeView type={classifyIndex(index)} />}
    />
);

/** Accessible (keyboard-focusable) stat badge — follows the focusableBadge pattern. */
const StatBadge = ({ icon, label, tooltip }: { icon: JSX.Element; label: string; tooltip: string }): JSX.Element => (
    <Tooltip content={tooltip} relationship="description">
        <Badge
            appearance="outline"
            color="informative"
            icon={icon}
            tabIndex={0}
            className="focusableBadge"
            aria-label={label}
        >
            <span aria-hidden="true">{label}</span>
        </Badge>
    </Tooltip>
);

/** Size + usage as accessible badges (StageDetailCard optional-metrics feel). */
const StatsBadges = ({ index }: { index: IndexRow }): JSX.Element => (
    <div className="statBadges">
        <StatBadge
            icon={<StorageRegular />}
            label={l10n.t('Size {0}', formatBytes(index.sizeBytes))}
            tooltip={l10n.t('On-disk size of this index.')}
        />
        <StatBadge
            icon={<DataUsageRegular />}
            label={l10n.t('Usage {0}', formatOps(index.usageOps))}
            tooltip={l10n.t('Operations that have used this index since usage tracking began.')}
        />
    </div>
);

/** Big figures (Query Insights metric-card feel). */
const StatsBig = ({ index }: { index: IndexRow }): JSX.Element => (
    <div className="statsBig">
        <div className="statBigItem">
            <span className="statLabel">{l10n.t('Size')}</span>
            <span className="statBigValue">{formatBytes(index.sizeBytes)}</span>
        </div>
        <div className="statBigItem">
            <span className="statLabel">{l10n.t('Usage')}</span>
            <span className="statBigValue">{formatOps(index.usageOps)}</span>
        </div>
    </div>
);

/** Footer Hide/Unhide + Delete buttons, right-aligned. Disabled on the default `_id` index. */
const FooterButtonsRight = ({ index, onDelete, onToggleHidden }: IndexCardProps): JSX.Element => (
    <CardFooter className="cardFooterRight">
        <Button
            size="small"
            appearance="subtle"
            icon={index.hidden ? <EyeRegular /> : <EyeOffRegular />}
            disabled={index.isDefault}
            onClick={() => onToggleHidden(index)}
        >
            {index.hidden ? l10n.t('Unhide') : l10n.t('Hide')}
        </Button>
        <Button
            size="small"
            appearance="subtle"
            icon={<DeleteRegular />}
            disabled={index.isDefault}
            onClick={() => onDelete(index)}
        >
            {l10n.t('Delete')}
        </Button>
    </CardFooter>
);

// ---------------------------------------------------------------------------
// Variant 3D family
// ---------------------------------------------------------------------------

// 3D — Accessible stat badges + right-aligned footer buttons.
const Card3D = ({ index, onDelete, onToggleHidden }: IndexCardProps): JSX.Element => (
    <Card className="indexCard" appearance="filled">
        <CardHeaderStd index={index} />
        <StatsBadges index={index} />
        <FooterButtonsRight index={index} onDelete={onDelete} onToggleHidden={onToggleHidden} />
    </Card>
);

// 3D+ — Big figures (from 3A) + right-aligned footer buttons.
const Card3DBig = ({ index, onDelete, onToggleHidden }: IndexCardProps): JSX.Element => (
    <Card className="indexCard" appearance="filled">
        <CardHeaderStd index={index} />
        <StatsBig index={index} />
        <FooterButtonsRight index={index} onDelete={onDelete} onToggleHidden={onToggleHidden} />
    </Card>
);

// ---------------------------------------------------------------------------
// Container
// ---------------------------------------------------------------------------

/**
 * Card layout for the Index Management tab — the comfortable view intended for
 * collections with only a handful of indexes.
 *
 * PROTOTYPE (variant 3D deep-dive): accessible stat badges vs. big figures,
 * both with a right-aligned footer action row. Pick one to keep.
 */
export const IndexCardsView = ({ indexes, onDelete, onToggleHidden }: IndexCardsViewProps): JSX.Element => {
    if (indexes.length === 0) {
        return (
            <div className="indexCardsView" role="status">
                <span className="cardMuted">{l10n.t('No indexes to display.')}</span>
            </div>
        );
    }

    const variations: ReadonlyArray<{ title: string; render: (index: IndexRow) => JSX.Element }> = [
        {
            title: l10n.t('3D — Stat badges + right-aligned actions'),
            render: (idx) => <Card3D index={idx} onDelete={onDelete} onToggleHidden={onToggleHidden} />,
        },
        {
            title: l10n.t('3D+ — Big figures + right-aligned actions'),
            render: (idx) => <Card3DBig index={idx} onDelete={onDelete} onToggleHidden={onToggleHidden} />,
        },
    ];

    return (
        <div className="indexCardsView">
            {variations.map((variation) => (
                <section className="cardsVariation" key={variation.title}>
                    <Subtitle2 className="cardsVariationTitle">{variation.title}</Subtitle2>
                    <div className="cardsGrid">
                        {indexes.map((idx) => (
                            <div key={idx.name}>{variation.render(idx)}</div>
                        ))}
                    </div>
                </section>
            ))}

            <Text as="p" className="cardMuted cardsPrototypeNote">
                {l10n.t('Prototype: two variant 3D designs for the same indexes. Pick one to keep.')}
            </Text>
        </div>
    );
};
