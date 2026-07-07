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
    CardPreview,
    Subtitle2,
    Text,
} from '@fluentui/react-components';
import {
    BranchRegular,
    DataUsageRegular,
    DeleteRegular,
    DocumentMultipleRegular,
    DocumentRegular,
    EyeOffRegular,
    EyeRegular,
    GlobeRegular,
    KeyRegular,
    NumberSymbolRegular,
    StarRegular,
    StorageRegular,
    TextAlignLeftRegular,
} from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { type JSX } from 'react';
import { type IndexRow, type IndexTypeBadge } from '../types';
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

/** Numeric directions (±1) → asc/desc; string sentinels (text, 2dsphere) pass through. */
function formatDirection(direction: number | string): string {
    if (direction === 1) return l10n.t('asc');
    if (direction === -1) return l10n.t('desc');
    return String(direction);
}

/** Compact "field: dir, field: dir" summary of an index key. */
function keySummary(index: IndexRow): string {
    return index.key.map((k) => `${k.field}: ${formatDirection(k.direction)}`).join(', ');
}

/** A representative leading icon per classified index type (CardHeader image slot). */
const TYPE_ICON: Record<IndexTypeBadge, JSX.Element> = {
    Default: <KeyRegular />,
    ObjectId: <KeyRegular />,
    'Single Field': <DocumentRegular />,
    Compound: <DocumentMultipleRegular />,
    Text: <TextAlignLeftRegular />,
    Geospatial: <GlobeRegular />,
    Wildcard: <StarRegular />,
    Hashed: <NumberSymbolRegular />,
};

const IndexTypeIcon = ({ index }: { index: IndexRow }): JSX.Element => (
    <span className="cardTypeIcon" aria-hidden="true">
        {TYPE_ICON[classifyIndex(index)] ?? <BranchRegular />}
    </span>
);

/** Row of small property badges (Fluent "template card" badge style). */
const IndexPropertyBadges = ({ index, includeType }: { index: IndexRow; includeType?: boolean }): JSX.Element => (
    <div className="cardBadgeRow">
        {includeType && <IndexTypeBadgeView type={classifyIndex(index)} />}
        {index.unique && (
            <Badge size="small" appearance="tint" color="brand">
                {l10n.t('Unique')}
            </Badge>
        )}
        {index.sparse && (
            <Badge size="small" appearance="tint" color="informative">
                {l10n.t('Sparse')}
            </Badge>
        )}
        {index.expireAfterSeconds !== undefined && (
            <Badge size="small" appearance="tint" color="warning">
                {l10n.t('TTL')}
            </Badge>
        )}
        {index.hidden && (
            <Badge size="small" appearance="tint" color="subtle">
                {l10n.t('Hidden')}
            </Badge>
        )}
    </div>
);

/** Inline size + usage figures. */
const IndexStatChips = ({ index }: { index: IndexRow }): JSX.Element => (
    <div className="cardStatChips">
        <span className="cardStatChip">
            <Caption1 className="cardMuted">{l10n.t('Size')}</Caption1>
            <span className="cardStatValue">
                <StorageRegular />
                <Body1>{formatBytes(index.sizeBytes)}</Body1>
            </span>
        </span>
        <span className="cardStatChip">
            <Caption1 className="cardMuted">{l10n.t('Usage')}</Caption1>
            <span className="cardStatValue">
                <DataUsageRegular />
                <Body1>{formatOps(index.usageOps)}</Body1>
            </span>
        </span>
    </div>
);

