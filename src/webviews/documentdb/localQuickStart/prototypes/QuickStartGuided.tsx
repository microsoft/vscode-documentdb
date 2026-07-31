/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * EXPERIMENT (dev/tnaum/quickstart-brainstorm) — PROTOTYPE C: "Guided".
 *
 * A hybrid: the *chrome* of the Atlas wizard (a step rail at the top, a pinned
 * footer whose primary action is always reachable without scrolling) applied to
 * a page that never navigates.
 *
 * Two deliberate differences from the wizard:
 *
 * 1. The rail is a **status indicator, not navigation** — you cannot click a
 *    step, because there is nothing to go back to in a flow whose only decision
 *    is "start". It answers "how far along am I", which is the only question
 *    users actually ask during a one-minute wait.
 * 2. It collapses the five technical stages into **three human ones** (Get image
 *    → Start container → Connect). "Pulling official image" and "Checking Docker"
 *    are the same wait from the user's side; the detailed checklist is still one
 *    disclosure away for when something fails.
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
import { CheckmarkCircleFilled, CircleHintFilled, ErrorCircleFilled, RocketRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { type JSX } from 'react';
import {
    type ProvisionStage,
    QUICK_START_IMAGE,
    QUICK_START_IMAGE_REPOSITORY,
    QUICK_START_PORT,
} from '../../../../services/localQuickStart/quickStartTypes';
import { Announcer } from '../../../components/accessibility/Announcer';
import { WizardShell } from '../../../components/wizard/WizardShell';
import { AdvancedFields, DockerBlockedContent, NextSteps, StageChecklist, useSharedStyles } from './QuickStartShared';
import { type StageStatus, useQuickStartMachine } from './useQuickStartMachine';

const useStyles = makeStyles({
    hero: { display: 'flex', alignItems: 'center', gap: '16px' },
    heroIcon: { color: tokens.colorBrandForeground1, fontSize: '48px', flexShrink: 0 },
    loading: { padding: '24px' },
    rail: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' },
    railItem: { display: 'flex', alignItems: 'center', gap: '8px' },
    railIcon: { width: '18px', height: '18px', display: 'grid', placeItems: 'center', flexShrink: 0 },
    railConnector: {
        width: '28px',
        height: '2px',
        backgroundColor: tokens.colorNeutralStroke2,
        flexShrink: 0,
    },
    railConnectorDone: { backgroundColor: tokens.colorPaletteGreenForeground1 },
    railLabelActive: { fontWeight: tokens.fontWeightSemibold },
    railDone: { color: tokens.colorPaletteGreenForeground1, fontSize: '18px' },
    railError: { color: tokens.colorPaletteRedForeground1, fontSize: '18px' },
    railPending: { color: tokens.colorNeutralForeground4, fontSize: '18px' },
    factsCard: { padding: '14px 16px', display: 'flex', flexWrap: 'wrap', gap: '20px' },
    fact: { display: 'flex', flexDirection: 'column', gap: '2px', minWidth: '120px' },
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

/** The three user-facing phases, each backed by one or more technical stages. */
const RAIL: readonly { readonly key: string; readonly label: string; readonly stages: readonly ProvisionStage[] }[] = [
    { key: 'image', label: l10n.t('Get image'), stages: ['checking', 'pulling'] },
    { key: 'container', label: l10n.t('Start container'), stages: ['creating', 'starting'] },
    { key: 'connect', label: l10n.t('Connect'), stages: ['waiting'] },
];

function railStatus(stages: readonly ProvisionStage[], stageStatus: Record<ProvisionStage, StageStatus>): StageStatus {
    if (stages.some((s) => stageStatus[s] === 'error')) return 'error';
    if (stages.some((s) => stageStatus[s] === 'active')) return 'active';
    if (stages.every((s) => stageStatus[s] === 'done')) return 'done';
    return 'pending';
}

const ProgressRail = ({ stageStatus }: { readonly stageStatus: Record<ProvisionStage, StageStatus> }): JSX.Element => {
    const styles = useStyles();
    const shared = useSharedStyles();
    return (
        // A status list, not a navigation landmark: there is nothing to click.
        <div className={styles.rail} role="list" aria-label={l10n.t('Setup progress')}>
            {RAIL.map((item, index) => {
                const status = railStatus(item.stages, stageStatus);
                let icon: JSX.Element;
                let statusText: string;
                if (status === 'done') {
                    icon = <CheckmarkCircleFilled aria-hidden className={styles.railDone} />;
                    statusText = l10n.t('done');
                } else if (status === 'error') {
                    icon = <ErrorCircleFilled aria-hidden className={styles.railError} />;
                    statusText = l10n.t('failed');
                } else if (status === 'active') {
                    icon = <Spinner size="extra-tiny" aria-hidden />;
                    statusText = l10n.t('in progress');
                } else {
                    icon = <CircleHintFilled aria-hidden className={styles.railPending} />;
                    statusText = l10n.t('pending');
                }
                return (
                    <div
                        key={item.key}
                        className={styles.railItem}
                        role="listitem"
                        aria-label={`${item.label}, ${statusText}`}
                    >
                        <span className={styles.railIcon}>{icon}</span>
                        <Text
                            aria-hidden
                            size={200}
                            className={
                                status === 'active'
                                    ? styles.railLabelActive
                                    : status === 'pending'
                                      ? shared.muted
                                      : undefined
                            }
                        >
                            {item.label}
                        </Text>
                        {index < RAIL.length - 1 && (
                            <span
                                aria-hidden
                                className={`${styles.railConnector} ${status === 'done' ? styles.railConnectorDone : ''}`}
                            />
                        )}
                    </div>
                );
            })}
        </div>
    );
};

export const QuickStartGuided = (): JSX.Element => {
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

    const port = machine.boundPort ?? QUICK_START_PORT;
    const effectiveImage =
        !machine.isRecreate && advanced.tag.trim()
            ? `${QUICK_START_IMAGE_REPOSITORY}:${advanced.tag.trim()}`
            : QUICK_START_IMAGE;

    const facts = (
        <Card className={styles.factsCard}>
            <div className={styles.fact}>
                <Text size={200} className={shared.muted}>
                    {l10n.t('Address')}
                </Text>
                <Text weight="semibold">{l10n.t('localhost:{0}', machine.effectivePort)}</Text>
            </div>
            <div className={styles.fact}>
                <Text size={200} className={shared.muted}>
                    {l10n.t('Credentials')}
                </Text>
                <Text weight="semibold">
                    {machine.isRecreate
                        ? l10n.t('Reused')
                        : advanced.username.trim()
                          ? l10n.t('Custom')
                          : l10n.t('Auto-generated')}
                </Text>
            </div>
            <div className={styles.fact}>
                <Text size={200} className={shared.muted}>
                    {l10n.t('Data')}
                </Text>
                <Text weight="semibold">{l10n.t('Persistent volume')}</Text>
            </div>
            <div className={styles.fact}>
                <Text size={200} className={shared.muted}>
                    {l10n.t('Image')}
                </Text>
                <Text weight="semibold">{machine.isRecreate ? l10n.t('Kept') : effectiveImage.split('/').pop()}</Text>
            </div>
        </Card>
    );

    const detailDisclosure = (
        <Accordion collapsible defaultOpenItems={phase === 'failed' ? ['details'] : []}>
            <AccordionItem value="details">
                <AccordionHeader>{l10n.t('Details')}</AccordionHeader>
                <AccordionPanel>
                    <div className={shared.section}>
                        <StageChecklist stageStatus={machine.stageStatus} />
                        <Link onClick={machine.viewOutput}>{l10n.t('View Docker output')}</Link>
                    </div>
                </AccordionPanel>
            </AccordionItem>
        </Accordion>
    );

    let body: JSX.Element;
    let footer: JSX.Element;

    if (phase === 'dockerNotReady') {
        body = (
            <section className={shared.section} aria-labelledby="qsg-heading">
                <Text id="qsg-heading" as="h2" size={500} weight="semibold">
                    {l10n.t('Docker is required')}
                </Text>
                <DockerBlockedContent
                    docker={machine.docker}
                    startingDocker={machine.startingDocker}
                    onStartDocker={machine.startDockerDesktop}
                    onRetry={machine.reloadDockerStatus}
                />
            </section>
        );
        footer = (
            <>
                <Button appearance="primary" onClick={machine.reloadDockerStatus}>
                    {l10n.t('Check again')}
                </Button>
                <Button appearance="secondary" onClick={machine.close}>
                    {l10n.t('Cancel')}
                </Button>
            </>
        );
    } else if (phase === 'provisioning') {
        body = (
            <section className={shared.section} aria-labelledby="qsg-heading">
                <Text id="qsg-heading" as="h2" size={500} weight="semibold">
                    {l10n.t('Setting up… {0}', machine.elapsedLabel)}
                </Text>
                <Text className={shared.muted}>
                    {l10n.t('You can keep working; this finishes on its own and the connection is saved for you.')}
                </Text>
                {facts}
                {detailDisclosure}
            </section>
        );
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
        body = (
            <section className={shared.section} aria-labelledby="qsg-heading">
                <Text id="qsg-heading" as="h2" size={500} weight="semibold">
                    {l10n.t('DocumentDB Local is running')}
                </Text>
                <Text className={styles.connString} size={200}>
                    {l10n.t('localhost:{0}', String(port))}
                </Text>
                <MessageBar intent="success">
                    <MessageBarBody>
                        <MessageBarTitle>{l10n.t('All set')}</MessageBarTitle>{' '}
                        {l10n.t('The connection was saved and is ready to use.')}
                    </MessageBarBody>
                </MessageBar>
                <NextSteps port={port} />
                {detailDisclosure}
            </section>
        );
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
        body = (
            <section className={shared.section} aria-labelledby="qsg-heading">
                <Text id="qsg-heading" as="h2" size={500} weight="semibold">
                    {machine.timedOut ? l10n.t('Still starting up') : l10n.t('Setup did not finish')}
                </Text>
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
                {detailDisclosure}
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
        footer = machine.timedOut ? (
            <>
                <Button appearance="primary" onClick={machine.waitLonger}>
                    {l10n.t('Wait longer')}
                </Button>
                <Button appearance="secondary" onClick={machine.startOver}>
                    {l10n.t('Start over')}
                </Button>
            </>
        ) : (
            <>
                <Button appearance="primary" onClick={machine.start}>
                    {l10n.t('Retry')}
                </Button>
                <Button appearance="secondary" onClick={machine.close}>
                    {l10n.t('Cancel')}
                </Button>
            </>
        );
    } else {
        body = (
            <section className={shared.section} aria-labelledby="qsg-heading">
                <Text id="qsg-heading" as="h2" size={500} weight="semibold">
                    {machine.isRecreate ? l10n.t('Recreate your local instance') : l10n.t("Here's what you'll get")}
                </Text>
                <Text className={shared.muted}>
                    {l10n.t('These defaults work for most people. Change them only if you need to.')}
                </Text>
                {facts}
                <Accordion collapsible>
                    <AccordionItem value="advanced">
                        <AccordionHeader>
                            {advanced.isCustomized ? l10n.t('Advanced (changed)') : l10n.t('Advanced (optional)')}
                        </AccordionHeader>
                        <AccordionPanel>
                            <AdvancedFields advanced={advanced} isRecreate={machine.isRecreate} />
                        </AccordionPanel>
                    </AccordionItem>
                </Accordion>
            </section>
        );
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
        <WizardShell footer={footer} contentKey={phase}>
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
            <div className={styles.hero}>
                <RocketRegular aria-hidden className={styles.heroIcon} />
                <div>
                    <Text as="h1" size={700} weight="semibold">
                        {l10n.t('DocumentDB Local')}
                    </Text>
                    <div>
                        <Text className={shared.muted}>
                            {l10n.t('A real DocumentDB running on this machine, in about a minute.')}
                        </Text>
                    </div>
                </div>
            </div>
            {phase !== 'dockerNotReady' && <ProgressRail stageStatus={machine.stageStatus} />}
            {advanced.isCustomized && phase === 'review' && (
                <Badge appearance="tint" color="brand" size="small">
                    {l10n.t('Customized')}
                </Badge>
            )}
            {body}
        </WizardShell>
    );
};
