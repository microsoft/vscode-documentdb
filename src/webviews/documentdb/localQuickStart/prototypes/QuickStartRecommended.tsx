/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * EXPERIMENT (dev/tnaum/quickstart-brainstorm-2nd) — RECOMMENDED ITERATION.
 *
 * Local Quick Start has one user decision, so this view deliberately does not
 * copy Atlas's top-level breadcrumb. It does reuse the parts that fit:
 *
 * - a pinned, stable footer for global actions;
 * - focus movement to each phase heading;
 * - the inner verification-stage list for real host work;
 * - retry and diagnostic actions beside the error that explains them; and
 * - the completed stage list repeated on success.
 */

import {
    Accordion,
    AccordionHeader,
    AccordionItem,
    AccordionPanel,
    Badge,
    Button,
    Card,
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
import {
    ArrowClockwiseRegular,
    CheckmarkCircleFilled,
    ErrorCircleFilled,
    RocketRegular,
    WarningRegular,
} from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { type JSX } from 'react';
import { Announcer } from '../../../components/accessibility/Announcer';
import { WizardShell } from '../../../components/wizard/WizardShell';
import { AdvancedFields, DockerBlockedContent, NextSteps, StageChecklist, useSharedStyles } from './QuickStartShared';
import { useQuickStartMachine } from './useQuickStartMachine';

const useStyles = makeStyles({
    hero: { display: 'flex', alignItems: 'center', gap: '16px' },
    heroIcon: { color: tokens.colorBrandForeground1, fontSize: '48px', flexShrink: 0 },
    loading: { padding: '24px' },
    facts: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px' },
    factSeparator: { color: tokens.colorNeutralForeground4 },
    section: { display: 'flex', flexDirection: 'column', gap: '12px' },
    sectionHeader: { display: 'flex', flexDirection: 'column', gap: '4px' },
    summary: { padding: '16px', display: 'flex', flexDirection: 'column', gap: '8px' },
    statusHeader: { display: 'flex', alignItems: 'center', gap: '10px' },
    successIcon: { color: tokens.colorPaletteGreenForeground1, fontSize: '20px' },
    errorIcon: { color: tokens.colorPaletteRedForeground1, fontSize: '20px' },
    warningIcon: { color: tokens.colorStatusWarningForeground1, fontSize: '20px' },
    connectionAddress: {
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

export const QuickStartRecommended = (): JSX.Element => {
    const styles = useStyles();
    const shared = useSharedStyles();
    const machine = useQuickStartMachine();
    const { advanced, phase } = machine;

    if (phase === 'loading') {
        return (
            <div className={styles.loading}>
                <Spinner label={l10n.t('Checking Docker…')} />
            </div>
        );
    }

    const displayPort = machine.boundPort ?? Number(machine.effectivePort);
    const facts = (
        <div className={styles.facts} aria-label={l10n.t('Local instance summary')}>
            <Badge appearance="filled" color={machine.dockerReady ? 'success' : 'danger'} size="small">
                {machine.dockerReady ? '✓' : '!'}
            </Badge>
            <Text size={200}>{machine.dockerReady ? l10n.t('Docker ready') : l10n.t('Docker not ready')}</Text>
            <Text aria-hidden size={200} className={styles.factSeparator}>
                ·
            </Text>
            <Text size={200}>{l10n.t('localhost:{0}', String(displayPort))}</Text>
            <Text aria-hidden size={200} className={styles.factSeparator}>
                ·
            </Text>
            <Text size={200}>{l10n.t('Data persists')}</Text>
            <Text aria-hidden size={200} className={styles.factSeparator}>
                ·
            </Text>
            <Text size={200}>{l10n.t('TLS · self-signed')}</Text>
            {advanced.isCustomized && (
                <Badge appearance="tint" color="brand" size="small">
                    {l10n.t('Customized')}
                </Badge>
            )}
        </div>
    );

    const reviewContent = (
        <section className={styles.section} aria-labelledby="qsr-review-heading">
            <div className={styles.sectionHeader}>
                <Text id="qsr-review-heading" as="h2" size={500} weight="semibold">
                    {machine.isRecreate ? l10n.t('Recreate your local instance') : l10n.t('Ready when you are')}
                </Text>
                <Text className={shared.muted}>
                    {machine.isRecreate
                        ? l10n.t('Your existing data, credentials, and image will be kept.')
                        : l10n.t('The defaults are ready for most local development.')}
                </Text>
            </div>
            <Card className={styles.summary}>
                <Text weight="semibold">{l10n.t('One-click setup')}</Text>
                <Text size={200} className={shared.muted}>
                    {l10n.t('The extension starts the official image and saves a connection for you.')}
                </Text>
            </Card>
            <Accordion collapsible>
                <AccordionItem value="customize">
                    <AccordionHeader>
                        {advanced.isCustomized ? l10n.t('Customize (changed)') : l10n.t('Customize (optional)')}
                    </AccordionHeader>
                    <AccordionPanel>
                        <AdvancedFields advanced={advanced} isRecreate={machine.isRecreate} />
                    </AccordionPanel>
                </AccordionItem>
            </Accordion>
        </section>
    );

    const provisioningContent = (
        <section className={styles.section} aria-labelledby="qsr-provisioning-heading">
            <div className={styles.sectionHeader}>
                <Text id="qsr-provisioning-heading" as="h2" size={500} weight="semibold">
                    {l10n.t('Setting up DocumentDB Local')}
                </Text>
                <Text className={shared.muted}>
                    {l10n.t('This usually takes about a minute. Elapsed time: {0}', machine.elapsedLabel)}
                </Text>
            </div>
            <StageChecklist stageStatus={machine.stageStatus} />
            <Link onClick={machine.viewOutput}>{l10n.t('View Docker output')}</Link>
        </section>
    );

    const successContent = (
        <section className={styles.section} aria-labelledby="qsr-success-heading">
            <div className={styles.statusHeader}>
                <CheckmarkCircleFilled aria-hidden className={styles.successIcon} />
                <Text id="qsr-success-heading" as="h2" size={500} weight="semibold">
                    {l10n.t('DocumentDB Local is running')}
                </Text>
            </div>
            <StageChecklist stageStatus={machine.stageStatus} />
            <MessageBar intent="success">
                <MessageBarBody>
                    <MessageBarTitle>{l10n.t('All set')}</MessageBarTitle>{' '}
                    {machine.successMessage ?? l10n.t('The connection was saved and is ready to use.')}
                </MessageBarBody>
            </MessageBar>
            <Text className={styles.connectionAddress} size={200}>
                {l10n.t('localhost:{0}', String(displayPort))}
            </Text>
            <NextSteps port={displayPort} />
        </section>
    );

    const failedContent = (
        <section className={styles.section} aria-labelledby="qsr-failed-heading">
            <div className={styles.statusHeader}>
                {machine.timedOut ? (
                    <WarningRegular aria-hidden className={styles.warningIcon} />
                ) : (
                    <ErrorCircleFilled aria-hidden className={styles.errorIcon} />
                )}
                <Text id="qsr-failed-heading" as="h2" size={500} weight="semibold">
                    {machine.timedOut ? l10n.t('Still starting up') : l10n.t('Setup did not finish')}
                </Text>
            </div>
            <StageChecklist stageStatus={machine.stageStatus} />
            <MessageBar intent={machine.timedOut ? 'warning' : 'error'} layout="multiline">
                <MessageBarBody>
                    <MessageBarTitle>
                        {machine.timedOut ? l10n.t('No connections yet') : l10n.t('Setup failed')}
                    </MessageBarTitle>{' '}
                    {machine.timedOut
                        ? l10n.t(
                              'The container is running, but DocumentDB has not accepted connections yet. It may still be initializing.',
                          )
                        : (machine.errorMessage ?? l10n.t('Review the failed stage and try again.'))}
                </MessageBarBody>
                <MessageBarActions>
                    <Button
                        appearance="secondary"
                        icon={<ArrowClockwiseRegular />}
                        onClick={machine.timedOut ? machine.waitLonger : machine.start}
                    >
                        {machine.timedOut ? l10n.t('Wait longer') : l10n.t('Retry')}
                    </Button>
                    <Button appearance="secondary" onClick={machine.viewOutput}>
                        {l10n.t('View Docker output')}
                    </Button>
                </MessageBarActions>
            </MessageBar>
        </section>
    );

    const dockerBlockedContent = (
        <section className={styles.section} aria-labelledby="qsr-docker-heading">
            <div className={styles.sectionHeader}>
                <Text id="qsr-docker-heading" as="h2" size={500} weight="semibold">
                    {l10n.t('Docker is required')}
                </Text>
                <Text className={shared.muted}>
                    {l10n.t('Review the checks below, then try again when Docker is ready.')}
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

    let content: JSX.Element;
    if (phase === 'dockerNotReady') {
        content = dockerBlockedContent;
    } else if (phase === 'provisioning') {
        content = provisioningContent;
    } else if (phase === 'success') {
        content = successContent;
    } else if (phase === 'failed') {
        content = failedContent;
    } else {
        content = reviewContent;
    }

    let footer: JSX.Element;
    if (phase === 'dockerNotReady') {
        footer = (
            <>
                <Button appearance="primary" disabled>
                    {l10n.t('Start DocumentDB Local')}
                </Button>
                <Button appearance="secondary" onClick={machine.close}>
                    {l10n.t('Close')}
                </Button>
            </>
        );
    } else if (phase === 'provisioning') {
        footer = (
            <>
                <Button appearance="primary" disabled>
                    {l10n.t('Setting up…')}
                </Button>
                <Button appearance="secondary" onClick={machine.cancel}>
                    {l10n.t('Cancel')}
                </Button>
            </>
        );
    } else if (phase === 'success') {
        footer = (
            <>
                <Button appearance="primary" onClick={machine.openConnection}>
                    {l10n.t('Open Connection')}
                </Button>
                <Button appearance="secondary" onClick={machine.copyConnectionString}>
                    {l10n.t('Copy Connection String')}
                </Button>
                <Button appearance="subtle" onClick={machine.close}>
                    {l10n.t('Close')}
                </Button>
            </>
        );
    } else if (phase === 'failed') {
        footer = (
            <>
                <Button appearance="primary" disabled>
                    {l10n.t('Start DocumentDB Local')}
                </Button>
                <Button appearance="secondary" onClick={machine.timedOut ? machine.startOver : machine.backToReview}>
                    {machine.timedOut ? l10n.t('Start over') : l10n.t('Edit settings')}
                </Button>
            </>
        );
    } else {
        footer = (
            <>
                <Button
                    appearance="primary"
                    icon={<RocketRegular />}
                    disabled={!!advanced.validation}
                    onClick={machine.start}
                >
                    {machine.isRecreate ? l10n.t('Recreate DocumentDB Local') : l10n.t('Start DocumentDB Local')}
                </Button>
                <Button appearance="secondary" onClick={machine.close}>
                    {l10n.t('Cancel')}
                </Button>
            </>
        );
    }

    return (
        <WizardShell footer={footer} contentKey={`${phase}:${machine.timedOut}`}>
            <Announcer when={phase === 'provisioning'} message={l10n.t('Setting up DocumentDB Local.')} />
            <Announcer when={phase === 'success'} message={l10n.t('DocumentDB Local is ready.')} />
            <Announcer
                when={phase === 'failed'}
                message={
                    machine.timedOut
                        ? l10n.t('DocumentDB is still initializing. Review the setup progress and recovery actions.')
                        : l10n.t('Setup failed. {0}', machine.errorMessage ?? l10n.t('Review the failed stage.'))
                }
                politeness="assertive"
            />
            <Announcer
                when={phase === 'dockerNotReady'}
                message={l10n.t('Docker is required and is not ready. Review the checks below.')}
                politeness="assertive"
            />
            <div role="status" aria-live="polite" aria-atomic="true" className={styles.srOnly}>
                {phase === 'provisioning' ? machine.provisioningStatusMessage : ''}
            </div>
            <div className={styles.hero}>
                <RocketRegular aria-hidden className={styles.heroIcon} />
                <div>
                    <Text as="h1" size={700} weight="semibold">
                        {l10n.t('DocumentDB Local')}
                    </Text>
                    <div>
                        <Text className={shared.muted}>
                            {l10n.t('A local DocumentDB instance, ready in about a minute.')}
                        </Text>
                    </div>
                </div>
            </div>
            {(phase === 'review' || phase === 'success') && facts}
            {content}
        </WizardShell>
    );
};
