/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * EXPERIMENT (dev/tnaum/quickstart-brainstorm) — PROTOTYPE B: "Atlas wizard".
 *
 * The MongoDB Atlas credentials layout applied literally: hero, responsive step
 * breadcrumb, one step's content at a time, and a pinned footer whose primary
 * action never moves. It reuses the chrome lifted out of that view
 * ({@link WizardShell}, {@link WizardBreadcrumb}) rather than re-implementing it,
 * so the two flows are identical by construction.
 *
 * Steps: Check Docker → Configure → Set up → Done.
 *
 * The trade-off this prototype exists to expose: the wizard is honest about a
 * multi-stage process and gives failures a natural place to live, but it charges
 * every user a "Continue" for a flow whose default answer is always "yes".
 */

import {
    Accordion,
    AccordionHeader,
    AccordionItem,
    AccordionPanel,
    Button,
    Card,
    Divider,
    Link,
    makeStyles,
    MessageBar,
    MessageBarActions,
    MessageBarBody,
    MessageBarTitle,
    Spinner,
    Text,
    tokens,
} from '@fluentui/react-components';
import { ArrowLeftRegular, RocketRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { type JSX } from 'react';
import {
    QUICK_START_IMAGE,
    QUICK_START_IMAGE_REPOSITORY,
    QUICK_START_PORT,
} from '../../../../services/localQuickStart/quickStartTypes';
import { Announcer } from '../../../components/accessibility/Announcer';
import { WizardBreadcrumb, WizardShell, type WizardStepMeta } from '../../../components/wizard/WizardShell';
import { AdvancedFields, DockerBlockedContent, NextSteps, StageChecklist, useSharedStyles } from './QuickStartShared';
import { useQuickStartMachine } from './useQuickStartMachine';

type Step = 'check' | 'configure' | 'run' | 'done';

const useStyles = makeStyles({
    hero: { display: 'flex', alignItems: 'center', gap: '16px' },
    heroIcon: { color: tokens.colorBrandForeground1, fontSize: '56px', flexShrink: 0 },
    loading: { padding: '24px' },
    connString: {
        fontFamily: tokens.fontFamilyMonospace,
        backgroundColor: tokens.colorNeutralBackground3,
        padding: '6px 10px',
        borderRadius: tokens.borderRadiusMedium,
        alignSelf: 'flex-start',
    },
    srOnly: {
        position: 'absolute',
        width: '1px',
        height: '1px',
        padding: 0,
        margin: '-1px',
        overflow: 'hidden',
        clip: 'rect(0, 0, 0, 0)',
        whiteSpace: 'nowrap',
    },
});

export const QuickStartWizard = (): JSX.Element => {
    const styles = useStyles();
    const shared = useSharedStyles();
    const machine = useQuickStartMachine();
    const { phase, advanced } = machine;

    if (phase === 'loading') {
        return (
            <div className={styles.loading}>
                <Spinner label={l10n.t('Checking Docker…')} />
            </div>
        );
    }

    const step: Step =
        phase === 'dockerNotReady' ? 'check' : phase === 'review' ? 'configure' : phase === 'success' ? 'done' : 'run';

    const stepDefs: { readonly id: Step; readonly label: string }[] = [
        { id: 'check', label: l10n.t('Check Docker') },
        { id: 'configure', label: l10n.t('Configure') },
        { id: 'run', label: l10n.t('Set up') },
        { id: 'done', label: l10n.t('Done') },
    ];
    const currentIndex = stepDefs.findIndex((s) => s.id === step);
    // Steps lock while provisioning is in flight and after it has succeeded; a failure unlocks
    // them again so the user can go back and change an option (mirrors the Atlas rule).
    const locked = phase === 'provisioning' || phase === 'success';
    const steps: WizardStepMeta[] = stepDefs.map((s, index) => ({
        id: s.id,
        label: s.label,
        isCurrent: index === currentIndex,
        // "Check Docker" is pre-satisfied whenever we got past it, exactly like Atlas's first step.
        isCompleted: index < currentIndex || (s.id === 'done' && index === currentIndex),
        canNavigate: index < currentIndex && !locked && (s.id === 'check' || s.id === 'configure'),
    }));

    const goToStep = (id: string): void => {
        if (id === 'check') {
            machine.reloadDockerStatus();
        } else if (id === 'configure') {
            machine.backToReview();
        }
    };

    const hero = (
        <div className={styles.hero}>
            <RocketRegular aria-hidden className={styles.heroIcon} />
            <div>
                <Text as="h1" size={700} weight="semibold">
                    {l10n.t('DocumentDB Local')}
                </Text>
                <div>
                    <Text className={shared.muted}>
                        {l10n.t('Run a real DocumentDB on this machine in a Docker container, managed by VS Code.')}
                    </Text>
                </div>
            </div>
        </div>
    );

    const checkContent = (
        <section className={shared.section} aria-labelledby="qs-check-heading">
            <div className={shared.sectionHeader}>
                <Text id="qs-check-heading" as="h2" size={500} weight="semibold">
                    {l10n.t('Check Docker')}
                </Text>
                <Text className={shared.muted}>
                    {l10n.t(
                        'Docker is required to run DocumentDB locally. The extension does not install Docker for you.',
                    )}
                </Text>
            </div>
            <DockerBlockedContent
                docker={machine.docker}
                startingDocker={machine.startingDocker}
                onStartDocker={machine.startDockerDesktop}
                onRetry={machine.reloadDockerStatus}
            />
        </section>
    );

    const effectiveImage =
        !machine.isRecreate && advanced.tag.trim()
            ? `${QUICK_START_IMAGE_REPOSITORY}:${advanced.tag.trim()}`
            : QUICK_START_IMAGE;
    const customCreds = !machine.isRecreate && advanced.username.trim().length > 0;
    const configureContent = (
        <section className={shared.section} aria-labelledby="qs-configure-heading">
            <div className={shared.sectionHeader}>
                <Text id="qs-configure-heading" as="h2" size={500} weight="semibold">
                    {l10n.t('Review what will be created')}
                </Text>
                <Text className={shared.muted}>
                    {l10n.t('These defaults work for most people. Change them only if you need to.')}
                </Text>
            </div>
            <Card className={shared.summaryCard}>
                <Text weight="semibold">{l10n.t("What we'll do")}</Text>
                <Divider />
                <div className={shared.summaryRow}>
                    <Text className={shared.muted}>{l10n.t('Image')}</Text>
                    <Text>{machine.isRecreate ? l10n.t('Kept from the existing instance') : effectiveImage}</Text>
                </div>
                <div className={shared.summaryRow}>
                    <Text className={shared.muted}>{l10n.t('Port')}</Text>
                    <Text>
                        {advanced.port.trim() && !advanced.validation
                            ? advanced.port.trim()
                            : l10n.t('{0} (auto)', String(QUICK_START_PORT))}
                    </Text>
                </div>
                <div className={shared.summaryRow}>
                    <Text className={shared.muted}>{l10n.t('Runs on')}</Text>
                    <Text>{l10n.t('This machine (Docker)')}</Text>
                </div>
                <div className={shared.summaryRow}>
                    <Text className={shared.muted}>{l10n.t('Credentials')}</Text>
                    <Text>
                        {machine.isRecreate
                            ? l10n.t('Reused from the existing instance')
                            : customCreds
                              ? l10n.t('Custom, stored securely')
                              : l10n.t('Auto-generated, stored securely')}
                    </Text>
                </div>
                <div className={shared.summaryRow}>
                    <Text className={shared.muted}>{l10n.t('Lifetime')}</Text>
                    <Text>{l10n.t('Keeps running after VS Code closes')}</Text>
                </div>
            </Card>
            <Accordion collapsible>
                <AccordionItem value="advanced">
                    <AccordionHeader>{l10n.t('Advanced (optional)')}</AccordionHeader>
                    <AccordionPanel>
                        <AdvancedFields advanced={advanced} isRecreate={machine.isRecreate} />
                    </AccordionPanel>
                </AccordionItem>
            </Accordion>
        </section>
    );

    const runContent = (
        <section className={shared.section} aria-labelledby="qs-run-heading">
            <div className={shared.sectionHeader}>
                <Text id="qs-run-heading" as="h2" size={500} weight="semibold">
                    {phase === 'failed' ? l10n.t('Setup did not finish') : l10n.t('Setting up DocumentDB Local')}
                </Text>
                <Text className={shared.muted}>
                    {phase === 'failed'
                        ? l10n.t('Review the step that failed, then retry or change a setting.')
                        : l10n.t(
                              'Pulling the image, starting the container, and waiting for it to accept connections. {0}',
                              machine.elapsedLabel,
                          )}
                </Text>
            </div>
            <StageChecklist stageStatus={machine.stageStatus} />
            {phase === 'failed' && (
                <MessageBar intent={machine.timedOut ? 'warning' : 'error'} layout="multiline">
                    <MessageBarBody>
                        <MessageBarTitle>
                            {machine.timedOut ? l10n.t('No connections yet') : l10n.t('Setup failed')}
                        </MessageBarTitle>{' '}
                        {machine.timedOut
                            ? l10n.t(
                                  'The container is running, but DocumentDB has not accepted connections yet. It may still be initializing.',
                              )
                            : (machine.errorMessage ?? l10n.t('Setup failed.'))}
                    </MessageBarBody>
                    <MessageBarActions>
                        <Button appearance="secondary" onClick={machine.viewOutput}>
                            {l10n.t('View Docker output')}
                        </Button>
                    </MessageBarActions>
                </MessageBar>
            )}
            {phase === 'provisioning' && <Link onClick={machine.viewOutput}>{l10n.t('View Docker output')}</Link>}
        </section>
    );

    const displayPort = machine.boundPort ?? Number(machine.effectivePort);
    const doneContent = (
        <section className={shared.section} aria-labelledby="qs-done-heading">
            <div className={shared.sectionHeader}>
                <Text id="qs-done-heading" as="h2" size={500} weight="semibold">
                    {l10n.t('DocumentDB Local is running')}
                </Text>
                <Text className={shared.muted}>{machine.successMessage ?? l10n.t('Everything checked out.')}</Text>
            </div>
            <StageChecklist stageStatus={machine.stageStatus} />
            <Text className={styles.connString} size={200}>
                {l10n.t('localhost:{0}', String(displayPort))}
            </Text>
            <MessageBar intent="success">
                <MessageBarBody>
                    <MessageBarTitle>{l10n.t('All set')}</MessageBarTitle>{' '}
                    {l10n.t('The connection was saved and is ready to use.')}
                </MessageBarBody>
            </MessageBar>
            <NextSteps port={displayPort} />
        </section>
    );

    // Footer: primary first, then the secondary slot — the two never swap position, so the
    // pointer target stays put across steps (the Atlas rule).
    let primaryLabel: string;
    let primaryDisabled = false;
    let onPrimary: () => void;
    let secondaryLabel = l10n.t('Back');
    let secondaryDisabled = false;
    let secondaryIcon: JSX.Element | undefined = <ArrowLeftRegular />;
    let onSecondary: () => void = () => machine.reloadDockerStatus();
    let extra: JSX.Element | undefined;

    if (step === 'check') {
        primaryLabel = l10n.t('Check again');
        onPrimary = machine.reloadDockerStatus;
        secondaryDisabled = true;
    } else if (step === 'configure') {
        primaryLabel = l10n.t('Start DocumentDB Local');
        primaryDisabled = !!advanced.validation;
        onPrimary = machine.start;
        secondaryLabel = l10n.t('Cancel');
        secondaryIcon = undefined;
        onSecondary = machine.close;
    } else if (step === 'run' && phase === 'provisioning') {
        primaryLabel = l10n.t('Setting up…');
        primaryDisabled = true;
        onPrimary = () => undefined;
        secondaryLabel = l10n.t('Cancel');
        secondaryIcon = undefined;
        onSecondary = machine.cancel;
    } else if (step === 'run') {
        primaryLabel = machine.timedOut ? l10n.t('Wait longer') : l10n.t('Retry');
        onPrimary = machine.timedOut ? machine.waitLonger : machine.start;
        secondaryLabel = machine.timedOut ? l10n.t('Start over') : l10n.t('Edit settings');
        secondaryIcon = machine.timedOut ? undefined : <ArrowLeftRegular />;
        onSecondary = machine.timedOut ? machine.startOver : machine.backToReview;
    } else {
        primaryLabel = l10n.t('Open Connection');
        onPrimary = machine.openConnection;
        secondaryLabel = l10n.t('Copy Connection String');
        secondaryIcon = undefined;
        onSecondary = machine.copyConnectionString;
        extra = (
            <Button appearance="subtle" onClick={machine.close}>
                {l10n.t('Close')}
            </Button>
        );
    }

    const footer = (
        <>
            <Button appearance="primary" disabled={primaryDisabled} onClick={onPrimary}>
                {primaryLabel}
            </Button>
            <Button appearance="secondary" icon={secondaryIcon} disabled={secondaryDisabled} onClick={onSecondary}>
                {secondaryLabel}
            </Button>
            {extra}
        </>
    );

    return (
        <WizardShell footer={footer} contentKey={`${step}:${phase}`}>
            <Announcer when={phase === 'success'} message={l10n.t('DocumentDB Local is ready.')} />
            <Announcer
                when={phase === 'failed'}
                message={l10n.t('Setup failed. {0}', machine.errorMessage ?? l10n.t('See the details below.'))}
            />
            <Announcer
                when={phase === 'dockerNotReady'}
                message={l10n.t('Docker is required and is not ready. Review the checks below.')}
                politeness="assertive"
            />
            <div role="status" aria-live="polite" aria-atomic="true" className={styles.srOnly}>
                {phase === 'provisioning' ? machine.provisioningStatusMessage : ''}
            </div>
            {hero}
            <WizardBreadcrumb steps={steps} label={l10n.t('Setup progress')} onNavigate={goToStep} />
            {step === 'check' && checkContent}
            {step === 'configure' && configureContent}
            {step === 'run' && runContent}
            {step === 'done' && doneContent}
        </WizardShell>
    );
};
