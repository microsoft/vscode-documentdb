/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles, mergeClasses, Spinner, Text, tokens } from '@fluentui/react-components';
import { CheckmarkCircleFilled, CircleHintFilled, ErrorCircleFilled, WarningRegular } from '@fluentui/react-icons';
import { type JSX } from 'react';
import { useStatusLabels } from '../contexts/statusLabels.js';
import { useSrOnlyStyles } from '../utils/srOnly.js';
import { type StatusListItemProps } from './StatusList.types.js';

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
    pendingLabel: { color: tokens.colorNeutralForeground2 },
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
});

/**
 * One row of a {@link StatusList}.
 *
 * The row carries no `aria-label`. The status is a visually-hidden word appended to the label
 * instead, because a row-level label would make anything interactive inside {@link
 * StatusListItemProps.detail} unreachable — and `detail` takes arbitrary content, so that is a
 * guarantee rather than an observation.
 */
export const StatusListItem = ({
    label,
    status,
    detail,
    reserveDetailSpace,
    className,
    ...rest
}: StatusListItemProps): JSX.Element => {
    const styles = useStyles();
    const srOnly = useSrOnlyStyles();
    const statusLabels = useStatusLabels();

    let icon: JSX.Element;
    if (status === 'done') {
        icon = <CheckmarkCircleFilled aria-hidden className={styles.done} />;
    } else if (status === 'error') {
        icon = <ErrorCircleFilled aria-hidden className={styles.error} />;
    } else if (status === 'warning') {
        icon = <WarningRegular aria-hidden className={styles.warning} />;
    } else if (status === 'active') {
        icon = <Spinner size="extra-tiny" aria-hidden />;
    } else {
        icon = <CircleHintFilled aria-hidden className={styles.pending} />;
    }

    const hasDetail = detail !== undefined && detail !== null && detail !== false && detail !== '';

    return (
        <div className={mergeClasses(styles.row, className)} role="listitem" {...rest}>
            <span className={styles.icon}>{icon}</span>
            <div className={styles.copy}>
                <Text className={status === 'pending' ? styles.pendingLabel : undefined}>
                    {label}
                    <span className={srOnly.srOnly}>{`, ${statusLabels[status]}`}</span>
                </Text>
                {(hasDetail || reserveDetailSpace === true) && (
                    <Text size={200} className={styles.detail}>
                        {hasDetail ? detail : <span aria-hidden>{'\u00a0'}</span>}
                    </Text>
                )}
            </div>
        </div>
    );
};
