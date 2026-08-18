/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

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
import { Fragment, type JSX } from 'react';

const MoreHorizontal = bundleIcon(MoreHorizontalFilled, MoreHorizontalRegular);

/** A wizard step's derived breadcrumb state, shared by the inline items and the overflow menu. */
export interface WizardStepMeta {
    readonly id: string;
    readonly label: string;
    readonly isCurrent: boolean;
    readonly isCompleted: boolean;
    readonly canNavigate: boolean;
}

const useStyles = makeStyles({
    breadcrumb: { minWidth: 0, overflow: 'hidden' },
    done: { color: tokens.colorPaletteGreenForeground1, fontSize: '16px' },
    // Inherit the breadcrumb button's own text colour, so the hint dot matches whatever state the
    // step is in (the active/current item gets its colour for free).
    pending: { color: 'inherit', fontSize: '16px' },
    // Keep completed steps bold. Fluent only bolds the `current` item, so a step dropped back to
    // regular weight when it stopped being current, and the width change shifted the whole row.
    buttonDone: { fontWeight: tokens.fontWeightSemibold },
});

/** Renders a hidden (overflowed) step as a menu item; visible steps render nothing here. */
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

/** The "…" breadcrumb entry that collects steps hidden by overflow. Renders nothing until overflow. */
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

export interface WizardBreadcrumbProps {
    /** Steps in wizard order, with their completed / current / reachable state already derived. */
    readonly steps: readonly WizardStepMeta[];
    /** Accessible name of the breadcrumb navigation landmark. */
    readonly ariaLabel: string;
    /** Invoked when a reachable step is activated, inline or from the overflow menu. */
    readonly onNavigate: (id: string) => void;
}

/**
 * Responsive wizard step indicator. When the breadcrumb doesn't fit, steps collapse into a "…"
 * menu; the current step is given the highest priority so it is the last item overflow ever
 * removes — it never hides.
 */
export const WizardBreadcrumb = ({ steps, ariaLabel, onNavigate }: WizardBreadcrumbProps): JSX.Element => {
    const styles = useStyles();
    return (
        <Overflow minimumVisible={1}>
            <Breadcrumb aria-label={ariaLabel} className={styles.breadcrumb}>
                {steps.map((step, index) => (
                    <Fragment key={step.id}>
                        <OverflowItem id={step.id} groupId={step.id} priority={step.isCurrent ? steps.length + 1 : 0}>
                            <BreadcrumbItem>
                                <BreadcrumbButton
                                    current={step.isCurrent}
                                    aria-current={step.isCurrent ? 'step' : undefined}
                                    disabledFocusable={!step.isCurrent && !step.canNavigate}
                                    className={step.isCompleted ? styles.buttonDone : undefined}
                                    icon={
                                        step.isCompleted ? (
                                            <CheckmarkCircleFilled aria-hidden className={styles.done} />
                                        ) : (
                                            <CircleHintFilled aria-hidden className={styles.pending} />
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
