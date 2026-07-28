/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Body1,
    Breadcrumb,
    BreadcrumbButton,
    BreadcrumbDivider,
    BreadcrumbItem,
    Button,
    Card,
    CardHeader,
    Field,
    Input,
    Link,
    makeStyles,
    mergeClasses,
    MessageBar,
    MessageBarActions,
    MessageBarBody,
    MessageBarTitle,
    Radio,
    Spinner,
    Text,
    tokens,
} from '@fluentui/react-components';
import {
    ArrowLeftRegular,
    CheckmarkCircleFilled,
    CircleRegular,
    CloudRegular,
    ErrorCircleFilled,
    EyeOffRegular,
    EyeRegular,
    KeyRegular,
    PersonAccountsRegular,
} from '@fluentui/react-icons';
import { useConfiguration } from '@microsoft/vscode-ext-webview/react';
import * as l10n from '@vscode/l10n';
import { Fragment, type JSX, useCallback, useMemo, useState } from 'react';
import { type AtlasAuthMethod } from '../../../plugins/service-atlas-mongodb/auth/AtlasSession';
import { useTrpcClient } from '../../_integration/useTrpcClient';
import { Announcer } from '../../components/accessibility/Announcer';
import { type AtlasCredentialsWebviewConfig } from './atlasCredentialsController';
import { type CredentialSubmitError } from './atlasCredentialsRouter';

const ATLAS_API_KEY_DOCS_URL = 'https://www.mongodb.com/docs/atlas/configure-api-access/';
const ATLAS_SERVICE_ACCOUNT_DOCS_URL = 'https://www.mongodb.com/docs/atlas/api/service-accounts-overview/';
const ATLAS_CONSOLE_URL = 'https://cloud.mongodb.com/';

type Phase = 'choose' | 'form' | 'checking' | 'success';
type StageStatus = 'pending' | 'active' | 'done' | 'error';

const useStyles = makeStyles({
    root: {
        display: 'flex',
        flexDirection: 'column',
        gap: '20px',
        maxWidth: '760px',
        padding: '24px',
    },
    hero: { display: 'flex', alignItems: 'center', gap: '16px' },
    heroIcon: { color: tokens.colorBrandForeground1, fontSize: '44px', flexShrink: 0 },
    muted: { color: tokens.colorNeutralForeground2 },
    section: { display: 'flex', flexDirection: 'column', gap: '12px' },
    sectionHeader: { display: 'flex', flexDirection: 'column', gap: '4px' },
    breadcrumbDone: { color: tokens.colorPaletteGreenForeground1, fontSize: '16px' },
    cardGrid: {
        display: 'grid',
        gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
        gap: '12px',
        '@media (max-width: 640px)': { gridTemplateColumns: '1fr' },
    },
    methodCard: { cursor: 'pointer', height: '100%' },
    methodCardSelected: {
        outline: `2px solid ${tokens.colorBrandStroke1}`,
        outlineOffset: '-1px',
    },
    methodIcon: { color: tokens.colorBrandForeground1, fontSize: '24px' },
    methodSummary: { color: tokens.colorNeutralForeground2 },
    actions: {
        display: 'flex',
        gap: '8px',
        justifyContent: 'flex-end',
        alignItems: 'center',
        flexWrap: 'wrap',
    },
    formHeader: { display: 'flex', flexDirection: 'column', gap: '8px' },
    guide: { display: 'flex', flexDirection: 'column', gap: '4px' },
    guideSummary: { cursor: 'pointer', userSelect: 'none' },
    guideHeading: { fontWeight: tokens.fontWeightSemibold, color: tokens.colorNeutralForeground2 },
    stepList: {
        margin: '4px 0 0 0',
        paddingLeft: '20px',
        color: tokens.colorNeutralForeground2,
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
    },
    fields: { display: 'flex', flexDirection: 'column', gap: '14px' },
    secretButton: { minWidth: '28px' },
    checkHint: { color: tokens.colorNeutralForeground2 },
    stageList: {
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        padding: '16px',
        border: `1px solid ${tokens.colorNeutralStroke2}`,
        borderRadius: tokens.borderRadiusMedium,
    },
    stageRow: { display: 'flex', alignItems: 'center', gap: '10px', minHeight: '20px' },
    stageDone: { color: tokens.colorPaletteGreenForeground1, fontSize: '18px', flexShrink: 0 },
    stageError: { color: tokens.colorPaletteRedForeground1, fontSize: '18px', flexShrink: 0 },
    stagePending: { color: tokens.colorNeutralForeground4, fontSize: '18px', flexShrink: 0 },
    messageContent: { display: 'flex', flexDirection: 'column', gap: '8px' },
});

