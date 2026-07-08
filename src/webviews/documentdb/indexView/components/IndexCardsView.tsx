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
    Menu,
    MenuItem,
    MenuList,
    MenuPopover,
    MenuTrigger,
    Subtitle2,
    Text,
    Tooltip,
} from '@fluentui/react-components';
import {
    DataUsageRegular,
    DeleteRegular,
    DocumentMultipleRegular,
    EyeOffRegular,
    EyeRegular,
    GlobeRegular,
    KeyRegular,
    MoreHorizontalRegular,
    NumberSymbolRegular,
    SquareMultipleRegular,
    StarRegular,
    StorageRegular,
    TextAlignLeftRegular,
} from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { type JSX } from 'react';
import '../../../components/focusableBadge/focusableBadge.scss';
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
// Icons (per type) — a single accent colour for all types (no colour coding).
// ---------------------------------------------------------------------------

/**
 * Icon per index type. Single Field uses SquareMultiple to match the `combine`
 * codicon shown for indexes in the tree view; the rest get a thematic icon.
 * Colour is a single theme accent for every type (we don't colour-code types).
 */
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

/** Filled accent tile variant of the icon (icon reversed out of the accent). */
const IndexTile = ({ index }: { index: IndexRow }): JSX.Element => (
    <span className="cardTypeIcon cardTypeTile" aria-hidden="true">
        {TYPE_ICON[classifyIndex(index)]}
    </span>
);

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function directionGlyph(direction: number | string): string {
    if (direction === 1) return '↑';
    if (direction === -1) return '↓';
    return String(direction);
}

/** The index's key fields as chips (field + direction). `emphasis` makes them readable/larger. */
const KeyBadges = ({ index, emphasis }: { index: IndexRow; emphasis?: boolean }): JSX.Element => (
    <div className={emphasis ? 'keyBadges keyBadgesEmphasis' : 'keyBadges'}>
        {index.key.map((k, i) => (
            // Custom chip (not a Fluent Badge) so the field-name text has an
            // explicit, always-legible colour on any card surface.
            <span key={`${k.field}-${i}`} className={emphasis ? 'keyChip keyChipEmphasis' : 'keyChip'}>
                <span className="keyField">{k.field}</span>
                <span className="keyDir">{directionGlyph(k.direction)}</span>
            </span>
        ))}
    </div>
);

/**
 * Robust title row: optional icon, an ellipsised name that always renders
 * (grows inside its own min-width:0 block), and an optional trailing action.
 */
const TitleRow = ({
    index,
    withIcon,
    big,
    action,
}: {
    index: IndexRow;
    withIcon?: boolean;
    big?: boolean;
    action?: JSX.Element;
}): JSX.Element => (
    <div className="cardTitleRow">
        {withIcon && <IndexIcon index={index} />}
        <div className="cardTitleBlock">
            {big ? (
                <Subtitle2 className="cardName" title={index.name}>
                    {index.name}
                </Subtitle2>
            ) : (
                <Body1 className="cardName" title={index.name}>
                    {index.name}
                </Body1>
            )}
        </div>
        {action}
    </div>
);

/** Accessible (keyboard-focusable), small stat badge — matches Query Insights sizing. */
const StatBadge = ({ icon, label, tooltip }: { icon: JSX.Element; label: string; tooltip: string }): JSX.Element => (
    <Tooltip content={tooltip} relationship="description">
        <Badge
            appearance="tint"
            shape="rounded"
            size="small"
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
            tooltip={formatSinceTooltip(index.usageSince)}
        />
    </div>
);

/**
 * Minimal, icon-free stats line for the "hero" cards: size · usage · since.
 * Focusable, with the same tooltip depth as the stat badges.
 */
