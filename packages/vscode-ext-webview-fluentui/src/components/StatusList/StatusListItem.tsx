/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, makeStyles, mergeClasses, Spinner, Text, tokens, useId } from '@fluentui/react-components';
import {
    CheckmarkCircleFilled,
    ChevronDownRegular,
    ChevronUpRegular,
    CircleHintFilled,
    ErrorCircleFilled,
    SubtractCircleRegular,
    WarningRegular,
} from '@fluentui/react-icons';
import { Collapse } from '@fluentui/react-motion-components-preview';
import { type JSX, useCallback, useState } from 'react';
import { useStatusLabels } from '../contexts/statusLabels.js';
import { useSrOnlyStyles } from '../utils/srOnly.js';
import { useDetailsTypographyStyles } from './detailsTypography.js';
import { type StatusListItemDisclosure, type StatusListItemProps } from './StatusList.types.js';

const useStyles = makeStyles({
    // `flex-start`, not `center`: identical with no detail line, and correct with one.
    row: { display: 'flex', alignItems: 'flex-start', gap: '10px', minHeight: '20px' },
    // The box holds the glyph's place, which is also why the glyphs themselves need no `flexShrink`.
    icon: {
        width: '18px',
        height: tokens.lineHeightBase300,
        flexShrink: 0,
        display: 'grid',
        placeItems: 'center',
    },
    copy: { display: 'flex', flexDirection: 'column', gap: '1px', minWidth: 0, alignItems: 'flex-start' },
    // With a disclosure the copy takes the row's width, so the expanded region can use all of it.
    copyWithDisclosure: { flexGrow: 1 },
    // The toggle follows the label on the label's own line, so it reads as part of that row.
    labelLine: { display: 'flex', alignItems: 'flex-start', columnGap: tokens.spacingHorizontalS, minWidth: 0 },
    labelText: { minWidth: 0 },
    // With an `aside` the copy takes the row's width, so the aside can sit at its far end.
    copyWithAside: { flexGrow: 1 },
    // The label (and a label-placed toggle) wraps; the aside keeps its line.
    asideLine: {
        display: 'flex',
        alignItems: 'flex-start',
        alignSelf: 'stretch',
        columnGap: tokens.spacingHorizontalM,
        minWidth: 0,
    },
    asideLabel: { flexGrow: 1, minWidth: 0 },
    // Exactly the label line's height, so a small badge centres on the label without growing the row.
    aside: {
        flexShrink: 0,
        display: 'inline-flex',
        alignItems: 'center',
        height: tokens.lineHeightBase300,
        whiteSpace: 'nowrap',
    },
    // Exactly the label line's height, so a collapsed row with a toggle is as tall as one without.
    toggle: {
        flexShrink: 0,
        minWidth: 'auto',
        minHeight: tokens.lineHeightBase300,
        height: tokens.lineHeightBase300,
        paddingTop: 0,
        paddingBottom: 0,
        paddingLeft: tokens.spacingHorizontalXS,
        paddingRight: tokens.spacingHorizontalXS,
    },
    // Inline at the end of the detail line, in its type size and exactly its line height, so the line
    // wraps around it like a word and a collapsed row keeps its height. `top` keeps the line box at the
    // caption's height. The space before it is the wrap opportunity; the margin widens that gap.
    detailToggle: {
        minWidth: 'auto',
        minHeight: 0,
        height: tokens.lineHeightBase200,
        verticalAlign: 'top',
        marginLeft: tokens.spacingHorizontalXXS,
        paddingTop: 0,
        paddingBottom: 0,
        paddingLeft: tokens.spacingHorizontalXXS,
        paddingRight: tokens.spacingHorizontalXXS,
        columnGap: tokens.spacingHorizontalXXS,
        fontSize: tokens.fontSizeBase200,
        fontWeight: tokens.fontWeightRegular,
        lineHeight: tokens.lineHeightBase200,
        whiteSpace: 'nowrap',
        color: tokens.colorBrandForegroundLink,
        ':hover': { color: tokens.colorBrandForegroundLinkHover },
        ':hover:active': { color: tokens.colorBrandForegroundLinkPressed },
    },
    detailToggleIcon: {
        fontSize: tokens.fontSizeBase200,
        width: tokens.fontSizeBase200,
        height: tokens.fontSizeBase200,
    },
    region: {
        alignSelf: 'stretch',
        // An empty region must not add another flex gap to a collapsed row.
        ':empty': { display: 'none' },
    },
    // The frame around the consumer's content: the gap under the detail line, the indent and the rule.
    // The vertical padding lets the rule start above the first line and end below the last.
    regionBody: {
        marginTop: tokens.spacingVerticalS,
        paddingTop: tokens.spacingVerticalXXS,
        paddingBottom: tokens.spacingVerticalXXS,
        paddingLeft: tokens.spacingHorizontalM,
        borderLeft: `${tokens.strokeWidthThick} solid ${tokens.colorNeutralStroke2}`,
    },
    dimmedLabel: { color: tokens.colorNeutralForeground2 },
    // Normalised by element, never by a `fui-*` class: `Link` renders a <button> when it is given
    // `onClick` without `href`, and an inline control has to drop to the evidence line's type scale.
    detail: {
        color: tokens.colorNeutralForeground2,
        '& a, & button, & label': { fontSize: 'inherit', lineHeight: 'inherit' },
    },
    done: { color: tokens.colorPaletteGreenForeground1, fontSize: '18px' },
    error: { color: tokens.colorPaletteRedForeground1, fontSize: '18px' },
    warning: { color: tokens.colorStatusWarningForeground1, fontSize: '18px' },
    pending: { color: tokens.colorNeutralForeground4, fontSize: '18px' },
    skipped: { color: tokens.colorNeutralForeground3, fontSize: '18px' },
});

