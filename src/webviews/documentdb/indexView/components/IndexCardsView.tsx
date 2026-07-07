/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Body1,
    Button,
    Caption1,
    Card,
    CardFooter,
    CardHeader,
    CardPreview,
    Menu,
    MenuItem,
    MenuList,
    MenuPopover,
    MenuTrigger,
    Subtitle2,
    Text,
} from '@fluentui/react-components';
import {
    DeleteRegular,
    EyeOffRegular,
    EyeRegular,
    MoreHorizontalRegular,
    NumberSymbolRegular,
    StorageRegular,
} from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { type JSX } from 'react';
import { type IndexRow } from '../types';
import { formatBytes, formatOps } from '../utils/format';
import { classifyIndex } from '../utils/indexType';
import { IndexTypeBadgeView } from './IndexTypeBadgeView';

export interface IndexCardsViewProps {
    indexes: ReadonlyArray<IndexRow>;
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

/** Shared 3-dot actions menu (Hide/Unhide, Delete). Disabled on the default index. */
const IndexActionsMenu = ({
    index,
    onDelete,
    onToggleHidden,
}: {
    index: IndexRow;
    onDelete: (index: IndexRow) => void;
    onToggleHidden: (index: IndexRow) => void;
}): JSX.Element => (
    <Menu>
        <MenuTrigger disableButtonEnhancement>
            <Button
                appearance="subtle"
                icon={<MoreHorizontalRegular />}
                aria-label={l10n.t('More actions for {0}', index.name)}
            />
        </MenuTrigger>
        <MenuPopover>
            <MenuList>
                <MenuItem
                    icon={index.hidden ? <EyeRegular /> : <EyeOffRegular />}
                    disabled={index.isDefault}
                    onClick={() => onToggleHidden(index)}
                >
                    {index.hidden ? l10n.t('Unhide') : l10n.t('Hide')}
                </MenuItem>
                <MenuItem icon={<DeleteRegular />} disabled={index.isDefault} onClick={() => onDelete(index)}>
                    {l10n.t('Delete')}
                </MenuItem>
            </MenuList>
        </MenuPopover>
    </Menu>
);

/** Two small stat chips (size + usage) reused across variations. */
const IndexStatChips = ({ index }: { index: IndexRow }): JSX.Element => (
    <div className="cardStatChips">
        <span className="cardStatChip">
            <StorageRegular />
            {formatBytes(index.sizeBytes)}
        </span>
        <span className="cardStatChip">
            <NumberSymbolRegular />
            {formatOps(index.usageOps)}
        </span>
    </div>
);

// ---------------------------------------------------------------------------
// Variation A — Compact horizontal list cards
// ---------------------------------------------------------------------------

const CardVariationCompact = ({ index }: { index: IndexRow }): JSX.Element => (
    <Card className="indexCard" appearance="filled" orientation="horizontal" size="small">
        <CardHeader
            image={<IndexTypeBadgeView type={classifyIndex(index)} />}
            header={<Body1 className="cardName">{index.name}</Body1>}
            description={<Caption1 className="cardMuted">{keySummary(index)}</Caption1>}
        />
    </Card>
);

// ---------------------------------------------------------------------------
// Variation B — Vertical cards with explicit footer action buttons
// ---------------------------------------------------------------------------

const CardVariationFooterActions = ({
    index,
    onDelete,
    onToggleHidden,
}: {
    index: IndexRow;
    onDelete: (index: IndexRow) => void;
    onToggleHidden: (index: IndexRow) => void;
}): JSX.Element => (
    <Card className="indexCard" appearance="outline">
        <CardHeader
            header={<Body1 className="cardName">{index.name}</Body1>}
            description={<IndexTypeBadgeView type={classifyIndex(index)} />}
        />
        <Caption1 className="cardMuted">{keySummary(index)}</Caption1>
        <IndexStatChips index={index} />
        <CardFooter>
            <Button
                size="small"
                icon={index.hidden ? <EyeRegular /> : <EyeOffRegular />}
                disabled={index.isDefault}
                onClick={() => onToggleHidden(index)}
            >
                {index.hidden ? l10n.t('Unhide') : l10n.t('Hide')}
            </Button>
            <Button size="small" icon={<DeleteRegular />} disabled={index.isDefault} onClick={() => onDelete(index)}>
                {l10n.t('Delete')}
            </Button>
        </CardFooter>
    </Card>
);

// ---------------------------------------------------------------------------
// Variation C — Vertical cards with a 3-dot overflow menu (required)
// ---------------------------------------------------------------------------

const CardVariationMenu = ({
    index,
    onDelete,
    onToggleHidden,
}: {
    index: IndexRow;
    onDelete: (index: IndexRow) => void;
    onToggleHidden: (index: IndexRow) => void;
}): JSX.Element => (
    <Card className="indexCard" appearance="filled-alternative">
        <CardHeader
            header={<Body1 className="cardName">{index.name}</Body1>}
            description={<Caption1 className="cardMuted">{keySummary(index)}</Caption1>}
            action={<IndexActionsMenu index={index} onDelete={onDelete} onToggleHidden={onToggleHidden} />}
        />
        <div className="cardBadgeRow">
            <IndexTypeBadgeView type={classifyIndex(index)} />
            {index.hidden && <Caption1 className="cardMuted">{l10n.t('Hidden')}</Caption1>}
        </div>
        <IndexStatChips index={index} />
    </Card>
);

// ---------------------------------------------------------------------------
// Variation D — Stat-forward cards with a coloured preview strip + menu
// ---------------------------------------------------------------------------

const CardVariationStats = ({
    index,
    onDelete,
    onToggleHidden,
}: {
    index: IndexRow;
    onDelete: (index: IndexRow) => void;
    onToggleHidden: (index: IndexRow) => void;
}): JSX.Element => (
    <Card className="indexCard indexCardStats" appearance="filled">
        <CardPreview className="cardStatsPreview">
            <div className="cardStatsPreviewInner">
                <IndexTypeBadgeView type={classifyIndex(index)} />
            </div>
        </CardPreview>
        <CardHeader
            header={<Body1 className="cardName">{index.name}</Body1>}
            description={<Caption1 className="cardMuted">{keySummary(index)}</Caption1>}
            action={<IndexActionsMenu index={index} onDelete={onDelete} onToggleHidden={onToggleHidden} />}
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
    </Card>
);

// ---------------------------------------------------------------------------
// Container: render each design variation as its own labelled row
// ---------------------------------------------------------------------------

/**
 * Card layout for the Index Management tab — the comfortable view intended
 * for collections with only a handful of indexes.
 *
 * PROTOTYPE: this renders the same index list four times, once per card design
 * variation, so a direction can be chosen. Once picked, the winning variation
 * becomes the single card layout and the others are removed.
 */
export const IndexCardsView = ({ indexes, onDelete, onToggleHidden }: IndexCardsViewProps): JSX.Element => {
    if (indexes.length === 0) {
        return (
            <div className="indexCardsView" role="status">
                <span className="cardMuted">{l10n.t('No indexes to display.')}</span>
            </div>
        );
    }

    return (
        <div className="indexCardsView">
            <section className="cardsVariation">
                <Subtitle2 className="cardsVariationTitle">{l10n.t('Variation A — Compact list cards')}</Subtitle2>
                <div className="cardsGrid cardsGridWide">
                    {indexes.map((idx) => (
                        <CardVariationCompact key={idx.name} index={idx} />
                    ))}
                </div>
            </section>

            <section className="cardsVariation">
                <Subtitle2 className="cardsVariationTitle">{l10n.t('Variation B — Footer action buttons')}</Subtitle2>
                <div className="cardsGrid">
                    {indexes.map((idx) => (
                        <CardVariationFooterActions
                            key={idx.name}
                            index={idx}
                            onDelete={onDelete}
                            onToggleHidden={onToggleHidden}
                        />
                    ))}
                </div>
            </section>

            <section className="cardsVariation">
                <Subtitle2 className="cardsVariationTitle">{l10n.t('Variation C — Overflow (…) menu')}</Subtitle2>
                <div className="cardsGrid">
                    {indexes.map((idx) => (
                        <CardVariationMenu
                            key={idx.name}
                            index={idx}
                            onDelete={onDelete}
                            onToggleHidden={onToggleHidden}
                        />
                    ))}
                </div>
            </section>

            <section className="cardsVariation">
                <Subtitle2 className="cardsVariationTitle">{l10n.t('Variation D — Stat-forward cards')}</Subtitle2>
                <div className="cardsGrid">
                    {indexes.map((idx) => (
                        <CardVariationStats
                            key={idx.name}
                            index={idx}
                            onDelete={onDelete}
                            onToggleHidden={onToggleHidden}
                        />
                    ))}
                </div>
            </section>

            <Text as="p" className="cardMuted cardsPrototypeNote">
                {l10n.t('Prototype: four card designs for the same indexes. Pick one to keep.')}
            </Text>
        </div>
    );
};
