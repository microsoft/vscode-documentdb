/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Body1, Button, Caption1, Card, CardFooter, Subtitle2, Text, Tooltip } from '@fluentui/react-components';
import {
    ChevronDownRegular,
    ChevronUpRegular,
    DeleteRegular,
    DocumentMultipleRegular,
    EyeOffRegular,
    EyeRegular,
    GlobeRegular,
    KeyRegular,
    NumberSymbolRegular,
    SquareMultipleRegular,
    StarRegular,
    TextAlignLeftRegular,
} from '@fluentui/react-icons';
import { Collapse } from '@fluentui/react-motion-components-preview';
import * as l10n from '@vscode/l10n';
import { useState, type JSX } from 'react';
import { type IndexRow, type IndexTypeBadge } from '../types';
import { formatBytes, formatDate, formatOps, formatSinceTooltip } from '../utils/format';
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
// Icon (per type, single accent colour) + title row
// ---------------------------------------------------------------------------

const TYPE_ICON: Record<IndexTypeBadge, JSX.Element> = {
    Default: <KeyRegular />,
    ObjectId: <KeyRegular />,
    'Single Field': <SquareMultipleRegular />,
    Compound: <DocumentMultipleRegular />,
    Text: <TextAlignLeftRegular />,
    Geospatial: <GlobeRegular />,
    Wildcard: <StarRegular />,
    Hashed: <NumberSymbolRegular />,
};

const IndexIcon = ({ index }: { index: IndexRow }): JSX.Element => (
    <span className="cardTypeIcon cardTypeIconAccent" aria-hidden="true">
        {TYPE_ICON[classifyIndex(index)]}
    </span>
);

/** Title row: optional icon, an always-rendered ellipsised name, optional action. */
const TitleRow = ({
    index,
    withIcon,
    action,
}: {
    index: IndexRow;
    withIcon?: boolean;
    action?: JSX.Element;
}): JSX.Element => (
    <div className="cardTitleRow">
        {withIcon && <IndexIcon index={index} />}
        <div className="cardTitleBlock">
            <Body1 className="cardName" title={index.name}>
                {index.name}
            </Body1>
        </div>
        {action}
    </div>
);

// ---------------------------------------------------------------------------
// Big-number stats
// ---------------------------------------------------------------------------

function directionGlyph(direction: number | string): string {
    if (direction === 1) return '↑';
    if (direction === -1) return '↓';
    return String(direction);
}

/** A single big-figure stat (label + large value), optionally wrapped in a tooltip. */
const StatBig = ({ label, value, tooltip }: { label: string; value: string; tooltip?: string }): JSX.Element => {
    const item = (
        <div className="statBigItem">
            <span className="statLabel">{label}</span>
            <span className="statBigValue">{value}</span>
        </div>
    );
    return tooltip ? (
        <Tooltip content={tooltip} relationship="description">
            {item}
        </Tooltip>
    ) : (
        item
    );
};

/** Two big figures: Size · Usage. */
const StatsBig2 = ({ index }: { index: IndexRow }): JSX.Element => (
    <div className="statsBig">
        <StatBig label={l10n.t('Size')} value={formatBytes(index.sizeBytes)} />
        <StatBig label={l10n.t('Usage')} value={formatOps(index.usageOps)} />
    </div>
);

/** Three unified columns (1/3 each): Size · Usage · Since (date). */
const StatsBig3 = ({ index }: { index: IndexRow }): JSX.Element => (
    <div className="statsBig3">
        <StatBig label={l10n.t('Size')} value={formatBytes(index.sizeBytes)} />
        <StatBig label={l10n.t('Usage')} value={formatOps(index.usageOps)} />
        <StatBig
            label={l10n.t('Since')}
            value={formatDate(index.usageSince)}
            tooltip={formatSinceTooltip(index.usageSince)}
        />
    </div>
);