/**
 * One row of a {@link StatusList}.
 *
 * The row carries no `aria-label`. The status is a visually-hidden word appended to the label
 * instead, because a row-level label would make anything interactive inside {@link
 * StatusListItemProps.detail} unreachable, and `detail` takes arbitrary content, so that is a
 * guarantee rather than an observation.
 */
export const StatusListItem = ({
    label,
    status,
    detail,
    reserveDetailSpace,
    disclosure,
    aside,
    className,
    ...rest
}: StatusListItemProps): JSX.Element => {
    const styles = useStyles();
    const srOnly = useSrOnlyStyles();
    const detailsTypography = useDetailsTypographyStyles();
    const statusLabels = useStatusLabels();
    const [expanded, toggle] = useDisclosureState(disclosure);
    // Read once: the React Compiler lint treats an object that carries a ref as a ref itself.
    const { content, toggleText, toggleLabel, toggleDescription, toggleRef, placement } = disclosure ?? {};
    const hasDisclosure = disclosure !== undefined;
    const toggleId = useId('status-list-item-toggle-');
    const regionId = useId('status-list-item-details-');
    const descriptionId = useId('status-list-item-description-');

    let icon: JSX.Element;
    if (status === 'done') {
        icon = <CheckmarkCircleFilled aria-hidden className={styles.done} />;
    } else if (status === 'error') {
        icon = <ErrorCircleFilled aria-hidden className={styles.error} />;
    } else if (status === 'warning') {
        icon = <WarningRegular aria-hidden className={styles.warning} />;
    } else if (status === 'active') {
        icon = <Spinner size="extra-tiny" aria-hidden />;
    } else if (status === 'skipped') {
        icon = <SubtractCircleRegular aria-hidden className={styles.skipped} />;
    } else {
        icon = <CircleHintFilled aria-hidden className={styles.pending} />;
    }

    const hasDetail = detail !== undefined && detail !== null && detail !== false && detail !== '';

    const labelText = (
        <Text
            className={mergeClasses(
                status === 'pending' || status === 'skipped' ? styles.dimmedLabel : undefined,
                hasDisclosure ? styles.labelText : undefined,
            )}
        >
            {label}
            <span className={srOnly.srOnly}>{`, ${statusLabels[status]}`}</span>
        </Text>
    );

    const onDetailLine = hasDisclosure && placement === 'detail';
    const toggleButton = hasDisclosure ? (
        <Button
            id={toggleId}
            ref={toggleRef}
            className={onDetailLine ? styles.detailToggle : styles.toggle}
            size="small"
            appearance={onDetailLine ? 'transparent' : 'subtle'}
            icon={{
                children: expanded ? <ChevronUpRegular /> : <ChevronDownRegular />,
                className: onDetailLine ? styles.detailToggleIcon : undefined,
            }}
            iconPosition="after"
            aria-expanded={expanded}
            aria-controls={regionId}
            aria-label={toggleLabel}
            aria-describedby={toggleDescription ? descriptionId : undefined}
            onClick={toggle}
        >
            {toggleText}
        </Button>
    ) : undefined;
    // Outside both lines, so neither line's text includes it.
    const description =
        hasDisclosure && toggleDescription ? (
            <span id={descriptionId} hidden>
                {toggleDescription}
            </span>
        ) : undefined;
    const labelLine =
        hasDisclosure && !onDetailLine ? (
            <div className={styles.labelLine}>
                {labelText}
                {toggleButton}
            </div>
        ) : (
            labelText
        );
    const hasAside = aside !== undefined && aside !== null && aside !== false && aside !== '';

    return (
        <div className={mergeClasses(styles.row, className)} role="listitem" {...rest}>
            <span className={styles.icon}>{icon}</span>
            <div
                className={mergeClasses(
                    styles.copy,
                    hasDisclosure ? styles.copyWithDisclosure : undefined,
                    hasAside ? styles.copyWithAside : undefined,
                )}
            >
                {hasAside ? (
                    <div className={styles.asideLine}>
                        <div className={styles.asideLabel}>{labelLine}</div>
                        <span className={styles.aside}>{aside}</span>
                    </div>
                ) : (
                    labelLine
                )}
                {onDetailLine ? (
                    <Text size={200} className={styles.detail}>
                        {hasDetail ? <>{detail} </> : null}
                        {toggleButton}
                    </Text>
                ) : (
                    (hasDetail || reserveDetailSpace === true) && (
                        <Text size={200} className={styles.detail}>
                            {hasDetail ? detail : <span aria-hidden>{'\u00a0'}</span>}
                        </Text>
                    )
                )}
                {description}
                {hasDisclosure && (
                    <div
                        id={regionId}
                        role="region"
                        aria-labelledby={toggleId}
                        className={styles.region}
                        inert={!expanded}
                    >
                        <Collapse visible={expanded} unmountOnExit>
                            <div className={mergeClasses(detailsTypography.base, styles.regionBody)}>{content}</div>
                        </Collapse>
                    </div>
                )}
            </div>
        </div>
    );
};

/** Controlled when `expanded` is set; otherwise the row keeps its own state. */
function useDisclosureState(disclosure: StatusListItemDisclosure | undefined): [boolean, () => void] {
    const [own, setOwn] = useState(disclosure?.defaultExpanded === true);
    const controlled = disclosure?.expanded;
    const expanded = controlled ?? own;
    const onExpandedChange = disclosure?.onExpandedChange;
    const toggle = useCallback((): void => {
        const next = !expanded;
        if (controlled === undefined) {
            setOwn(next);
        }
        onExpandedChange?.(next);
    }, [expanded, controlled, onExpandedChange]);
    return [expanded, toggle];
}
