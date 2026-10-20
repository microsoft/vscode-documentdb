/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Dev-only design preview (POC): strings are not localized on purpose; the chosen option is
// rebuilt with l10n in GetPerformanceInsightsCard once the operator picks one.

import {
    Badge,
    Card,
    CardHeader,
    makeStyles,
    mergeClasses,
    Menu,
    MenuGroup,
    MenuGroupHeader,
    MenuItemRadio,
    MenuList,
    MenuPopover,
    MenuTrigger,
    Text,
    tokens,
    type MenuProps,
} from '@fluentui/react-components';
import { SparkleRegular } from '@fluentui/react-icons';
import { Fragment, useLayoutEffect, useRef, useState, type JSX, type ReactNode, type RefObject } from 'react';
import type { AvailableModelInfo } from '../../../../services/ai/modelSelection';
import { formatTokenCount } from '../../../../utils/formatTokenCount';
import '../../collectionView/queryInsightsTab/components/optimizationCards/baseOptimizationCard.scss';
import '../../collectionView/queryInsightsTab/components/optimizationCards/custom/GetPerformanceInsightsCard.scss';
import { groupPreviewModels, previewModels } from './mockModels';

export const usePreviewStyles = makeStyles({
    muted: { color: tokens.colorNeutralForeground3 },
    cardTitle: { display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalS, flexWrap: 'wrap' },
    cardHeader: { marginBottom: tokens.spacingVerticalS },
    cardBody: { display: 'block', marginBottom: tokens.spacingVerticalL },
    cardContent: { flex: 1, minWidth: 0 },
    actions: {
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: tokens.spacingHorizontalS,
    },
    actionsSpacer: { flexGrow: 1 },
    metaLine: {
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        columnGap: tokens.spacingHorizontalS,
        rowGap: tokens.spacingVerticalXXS,
        marginTop: tokens.spacingVerticalS,
        color: tokens.colorNeutralForeground3,
        fontSize: tokens.fontSizeBase200,
        lineHeight: tokens.lineHeightBase200,
    },
    smallLink: { fontSize: tokens.fontSizeBase200, lineHeight: tokens.lineHeightBase200 },
    strong: { color: tokens.colorNeutralForeground1, fontWeight: tokens.fontWeightSemibold },
    pillContent: { display: 'inline-flex', alignItems: 'center', gap: tokens.spacingHorizontalS, fontWeight: tokens.fontWeightRegular },

    staticSurface: {
        width: 'max-content',
        maxWidth: '420px',
        padding: tokens.spacingHorizontalXS,
        backgroundColor: tokens.colorNeutralBackground1,
        border: `${tokens.strokeWidthThin} solid ${tokens.colorTransparentStroke}`,
        borderRadius: tokens.borderRadiusMedium,
        boxShadow: tokens.shadow16,
        color: tokens.colorNeutralForeground1,
    },
    frame: { position: 'relative' },
    floating: { position: 'absolute', zIndex: 1, width: 'max-content' },
    hidden: { visibility: 'hidden' },
    anchor: { display: 'inline-flex' },
});

export const BODY_TEXT =
    'Get personalized recommendations to optimize your query performance. AI will analyze your cluster configuration, index usage, execution plan, and more to suggest specific improvements.';

export function contextLabel(model: AvailableModelInfo): string {
    return model.maxInputTokens > 0 ? formatTokenCount(model.maxInputTokens, 'en-US') : '';
}

export function costLabel(model: AvailableModelInfo): string | undefined {
    if (model.isUtility) return undefined;
    switch (model.priceCategory) {
        case 'low': return 'Low cost';
        case 'medium': return 'Medium cost';
        case 'high': return 'High cost';
        case 'very_high': return 'Very high cost';
        case undefined: return undefined;
        default: return `${model.priceCategory.charAt(0).toUpperCase()}${model.priceCategory.slice(1)} cost`;
    }
}

/** One-line plain-language cost explanation (tooltip / quick pick detail). */
export function costExplanation(model: AvailableModelInfo): string {
    return model.isUtility
        ? 'No additional cost for most GitHub Copilot subscribers.'
        : 'Uses premium requests from your Copilot plan.';
}

/** House style; VS Code tints: low/medium neutral, utility has no badge, high/very_high warning. */
export function CostBadge({ model }: { model: AvailableModelInfo }): JSX.Element | null {
    const label = costLabel(model);
    if (!label) return null;
    const warning = model.priceCategory === 'high' || model.priceCategory === 'very_high';
    return (
        <Badge appearance="tint" shape="rounded" size="small" color={!model.isUtility && warning ? 'warning' : 'informative'}>
            {label}
        </Badge>
    );
}

export function Dot(): JSX.Element {
    return <span aria-hidden>·</span>;
}

/** Joins inline meta items with a muted middle dot. */
export function MetaItems({ items }: { items: readonly ReactNode[] }): JSX.Element {
    return (
        <>
            {items.filter(Boolean).map((item, index) => (
                <Fragment key={index}>
                    {index > 0 && <Dot />}
                    {item}
                </Fragment>
            ))}
        </>
    );
}