/** Footer Hide/Unhide + Delete buttons, disabled on the default `_id` index. */
const IndexFooterActions = ({ index, onDelete, onToggleHidden }: IndexCardProps): JSX.Element => (
    <CardFooter>
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
// Variation 1 — Icon header (icon + title + subtitle) + stat chips + footer
// ---------------------------------------------------------------------------

const CardHeaderIcon = ({ index, onDelete, onToggleHidden }: IndexCardProps): JSX.Element => (
    <Card className="indexCard" appearance="filled">
        <CardHeader
            image={<IndexTypeIcon index={index} />}
            header={<Body1 className="cardName">{index.name}</Body1>}
            description={<Caption1 className="cardMuted">{keySummary(index)}</Caption1>}
        />
        <IndexStatChips index={index} />
        <IndexFooterActions index={index} onDelete={onDelete} onToggleHidden={onToggleHidden} />
    </Card>
);

// ---------------------------------------------------------------------------
// Variation 2 — Small property badges on top + icon header + footer
// ---------------------------------------------------------------------------

const CardTopBadges = ({ index, onDelete, onToggleHidden }: IndexCardProps): JSX.Element => (
    <Card className="indexCard" appearance="outline">
        <IndexPropertyBadges index={index} includeType />
        <CardHeader
            image={<IndexTypeIcon index={index} />}
            header={<Body1 className="cardName">{index.name}</Body1>}
            description={<Caption1 className="cardMuted">{keySummary(index)}</Caption1>}
        />
        <IndexStatChips index={index} />
        <IndexFooterActions index={index} onDelete={onDelete} onToggleHidden={onToggleHidden} />
    </Card>
);

// ---------------------------------------------------------------------------
// Variation 3 — Stat-forward: large Size / Usage figures + footer
// ---------------------------------------------------------------------------

const CardStatForward = ({ index, onDelete, onToggleHidden }: IndexCardProps): JSX.Element => (
    <Card className="indexCard" appearance="filled">
        <CardHeader
            image={<IndexTypeIcon index={index} />}
            header={<Body1 className="cardName">{index.name}</Body1>}
            description={<Caption1 className="cardMuted">{keySummary(index)}</Caption1>}
        />
        <div className="cardStatsGrid">
            <div className="cardStatBlock">
                <Subtitle2>{formatBytes(index.sizeBytes)}</Subtitle2>
                <Caption1 className="cardMuted">{l10n.t('Size')}</Caption1>
            </div>
            <div className="cardStatBlock">
                <Subtitle2>{formatOps(index.usageOps)}</Subtitle2>
                <Caption1 className="cardMuted">{l10n.t('Usage')}</Caption1>
            </div>
        </div>
        <IndexFooterActions index={index} onDelete={onDelete} onToggleHidden={onToggleHidden} />
    </Card>
);

// ---------------------------------------------------------------------------
// Variation 4 — Preview strip with type + property badges + stats + footer
// ---------------------------------------------------------------------------

const CardPreviewBadges = ({ index, onDelete, onToggleHidden }: IndexCardProps): JSX.Element => (
    <Card className="indexCard" appearance="filled-alternative">
        <CardPreview className="cardBadgePreview">
            <IndexPropertyBadges index={index} includeType />
        </CardPreview>
        <CardHeader
            image={<IndexTypeIcon index={index} />}
            header={<Body1 className="cardName">{index.name}</Body1>}
            description={<Caption1 className="cardMuted">{keySummary(index)}</Caption1>}
        />
        <IndexStatChips index={index} />
        <IndexFooterActions index={index} onDelete={onDelete} onToggleHidden={onToggleHidden} />
    </Card>
);

// ---------------------------------------------------------------------------
// Container: render each design variation as its own labelled row
// ---------------------------------------------------------------------------

/**
 * Card layout for the Index Management tab — the comfortable view intended
 * for collections with only a handful of indexes.
 *
 * PROTOTYPE: renders the same index list once per card design variation so a
 * direction can be chosen. Every variation uses Fluent's Card header (icon +
 * title + subtitle) and footer actions (Hide/Unhide, Delete); they differ in
 * how they surface property badges and the size/usage figures. Once a design
 * is picked, the winning variation becomes the single layout.
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
            title: l10n.t('Variation 1 — Icon header + stat chips'),
            render: (idx) => <CardHeaderIcon index={idx} onDelete={onDelete} onToggleHidden={onToggleHidden} />,
        },
        {
            title: l10n.t('Variation 2 — Property badges on top'),
            render: (idx) => <CardTopBadges index={idx} onDelete={onDelete} onToggleHidden={onToggleHidden} />,
        },
        {
            title: l10n.t('Variation 3 — Stat-forward figures'),
            render: (idx) => <CardStatForward index={idx} onDelete={onDelete} onToggleHidden={onToggleHidden} />,
        },
        {
            title: l10n.t('Variation 4 — Preview strip with badges'),
            render: (idx) => <CardPreviewBadges index={idx} onDelete={onDelete} onToggleHidden={onToggleHidden} />,
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
                {l10n.t('Prototype: multiple card designs for the same indexes. Pick one to keep.')}
            </Text>
        </div>
    );
};
