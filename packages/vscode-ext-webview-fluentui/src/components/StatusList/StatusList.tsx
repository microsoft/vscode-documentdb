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
export const StatusList = ({ ariaLabel, statusLabels, children, className, ...rest }: StatusListProps): JSX.Element => {
    const styles = useStyles();

    const labels = useMemo<Readonly<Record<StatusListItemStatus, string>>>(
        () => ({ ...defaultStatusLabels, ...statusLabels }),
        [statusLabels],
    );

    return (
        <StatusLabelsContext.Provider value={labels}>
            <div className={mergeClasses(styles.list, className)} role="list" aria-label={ariaLabel} {...rest}>
                {children}
            </div>
        </StatusLabelsContext.Provider>
    );
};
