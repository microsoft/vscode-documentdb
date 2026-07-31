/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * EXPERIMENT (dev/tnaum/quickstart-brainstorm).
 *
 * The wizard chrome first built inline in `AtlasCredentialsView`, lifted into a
 * reusable pair so a second flow can adopt the same shape without copying it:
 *
 * - {@link WizardBreadcrumb} — the responsive step breadcrumb (completed steps
 *   carry a check, the current step is never hidden, hidden steps collapse into
 *   a "…" menu).
 * - {@link WizardShell} — scrollable content + a pinned footer that only gains
 *   its separator/shadow while content is actually scrolled.
 *
 * If a prototype is adopted, `AtlasCredentialsView` should switch to these too
 * so both flows stay identical by construction rather than by review.
 */

import {
    Breadcrumb,
    BreadcrumbButton,
    BreadcrumbDivider,
    BreadcrumbItem,
    Button,
    makeStyles,
    Menu,
    MenuItem,
    MenuList,
    MenuPopover,
    MenuTrigger,
    mergeClasses,
    Overflow,
    OverflowDivider,
    OverflowItem,
    tokens,
    useIsOverflowItemVisible,
    useOverflowMenu,
} from '@fluentui/react-components';
import {
    bundleIcon,
    CheckmarkCircleFilled,
    CircleHintFilled,
    MoreHorizontalFilled,
    MoreHorizontalRegular,
} from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { Fragment, type JSX, type ReactNode, useCallback, useEffect, useRef, useState } from 'react';

const MoreHorizontal = bundleIcon(MoreHorizontalFilled, MoreHorizontalRegular);

