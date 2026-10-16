/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Badge, createFocusOutlineStyle, makeStyles, mergeClasses } from '@fluentui/react-components';
import { type JSX, useId } from 'react';
import { type FocusableBadgeProps } from './FocusableBadge.types.js';

const useStyles = makeStyles({
    root: {
        cursor: 'default',
        position: 'relative',
        ...createFocusOutlineStyle(),
    },
});

/**
 * A Fluent badge that can expose tooltip-only information to keyboard users.
 *
 * Keep `Tooltip` at the call site and use `relationship="description"`. The badge's visible
 * content is its accessible name; the tooltip supplies only supplementary description.
 *
 * When not focusable it emits the same DOM as a plain Fluent `Badge`.
 */
export const FocusableBadge = ({
    focusable = true,
    children,
    className,
    ...badgeProps
}: FocusableBadgeProps): JSX.Element => {
    const styles = useStyles();
    const contentId = useId();

    return (
        <Badge
            {...badgeProps}
            className={mergeClasses(styles.root, className)}
            // ARIA forbids naming a role-less element, and Badge renders a bare div.
            role={focusable ? 'group' : undefined}
            tabIndex={focusable ? 0 : undefined}
            aria-labelledby={focusable ? contentId : undefined}
        >
            {focusable ? <span id={contentId}>{children}</span> : children}
        </Badge>
    );
};
