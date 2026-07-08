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
    TextAlignLeftRegular,
} from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { type JSX } from 'react';
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

/** Icon rendering treatment for the leading index icon. */
type IconVariant = 'surface' | 'tile' | 'plain';

// ---------------------------------------------------------------------------
// Icons (per type) — a single accent colour for all types (no colour coding).
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

const ICON_VARIANT_CLASS: Record<IconVariant, string> = {
    surface: 'cardTypeIcon cardTypeIconAccent', // neutral surface + accent icon
    tile: 'cardTypeIcon cardTypeTile', // accent background + reversed icon (F4 style)
    plain: 'cardTypeIcon cardTypeIconPlain', // no background, accent icon (Query Insights AI style)
};

const IndexIcon = ({ index, variant = 'surface' }: { index: IndexRow; variant?: IconVariant }): JSX.Element => (
    <span className={ICON_VARIANT_CLASS[variant]} aria-hidden="true">
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

/** The index's key fields as chips (field + direction). `emphasis` makes them larger. */
const KeyBadges = ({ index, emphasis }: { index: IndexRow; emphasis?: boolean }): JSX.Element => (
    <div className={emphasis ? 'keyBadges keyBadgesEmphasis' : 'keyBadges'}>
        {index.key.map((k, i) => (
            <span key={`${k.field}-${i}`} className={emphasis ? 'keyChip keyChipEmphasis' : 'keyChip'}>
                <span className="keyField">{k.field}</span>
                <span className="keyDir">{directionGlyph(k.direction)}</span>
            </span>
        ))}
    </div>
);

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

/** Robust title row: optional icon, an always-rendered ellipsised name, optional action. */
const TitleRow = ({
    index,
    iconVariant,
    big,
    action,
}: {
    index: IndexRow;
    iconVariant?: IconVariant;
    big?: boolean;
    action?: JSX.Element;
}): JSX.Element => (
    <div className="cardTitleRow">
        {iconVariant && <IndexIcon index={index} variant={iconVariant} />}
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

/** Minimal, icon-free stats line: size · usage · since. Focusable, with a full tooltip. */
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
        {/* Focusable so keyboard users get the same tooltip depth as the badges. */}
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

// ---------------------------------------------------------------------------
// Component content blocks
// ---------------------------------------------------------------------------

/** Key chips inline (no surface panel); optional "Fields" label. */
const ComponentsInline = ({ index, showLabel }: { index: IndexRow; showLabel?: boolean }): JSX.Element => (
    <div className="componentsInline">
        {showLabel && <Caption1 className="cardMuted componentsLabel">{l10n.t('Fields')}</Caption1>}
        <KeyBadges index={index} emphasis />
    </div>
);

/** Key chips in a padded, labelled panel. */
const ComponentsHero = ({ index }: { index: IndexRow }): JSX.Element => (
    <div className="componentsHero">
        <Caption1 className="cardMuted componentsLabel">{l10n.t('Fields')}</Caption1>
        <KeyBadges index={index} emphasis />
    </div>
);

// ---------------------------------------------------------------------------
// Grid card variants (kept per feedback)
// ---------------------------------------------------------------------------

// 3D+ — big figures, kept as a reference.
const Card3DBig = ({ index, onDelete, onToggleHidden }: IndexCardProps): JSX.Element => (
    <Card className="indexCard" appearance="filled">
        <TitleRow
            index={index}
            iconVariant="surface"
            action={<IndexTypeBadgeView type={classifyIndex(index)} size="small" />}
        />
        <StatsBig index={index} />
        <FooterButtonsRight index={index} onDelete={onDelete} onToggleHidden={onToggleHidden} />
    </Card>
);

// F3c — minimal hero with the type badge in the upper-right corner.
const CardF3c = ({ index, onDelete, onToggleHidden }: IndexCardProps): JSX.Element => (
    <Card className="indexCard" appearance="filled">
        <TitleRow
            index={index}
            iconVariant="surface"
            big
            action={<IndexTypeBadgeView type={classifyIndex(index)} size="small" />}
        />
        <KeyBadges index={index} />
        <MinimalStats index={index} />
        <FooterButtonsRight index={index} onDelete={onDelete} onToggleHidden={onToggleHidden} />
    </Card>
);

// F5c — component panel; Hide/Unhide shows its label. `iconVariant` undefined = no icon.
const CardF5c = ({
    index,
    onDelete,
    onToggleHidden,
    iconVariant,
}: IndexCardProps & { iconVariant?: IconVariant }): JSX.Element => (
    <Card className="indexCard" appearance="filled">
        <TitleRow
            index={index}
            iconVariant={iconVariant}
            action={<LabeledActions index={index} onDelete={onDelete} onToggleHidden={onToggleHidden} />}
        />
        <ComponentsHero index={index} />
        <MinimalStats index={index} />
    </Card>
);

// F5e — inline chips (no frame), overflow menu; optional "Fields" label.
const CardF5e = ({
    index,
    onDelete,
    onToggleHidden,
    showLabel,
}: IndexCardProps & { showLabel?: boolean }): JSX.Element => (
    <Card className="indexCard" appearance="filled">
        <TitleRow
            index={index}
            iconVariant="surface"
            action={<OverflowMenu index={index} onDelete={onDelete} onToggleHidden={onToggleHidden} />}
        />
        <ComponentsInline index={index} showLabel={showLabel} />
        <MinimalStats index={index} />
    </Card>
);

// ---------------------------------------------------------------------------
// L family — full-width "rich list" rows (fixed columns align across rows;
// all rows equal height).
// ---------------------------------------------------------------------------

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
 * PROTOTYPE gallery (trimmed to the promising directions): a big-figures
 * reference, the F3c minimal hero, the F5 component families (with icon
 * treatments + label options), and the full-width L rich-list rows.
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
            title: l10n.t('3D+ — Big figures (reference)'),
            render: (idx) => <Card3DBig index={idx} onDelete={onDelete} onToggleHidden={onToggleHidden} />,
        },
        {
            title: l10n.t('F3c — Minimal hero (type badge top-right)'),
            render: (idx) => <CardF3c index={idx} onDelete={onDelete} onToggleHidden={onToggleHidden} />,
        },
        {
            title: l10n.t('F5c — Components (icon on surface, labeled Hide)'),
            render: (idx) => (
                <CardF5c index={idx} onDelete={onDelete} onToggleHidden={onToggleHidden} iconVariant="surface" />
            ),
        },
        {
            title: l10n.t('F5c — Components (no icon, labeled Hide)'),
            render: (idx) => <CardF5c index={idx} onDelete={onDelete} onToggleHidden={onToggleHidden} />,
        },
        {
            title: l10n.t('F5c — Components (accent tile icon)'),
            render: (idx) => (
                <CardF5c index={idx} onDelete={onDelete} onToggleHidden={onToggleHidden} iconVariant="tile" />
            ),
        },
        {
            title: l10n.t('F5c — Components (accent icon, no background)'),
            render: (idx) => (
                <CardF5c index={idx} onDelete={onDelete} onToggleHidden={onToggleHidden} iconVariant="plain" />
            ),
        },
        {
            title: l10n.t('F5e — Inline fields (with “Fields” label)'),
            render: (idx) => <CardF5e index={idx} onDelete={onDelete} onToggleHidden={onToggleHidden} showLabel />,
        },
        {
            title: l10n.t('F5e — Inline fields (no label)'),
            render: (idx) => <CardF5e index={idx} onDelete={onDelete} onToggleHidden={onToggleHidden} />,
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