/** Three big figures in bordered cells (execution-plan StageDetailCard feel). */
const StatsBigCells = ({ index }: { index: IndexRow }): JSX.Element => (
    <div className="bigStatCells">
        <div className="bigStatCell">
            <span className="statLabel">{l10n.t('Size')}</span>
            <span className="statBigValue">{formatBytes(index.sizeBytes)}</span>
        </div>
        <div className="bigStatCell">
            <span className="statLabel">{l10n.t('Usage')}</span>
            <span className="statBigValue">{formatOps(index.usageOps)}</span>
        </div>
        <div className="bigStatCell">
            <span className="statLabel">{l10n.t('Since')}</span>
            <span className="statBigValue">{formatDate(index.usageSince)}</span>
        </div>
    </div>
);

/** Index key fields as chips (revealed in the details section). */
const KeyChips = ({ index }: { index: IndexRow }): JSX.Element => (
    <div className="keyBadges keyBadgesEmphasis">
        {index.key.map((k, i) => (
            <span key={`${k.field}-${i}`} className="keyChip keyChipEmphasis">
                <span className="keyField">{k.field}</span>
                <span className="keyDir">{directionGlyph(k.direction)}</span>
            </span>
        ))}
    </div>
);

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

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

/** Hide/Unhide with a visible label + icon-only Delete, right-aligned. */
const LabeledActions = ({ index, onDelete, onToggleHidden }: IndexCardProps): JSX.Element => (
    <div className="cardActionsRight">
        <Button
            size="small"
            appearance="subtle"
            icon={index.hidden ? <EyeRegular /> : <EyeOffRegular />}
            disabled={index.isDefault}
            onClick={() => onToggleHidden(index)}
        >
            {index.hidden ? l10n.t('Unhide') : l10n.t('Hide')}
        </Button>
        <Tooltip content={l10n.t('Delete')} relationship="label">
            <Button
                size="small"
                appearance="subtle"
                icon={<DeleteRegular />}
                disabled={index.isDefault}
                aria-label={l10n.t('Delete {0}', index.name)}
                onClick={() => onDelete(index)}
            />
        </Tooltip>
    </div>
);

/** Icon-only actions, right-aligned. */
const IconActionsRight = ({ index, onDelete, onToggleHidden }: IndexCardProps): JSX.Element => (
    <div className="cardActionsRight">
        <Tooltip content={index.hidden ? l10n.t('Unhide') : l10n.t('Hide')} relationship="label">
            <Button
                size="small"
                appearance="subtle"
                icon={index.hidden ? <EyeRegular /> : <EyeOffRegular />}
                disabled={index.isDefault}
                aria-label={index.hidden ? l10n.t('Unhide {0}', index.name) : l10n.t('Hide {0}', index.name)}
                onClick={() => onToggleHidden(index)}
            />
        </Tooltip>
        <Tooltip content={l10n.t('Delete')} relationship="label">
            <Button
                size="small"
                appearance="subtle"
                icon={<DeleteRegular />}
                disabled={index.isDefault}
                aria-label={l10n.t('Delete {0}', index.name)}
                onClick={() => onDelete(index)}
            />
        </Tooltip>
    </div>
);

/** Fields section revealed by the details toggle (animated by <Collapse>). */
const DetailsFields = ({ index }: { index: IndexRow }): JSX.Element => (
    <div className="detailsFields">
        <Caption1 className="cardMuted componentsLabel">{l10n.t('Fields')}</Caption1>
        <KeyChips index={index} />
    </div>
);

// ---------------------------------------------------------------------------
// Variants — all built on the 3D+ big-numbers direction
// ---------------------------------------------------------------------------

// B1 — icon, two big figures, footer.
const CardBig = ({ index, onDelete, onToggleHidden }: IndexCardProps): JSX.Element => (
    <Card className="indexCard" appearance="filled">
        <TitleRow index={index} withIcon action={<IndexTypeBadgeView type={classifyIndex(index)} size="small" />} />
        <StatsBig2 index={index} />
        <FooterButtonsRight index={index} onDelete={onDelete} onToggleHidden={onToggleHidden} />
    </Card>
);

// B2 — no icon, two big figures, footer.
const CardBigNoIcon = ({ index, onDelete, onToggleHidden }: IndexCardProps): JSX.Element => (
    <Card className="indexCard" appearance="filled">
        <TitleRow index={index} action={<IndexTypeBadgeView type={classifyIndex(index)} size="small" />} />
        <StatsBig2 index={index} />
        <FooterButtonsRight index={index} onDelete={onDelete} onToggleHidden={onToggleHidden} />
    </Card>
);

