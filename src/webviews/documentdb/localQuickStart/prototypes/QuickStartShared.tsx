/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * EXPERIMENT (dev/tnaum/quickstart-brainstorm).
 *
 * Presentation pieces shared by the three Local Quick Start layout prototypes,
 * so a review compares *layouts* rather than three divergent copies of the same
 * content. Anything genuinely layout-specific lives in the prototype itself.
 */

import {
    Badge,
    Button,
    Card,
    Divider,
    Field,
    Input,
    Link,
    makeStyles,
    Spinner,
    Switch,
    Text,
    tokens,
} from '@fluentui/react-components';
import {
    ArrowClockwiseRegular,
    CheckmarkCircleFilled,
    CircleHintFilled,
    ErrorCircleFilled,
} from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { type JSX } from 'react';
import {
    type DockerStatusResult,
    type ProvisionStage,
    QUICK_START_DEFAULT_TAG,
    QUICK_START_PORT,
} from '../../../../services/localQuickStart/quickStartTypes';
import { type AdvancedState, STAGE_LABELS, type StageStatus, VISIBLE_STAGES } from './useQuickStartMachine';

export const useSharedStyles = makeStyles({
    muted: { color: tokens.colorNeutralForeground3 },
    hero: { display: 'flex', alignItems: 'center', gap: '16px' },
    heroIcon: { fontSize: '40px', color: tokens.colorBrandForeground1, flexShrink: 0 },
    section: { display: 'flex', flexDirection: 'column', gap: '12px' },
    sectionHeader: { display: 'flex', flexDirection: 'column', gap: '4px' },
    cardGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '12px' },
    metricCard: { padding: '14px', display: 'flex', flexDirection: 'column', gap: '4px' },
    metricValueRow: { display: 'flex', alignItems: 'center', gap: '6px' },
    summaryCard: { padding: '16px', display: 'flex', flexDirection: 'column', gap: '8px' },
    summaryRow: { display: 'grid', gridTemplateColumns: '140px 1fr', gap: '8px' },
    stageList: {
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        padding: '16px',
        border: `1px solid ${tokens.colorNeutralStroke2}`,
        borderRadius: tokens.borderRadiusMedium,
    },
    stageRow: { display: 'flex', alignItems: 'center', gap: '10px', minHeight: '20px' },
    stageIcon: { width: '18px', height: '18px', flexShrink: 0, display: 'grid', placeItems: 'center' },
    stageDone: { color: tokens.colorPaletteGreenForeground1, fontSize: '18px' },
    stageError: { color: tokens.colorPaletteRedForeground1, fontSize: '18px' },
    stagePending: { color: tokens.colorNeutralForeground4, fontSize: '18px' },
    advancedPanel: { display: 'flex', flexDirection: 'column', gap: '12px', paddingTop: '8px' },
    advancedGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' },
    actions: { display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' },
    nextSteps: { display: 'flex', flexDirection: 'column', gap: '4px' },
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

export const MetricCard = ({
    label,
    value,
    badge,
}: {
    readonly label: string;
    readonly value: string;
    readonly badge?: JSX.Element;
}): JSX.Element => {
    const styles = useSharedStyles();
    return (
        <Card className={styles.metricCard}>
            <Text size={200} className={styles.muted}>
                {label}
            </Text>
            <div className={styles.metricValueRow}>
                {badge}
                <Text weight="semibold">{value}</Text>
            </div>
        </Card>
    );
};

export const statusBadge = (ok: boolean, notOkColor: 'danger' | 'warning' = 'danger'): JSX.Element => (
    <Badge appearance="filled" color={ok ? 'success' : notOkColor} size="small">
        {ok ? '✓' : '!'}
    </Badge>
);

/** One row of the vertical provisioning checklist (Atlas `StageRow` shape). */
export const StageChecklistRow = ({
    stage,
    status,
}: {
    readonly stage: ProvisionStage;
    readonly status: StageStatus;
}): JSX.Element => {
    const styles = useSharedStyles();
    let icon: JSX.Element;
    let statusText: string;
    if (status === 'done') {
        icon = <CheckmarkCircleFilled aria-hidden className={styles.stageDone} />;
        statusText = l10n.t('done');
    } else if (status === 'error') {
        icon = <ErrorCircleFilled aria-hidden className={styles.stageError} />;
        statusText = l10n.t('failed');
    } else if (status === 'active') {
        icon = <Spinner size="extra-tiny" aria-hidden />;
        statusText = l10n.t('in progress');
    } else {
        icon = <CircleHintFilled aria-hidden className={styles.stagePending} />;
        statusText = l10n.t('pending');
    }
    return (
        <div className={styles.stageRow} role="listitem" aria-label={`${STAGE_LABELS[stage]}, ${statusText}`}>
            <span className={styles.stageIcon}>{icon}</span>
            <Text aria-hidden className={status === 'pending' ? styles.muted : undefined}>
                {STAGE_LABELS[stage]}
            </Text>
        </div>
    );
};

export const StageChecklist = ({
    stageStatus,
}: {
    readonly stageStatus: Record<ProvisionStage, StageStatus>;
}): JSX.Element => {
    const styles = useSharedStyles();
    return (
        <div className={styles.stageList} role="list" aria-label={l10n.t('Setup progress')}>
            {VISIBLE_STAGES.map((stage) => (
                <StageChecklistRow key={stage} stage={stage} status={stageStatus[stage]} />
            ))}
        </div>
    );
};

/** The Advanced overrides, identical in every prototype; only the container differs. */
export const AdvancedFields = ({
    advanced,
    isRecreate,
}: {
    readonly advanced: AdvancedState;
    readonly isRecreate: boolean;
}): JSX.Element => {
    const styles = useSharedStyles();
    const validation = advanced.validation;
    return (
        <div className={styles.advancedPanel}>
            <Text size={200} className={styles.muted}>
                {l10n.t('Leave any field blank to keep the automatic default.')}
            </Text>
            <div className={styles.advancedGrid}>
                <Field
                    label={l10n.t('Port')}
                    hint={l10n.t('Default {0}', String(QUICK_START_PORT))}
                    validationState={validation?.field === 'port' ? 'error' : 'none'}
                    validationMessage={validation?.field === 'port' ? validation.message : undefined}
                >
                    <Input
                        type="number"
                        value={advanced.port}
                        placeholder={String(QUICK_START_PORT)}
                        onChange={(_e, d) => advanced.setPort(d.value)}
                    />
                </Field>
                {!isRecreate && (
                    <Field
                        label={l10n.t('Image tag')}
                        hint={l10n.t('Default “{0}”', QUICK_START_DEFAULT_TAG)}
                        validationState={validation?.field === 'tag' ? 'error' : 'none'}
                        validationMessage={validation?.field === 'tag' ? validation.message : undefined}
                    >
                        <Input
                            value={advanced.tag}
                            maxLength={128}
                            placeholder={QUICK_START_DEFAULT_TAG}
                            onChange={(_e, d) => advanced.setTag(d.value)}
                        />
                    </Field>
                )}
                {!isRecreate && (
                    <Field
                        label={l10n.t('Username')}
                        hint={l10n.t('Default: auto-generated')}
                        validationState={validation?.field === 'username' ? 'error' : 'none'}
                        validationMessage={validation?.field === 'username' ? validation.message : undefined}
                    >
                        <Input
                            value={advanced.username}
                            maxLength={128}
                            placeholder={l10n.t('auto')}
                            onChange={(_e, d) => advanced.setUsername(d.value)}
                        />
                    </Field>
                )}
                {!isRecreate && (
                    <Field
                        label={l10n.t('Password')}
                        hint={l10n.t('Default: auto-generated')}
                        validationState={validation?.field === 'password' ? 'error' : 'none'}
                        validationMessage={validation?.field === 'password' ? validation.message : undefined}
                    >
                        <Input
                            type="password"
                            value={advanced.password}
                            maxLength={256}
                            placeholder={l10n.t('auto')}
                            onChange={(_e, d) => advanced.setPassword(d.value)}
                        />
                    </Field>
                )}
            </div>
            {isRecreate && (
                <Text size={200} className={styles.muted}>
                    {l10n.t(
                        'Recreating reuses the existing data volume, so the original credentials and image are kept.',
                    )}
                </Text>
            )}
            <Switch
                checked={advanced.loadSampleData}
                label={l10n.t('Load sample data')}
                onChange={(_e, d) => advanced.setLoadSampleData(d.checked)}
            />
        </div>
    );
};

/** The Docker-is-not-ready remediation content, shared by every prototype. */
export const DockerBlockedContent = ({
    docker,
    startingDocker,
    onStartDocker,
    onRetry,
}: {
    readonly docker: DockerStatusResult | undefined;
    readonly startingDocker: boolean;
    readonly onStartDocker: () => void;
    readonly onRetry: () => void;
}): JSX.Element => {
    const styles = useSharedStyles();
    const r = docker?.readiness;
    const cliOk = !!r?.cliInstalled;
    const daemonOk = !!r?.daemonReachable;
    const platformOk = r?.platformSupported !== false;
    return (
        <div className={styles.section}>
            <div className={styles.cardGrid}>
                <MetricCard
                    label={l10n.t('Docker CLI')}
                    value={cliOk ? (r?.cliVersion ?? l10n.t('Found')) : l10n.t('Not found')}
                    badge={statusBadge(cliOk)}
                />
                <MetricCard
                    label={l10n.t('Docker daemon')}
                    value={daemonOk ? l10n.t('Reachable') : l10n.t('Stopped')}
                    badge={statusBadge(daemonOk)}
                />
                <MetricCard
                    label={l10n.t('Platform')}
                    value={r?.arch ?? l10n.t('unknown')}
                    badge={statusBadge(platformOk, 'warning')}
                />
            </div>
            <Card className={styles.summaryCard}>
                <Text weight="semibold">{l10n.t('How to fix')}</Text>
                <Divider />
                <Text size={200}>
                    {cliOk
                        ? l10n.t('• Start Docker Desktop and wait for it to report “running”.')
                        : l10n.t('• Install Docker Desktop, then reopen Quick Start.')}
                </Text>
                <Text size={200}>{l10n.t('• If you use a corporate proxy, check that ghcr.io is reachable.')}</Text>
                <div className={styles.actions}>
                    {!cliOk && (
                        <Link href="https://www.docker.com/products/docker-desktop/">{l10n.t('Install Docker')}</Link>
                    )}
                    <Link href="https://docs.docker.com/desktop/troubleshoot-and-support/troubleshoot/">
                        {l10n.t('Troubleshooting')}
                    </Link>
                </div>
            </Card>
            <div className={styles.actions}>
                {cliOk && !daemonOk && (
                    <Button appearance="primary" disabled={startingDocker} onClick={onStartDocker}>
                        {startingDocker ? l10n.t('Starting Docker Desktop…') : l10n.t('Start Docker Desktop')}
                    </Button>
                )}
                <Button
                    appearance={cliOk && !daemonOk ? 'secondary' : 'primary'}
                    icon={<ArrowClockwiseRegular />}
                    onClick={onRetry}
                >
                    {l10n.t('Retry')}
                </Button>
            </div>
        </div>
    );
};

export const NextSteps = ({ port }: { readonly port: number }): JSX.Element => {
    const styles = useSharedStyles();
    return (
        <div className={styles.nextSteps}>
            <Text size={200} weight="semibold">
                {l10n.t('Next steps')}
            </Text>
            <Text size={200}>
                {l10n.t('• Open Connection: browse your databases in the Connections view, under “DocumentDB Local”.')}
            </Text>
            <Text size={200}>
                {l10n.t(
                    '• Copy Connection String: use it from a Query Playground, your app, or mongosh (localhost:{0}).',
                    String(port),
                )}
            </Text>
            <Text size={200}>
                {l10n.t(
                    '• The container keeps running after VS Code closes. Manage it with Stop / Restart / Delete in the Connections view.',
                )}
            </Text>
        </div>
    );
};
