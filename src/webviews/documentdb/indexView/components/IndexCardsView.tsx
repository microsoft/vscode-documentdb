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
    EyeOffRegular,
    EyeRegular,
    MoreHorizontalRegular,
    SquareMultipleRegular,
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

/** Standard card header: accent index icon + name + key summary, optional trailing action. */
const CardHeaderStd = ({ index, action }: { index: IndexRow; action?: JSX.Element }): JSX.Element => (
    <CardHeader
        image={<IndexIcon />}
        header={<Body1 className="cardName">{index.name}</Body1>}
        description={<Caption1 className="cardMuted">{keySummary(index)}</Caption1>}
        action={action}
    />
);

// -- Stat renderings (borrowed from the Query Insights stage / summary cards) --

/** Big figures, like the Query Insights metric cards (28px value + small caps label). */
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

/** Bordered grid cells, like the execution-plan StageDetailCard primary metrics. */
const StatsBordered = ({ index }: { index: IndexRow }): JSX.Element => (
    <div className="borderedStatGrid">
        <div className="borderedStatCell">
            <span className="statLabel">{l10n.t('Size')}</span>
            <span className="statCellValue">{formatBytes(index.sizeBytes)}</span>
        </div>
        <div className="borderedStatCell">
            <span className="statLabel">{l10n.t('Usage')}</span>
            <span className="statCellValue">{formatOps(index.usageOps)}</span>
        </div>
    </div>
);

/** Inline gray badges, like the StageDetailCard optional metrics. */
const StatsBadges = ({ index }: { index: IndexRow }): JSX.Element => (
    <div className="statBadges">
        <Badge appearance="outline" color="informative" icon={<StorageRegular />}>
            {l10n.t('Size {0}', formatBytes(index.sizeBytes))}
        </Badge>
        <Badge appearance="outline" color="informative" icon={<DataUsageRegular />}>
            {l10n.t('Usage {0}', formatOps(index.usageOps))}
        </Badge>
    </div>
);

/** Two-column label/value grid, like the query-efficiency SummaryCard. */
const StatsSummaryGrid = ({ index }: { index: IndexRow }): JSX.Element => (
    <div className="summaryStatGrid">
        <div className="summaryStatCell">
            <span className="statLabel">{l10n.t('Size')}</span>
            <span className="statMedValue">{formatBytes(index.sizeBytes)}</span>
        </div>
        <div className="summaryStatCell">
            <span className="statLabel">{l10n.t('Usage')}</span>
            <span className="statMedValue">{formatOps(index.usageOps)}</span>
        </div>
    </div>
);

/** Compact medium inline figures. */
const StatsMedium = ({ index }: { index: IndexRow }): JSX.Element => (
    <div className="statsMediumRow">
        <StorageRegular />
        <Body1>{formatBytes(index.sizeBytes)}</Body1>
        <span className="statDot">·</span>
        <DataUsageRegular />
        <Body1>{formatOps(index.usageOps)}</Body1>
    </div>
);

// -- Action renderings (with / without; footer buttons, icon buttons, menu) --

