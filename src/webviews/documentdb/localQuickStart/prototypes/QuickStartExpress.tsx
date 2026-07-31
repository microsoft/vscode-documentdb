/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * EXPERIMENT (dev/tnaum/quickstart-brainstorm) — PROTOTYPE A: "Express".
 *
 * The one-page answer to the 80% happy path: there is no navigation at all.
 * A single "action slot" occupies the middle of the page and swaps its contents
 * between four states (ready → running → done / blocked), so the user's eyes
 * never have to re-acquire the page. Everything optional is either a one-line
 * fact strip or hidden behind a collapsed "Customize" section.
 *
 * The bet: nobody wants to *configure* a throwaway local database; they want it
 * to exist. So the default path is a single button press with zero decisions,
 * and the only thing that ever changes position is the content of one card.
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
import { ArrowClockwiseRegular, CheckmarkCircleFilled, ErrorCircleFilled, RocketRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { type JSX, useEffect, useRef } from 'react';
import { Announcer } from '../../../components/accessibility/Announcer';
import { AdvancedFields, DockerBlockedContent, NextSteps, StageChecklist, useSharedStyles } from './QuickStartShared';
import { useQuickStartMachine } from './useQuickStartMachine';

const useStyles = makeStyles({
    root: {
        padding: '32px 24px',
        maxWidth: '720px',
        margin: '0 auto',
        display: 'flex',
        flexDirection: 'column',
        gap: '20px',
    },
    hero: { display: 'flex', alignItems: 'center', gap: '16px' },
    heroIcon: { fontSize: '44px', color: tokens.colorBrandForeground1, flexShrink: 0 },
    // The single fact strip that replaces four separate metric cards: the same
    // information, but read as one sentence rather than scanned as a grid.
    facts: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px' },
    factSeparator: { color: tokens.colorNeutralForeground4 },
    // The one slot that changes. Fixed padding and a stable border keep the page
    // from reflowing as it swaps between ready / running / done.
    slot: {
        padding: '20px',
        display: 'flex',
        flexDirection: 'column',
        gap: '14px',
    },
    slotHeader: { display: 'flex', alignItems: 'center', gap: '10px' },
    cta: { alignSelf: 'flex-start', minWidth: '220px' },
    actions: { display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' },
    footNote: { color: tokens.colorNeutralForeground3 },
    successIcon: { color: tokens.colorPaletteGreenForeground1, fontSize: '20px' },
    errorIcon: { color: tokens.colorPaletteRedForeground1, fontSize: '20px' },
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

export const QuickStartExpress = (): JSX.Element => {
    const styles = useStyles();
    const shared = useSharedStyles();
    const machine = useQuickStartMachine();
    const { phase, advanced } = machine;

    // Focus follows the slot: whatever the primary action becomes after a state
    // swap is what the keyboard user lands on (the button they pressed is gone).
    const primaryRef = useRef<HTMLButtonElement>(null);
    useEffect(() => {
        if (phase === 'success' || phase === 'failed' || phase === 'provisioning') {
            primaryRef.current?.focus();
        }
    }, [phase]);

    if (phase === 'loading') {
        return (
            <div className={styles.root}>
                <Spinner label={l10n.t('Checking Docker…')} />
            </div>
        );
    }

    const port = machine.boundPort ?? Number(machine.effectivePort);

    const facts = (
        <div className={styles.facts}>
            <Badge appearance="filled" color={machine.dockerReady ? 'success' : 'danger'} size="small">
                {machine.dockerReady ? '✓' : '!'}
            </Badge>
            <Text size={200}>{machine.dockerReady ? l10n.t('Docker ready') : l10n.t('Docker not ready')}</Text>
            <Text size={200} className={styles.factSeparator}>
                ·
            </Text>
            <Text size={200}>{l10n.t('localhost:{0}', machine.effectivePort)}</Text>
            <Text size={200} className={styles.factSeparator}>
                ·
            </Text>
            <Text size={200}>{l10n.t('Data persists')}</Text>
            <Text size={200} className={styles.factSeparator}>
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

    const readySlot = (
        <Card className={styles.slot}>
            <Button
                appearance="primary"
                size="large"
                className={styles.cta}
                icon={<RocketRegular />}
                disabled={!!advanced.validation}
                onClick={machine.start}
            >
                {machine.isRecreate ? l10n.t('Recreate DocumentDB Local') : l10n.t('Create DocumentDB Local')}
            </Button>
            <Text size={200} className={styles.footNote}>
                {machine.isRecreate
                    ? l10n.t(
                          'Reuses the existing data volume, so your data, credentials, and image are kept. Usually under a minute.',
                      )
                    : l10n.t(
                          'Pulls the official image, starts a container, and saves the connection for you. Usually under a minute — nothing else to configure.',
                      )}
            </Text>
        </Card>
    );

    const runningSlot = (
        <Card className={styles.slot}>
            <div className={styles.slotHeader}>
                <Spinner size="tiny" aria-hidden />
                <Text weight="semibold">{l10n.t('Setting up… {0}', machine.elapsedLabel)}</Text>
            </div>
            <StageChecklist stageStatus={machine.stageStatus} />
            <div className={styles.actions}>
                <Button appearance="secondary" ref={primaryRef} onClick={machine.cancel}>
                    {l10n.t('Cancel')}
                </Button>
                <Link onClick={machine.viewOutput}>{l10n.t('View Docker output')}</Link>
            </div>
        </Card>
    );

    const successSlot = (
        <Card className={styles.slot}>
            <div className={styles.slotHeader}>
                <CheckmarkCircleFilled aria-hidden className={styles.successIcon} />
                <Text weight="semibold">{machine.successMessage ?? l10n.t('DocumentDB Local is running.')}</Text>
            </div>
            <Text className={styles.connString} size={200}>
                {l10n.t('localhost:{0}', String(port))}
            </Text>
            <div className={styles.actions}>
                <Button appearance="primary" ref={primaryRef} onClick={machine.openConnection}>
                    {l10n.t('Open Connection')}
                </Button>
                <Button appearance="secondary" onClick={machine.copyConnectionString}>
                    {l10n.t('Copy Connection String')}
                </Button>
                <Button appearance="subtle" onClick={machine.close}>
                    {l10n.t('Close')}
                </Button>
            </div>
            <NextSteps port={port} />
        </Card>
    );

    const failedSlot = (
        <Card className={styles.slot}>
            <div className={styles.slotHeader}>
                <ErrorCircleFilled aria-hidden className={styles.errorIcon} />
                <Text weight="semibold">
                    {machine.timedOut ? l10n.t('Still starting up') : l10n.t("That didn't work")}
                </Text>
            </div>
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
            <StageChecklist stageStatus={machine.stageStatus} />
            <div className={styles.actions}>
                {machine.timedOut ? (
                    <>
                        <Button
                            appearance="primary"
                            ref={primaryRef}
                            icon={<ArrowClockwiseRegular />}
                            onClick={machine.waitLonger}
                        >
                            {l10n.t('Wait longer')}
                        </Button>
                        <Button appearance="secondary" onClick={machine.startOver}>
                            {l10n.t('Start over')}
                        </Button>
                    </>
                ) : (
                    <>
                        <Button
                            appearance="primary"
                            ref={primaryRef}
                            icon={<ArrowClockwiseRegular />}
                            onClick={machine.start}
                        >
                            {l10n.t('Retry')}
                        </Button>
                        <Button appearance="secondary" onClick={machine.backToReview}>
                            {l10n.t('Edit settings')}
                        </Button>
                    </>
                )}
            </div>
        </Card>
    );

    const blockedSlot = (
        <Card className={styles.slot}>
            <div className={styles.slotHeader}>
                <ErrorCircleFilled aria-hidden className={styles.errorIcon} />
                <Text weight="semibold">{l10n.t('Docker is required')}</Text>
            </div>
            <Text size={200} className={styles.footNote}>
                {l10n.t('Docker is required to run DocumentDB locally. The extension does not install Docker for you.')}
            </Text>
            <DockerBlockedContent
                docker={machine.docker}
                startingDocker={machine.startingDocker}
                onStartDocker={machine.startDockerDesktop}
                onRetry={machine.reloadDockerStatus}
            />
        </Card>
    );

    let slot: JSX.Element;
    if (phase === 'dockerNotReady') {
        slot = blockedSlot;
    } else if (phase === 'provisioning') {
        slot = runningSlot;
    } else if (phase === 'success') {
        slot = successSlot;
    } else if (phase === 'failed') {
        slot = failedSlot;
    } else {
        slot = readySlot;
    }

    return (
        <div className={styles.root}>
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

            {facts}
            {slot}

            {/* Optional, and stated as optional: the 20% path never blocks the 80%. */}
            {(phase === 'review' || phase === 'failed') && (
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
            )}
        </div>
    );
};
