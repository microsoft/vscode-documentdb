/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles, mergeClasses, tokens } from '@fluentui/react-components';
import { ErrorCircleRegular, InfoRegular, WarningRegular } from '@fluentui/react-icons';
import { type JSX, type ReactNode } from 'react';
import { useSrOnlyStyles } from '../utils/srOnly.js';
import { useDetailsTypographyStyles } from './detailsTypography.js';
import {
    type StatusListDetailsFact,
    type StatusListDetailsFactsProps,
    type StatusListDetailsMessageProps,
    type StatusListDetailsMessageSeverity,
    type StatusListDetailsSectionProps,
} from './StatusList.types.js';

const useStyles = makeStyles({
    section: { display: 'flex', flexDirection: 'column', rowGap: tokens.spacingVerticalXXS, minWidth: 0 },
    sectionTitle: { fontWeight: tokens.fontWeightSemibold, overflowWrap: 'anywhere' },
    // The term column fits its longest term up to 40% of the width, then terms wrap: on a narrow panel a
    // long term must not squeeze the values into one character per line.
    facts: {
        display: 'grid',
        gridTemplateColumns: 'fit-content(40%) minmax(0, 1fr)',
        columnGap: tokens.spacingHorizontalL,
        rowGap: tokens.spacingVerticalXXS,
        margin: 0,
    },
    // Groups each pair for assistive technology; the parent grid lays out its term and value.
    factRow: { display: 'contents' },
    term: { margin: 0, minWidth: 0, color: tokens.colorNeutralForeground2, overflowWrap: 'break-word' },
    value: { margin: 0, minWidth: 0, overflowWrap: 'anywhere' },
    message: { display: 'flex', alignItems: 'flex-start', columnGap: tokens.spacingHorizontalS, minWidth: 0 },
    // One line tall, so the glyph centres on the title's first line however far the message wraps.
    messageIcon: {
        flexShrink: 0,
        display: 'grid',
        placeItems: 'center',
        height: tokens.lineHeightBase200,
        fontSize: '16px',
    },
    messageCopy: { display: 'flex', flexDirection: 'column', rowGap: tokens.spacingVerticalXXS, minWidth: 0 },
    messageTitle: { fontWeight: tokens.fontWeightSemibold, overflowWrap: 'anywhere' },
    messageLine: { overflowWrap: 'anywhere' },
    // The same tokens as the row glyphs of `StatusListItem`, so a warning reads the same in both places.
    error: { color: tokens.colorPaletteRedForeground1 },
    warning: { color: tokens.colorStatusWarningForeground1 },
    info: { color: tokens.colorNeutralForeground2 },
});

function hasContent(node: ReactNode): boolean {
    return node !== undefined && node !== null && node !== false && node !== '';
}

const DEFAULT_SEVERITY_LABELS: Record<StatusListDetailsMessageSeverity, string> = {
    error: 'Error:',
    warning: 'Warning:',
    info: 'Information:',
};

/**
 * A titled group inside a `StatusListItem` disclosure, for example the facts about one host. The
 * title is a visual heading, not an HTML heading. See the "Details content" section of the README.
 */
export const StatusListDetailsSection = ({
    title,
    children,
    className,
    ...rest
}: StatusListDetailsSectionProps): JSX.Element => {
    const styles = useStyles();
    const typography = useDetailsTypographyStyles();
    return (
        <div className={mergeClasses(typography.base, styles.section, className)} {...rest}>
            {hasContent(title) && <div className={styles.sectionTitle}>{title}</div>}
            {children}
        </div>
    );
};

/**
 * Term and value pairs as a semantic `<dl>`, in two aligned columns: terms in the secondary
 * foreground, values in the primary one, both at the details' base size.
 */
export const StatusListDetailsFacts = ({
    items,
    className,
    ...rest
}: StatusListDetailsFactsProps): JSX.Element | null => {
    const styles = useStyles();
    const typography = useDetailsTypographyStyles();
    const facts = items.filter((item): item is StatusListDetailsFact => !!item);
    if (facts.length === 0) {
        return null;
    }
    return (
        <dl className={mergeClasses(typography.base, styles.facts, className)} {...rest}>
            {facts.map((fact) => (
                <div key={fact.term} className={styles.factRow}>
                    <dt className={styles.term}>{fact.term}</dt>
                    <dd className={styles.value}>{fact.mono ? <code>{fact.value}</code> : fact.value}</dd>
                </div>
            ))}
        </dl>
    );
};

/**
 * A finding inside a `StatusListItem` disclosure: a severity glyph, a semibold title, an explanation
 * and an optional next step. The glyph is `aria-hidden`; a visually hidden `severityLabel` before the
 * title carries its meaning.
 */
export const StatusListDetailsMessage = ({
    severity,
    title,
    children,
    nextStep,
    severityLabel,
    className,
    ...rest
}: StatusListDetailsMessageProps): JSX.Element => {
    const styles = useStyles();
    const typography = useDetailsTypographyStyles();
    const srOnly = useSrOnlyStyles();
    const label = severityLabel ?? DEFAULT_SEVERITY_LABELS[severity];

    let icon: JSX.Element;
    if (severity === 'error') {
        icon = <ErrorCircleRegular aria-hidden className={styles.error} />;
    } else if (severity === 'warning') {
        icon = <WarningRegular aria-hidden className={styles.warning} />;
    } else {
        icon = <InfoRegular aria-hidden className={styles.info} />;
    }

    return (
        <div className={mergeClasses(typography.base, styles.message, className)} {...rest}>
            <span className={styles.messageIcon}>{icon}</span>
            <div className={styles.messageCopy}>
                <div className={styles.messageTitle}>
                    {label !== '' && <span className={srOnly.srOnly}>{`${label} `}</span>}
                    {title}
                </div>
                {hasContent(children) && <div className={styles.messageLine}>{children}</div>}
                {hasContent(nextStep) && <div className={styles.messageLine}>{nextStep}</div>}
            </div>
        </div>
    );
};
