/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Card,
    createFocusOutlineStyle,
    makeStyles,
    mergeClasses,
    SkeletonItem,
    tokens,
    Tooltip,
} from '@fluentui/react-components';
import { DataUsageRegular, InfoRegular } from '@fluentui/react-icons';
import { type JSX, type ReactNode } from 'react';
import { type MetricCardProps } from './MetricGrid.types.js';

const useStyles = makeStyles({
    // No padding and no gap here on purpose: `Card` supplies both, and a rule declared here would
    // win against it and silently change the spacing of every card that has ever shipped.
    filled: { alignItems: 'flex-start' },
    subtle: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: '4px',
        borderRadius: tokens.borderRadiusMedium,
        // createFocusOutlineStyle positions a pseudo element against this box.
        position: 'relative',
        ...createFocusOutlineStyle(),
    },
    label: {
        color: tokens.colorNeutralForeground4,
        fontSize: '12px',
        fontWeight: 600,
        width: '100%',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
    },
    labelWithGlyph: { display: 'inline-flex', alignItems: 'center' },
    glyph: { fontSize: '12px', opacity: 0.6, marginLeft: '4px' },
    // The slot is what stops the skeleton to value swap from shifting everything below it, so its
    // height is reserved rather than derived from the content.
    value: {
        display: 'flex',
        alignItems: 'center',
        width: '100%',
        fontWeight: 600,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
    },
    valueLarge: { fontSize: '28px', lineHeight: '32px', minHeight: '32px' },
    valueSmall: { fontSize: '14px', lineHeight: '20px', minHeight: '20px' },
    unavailable: { opacity: 0.5, color: tokens.colorNeutralForegroundDisabled },
    tooltip: { padding: '8px' },
    tooltipTitle: { fontWeight: 600, fontSize: '16px', marginBottom: '12px' },
    tooltipBody: { whiteSpace: 'pre-line' },
    tooltipValue: {
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        marginTop: '12px',
        marginLeft: '-3px',
        fontWeight: 600,
    },
});

/**
 * One measurement: a caption, a value, and an optional explanation behind an info glyph.
 *
 * ```tsx
 * <MetricCard
 *     label="Execution time"
 *     value={executionMs === undefined ? undefined : `${executionMs.toFixed(2)} ms`}
 *     description="Total time the server spent running the query."
 * />
 * ```
 *
 * It distinguishes **not yet known** from **not available**: `undefined` renders a placeholder in a
 * value slot of the final height, and `null` renders `nullValuePlaceholder`. Everything else
 * renders as it is, so `0` and the empty string are values rather than absences.
 *
 * It formats nothing. Units, grouping, precision and percentages are locale-specific and belong to
 * whoever knows what the number means.
 *
 * For a single figure with no caption, use Fluent's `Text` with a type ramp size. For a value that
 * needs a control next to it, use `Card` directly.
 */
export const MetricCard = ({
    label,
    value,
    description,
    appearance = 'filled',
    size = 'large',
    loadingPlaceholder = 'skeleton',
    nullValuePlaceholder = 'N/A',
    tooltipPositioning = 'below',
    tooltipRepeatsValue = false,
    ariaLabel,
    className,
    ...rest
}: MetricCardProps): JSX.Element => {
    const styles = useStyles();

    const hasDescription = description !== undefined && description !== '';
    const valueText = typeof value === 'string' || typeof value === 'number' ? String(value) : '';

    // A supplied name makes the visible content decorative, and the two are never both active.
    const contentIsDecorative = ariaLabel !== undefined ? true : undefined;

    let renderedValue: ReactNode;
    if (value === null) {
        renderedValue = <span className={styles.unavailable}>{nullValuePlaceholder}</span>;
    } else if (value === undefined) {
        renderedValue =
            loadingPlaceholder === 'skeleton' ? (
                <SkeletonItem size={size === 'large' ? 28 : 16} appearance="translucent" />
            ) : null;
    } else {
        renderedValue = value;
    }

    const body = (
        <>
            <div
                className={mergeClasses(styles.label, hasDescription && styles.labelWithGlyph)}
                aria-hidden={contentIsDecorative}
            >
                {label}
                {hasDescription && <InfoRegular className={styles.glyph} />}
            </div>
            <div
                className={mergeClasses(styles.value, size === 'large' ? styles.valueLarge : styles.valueSmall)}
                aria-hidden={contentIsDecorative}
            >
                {renderedValue}
            </div>
        </>
    );

    const card =
        appearance === 'filled' ? (
            <Card
                appearance="filled"
                className={mergeClasses(styles.filled, className)}
                tabIndex={0}
                aria-label={ariaLabel}
                {...rest}
            >
                {body}
            </Card>
        ) : (
            // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- every card is a tab stop
            <div className={mergeClasses(styles.subtle, className)} tabIndex={0} aria-label={ariaLabel} {...rest}>
                {body}
            </div>
        );

    if (!hasDescription) {
        return card;
    }

    return (
        <Tooltip
            content={{
                children: (
                    <div className={styles.tooltip}>
                        <div className={styles.tooltipTitle}>{label}</div>
                        <div className={styles.tooltipBody}>{description}</div>
                        {tooltipRepeatsValue && valueText !== '' && (
                            <div className={styles.tooltipValue}>
                                <DataUsageRegular fontSize={24} /> {valueText}
                            </div>
                        )}
                    </div>
                ),
            }}
            positioning={tooltipPositioning}
            relationship="description"
        >
            {card}
        </Tooltip>
    );
};