// B3 — three unified columns (Size · Usage · Since), footer.
const CardBig3 = ({ index, onDelete, onToggleHidden }: IndexCardProps): JSX.Element => (
    <Card className="indexCard" appearance="filled">
        <TitleRow index={index} withIcon action={<IndexTypeBadgeView type={classifyIndex(index)} size="small" />} />
        <StatsBig3 index={index} />
        <FooterButtonsRight index={index} onDelete={onDelete} onToggleHidden={onToggleHidden} />
    </Card>
);

// B4 / B5 — details toggle (bottom-left) reveals the fields section (animated).
const CardBigDetails = ({
    index,
    onDelete,
    onToggleHidden,
    threeCol,
}: IndexCardProps & { threeCol?: boolean }): JSX.Element => {
    const [expanded, setExpanded] = useState(false);
    return (
        <Card className="indexCard" appearance="filled">
            <TitleRow index={index} withIcon action={<IndexTypeBadgeView type={classifyIndex(index)} size="small" />} />
            {threeCol ? <StatsBig3 index={index} /> : <StatsBig2 index={index} />}
            <div className="cardDetailsBar">
                <Button
                    size="small"
                    appearance="subtle"
                    icon={expanded ? <ChevronUpRegular /> : <ChevronDownRegular />}
                    aria-expanded={expanded}
                    onClick={() => setExpanded((v) => !v)}
                >
                    {l10n.t('Details')}
                </Button>
                <LabeledActions index={index} onDelete={onDelete} onToggleHidden={onToggleHidden} />
            </div>
            <Collapse visible={expanded}>
                <DetailsFields index={index} />
            </Collapse>
        </Card>
    );
};

// B6 — three big figures in bordered cells, type badge top-right, icon actions.
const CardBigCells = ({ index, onDelete, onToggleHidden }: IndexCardProps): JSX.Element => (
    <Card className="indexCard" appearance="filled">
        <TitleRow index={index} withIcon action={<IndexTypeBadgeView type={classifyIndex(index)} size="small" />} />
        <StatsBigCells index={index} />
        <IconActionsRight index={index} onDelete={onDelete} onToggleHidden={onToggleHidden} />
    </Card>
);

// ---------------------------------------------------------------------------
// Container
// ---------------------------------------------------------------------------

/**
 * Card layout for the Index Management tab — the comfortable view intended for
 * collections with only a handful of indexes.
 *
 * PROTOTYPE gallery (3D+ big-numbers direction): variants differ in icon
 * presence, the number of stat columns (adding the "Since" date), a details
 * toggle that reveals the index fields with a Fluent Collapse animation, and a
 * bordered-cell treatment.
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
            title: l10n.t('B1 — Big figures (icon)'),
            render: (idx) => <CardBig index={idx} onDelete={onDelete} onToggleHidden={onToggleHidden} />,
        },
        {
            title: l10n.t('B2 — Big figures (no icon)'),
            render: (idx) => <CardBigNoIcon index={idx} onDelete={onDelete} onToggleHidden={onToggleHidden} />,
        },
        {
            title: l10n.t('B3 — Three columns (Size · Usage · Since)'),
            render: (idx) => <CardBig3 index={idx} onDelete={onDelete} onToggleHidden={onToggleHidden} />,
        },
        {
            title: l10n.t('B4 — Two columns + Details toggle'),
            render: (idx) => <CardBigDetails index={idx} onDelete={onDelete} onToggleHidden={onToggleHidden} />,
        },
        {
            title: l10n.t('B5 — Three columns + Details toggle'),
            render: (idx) => (
                <CardBigDetails index={idx} onDelete={onDelete} onToggleHidden={onToggleHidden} threeCol />
            ),
        },
        {
            title: l10n.t('B6 — Bordered stat cells (icon actions)'),
            render: (idx) => <CardBigCells index={idx} onDelete={onDelete} onToggleHidden={onToggleHidden} />,
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
                {l10n.t('Prototype: big-number card designs for the same indexes. Pick one to keep.')}
            </Text>
        </div>
    );
};
