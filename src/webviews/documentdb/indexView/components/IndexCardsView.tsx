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
// Per-type icon + accent colour
// ---------------------------------------------------------------------------

/**
 * Icon per index type. Single Field uses SquareMultiple to match the `combine`
 * codicon shown for indexes in the tree view; the rest get a thematic icon.
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

/** Accent colour per index type (VS Code chart colours adapt to the theme). */
const TYPE_ACCENT: Record<IndexTypeBadge, string> = {
    Default: 'var(--vscode-charts-lines, var(--colorNeutralStroke1))',
    ObjectId: 'var(--vscode-charts-purple, var(--colorBrandStroke1))',
    'Single Field': 'var(--vscode-charts-blue, var(--colorBrandStroke1))',
    Compound: 'var(--vscode-charts-purple, var(--colorBrandStroke1))',
    Text: 'var(--vscode-charts-green, var(--colorBrandStroke1))',
    Geospatial: 'var(--vscode-charts-orange, var(--colorBrandStroke1))',
    Wildcard: 'var(--vscode-charts-yellow, var(--colorBrandStroke1))',
    Hashed: 'var(--vscode-charts-red, var(--colorBrandStroke1))',
};

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Numeric directions (±1) → arrow glyphs; string sentinels (text, 2dsphere) pass through. */
function directionGlyph(direction: number | string): string {
    if (direction === 1) return '↑';
    if (direction === -1) return '↓';
    return String(direction);
}

/** Accent-tinted per-type index icon in a rounded surface. */
const IndexIcon = ({ index, tile }: { index: IndexRow; tile?: boolean }): JSX.Element => {
    const badge = classifyIndex(index);
    return (
        <span
            className={tile ? 'cardTypeIcon cardTypeTile' : 'cardTypeIcon cardTypeIconAccent'}
            style={tile ? { backgroundColor: TYPE_ACCENT[badge] } : { color: TYPE_ACCENT[badge] }}
            aria-hidden="true"
        >
            {TYPE_ICON[badge]}
        </span>
    );
};

/** The index's key fields rendered as small chips (field + direction glyph). */
const KeyBadges = ({ index }: { index: IndexRow }): JSX.Element => (
    <div className="keyBadges">
        {index.key.map((k, i) => (
            <Badge key={`${k.field}-${i}`} size="small" appearance="outline" color="subtle">
                {k.field}
                <span className="keyDir">{directionGlyph(k.direction)}</span>
            </Badge>
        ))}
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
            tooltip={l10n.t('Operations that have used this index since usage tracking began.')}
        />
    </div>
);

