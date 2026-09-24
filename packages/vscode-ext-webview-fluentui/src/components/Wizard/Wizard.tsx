/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles, mergeClasses, tokens } from '@fluentui/react-components';
import { type JSX } from 'react';
import { Container } from '../Container/Container.js';
import { ContainerBody } from '../Container/ContainerBody.js';
import { ContainerMain } from '../Container/ContainerMain.js';
import { ContainerNav } from '../Container/ContainerNav.js';
import { ContainerSection } from '../Container/ContainerSection.js';
import { StepList } from '../StepList/StepList.js';
import { StepListItem } from '../StepList/StepListItem.js';
import { collectMarkerChildren } from '../utils/markerChildren.js';
import { type WizardProps, type WizardStepProps } from './Wizard.types.js';
import { wizardStepBrand } from './WizardStep.js';
import { defaultCompleted, defaultNavigable } from './wizardStepState.js';

const useStyles = makeStyles({
    stickyScrollState: {
        containerName: 'wizard-scroll-state',
        containerType: 'scroll-state',
        overflowX: 'hidden',
    },
    scrollTimelineSource: {
        scrollTimelineAxis: 'block',
        scrollTimelineName: '--wizard-scroll',
    },
    // The header scrolls away in this mode, so it fades rather than sliding under the breadcrumbs.
    fadingHeader: {
        gridArea: 'header',
        '@supports (animation-timeline: scroll())': {
            animationName: {
                '0%': { opacity: 1 },
                '30%': { opacity: 0.25 },
                '65%, 100%': { opacity: 0 },
            },
            animationDuration: '1ms',
            animationFillMode: 'both',
            animationRange: '0px 150px',
            animationTimeline: '--wizard-scroll',
            animationTimingFunction: 'linear',
            '&:focus-within': { animationName: 'none' },
        },
        '@media (prefers-reduced-motion: reduce)': { animationName: 'none' },
    },
    stickyNavigation: {
        position: 'sticky',
        top: 0,
        zIndex: 1,
        alignSelf: 'start',
    },
    stickyNavigationSurface: {
        isolation: 'isolate',
        position: 'relative',
        paddingBlock: '8px',
        '::before': {
            content: '""',
            position: 'absolute',
            zIndex: -1,
            insetBlock: 0,
            insetInlineStart: '-24px',
            width: '100vw',
            pointerEvents: 'none',
            // Keeps the shadow below the surface instead of leaking above the sticky edge.
            clipPath: 'inset(0 0 -12px 0)',
            backgroundColor: tokens.colorNeutralBackground1,
            borderBottom: '1px solid transparent',
            transitionProperty: 'box-shadow, border-bottom-color',
            transitionDuration: tokens.durationNormal,
            transitionTimingFunction: tokens.curveEasyEase,
        },
        '@container wizard-scroll-state scroll-state(scrollable: top)': {
            '::before': {
                borderBottomColor: tokens.colorNeutralStroke2,
                boxShadow: '0 2px 6px rgba(0, 0, 0, 0.08)',
            },
        },
    },
    stickyNavigationSurfaceStart: {
        '::before': { width: 'calc(100% + 24px)' },
    },
    stickyFocusOffset: {
        '& main h2': { scrollMarginBlockStart: '140px' },
    },
});

/**
 * A whole wizard surface: header, step indicator, the active step's content, and a pinned footer.
 *
 * Built entirely on the public `Container` and `StepList` API, so a consumer who outgrows it can
 * take those same pieces and assemble the surface by hand. There is a step down, not a cliff.
 *
 * ```tsx
 * <Wizard
 *     activeStep={currentStep}
 *     onStepChange={goToStep}
 *     stepsAriaLabel="Setup steps"
 *     header={<ContainerHeader media={<RocketRegular />} title="DocumentDB Local" />}
 *     footer={<ContainerFooter note={note}><Button appearance="primary">Start</Button></ContainerFooter>}
 * >
 *     <WizardStep value="introduction" label="Introduction" subtitle="…">…</WizardStep>
 *     <WizardStep value="configure" label="Configure">…</WizardStep>
 * </Wizard>
 * ```
 *
 * Controlled, and it owns no navigation logic. `activeStep` is a string the consumer computes, and
 * how they arrive at it is never visible here: two situations may share one step and branch inside
 * its children, and a step that does not apply is simply not rendered.
 *
 * Only the active step is mounted, so a heavy step body does not stay resident, and
 * focus-on-mount falls out of mounting rather than needing a rule of its own.
 *
 * **Children must be `WizardStep`, `false` or `null`.** A fragment of steps is ignored, because a
 * fragment has no props to read.
 */
export const Wizard = ({
    activeStep,
    onStepChange,
    navPosition = 'top',
    headerBehavior = 'scroll',
    stepsLocked = false,
    stepsAriaLabel,
    overflowAriaLabel,
    header,
    footer,
    children,
}: WizardProps): JSX.Element => {
    const styles = useStyles();
    const steps = collectMarkerChildren<WizardStepProps>(children, wizardStepBrand);
    const activeIndex = steps.findIndex((step) => step.props.value === activeStep);
    const active = activeIndex === -1 ? undefined : steps[activeIndex];
    const stickyNavigation = headerBehavior === 'sticky-navigation';

    const stepList = (
        <StepList
            vertical={navPosition === 'start'}
            selectedValue={activeStep}
            onStepSelect={(_event, data) => onStepChange(data.value)}
            ariaLabel={stepsAriaLabel}
            overflowAriaLabel={overflowAriaLabel}
        >
            {steps.map((step, index) => (
                <StepListItem
                    key={step.props.value}
                    value={step.props.value}
                    completed={step.props.completed ?? defaultCompleted(index, activeIndex, steps.length)}
                    navigable={step.props.navigable ?? defaultNavigable(index, activeIndex, stepsLocked)}
                >
                    {step.props.label}
                </StepListItem>
            ))}
        </StepList>
    );

    const navigation = (
        <ContainerNav className={stickyNavigation ? styles.stickyNavigation : undefined}>
            {stickyNavigation ? (
                <div
                    className={mergeClasses(
                        styles.stickyNavigationSurface,
                        navPosition === 'start' && styles.stickyNavigationSurfaceStart,
                    )}
                >
                    {stepList}
                </div>
            ) : (
                stepList
            )}
        </ContainerNav>
    );

    const main = (
        <ContainerMain>
            {active && (
                <ContainerSection
                    key={active.props.value}
                    title={active.props.title ?? active.props.label}
                    subtitle={active.props.subtitle}
                    action={active.props.action}
                    focusOnMount
                >
                    {active.props.children}
                </ContainerSection>
            )}
        </ContainerMain>
    );

    return (
        <Container>
            <ContainerBody
                navPosition={navPosition}
                className={mergeClasses(
                    stickyNavigation && styles.stickyFocusOffset,
                    stickyNavigation && styles.stickyScrollState,
                    stickyNavigation && styles.scrollTimelineSource,
                )}
                data-header-behavior={headerBehavior}
            >
                {stickyNavigation ? <div className={styles.fadingHeader}>{header}</div> : header}
                {navigation}
                {main}
            </ContainerBody>
            {footer}
        </Container>
    );
};