/** Same shell as GetPerformanceInsightsCard: brand tint, sparkle, title and disclaimer. */
export function InsightsCardShell({ children, headerAction }: { children: ReactNode; headerAction?: JSX.Element }): JSX.Element {
    const styles = usePreviewStyles();
    const disclaimer = <Text size={200} className={styles.muted}>AI responses may be inaccurate</Text>;
    return (
        <Card
            className="get-performance-insights-card"
            style={{ backgroundColor: tokens.colorBrandBackground2, border: `1px solid ${tokens.colorBrandStroke1}` }}
        >
            <div className="optimization-card-container">
                <SparkleRegular className="optimization-card-icon" style={{ color: tokens.colorBrandForeground1, flexShrink: 0 }} />
                <div className={styles.cardContent}>
                    <CardHeader
                        className={styles.cardHeader}
                        header={<Text weight="semibold" size={500}>AI Performance Insights</Text>}
                        action={headerAction ?? disclaimer}
                    />
                    <Text size={300} className={styles.cardBody}>{BODY_TEXT}</Text>
                    {children}
                    {headerAction && <div className={styles.metaLine}>{disclaimer}</div>}
                </div>
            </div>
        </Card>
    );
}

export function ModelMenuGroups({ models }: { models: readonly AvailableModelInfo[] }): JSX.Element {
    return (
        <>
            {groupPreviewModels(models).map((group) => (
                <MenuGroup key={group.key}>
                    <MenuGroupHeader>{group.label}</MenuGroupHeader>
                    {group.models.map((model) => (
                        <MenuItemRadio
                            key={model.id}
                            name="model"
                            value={model.id}
                            // Fluent caps menu items at 290px, so only the cost badge fits next to the name.
                            secondaryContent={<CostBadge model={model} />}
                        >
                            {model.name}
                        </MenuItemRadio>
                    ))}
                </MenuGroup>
            ))}
        </>
    );
}

export interface ModelMenuProps {
    readonly selectedId: string;
    readonly onSelect: (id: string) => void;
    /** The trigger element (wrapped in MenuTrigger). */
    readonly children: JSX.Element;
    /** Extra items after the model groups (e.g. B's "Explore…" action). */
    readonly extra?: ReactNode;
    readonly positioning?: MenuProps['positioning'];
}

/** Interactive model menu: radio items grouped by category, cost badge per item. */
export function ModelMenu({ selectedId, onSelect, children, extra, positioning = 'below-start' }: ModelMenuProps): JSX.Element {
    return (
        <Menu
            positioning={positioning}
            hasCheckmarks
            checkedValues={{ model: [selectedId] }}
            onCheckedValueChange={(_event, data) => {
                if (data.name === 'model' && data.checkedItems[0]) onSelect(data.checkedItems[0]);
            }}
        >
            <MenuTrigger disableButtonEnhancement>{children}</MenuTrigger>
            <MenuPopover>
                <MenuList>
                    <ModelMenuGroups models={previewModels} />
                    {extra}
                </MenuList>
            </MenuPopover>
        </Menu>
    );
}

/** A static, non-interactive copy of the open model menu, for side-by-side screenshots. */
export function StaticModelMenu({ selectedId, extra }: { selectedId: string; extra?: ReactNode }): JSX.Element {
    const styles = usePreviewStyles();
    return (
        <div className={styles.staticSurface}>
            <MenuList hasCheckmarks checkedValues={{ model: [selectedId] }}>
                <ModelMenuGroups models={previewModels} />
                {extra}
            </MenuList>
        </div>
    );
}

/**
 * Renders `card` with `surface` floating under `anchorRef`, like an open popup, and reserves
 * enough height so the next frame does not overlap. The surface is inert (screenshot only).
 */
export function PopoverFrame({
    card,
    surface,
    anchorRef,
    align = 'start',
}: {
    card: ReactNode;
    surface: ReactNode;
    anchorRef: RefObject<HTMLElement | null>;
    align?: 'start' | 'end';
}): JSX.Element {
    const styles = usePreviewStyles();
    const frameRef = useRef<HTMLDivElement>(null);
    const surfaceRef = useRef<HTMLDivElement>(null);
    const [placement, setPlacement] = useState<{ top: number; left?: number; right?: number; minHeight: number }>();

    useLayoutEffect(() => {
        const update = (): void => {
            const frame = frameRef.current;
            const anchor = anchorRef.current;
            const floating = surfaceRef.current;
            if (!frame || !anchor || !floating) return;
            const frameRect = frame.getBoundingClientRect();
            const anchorRect = anchor.getBoundingClientRect();
            const top = anchorRect.bottom - frameRect.top + 4;
            const next = {
                top,
                left: align === 'start' ? anchorRect.left - frameRect.left : undefined,
                right: align === 'end' ? frameRect.right - anchorRect.right : undefined,
                minHeight: Math.ceil(top + floating.offsetHeight + 8),
            };
            setPlacement((previous) =>
                previous && previous.top === next.top && previous.left === next.left &&
                previous.right === next.right && previous.minHeight === next.minHeight ? previous : next);
        };
        update();
        const frameId = requestAnimationFrame(update);
        void document.fonts?.ready.then(update);
        window.addEventListener('resize', update);
        return () => {
            cancelAnimationFrame(frameId);
            window.removeEventListener('resize', update);
        };
    }, [anchorRef, align]);

    return (
        <div ref={frameRef} className={styles.frame} style={placement ? { minHeight: placement.minHeight } : undefined}>
            {card}
            <div
                ref={surfaceRef}
                inert
                className={mergeClasses(styles.floating, !placement && styles.hidden)}
                style={placement ? { top: placement.top, left: placement.left, right: placement.right } : undefined}
            >
                {surface}
            </div>
        </div>
    );
}