/** De-emphasised single line of stats (keeps cards quiet). */
const MutedStatsLine = ({ index }: { index: IndexRow }): JSX.Element => (
    <div className="mutedStatsLine">
        <StorageRegular />
        <span>{formatBytes(index.sizeBytes)}</span>
        <span className="statDot">·</span>
        <DataUsageRegular />
        <span>{formatOps(index.usageOps)}</span>
    </div>
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

// ---------------------------------------------------------------------------
// Kept from before — variant 3D family
// ---------------------------------------------------------------------------

const CardHeaderStd = ({ index, action }: { index: IndexRow; action?: JSX.Element }): JSX.Element => (
    <CardHeader
        image={<IndexIcon index={index} />}
        header={
            <Body1 className="cardName" title={index.name}>
                {index.name}
            </Body1>
        }
        description={
            <Caption1 className="cardSubtitle cardMuted" title={index.name}>
                <IndexTypeBadgeView type={classifyIndex(index)} size="small" />
            </Caption1>
        }
        action={action}
    />
);

// 3D — accessible stat badges + right-aligned footer.
const Card3D = ({ index, onDelete, onToggleHidden }: IndexCardProps): JSX.Element => (
    <Card className="indexCard" appearance="filled">
        <CardHeaderStd index={index} />
        <StatsBadges index={index} />
        <FooterButtonsRight index={index} onDelete={onDelete} onToggleHidden={onToggleHidden} />
    </Card>
);

// 3D+ — big figures + right-aligned footer.
const Card3DBig = ({ index, onDelete, onToggleHidden }: IndexCardProps): JSX.Element => (
    <Card className="indexCard" appearance="filled">
        <CardHeaderStd index={index} />
        <StatsBig index={index} />
        <FooterButtonsRight index={index} onDelete={onDelete} onToggleHidden={onToggleHidden} />
    </Card>
);

// ---------------------------------------------------------------------------
// Fresh, lower-noise variants
// ---------------------------------------------------------------------------

// F1 — accent left border, key chips, quiet stats, overflow menu.
const CardFreshBorder = ({ index, onDelete, onToggleHidden }: IndexCardProps): JSX.Element => (
    <Card
        className="indexCard freshBorder"
        appearance="filled"
        style={{ borderInlineStartColor: TYPE_ACCENT[classifyIndex(index)] }}
    >
        <CardHeader
            image={<IndexIcon index={index} />}
            header={
                <Body1 className="cardName" title={index.name}>
                    {index.name}
                </Body1>
            }
            description={<IndexTypeBadgeView type={classifyIndex(index)} size="small" />}
            action={<OverflowMenu index={index} onDelete={onDelete} onToggleHidden={onToggleHidden} />}
        />
        <KeyBadges index={index} />
        <MutedStatsLine index={index} />
    </Card>
);

// F2 — soft brand header band, key chips, quiet stats.
const CardBrandBand = ({ index, onDelete, onToggleHidden }: IndexCardProps): JSX.Element => (
    <Card className="indexCard freshBand" appearance="filled">
        <div className="cardBrandBand">
            <IndexIcon index={index} />
            <Body1 className="cardName cardBandName" title={index.name}>
                {index.name}
            </Body1>
            <OverflowMenu index={index} onDelete={onDelete} onToggleHidden={onToggleHidden} />
        </div>
        <div className="cardBandBody">
            <IndexTypeBadgeView type={classifyIndex(index)} size="small" />
            <KeyBadges index={index} />
            <MutedStatsLine index={index} />
        </div>
    </Card>
);

// F3 — big-name hero, minimal chrome (no buttons, quiet stats).
const CardHero = ({ index }: { index: IndexRow }): JSX.Element => (
    <Card className="indexCard freshHero" appearance="subtle">
        <div className="heroTop">
            <Subtitle2 className="cardName" title={index.name}>
                {index.name}
            </Subtitle2>
            <IndexTypeBadgeView type={classifyIndex(index)} size="small" />
        </div>
        <KeyBadges index={index} />
        <Caption1 className="cardMuted heroStats">
            {l10n.t('{0} · {1} ops', formatBytes(index.sizeBytes), formatOps(index.usageOps))}
        </Caption1>
    </Card>
);

// F4 — accent icon tile (horizontal), key chips, quiet stats.
const CardTile = ({ index, onDelete, onToggleHidden }: IndexCardProps): JSX.Element => (
    <Card className="indexCard freshTile" appearance="filled" orientation="horizontal">
        <IndexIcon index={index} tile />
        <div className="tileBody">
            <div className="tileHeaderRow">
                <Body1 className="cardName" title={index.name}>
                    {index.name}
                </Body1>
                <OverflowMenu index={index} onDelete={onDelete} onToggleHidden={onToggleHidden} />
            </div>
            <IndexTypeBadgeView type={classifyIndex(index)} size="small" />
            <KeyBadges index={index} />
            <MutedStatsLine index={index} />
        </div>
    </Card>
);

// F5 — component-forward: the key chips are the hero; stats as small badges.
const CardComponents = ({ index, onDelete, onToggleHidden }: IndexCardProps): JSX.Element => (
    <Card className="indexCard freshComponents" appearance="outline">
        <div className="componentsHeader">
            <IndexIcon index={index} />
            <Body1 className="cardName" title={index.name}>
                {index.name}
            </Body1>
            <OverflowMenu index={index} onDelete={onDelete} onToggleHidden={onToggleHidden} />
        </div>
        <div className="componentsHero">
            <KeyBadges index={index} />
        </div>
        <StatsBadges index={index} />
    </Card>
);

// F6 — colour-accented footer, key chips, right-aligned actions.
const CardFooterAccent = ({ index, onDelete, onToggleHidden }: IndexCardProps): JSX.Element => (
    <Card className="indexCard" appearance="filled">
        <CardHeader
            image={<IndexIcon index={index} />}
            header={
                <Body1 className="cardName" title={index.name}>
                    {index.name}
                </Body1>
            }
            description={<IndexTypeBadgeView type={classifyIndex(index)} size="small" />}
        />
        <KeyBadges index={index} />
        <CardFooter
            className="cardFooterRight cardFooterAccent"
            style={{ borderTopColor: TYPE_ACCENT[classifyIndex(index)] }}
        >
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
    </Card>
);

// ---------------------------------------------------------------------------
// Container
// ---------------------------------------------------------------------------

/**
 * Card layout for the Index Management tab — the comfortable view intended for
 * collections with only a handful of indexes.
 *
 * PROTOTYPE gallery: the two variant-3D designs plus a set of fresher, lower
 * noise ideas (per-type colour + icon, key-component chips, coloured borders /
 * header bands / footers). Goal is a layout that reads more pleasantly than
 * the table for < ~10 indexes. Pick a direction to keep.
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
            title: l10n.t('3D — Stat badges + right actions'),
            render: (idx) => <Card3D index={idx} onDelete={onDelete} onToggleHidden={onToggleHidden} />,
        },
        {
            title: l10n.t('3D+ — Big figures + right actions'),
            render: (idx) => <Card3DBig index={idx} onDelete={onDelete} onToggleHidden={onToggleHidden} />,
        },
        {
            title: l10n.t('F1 — Accent left border + key chips'),
            render: (idx) => <CardFreshBorder index={idx} onDelete={onDelete} onToggleHidden={onToggleHidden} />,
        },
        {
            title: l10n.t('F2 — Soft brand header band'),
            render: (idx) => <CardBrandBand index={idx} onDelete={onDelete} onToggleHidden={onToggleHidden} />,
        },
        {
            title: l10n.t('F3 — Big-name hero (minimal)'),
            render: (idx) => <CardHero index={idx} />,
        },
        {
            title: l10n.t('F4 — Accent icon tile'),
            render: (idx) => <CardTile index={idx} onDelete={onDelete} onToggleHidden={onToggleHidden} />,
        },
        {
            title: l10n.t('F5 — Component chips forward'),
            render: (idx) => <CardComponents index={idx} onDelete={onDelete} onToggleHidden={onToggleHidden} />,
        },
        {
            title: l10n.t('F6 — Colour-accented footer'),
            render: (idx) => <CardFooterAccent index={idx} onDelete={onDelete} onToggleHidden={onToggleHidden} />,
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
                {l10n.t('Prototype: card designs for the same indexes. Pick one to keep.')}
            </Text>
        </div>
    );
};