const MinimalStats = ({ index }: { index: IndexRow }): JSX.Element => (
    <Tooltip
        relationship="description"
        content={
            <div className="statTooltip">
                <div>{l10n.t('Size: {0} on disk.', formatBytes(index.sizeBytes))}</div>
                <div>{l10n.t('Usage: {0} operations.', formatOps(index.usageOps))}</div>
                <div>{formatSinceTooltip(index.usageSince)}</div>
            </div>
        }
    >
        {/* Focusable so keyboard users get the same tooltip depth as the stat badges. */}
        {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
        <div className="mutedStatsLine" tabIndex={0} role="group" aria-label={l10n.t('Index statistics')}>
            <span>{formatBytes(index.sizeBytes)}</span>
            <span className="statDot">·</span>
            <span>{l10n.t('{0} ops', formatOps(index.usageOps))}</span>
            <span className="statDot">·</span>
            <span>{l10n.t('since {0}', formatDate(index.usageSince))}</span>
        </div>
    </Tooltip>
);

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

// -- Actions --

const OverflowMenu = ({ index, onDelete, onToggleHidden }: IndexCardProps): JSX.Element => (
    <Menu>
        <MenuTrigger disableButtonEnhancement>
            <Button
                appearance="subtle"
                size="small"
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

// ---------------------------------------------------------------------------
// Kept variants: 3D, 3D+, F4 tile
// ---------------------------------------------------------------------------

// 3D — accessible stat badges + right-aligned footer.
const Card3D = ({ index, onDelete, onToggleHidden }: IndexCardProps): JSX.Element => (
    <Card className="indexCard" appearance="filled">
        <TitleRow index={index} withIcon action={<IndexTypeBadgeView type={classifyIndex(index)} size="small" />} />
        <StatsBadges index={index} />
        <FooterButtonsRight index={index} onDelete={onDelete} onToggleHidden={onToggleHidden} />
    </Card>
);

// 3D+ — big figures + right-aligned footer.
const Card3DBig = ({ index, onDelete, onToggleHidden }: IndexCardProps): JSX.Element => (
    <Card className="indexCard" appearance="filled">
        <TitleRow index={index} withIcon action={<IndexTypeBadgeView type={classifyIndex(index)} size="small" />} />
        <StatsBig index={index} />
        <FooterButtonsRight index={index} onDelete={onDelete} onToggleHidden={onToggleHidden} />
    </Card>
);

// F4 — accent icon tile (single accent), key chips, quiet stats, overflow menu.
const CardTile = ({ index, onDelete, onToggleHidden }: IndexCardProps): JSX.Element => (
    <Card className="indexCard freshTile" appearance="filled" orientation="horizontal">
        <IndexTile index={index} />
        <div className="tileBody">
            <div className="cardTitleRow">
                <div className="cardTitleBlock">
                    <Body1 className="cardName" title={index.name}>
                        {index.name}
                    </Body1>
                </div>
                <OverflowMenu index={index} onDelete={onDelete} onToggleHidden={onToggleHidden} />
            </div>
            <IndexTypeBadgeView type={classifyIndex(index)} size="small" />
            <KeyBadges index={index} />
            <MinimalStats index={index} />
        </div>
    </Card>
);

// ---------------------------------------------------------------------------
// F3 family — minimal "hero" cards (filled surface). Vary icon + actions.
// ---------------------------------------------------------------------------

const HeroMeta = ({ index }: { index: IndexRow }): JSX.Element => (
    <div className="cardMetaRow">
        <IndexTypeBadgeView type={classifyIndex(index)} size="small" />
        <KeyBadges index={index} />
    </div>
);

// F3a — no icon, no action buttons (cleanest).
const CardF3a = ({ index }: { index: IndexRow }): JSX.Element => (
    <Card className="indexCard" appearance="filled">
        <TitleRow index={index} big />
        <HeroMeta index={index} />
        <MinimalStats index={index} />
    </Card>
);

// F3b — no icon, overflow (…) menu.
const CardF3b = ({ index, onDelete, onToggleHidden }: IndexCardProps): JSX.Element => (
    <Card className="indexCard" appearance="filled">
        <TitleRow
            index={index}
            big
            action={<OverflowMenu index={index} onDelete={onDelete} onToggleHidden={onToggleHidden} />}
        />
        <HeroMeta index={index} />
        <MinimalStats index={index} />
    </Card>
);

// F3c — with icon + footer buttons.
const CardF3c = ({ index, onDelete, onToggleHidden }: IndexCardProps): JSX.Element => (
    <Card className="indexCard" appearance="filled">
        <TitleRow index={index} withIcon big />
        <HeroMeta index={index} />
        <MinimalStats index={index} />
        <FooterButtonsRight index={index} onDelete={onDelete} onToggleHidden={onToggleHidden} />
    </Card>
);

// ---------------------------------------------------------------------------
// F5 family — component-forward cards (key chips are the hero). Vary icon,
// panel vs. inline chips, and actions.
// ---------------------------------------------------------------------------

/** Key chips in a padded, labelled panel. */
const ComponentsHero = ({ index }: { index: IndexRow }): JSX.Element => (
    <div className="componentsHero">
        <Caption1 className="cardMuted componentsLabel">{l10n.t('Fields')}</Caption1>
        <KeyBadges index={index} emphasis />
    </div>
);

/** Key chips inline (no surface panel). */
const ComponentsInline = ({ index }: { index: IndexRow }): JSX.Element => (
    <div className="componentsInline">
        <Caption1 className="cardMuted componentsLabel">{l10n.t('Fields')}</Caption1>
        <KeyBadges index={index} emphasis />
    </div>
);

// F5a — icon, panel, footer buttons.
const CardF5a = ({ index, onDelete, onToggleHidden }: IndexCardProps): JSX.Element => (
    <Card className="indexCard" appearance="filled">
        <TitleRow index={index} withIcon action={<IndexTypeBadgeView type={classifyIndex(index)} size="small" />} />
        <ComponentsHero index={index} />
        <MinimalStats index={index} />
        <FooterButtonsRight index={index} onDelete={onDelete} onToggleHidden={onToggleHidden} />
    </Card>
);

// F5b — no icon, panel, overflow (…) menu.
const CardF5b = ({ index, onDelete, onToggleHidden }: IndexCardProps): JSX.Element => (
    <Card className="indexCard" appearance="filled">
        <TitleRow
            index={index}
            action={<OverflowMenu index={index} onDelete={onDelete} onToggleHidden={onToggleHidden} />}
        />
        <IndexTypeBadgeView type={classifyIndex(index)} size="small" />
        <ComponentsHero index={index} />
        <StatsBadges index={index} />
    </Card>
);

// F5c — icon, panel, icon-only action buttons.
const CardF5c = ({ index, onDelete, onToggleHidden }: IndexCardProps): JSX.Element => (
    <Card className="indexCard" appearance="filled">
        <TitleRow
            index={index}
            withIcon
            action={<IconActionsRight index={index} onDelete={onDelete} onToggleHidden={onToggleHidden} />}
        />
        <ComponentsHero index={index} />
        <MinimalStats index={index} />
    </Card>
);

// F5d — NO icon, big title (F3 style), panel, footer buttons.
const CardF5d = ({ index, onDelete, onToggleHidden }: IndexCardProps): JSX.Element => (
    <Card className="indexCard" appearance="filled">
        <TitleRow index={index} big action={<IndexTypeBadgeView type={classifyIndex(index)} size="small" />} />
        <ComponentsHero index={index} />
        <MinimalStats index={index} />
        <FooterButtonsRight index={index} onDelete={onDelete} onToggleHidden={onToggleHidden} />
    </Card>
);

// F5e — icon, NO gray panel (inline chips), overflow (…) menu.
const CardF5e = ({ index, onDelete, onToggleHidden }: IndexCardProps): JSX.Element => (
    <Card className="indexCard" appearance="filled">
        <TitleRow
            index={index}
            withIcon
            action={<OverflowMenu index={index} onDelete={onDelete} onToggleHidden={onToggleHidden} />}
        />
        <ComponentsInline index={index} />
        <MinimalStats index={index} />
    </Card>
);

// F5f — NO icon, big title, NO gray panel (inline chips), footer buttons.
const CardF5f = ({ index, onDelete, onToggleHidden }: IndexCardProps): JSX.Element => (
    <Card className="indexCard" appearance="filled">
        <TitleRow index={index} big action={<IndexTypeBadgeView type={classifyIndex(index)} size="small" />} />
        <ComponentsInline index={index} />
        <MinimalStats index={index} />
        <FooterButtonsRight index={index} onDelete={onDelete} onToggleHidden={onToggleHidden} />
    </Card>
);

// ---------------------------------------------------------------------------
// L family — full-width "rich list" rows. Each card spans the row; a shared
// grid template keeps columns aligned across rows (table-like). Key components
// stack one per line; actions sit at the far right.
// ---------------------------------------------------------------------------

/** Key fields stacked one per line (Fields column of the list layout). */
const KeyLines = ({ index }: { index: IndexRow }): JSX.Element => (
    <div className="listFieldLines">
        {index.key.map((k, i) => (
            <span key={`${k.field}-${i}`} className="keyChip">
                <span className="keyField">{k.field}</span>
                <span className="keyDir">{directionGlyph(k.direction)}</span>
            </span>
        ))}
    </div>
);

// L1 — no icon, stacked field lines, icon actions at far right.
const CardL1 = ({ index, onDelete, onToggleHidden }: IndexCardProps): JSX.Element => (
    <Card className="indexListCard" appearance="filled">
        <div className="listRow">
            <div className="listName">
                <Body1 className="cardName" title={index.name}>
                    {index.name}
                </Body1>
            </div>
            <div className="listType">
                <IndexTypeBadgeView type={classifyIndex(index)} size="small" />
            </div>
            <KeyLines index={index} />
            <div className="listStats">
                <MinimalStats index={index} />
            </div>
            <div className="listActions">
                <IconActionsRight index={index} onDelete={onDelete} onToggleHidden={onToggleHidden} />
            </div>
        </div>
    </Card>
);

// L2 — with icon, stacked field lines, overflow menu at far right.
const CardL2 = ({ index, onDelete, onToggleHidden }: IndexCardProps): JSX.Element => (
    <Card className="indexListCard" appearance="filled">
        <div className="listRow">
            <div className="listName">
                <IndexIcon index={index} />
                <Body1 className="cardName" title={index.name}>
                    {index.name}
                </Body1>
            </div>
            <div className="listType">
                <IndexTypeBadgeView type={classifyIndex(index)} size="small" />
            </div>
            <KeyLines index={index} />
            <div className="listStats">
                <MinimalStats index={index} />
            </div>
            <div className="listActions">
                <OverflowMenu index={index} onDelete={onDelete} onToggleHidden={onToggleHidden} />
            </div>
        </div>
    </Card>
);

// L3 — icon, inline (wrapping) field chips, icon actions at far right.
const CardL3 = ({ index, onDelete, onToggleHidden }: IndexCardProps): JSX.Element => (
    <Card className="indexListCard" appearance="filled">
        <div className="listRow">
            <div className="listName">
                <IndexIcon index={index} />
                <Body1 className="cardName" title={index.name}>
                    {index.name}
                </Body1>
            </div>
            <div className="listType">
                <IndexTypeBadgeView type={classifyIndex(index)} size="small" />
            </div>
            <div className="listFieldsInline">
                <KeyBadges index={index} />
            </div>
            <div className="listStats">
                <MinimalStats index={index} />
            </div>
            <div className="listActions">
                <IconActionsRight index={index} onDelete={onDelete} onToggleHidden={onToggleHidden} />
            </div>
        </div>
    </Card>
);

// ---------------------------------------------------------------------------
// Container
// ---------------------------------------------------------------------------

/**
 * Card layout for the Index Management tab — the comfortable view intended for
 * collections with only a handful of indexes.
 *
 * PROTOTYPE gallery: kept 3D / 3D+ / tile designs plus F3 (minimal hero) and
 * F5 (component-forward) families, each explored with / without an icon and
 * with different action treatments (none, footer buttons, icon buttons,
 * overflow menu). A single accent colour is used for every index type.
 */
export const IndexCardsView = ({ indexes, onDelete, onToggleHidden }: IndexCardsViewProps): JSX.Element => {
    if (indexes.length === 0) {
        return (
            <div className="indexCardsView" role="status">
                <span className="cardMuted">{l10n.t('No indexes to display.')}</span>
            </div>
        );
    }

    const variations: ReadonlyArray<{
        title: string;
        layout?: 'grid' | 'list';
        render: (index: IndexRow) => JSX.Element;
    }> = [
        {
            title: l10n.t('3D — Stat badges + footer'),
            render: (idx) => <Card3D index={idx} onDelete={onDelete} onToggleHidden={onToggleHidden} />,
        },
        {
            title: l10n.t('3D+ — Big figures + footer'),
            render: (idx) => <Card3DBig index={idx} onDelete={onDelete} onToggleHidden={onToggleHidden} />,
        },
        {
            title: l10n.t('F4 — Accent icon tile'),
            render: (idx) => <CardTile index={idx} onDelete={onDelete} onToggleHidden={onToggleHidden} />,
        },
        { title: l10n.t('F3a — Minimal hero (no icon, no actions)'), render: (idx) => <CardF3a index={idx} /> },
        {
            title: l10n.t('F3b — Minimal hero (no icon, … menu)'),
            render: (idx) => <CardF3b index={idx} onDelete={onDelete} onToggleHidden={onToggleHidden} />,
        },
        {
            title: l10n.t('F3c — Minimal hero (icon + footer)'),
            render: (idx) => <CardF3c index={idx} onDelete={onDelete} onToggleHidden={onToggleHidden} />,
        },
        {
            title: l10n.t('F5a — Components (icon + footer)'),
            render: (idx) => <CardF5a index={idx} onDelete={onDelete} onToggleHidden={onToggleHidden} />,
        },
        {
            title: l10n.t('F5b — Components (no icon, … menu)'),
            render: (idx) => <CardF5b index={idx} onDelete={onDelete} onToggleHidden={onToggleHidden} />,
        },
        {
            title: l10n.t('F5c — Components (icon + icon actions)'),
            render: (idx) => <CardF5c index={idx} onDelete={onDelete} onToggleHidden={onToggleHidden} />,
        },
        {
            title: l10n.t('F5d — Components (no icon, big title, footer)'),
            render: (idx) => <CardF5d index={idx} onDelete={onDelete} onToggleHidden={onToggleHidden} />,
        },
        {
            title: l10n.t('F5e — Components (icon, no panel, … menu)'),
            render: (idx) => <CardF5e index={idx} onDelete={onDelete} onToggleHidden={onToggleHidden} />,
        },
        {
            title: l10n.t('F5f — Components (no icon, no panel, footer)'),
            render: (idx) => <CardF5f index={idx} onDelete={onDelete} onToggleHidden={onToggleHidden} />,
        },
        {
            title: l10n.t('L1 — Rich list (no icon, stacked fields, icon actions)'),
            layout: 'list',
            render: (idx) => <CardL1 index={idx} onDelete={onDelete} onToggleHidden={onToggleHidden} />,
        },
        {
            title: l10n.t('L2 — Rich list (icon, stacked fields, … menu)'),
            layout: 'list',
            render: (idx) => <CardL2 index={idx} onDelete={onDelete} onToggleHidden={onToggleHidden} />,
        },
        {
            title: l10n.t('L3 — Rich list (icon, inline fields, icon actions)'),
            layout: 'list',
            render: (idx) => <CardL3 index={idx} onDelete={onDelete} onToggleHidden={onToggleHidden} />,
        },
    ];

    return (
        <div className="indexCardsView">
            {variations.map((variation) => (
                <section className="cardsVariation" key={variation.title}>
                    <Subtitle2 className="cardsVariationTitle">{variation.title}</Subtitle2>
                    <div className={variation.layout === 'list' ? 'cardsList' : 'cardsGrid'}>
                        {indexes.map((idx) => (
                            <div key={idx.name}>{variation.render(idx)}</div>
                        ))}
                    </div>
                </section>
            ))}

            <Text as="p" className="cardMuted cardsPrototypeNote">
                {l10n.t('Prototype: card designs for the same indexes. Pick one to keep.')}
            </Text>
        </div>
    );
};