const OverflowMenu = ({ index, onDelete, onToggleHidden }: IndexCardProps): JSX.Element => (
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

const FooterButtons = ({ index, onDelete, onToggleHidden }: IndexCardProps): JSX.Element => (
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

/** Icon-only actions aligned to the bottom-right corner of the card. */
const IconActionsBottomRight = ({ index, onDelete, onToggleHidden }: IndexCardProps): JSX.Element => (
    <div className="cardActionsBottomRight">
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
// Variant 3 sub-variants (stat-forward). Each mixes a stat rendering with an
// action treatment (none / icon buttons / overflow menu / footer buttons).
// ---------------------------------------------------------------------------

// 3A — Big figures, no actions.
const Card3A = ({ index }: { index: IndexRow }): JSX.Element => (
    <Card className="indexCard" appearance="filled">
        <CardHeaderStd index={index} />
        <StatsBig index={index} />
    </Card>
);

// 3B — Big figures + icon actions at bottom-right.
const Card3B = ({ index, onDelete, onToggleHidden }: IndexCardProps): JSX.Element => (
    <Card className="indexCard" appearance="filled">
        <CardHeaderStd index={index} />
        <StatsBig index={index} />
        <IconActionsBottomRight index={index} onDelete={onDelete} onToggleHidden={onToggleHidden} />
    </Card>
);

// 3C — Bordered stat cells + overflow (…) menu in the header.
const Card3C = ({ index, onDelete, onToggleHidden }: IndexCardProps): JSX.Element => (
    <Card className="indexCard" appearance="outline">
        <CardHeaderStd
            index={index}
            action={<OverflowMenu index={index} onDelete={onDelete} onToggleHidden={onToggleHidden} />}
        />
        <StatsBordered index={index} />
    </Card>
);

// 3D — Inline stat badges + footer buttons.
const Card3D = ({ index, onDelete, onToggleHidden }: IndexCardProps): JSX.Element => (
    <Card className="indexCard" appearance="filled">
        <CardHeaderStd index={index} action={<IndexTypeBadgeView type={classifyIndex(index)} />} />
        <StatsBadges index={index} />
        <FooterButtons index={index} onDelete={onDelete} onToggleHidden={onToggleHidden} />
    </Card>
);

// 3E — Summary-grid stats + icon actions at bottom-right.
const Card3E = ({ index, onDelete, onToggleHidden }: IndexCardProps): JSX.Element => (
    <Card className="indexCard" appearance="filled-alternative">
        <CardHeaderStd index={index} />
        <StatsSummaryGrid index={index} />
        <IconActionsBottomRight index={index} onDelete={onDelete} onToggleHidden={onToggleHidden} />
    </Card>
);

// 3F — Compact medium figures + overflow (…) menu at bottom-right.
const Card3F = ({ index, onDelete, onToggleHidden }: IndexCardProps): JSX.Element => (
    <Card className="indexCard" appearance="outline">
        <CardHeaderStd index={index} />
        <StatsMedium index={index} />
        <div className="cardActionsBottomRight">
            <OverflowMenu index={index} onDelete={onDelete} onToggleHidden={onToggleHidden} />
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
 * PROTOTYPE (variant 3 deep-dive): a gallery of stat-forward card designs that
 * vary how size/usage are rendered (big figures, bordered cells, badges,
 * summary grid, medium inline — echoing the Query Insights stage / efficiency
 * cards) and how row actions appear (none, icon buttons bottom-right, overflow
 * menu, or footer buttons). Pick a direction to keep as the single layout.
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
        { title: l10n.t('3A — Big figures, no actions'), render: (idx) => <Card3A index={idx} /> },
        {
            title: l10n.t('3B — Big figures + icon actions (bottom-right)'),
            render: (idx) => <Card3B index={idx} onDelete={onDelete} onToggleHidden={onToggleHidden} />,
        },
        {
            title: l10n.t('3C — Bordered stat cells + (…) menu'),
            render: (idx) => <Card3C index={idx} onDelete={onDelete} onToggleHidden={onToggleHidden} />,
        },
        {
            title: l10n.t('3D — Stat badges + footer buttons'),
            render: (idx) => <Card3D index={idx} onDelete={onDelete} onToggleHidden={onToggleHidden} />,
        },
        {
            title: l10n.t('3E — Summary grid + icon actions'),
            render: (idx) => <Card3E index={idx} onDelete={onDelete} onToggleHidden={onToggleHidden} />,
        },
        {
            title: l10n.t('3F — Medium figures + (…) menu (bottom-right)'),
            render: (idx) => <Card3F index={idx} onDelete={onDelete} onToggleHidden={onToggleHidden} />,
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
                {l10n.t('Prototype: stat-forward card designs for the same indexes. Pick one to keep.')}
            </Text>
        </div>
    );
};