const useStyles = makeStyles({
    root: { display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' },
    scrollArea: { flex: 1, minHeight: 0, overflowY: 'auto' },
    content: { display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '760px', padding: '24px' },
    footer: {
        display: 'flex',
        gap: '8px',
        justifyContent: 'flex-start',
        alignItems: 'center',
        flexWrap: 'wrap',
        flexShrink: 0,
        padding: '16px 24px',
        backgroundColor: tokens.colorNeutralBackground1,
        borderTop: '1px solid transparent',
        transitionProperty: 'box-shadow, border-top-color',
        transitionDuration: tokens.durationNormal,
        transitionTimingFunction: tokens.curveEasyEase,
    },
    footerElevated: {
        borderTopColor: tokens.colorNeutralStroke2,
        boxShadow: '0 -2px 6px rgba(0, 0, 0, 0.08)',
    },
    breadcrumbDone: { color: tokens.colorPaletteGreenForeground1, fontSize: '16px' },
    // Inherit the button's own colour so the hint dot matches whatever state the step is in.
    breadcrumbPending: { color: 'inherit', fontSize: '16px' },
    // Keep completed steps bold: Fluent only bolds `current`, so a step dropping back to regular
    // weight would change its width and shift the whole row.
    breadcrumbButtonDone: { fontWeight: tokens.fontWeightSemibold },
});

/** A step's derived breadcrumb state, shared by the inline items and the overflow menu. */
export interface WizardStepMeta {
    readonly id: string;
    readonly label: string;
    readonly isCurrent: boolean;
    readonly isCompleted: boolean;
    readonly canNavigate: boolean;
}

const StepOverflowMenuItem = ({
    step,
    onNavigate,
}: {
    readonly step: WizardStepMeta;
    readonly onNavigate: (id: string) => void;
}): JSX.Element | null => {
    const isVisible = useIsOverflowItemVisible(step.id);
    if (isVisible) {
        return null;
    }
    return (
        <MenuItem disabled={!step.canNavigate} onClick={step.canNavigate ? () => onNavigate(step.id) : undefined}>
            {step.label}
        </MenuItem>
    );
};

const StepOverflowMenu = ({
    steps,
    onNavigate,
}: {
    readonly steps: readonly WizardStepMeta[];
    readonly onNavigate: (id: string) => void;
}): JSX.Element | null => {
    const { ref, isOverflowing, overflowCount } = useOverflowMenu<HTMLButtonElement>();
    if (!isOverflowing) {
        return null;
    }
    return (
        <BreadcrumbItem>
            <Menu>
                <MenuTrigger disableButtonEnhancement>
                    <Button
                        appearance="subtle"
                        ref={ref}
                        icon={<MoreHorizontal />}
                        aria-label={l10n.t('{0} more steps', String(overflowCount))}
                    />
                </MenuTrigger>
                <MenuPopover>
                    <MenuList>
                        {steps.map((step) => (
                            <StepOverflowMenuItem key={step.id} step={step} onNavigate={onNavigate} />
                        ))}
                    </MenuList>
                </MenuPopover>
            </Menu>
        </BreadcrumbItem>
    );
};

export const WizardBreadcrumb = ({
    steps,
    label,
    onNavigate,
}: {
    readonly steps: readonly WizardStepMeta[];
    readonly label: string;
    readonly onNavigate: (id: string) => void;
}): JSX.Element => {
    const styles = useStyles();
    return (
        <Overflow minimumVisible={1}>
            <Breadcrumb aria-label={label}>
                {steps.map((step, index) => (
                    <Fragment key={step.id}>
                        {/* The current step gets the highest priority, so overflow never hides it. */}
                        <OverflowItem id={step.id} groupId={step.id} priority={step.isCurrent ? steps.length + 1 : 0}>
                            <BreadcrumbItem>
                                <BreadcrumbButton
                                    current={step.isCurrent}
                                    aria-current={step.isCurrent ? 'step' : undefined}
                                    disabledFocusable={!step.isCurrent && !step.canNavigate}
                                    className={step.isCompleted ? styles.breadcrumbButtonDone : undefined}
                                    icon={
                                        step.isCompleted ? (
                                            <CheckmarkCircleFilled aria-hidden className={styles.breadcrumbDone} />
                                        ) : (
                                            <CircleHintFilled aria-hidden className={styles.breadcrumbPending} />
                                        )
                                    }
                                    onClick={step.canNavigate ? () => onNavigate(step.id) : undefined}
                                >
                                    {step.label}
                                </BreadcrumbButton>
                            </BreadcrumbItem>
                        </OverflowItem>
                        {index < steps.length - 1 && (
                            <OverflowDivider groupId={step.id}>
                                <BreadcrumbDivider />
                            </OverflowDivider>
                        )}
                    </Fragment>
                ))}
                <StepOverflowMenu steps={steps} onNavigate={onNavigate} />
            </Breadcrumb>
        </Overflow>
    );
};

/**
 * Scrollable content with a pinned footer. `contentKey` changes whenever the
 * visible step changes: it re-runs the elevation measurement and moves focus to
 * the new step's `<h2>` so keyboard/screen-reader users land on fresh content
 * instead of falling back to `<body>` (WCAG 2.4.3).
 */
export const WizardShell = ({
    children,
    footer,
    contentKey,
}: {
    readonly children: ReactNode;
    readonly footer: ReactNode;
    readonly contentKey: string;
}): JSX.Element => {
    const styles = useStyles();
    const scrollAreaRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const [footerElevated, setFooterElevated] = useState(false);
    const isInitialRender = useRef(true);

    const updateElevation = useCallback((): void => {
        const scrollArea = scrollAreaRef.current;
        if (scrollArea) {
            setFooterElevated(scrollArea.scrollTop + scrollArea.clientHeight < scrollArea.scrollHeight - 1);
        }
    }, []);

    useEffect(() => {
        const scrollArea = scrollAreaRef.current;
        const content = contentRef.current;
        if (!scrollArea || !content) {
            return;
        }
        const observer = new ResizeObserver(updateElevation);
        observer.observe(scrollArea);
        observer.observe(content);
        return () => observer.disconnect();
    }, [updateElevation, contentKey]);

    useEffect(() => {
        if (isInitialRender.current) {
            isInitialRender.current = false;
            return;
        }
        const heading = contentRef.current?.querySelector<HTMLElement>('h2');
        if (heading) {
            heading.tabIndex = -1;
            heading.focus();
        }
    }, [contentKey]);

    return (
        <main className={styles.root}>
            <div className={styles.scrollArea} ref={scrollAreaRef} onScroll={updateElevation}>
                <div ref={contentRef} className={styles.content}>
                    {children}
                </div>
            </div>
            <div className={mergeClasses(styles.footer, footerElevated && styles.footerElevated)}>{footer}</div>
        </main>
    );
};
