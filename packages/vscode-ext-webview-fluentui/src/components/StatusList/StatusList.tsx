/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles, mergeClasses, tokens } from '@fluentui/react-components';
import { type JSX, useMemo } from 'react';
import { defaultStatusLabels, StatusLabelsContext } from '../contexts/statusLabels.js';
import { type StatusListItemStatus, type StatusListProps } from './StatusList.types.js';

const useStyles = makeStyles({
    list: {
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        padding: '16px',
        border: `1px solid ${tokens.colorNeutralStroke2}`,
        borderRadius: tokens.borderRadiusMedium,
    },
    // Padding plus an equal negative margin gives the shade room without moving anything. Half the
    // list's 12px gap on each side, so neighbouring shades meet without overlapping.
    highlightRows: {
        '& > [role="listitem"]': {
            padding: '6px 8px',
            margin: '-6px -8px',
            borderRadius: tokens.borderRadiusMedium,
            // Transparent everywhere but high contrast, where the shade cannot show; Fluent's subtle
            // controls use the same token for their high-contrast hover outline.
            outline: `${tokens.strokeWidthThin} solid transparent`,
            outlineOffset: `calc(-1 * ${tokens.strokeWidthThin})`,
            transitionProperty: 'background-color',
            transitionDuration: tokens.durationFaster,
            transitionTimingFunction: tokens.curveEasyEase,
            '@media (prefers-reduced-motion: reduce)': { transitionDuration: '0.01ms' },
        },
        // `:focus-visible`, not `:focus-within`: a mouse click on a row's control must not leave that
        // row shaded while the pointer shades another one.
        '& > [role="listitem"]:hover, & > [role="listitem"]:has(:focus-visible)': {
            backgroundColor: tokens.colorNeutralBackground2,
            outlineColor: tokens.colorTransparentStrokeInteractive,
        },
    },
});

/**
 * A bordered list of things that are happening, or have happened: one row per stage, each with a
 * status glyph, a label and an optional line of evidence.
 *
 * ```tsx
 * <StatusList ariaLabel="Setup progress">
 *     <StatusListItem label="Checking Docker" status="done" detail="Docker Engine 27.3 · Linux" />
 *     <StatusListItem label="Pulling official image" status="active" />
 *     <StatusListItem label="Creating container" status="pending" />
 * </StatusList>
 * ```
 *
 * The border belongs to the component rather than to a `Card` the consumer wraps around it: the
 * list is one thing, and a wrapper would let the two drift apart.
 *
 * It carries no `aria-live`. A surface that streams progress should own one `role="status"` region
 * for the whole flow; live semantics here would double-announce.
 */
export const StatusList = ({
    ariaLabel,
    statusLabels,
    highlightRowsOnHover,
    children,
    className,
    ...rest
}: StatusListProps): JSX.Element => {
    const styles = useStyles();

    const labels = useMemo<Readonly<Record<StatusListItemStatus, string>>>(
        () => ({ ...defaultStatusLabels, ...statusLabels }),
        [statusLabels],
    );

    return (
        <StatusLabelsContext.Provider value={labels}>
            <div
                className={mergeClasses(
                    styles.list,
                    highlightRowsOnHover === true ? styles.highlightRows : undefined,
                    className,
                )}
                role="list"
                aria-label={ariaLabel}
                {...rest}
            >
                {children}
            </div>
        </StatusLabelsContext.Provider>
    );
};