interface FieldSpec {
    readonly key: 'publicKey' | 'privateKey' | 'clientId' | 'clientSecret';
    readonly label: string;
    readonly placeholder: string;
    readonly secret: boolean;
}

interface StageRowProps {
    readonly label: string;
    readonly status: StageStatus;
}

const StageRow = ({ label, status }: StageRowProps): JSX.Element => {
    const styles = useStyles();
    let icon: JSX.Element;
    let statusText: string;

    if (status === 'done') {
        icon = <CheckmarkCircleFilled aria-hidden className={styles.stageDone} />;
        statusText = l10n.t('done');
    } else if (status === 'active') {
        icon = <Spinner size="tiny" aria-hidden />;
        statusText = l10n.t('in progress');
    } else if (status === 'error') {
        icon = <ErrorCircleFilled aria-hidden className={styles.stageError} />;
        statusText = l10n.t('failed');
    } else {
        icon = <CircleRegular aria-hidden className={styles.stagePending} />;
        statusText = l10n.t('pending');
    }

    return (
        <div className={styles.stageRow} role="listitem" aria-label={`${label}, ${statusText}`}>
            {icon}
            <Text aria-hidden className={status === 'pending' ? styles.muted : undefined}>
                {label}
            </Text>
        </div>
    );
};

export const AtlasCredentialsView = (): JSX.Element => {
    const configuration = useConfiguration<AtlasCredentialsWebviewConfig>();
    const trpcClient = useTrpcClient();
    const styles = useStyles();
    const initialMethod = configuration.authMethod;
    const [phase, setPhase] = useState<Phase>(initialMethod ? 'form' : 'choose');
    const [chosenMethod, setChosenMethod] = useState<AtlasAuthMethod | undefined>(initialMethod);
    const [pendingMethod, setPendingMethod] = useState<AtlasAuthMethod | undefined>(initialMethod ?? 'serviceaccount');
    const [values, setValues] = useState<Record<string, string>>({});
    const [submitError, setSubmitError] = useState<CredentialSubmitError | undefined>();
    const [showSecret, setShowSecret] = useState(false);
    const [isCompleting, setIsCompleting] = useState(false);
    const [failedStage, setFailedStage] = useState<number | undefined>(undefined);
    const isApiKey = chosenMethod === 'apikey';
    const isEdit = configuration.mode === 'edit';

    // Breadcrumb progress. Edit mode opens straight on the form, so it drops the "Choose method"
    // step; both flows end on "Done".
    const steps: { readonly id: Phase; readonly label: string }[] = useMemo(
        () =>
            isEdit
                ? [
                      { id: 'form', label: l10n.t('Enter details') },
                      { id: 'checking', label: l10n.t('Verify') },
                      { id: 'success', label: l10n.t('Done') },
                  ]
                : [
                      { id: 'choose', label: l10n.t('Choose method') },
                      { id: 'form', label: l10n.t('Enter details') },
                      { id: 'checking', label: l10n.t('Verify') },
                      { id: 'success', label: l10n.t('Done') },
                  ],
        [isEdit],
    );
    const currentStepIndex = steps.findIndex((step) => step.id === phase);

    const fieldSpecs: FieldSpec[] = useMemo(
        () =>
            isApiKey
                ? [
                      {
                          key: 'publicKey',
                          label: l10n.t('Public Key'),
                          placeholder: l10n.t('e.g., abcdef12'),
                          secret: false,
                      },
                      {
                          key: 'privateKey',
                          label: l10n.t('Private Key'),
                          placeholder: l10n.t('xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'),
                          secret: true,
                      },
                  ]
                : [
                      {
                          key: 'clientId',
                          label: l10n.t('Client ID'),
                          placeholder: l10n.t('e.g., mdb_sa_id_6501…'),
                          secret: false,
                      },
                      {
                          key: 'clientSecret',
                          label: l10n.t('Client Secret'),
                          placeholder: l10n.t('mdb_sa_sk_…'),
                          secret: true,
                      },
                  ],
        [isApiKey],
    );
    const canSubmit = fieldSpecs.every((spec) => (values[spec.key] ?? '').trim().length > 0);

    // The real steps the host performs, per method. For an API key a single digest call both
    // authenticates and lists projects, so there is no separate "sign in" step. These labels double
    // as the progress list while verifying and the completed list on success.
    const checkStages = useMemo(
        () =>
            isApiKey
                ? [l10n.t('Verifying with MongoDB Atlas'), l10n.t('Saving the credential')]
                : [
                      l10n.t('Signing in to MongoDB Atlas'),
                      l10n.t('Checking access to your projects'),
                      l10n.t('Saving the credential'),
                  ],
        [isApiKey],
    );

    const openLink = useCallback(
        (url: string): void => {
            void trpcClient.common.openUrl.mutate({ url });
        },
        [trpcClient],
    );

    const showDetails = useCallback((): void => {
        void trpcClient.atlasCredentials.showLog.mutate();
    }, [trpcClient]);

    const handleBack = useCallback((): void => {
        setSubmitError(undefined);
        setShowSecret(false);
        setChosenMethod(undefined);
        setPhase('choose');
    }, []);

    // Breadcrumb back-navigation. Only the pre-verify steps are reachable; once checking starts a
    // credential may already be saved, so the earlier steps lock.
    const goToStep = useCallback(
        (id: Phase): void => {
            if (id === 'choose') {
                handleBack();
            } else if (id === 'form') {
                setSubmitError(undefined);
                setPhase('form');
            }
        },
        [handleBack],
    );

    const handleSubmit = useCallback(async (): Promise<void> => {
        if (!chosenMethod || !canSubmit || phase !== 'form') {
            return;
        }
        setSubmitError(undefined);
        setFailedStage(undefined);
        setPhase('checking');
        try {
            const result =
                chosenMethod === 'apikey'
                    ? await trpcClient.atlasCredentials.submitApiKey.mutate({
                          publicKey: values.publicKey ?? '',
                          privateKey: values.privateKey ?? '',
                      })
                    : await trpcClient.atlasCredentials.submitServiceAccount.mutate({
                          clientId: values.clientId ?? '',
                          clientSecret: values.clientSecret ?? '',
                      });
            if (result.success) {
                setPhase('success');
            } else {
                // Stay on the verification screen and surface the error there; the user chooses when
                // to go back rather than being bounced to the form automatically.
                setSubmitError(result.error);
                setFailedStage(result.failedStage);
            }
        } catch (error) {
            setSubmitError({
                kind: 'unknown',
                title: l10n.t("We couldn't check this credential"),
                message: error instanceof Error ? error.message : String(error),
            });
            setFailedStage(0);
        }
    }, [canSubmit, chosenMethod, phase, trpcClient, values]);

    const handleDone = useCallback(async (): Promise<void> => {
        if (isCompleting) {
            return;
        }
        setIsCompleting(true);
        try {
            await trpcClient.atlasCredentials.complete.mutate();
        } catch (error) {
            setSubmitError({
                kind: 'unknown',
                title: l10n.t("We couldn't close this view"),
                message: error instanceof Error ? error.message : String(error),
            });
            setIsCompleting(false);
        }
    }, [isCompleting, trpcClient]);

    const hero = (
        <div className={styles.hero}>
            <CloudRegular aria-hidden className={styles.heroIcon} />
            <div>
                <Text as="h1" size={700} weight="semibold">
                    {isEdit ? l10n.t('Update MongoDB Atlas credentials') : l10n.t('Add a MongoDB Atlas credential')}
                </Text>
                <div>
                    <Text className={styles.muted}>
                        {l10n.t('Connect MongoDB Atlas so DocumentDB can discover your clusters.')}
                    </Text>
                </div>
            </div>
        </div>
    );

    // Once verification starts a credential may already be saved, so earlier steps stop being
    // navigable and simply show progress.
    const stepsLocked = phase === 'checking' || phase === 'success';
    const progress = (
        <Breadcrumb aria-label={l10n.t('Progress')}>
            {steps.map((step, index) => {
                const isCurrent = index === currentStepIndex;
                // "Choose method" opens pre-satisfied (a default method is always selected), so it
                // carries a check from the start - an exception unique to the first step.
                const isCompleted =
                    step.id === 'choose' || index < currentStepIndex || (step.id === 'success' && isCurrent);
                const canNavigate =
                    index < currentStepIndex && !stepsLocked && (step.id === 'choose' || step.id === 'form');
                return (
                    <Fragment key={step.id}>
                        <BreadcrumbItem>
                            <BreadcrumbButton
                                current={isCurrent}
                                disabled={!isCurrent && !canNavigate}
                                icon={
                                    isCompleted ? (
                                        <CheckmarkCircleFilled aria-hidden className={styles.breadcrumbDone} />
                                    ) : undefined
                                }
                                onClick={canNavigate ? () => goToStep(step.id) : undefined}
                            >
                                {step.label}
                            </BreadcrumbButton>
                        </BreadcrumbItem>
                        {index < steps.length - 1 && <BreadcrumbDivider />}
                    </Fragment>
                );
            })}
        </Breadcrumb>
    );

    const methodCard = (
        method: AtlasAuthMethod,
        icon: JSX.Element,
        title: string,
        qualifier: string,
        summary: string,
    ): JSX.Element => (
        <Card
            className={mergeClasses(styles.methodCard, pendingMethod === method && styles.methodCardSelected)}
            selected={pendingMethod === method}
            onSelectionChange={(_event, data) => data.selected && setPendingMethod(method)}
            floatingAction={
                <Radio checked={pendingMethod === method} onChange={() => setPendingMethod(method)} aria-label={title} />
            }
        >
            <CardHeader
                image={icon}
                header={<Text weight="semibold">{title}</Text>}
                description={
                    <Text size={200} className={styles.methodSummary}>
                        {qualifier}
                    </Text>
                }
            />
            <Body1 className={styles.methodSummary}>{summary}</Body1>
        </Card>
    );

    const methodChoice = (
        <section className={styles.section} aria-labelledby="atlas-auth-method-heading">
            <div className={styles.sectionHeader}>
                <Text id="atlas-auth-method-heading" as="h2" size={500} weight="semibold">
                    {l10n.t('Choose an authentication method')}
                </Text>
                <Text className={styles.muted}>{l10n.t('Pick how DocumentDB signs in to MongoDB Atlas.')}</Text>
            </div>
            <div className={styles.cardGrid} role="group" aria-labelledby="atlas-auth-method-heading">
                {methodCard(
                    'serviceaccount',
                    <PersonAccountsRegular aria-hidden className={styles.methodIcon} />,
                    l10n.t('Service Account'),
                    l10n.t('Recommended'),
                    l10n.t(
                        'OAuth2 client ID and secret. More secure, and the secret expires (8 hours to 365 days) so it has to be rotated periodically.',
                    ),
                )}
                {methodCard(
                    'apikey',
                    <KeyRegular aria-hidden className={styles.methodIcon} />,
                    l10n.t('API Key'),
                    l10n.t('Legacy, simplest'),
                    l10n.t('Public and private key pair. Never expires, which suits a personal, set-and-forget setup.'),
                )}
            </div>
            <div className={styles.actions}>
                <Button
                    appearance="primary"
                    disabled={!pendingMethod}
                    onClick={() => {
                        if (pendingMethod) {
                            setChosenMethod(pendingMethod);
                            setPhase('form');
                        }
                    }}
                >
                    {l10n.t('Continue')}
                </Button>
            </div>
        </section>
    );

    const guide = (
        <div className={styles.guide}>
            <div>
                <Link onClick={() => openLink(ATLAS_CONSOLE_URL)}>{l10n.t('Open MongoDB Atlas')}</Link>
                {' · '}
                <Link onClick={() => openLink(isApiKey ? ATLAS_API_KEY_DOCS_URL : ATLAS_SERVICE_ACCOUNT_DOCS_URL)}>
                    {l10n.t('View documentation')}
                </Link>
            </div>
            <details>
                <summary className={styles.guideSummary}>
                    <Body1 as="span" className={styles.guideHeading}>
                        {l10n.t('Where do I find these values?')}
                    </Body1>
                </summary>
                <ol className={styles.stepList}>
                    <li>
                        <Body1 as="span">{l10n.t('Sign in to MongoDB Atlas and select your Organization.')}</Body1>
                    </li>
                    <li>
                        <Body1 as="span">
                            {l10n.t('Under IDENTITY & ACCESS in the left sidebar, open Applications.')}
                        </Body1>
                    </li>
                    <li>
                        <Body1 as="span">
                            {isApiKey
                                ? l10n.t('Open API Keys, add a key, set its permissions, and copy both values.')
                                : l10n.t(
                                      'Open Service Accounts, add an account, set its permissions, and copy both values.',
                                  )}
                        </Body1>
                    </li>
                </ol>
            </details>
        </div>
    );

    const errorMessage = submitError ? (
        <MessageBar intent="error" layout="multiline" icon={<ErrorCircleFilled />}>
            <MessageBarBody>
                <MessageBarTitle>{submitError.title}</MessageBarTitle> {submitError.message}
            </MessageBarBody>
            <MessageBarActions>
                {submitError.action && (
                    <Button appearance="secondary" onClick={() => openLink(submitError.action!.url)}>
                        {submitError.action.label}
                    </Button>
                )}
                <Button appearance="secondary" onClick={showDetails}>
                    {l10n.t('Show details')}
                </Button>
            </MessageBarActions>
        </MessageBar>
    ) : null;

    const methodName = isApiKey
        ? l10n.t('Provide your MongoDB Atlas API Key')
        : l10n.t('Provide your MongoDB Atlas Service Account');
    const form = (
        <section className={styles.section} aria-labelledby="atlas-credential-form-heading">
            <div className={styles.formHeader}>
                <Text id="atlas-credential-form-heading" as="h2" size={500} weight="semibold">
                    {methodName}
                </Text>
                <Text className={styles.muted}>
                    {isApiKey
                        ? l10n.t('Paste the Public Key and Private Key from your MongoDB Atlas API key below.')
                        : l10n.t(
                              'Paste the Client ID and Client Secret from your MongoDB Atlas Service Account below.',
                          )}
                </Text>
            </div>
            {guide}
            {errorMessage}
            <form
                className={styles.fields}
                onSubmit={(event) => {
                    event.preventDefault();
                    void handleSubmit();
                }}
            >
                {fieldSpecs.map((spec) => (
                    <Field key={spec.key} label={spec.label} required>
                        <Input
                            type={spec.secret && !showSecret ? 'password' : 'text'}
                            value={values[spec.key] ?? ''}
                            placeholder={spec.placeholder}
                            onChange={(_event, data) =>
                                setValues((previous) => ({ ...previous, [spec.key]: data.value }))
                            }
                            contentAfter={
                                spec.secret ? (
                                    <Button
                                        type="button"
                                        className={styles.secretButton}
                                        appearance="transparent"
                                        size="small"
                                        icon={showSecret ? <EyeOffRegular /> : <EyeRegular />}
                                        aria-label={showSecret ? l10n.t('Hide secret') : l10n.t('Show secret')}
                                        onClick={() => setShowSecret((visible) => !visible)}
                                    />
                                ) : undefined
                            }
                        />
                    </Field>
                ))}
                <Text className={styles.checkHint} size={200}>
                    {l10n.t('We check these with MongoDB Atlas before saving them.')}
                </Text>
                <div className={styles.actions}>
                    {!isEdit && (
                        <Button appearance="secondary" icon={<ArrowLeftRegular />} onClick={handleBack}>
                            {l10n.t('Back')}
                        </Button>
                    )}
                    <Button type="submit" appearance="primary" disabled={!canSubmit}>
                        {l10n.t('Verify & Save')}
                    </Button>
                </div>
            </form>
        </section>
    );

    const checkFailed = phase === 'checking' && submitError !== undefined;
    const stageStatusAt = (index: number): StageStatus => {
        if (checkFailed) {
            // No spinner once it has failed: mark the step that failed (defaulting to the first)
            // and leave the rest pending.
            const failedAt = failedStage ?? 0;
            if (index < failedAt) {
                return 'done';
            }
            return index === failedAt ? 'error' : 'pending';
        }
        // Verifying: the host does not stream per-step progress, so only the first step is shown
        // active and later steps stay pending rather than pretending to have finished.
        return index === 0 ? 'active' : 'pending';
    };
    const verifyTitle = isApiKey
        ? l10n.t('Verify your MongoDB Atlas API Key')
        : l10n.t('Verify your MongoDB Atlas Service Account');
    const verifySubtitle = checkFailed
        ? l10n.t("We couldn't verify your credentials. Review the details below.")
        : l10n.t('Checking your credentials with MongoDB Atlas…');
    const checking = (
        <section className={styles.section} aria-labelledby="atlas-checking-heading">
            <div className={styles.sectionHeader}>
                <Text id="atlas-checking-heading" as="h2" size={500} weight="semibold">
                    {verifyTitle}
                </Text>
                <Text className={styles.muted}>{verifySubtitle}</Text>
            </div>
            <div className={styles.stageList} role="list" aria-label={l10n.t('Credential check progress')}>
                {checkStages.map((label, index) => (
                    <StageRow key={label} label={label} status={stageStatusAt(index)} />
                ))}
            </div>
            {checkFailed && errorMessage}
            {checkFailed && (
                <div className={styles.actions}>
                    <Button appearance="secondary" icon={<ArrowLeftRegular />} onClick={() => setPhase('form')}>
                        {l10n.t('Back')}
                    </Button>
                </div>
            )}
        </section>
    );

    const success = (
        <section className={styles.section} aria-labelledby="atlas-success-heading">
            <Text id="atlas-success-heading" as="h2" size={500} weight="semibold">
                {isEdit ? l10n.t('Credential updated') : l10n.t('Credential added')}
            </Text>
            <div className={styles.stageList} role="list" aria-label={l10n.t('Completed credential checks')}>
                {checkStages.map((label) => (
                    <StageRow key={label} label={label} status="done" />
                ))}
            </div>
            <MessageBar intent="success" layout="multiline">
                <MessageBarBody>
                    <MessageBarTitle>{l10n.t('Everything was successful.')}</MessageBarTitle>{' '}
                    {l10n.t('Your credential was checked and saved.')}
                </MessageBarBody>
            </MessageBar>
            {submitError && errorMessage}
            <div className={styles.actions}>
                <Button appearance="primary" disabled={isCompleting} onClick={() => void handleDone()}>
                    {isCompleting ? l10n.t('Closing…') : l10n.t('Close')}
                </Button>
            </div>
        </section>
    );

    return (
        <main className={styles.root}>
            <Announcer when={phase === 'checking'} message={l10n.t('Checking your MongoDB Atlas credential.')} />
            <Announcer
                when={phase === 'success'}
                message={l10n.t('Everything was successful. Your credential was checked and saved.')}
            />
            <Announcer
                when={submitError !== undefined}
                message={submitError ? `${submitError.title}. ${submitError.message}` : ''}
                politeness="assertive"
            />
            {hero}
            {progress}
            {phase === 'choose' && methodChoice}
            {phase === 'form' && form}
            {phase === 'checking' && checking}
            {phase === 'success' && success}
        </main>
    );
};
