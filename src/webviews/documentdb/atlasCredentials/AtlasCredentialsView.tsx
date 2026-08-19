/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Accordion,
    AccordionHeader,
    AccordionItem,
    AccordionPanel,
    Body1,
    Button,
    Card,
    CardHeader,
    Field,
    Input,
    Link,
    makeStyles,
    mergeClasses,
    Radio,
    Text,
    tokens,
} from '@fluentui/react-components';
import {
    CloudRegular,
    ErrorCircleFilled,
    EyeOffRegular,
    EyeRegular,
    KeyRegular,
    PersonAccountsRegular,
    WarningRegular,
} from '@fluentui/react-icons';
import {
    ContainerFooter,
    ContainerHeader,
    StatusList,
    StatusListItem,
    type StatusListItemStatus,
    Wizard,
    WizardStep,
} from '@microsoft/vscode-ext-webview-fluentui/components';
import { useConfiguration } from '@microsoft/vscode-ext-webview/react';
import * as l10n from '@vscode/l10n';
import { Fragment, type JSX, useCallback, useMemo, useState } from 'react';
import { type AtlasAuthMethod } from '../../../plugins/service-atlas-mongodb/auth/AtlasSession';
import { useTrpcClient } from '../../_integration/useTrpcClient';
import { Announcer } from '../../components/accessibility/Announcer';
import { MessageBlock } from '../../components/MessageBlock';
import './atlasCredentials.scss';
import { type AtlasCredentialsWebviewConfig } from './atlasCredentialsController';
import { type CredentialSubmitError } from './atlasCredentialsRouter';

const ATLAS_CONSOLE_URL = 'https://cloud.mongodb.com/';
const ATLAS_LEARN_MORE_URL = 'https://aka.ms/vscode-documentdb-atlas-discovery';

type Phase = 'choose' | 'form' | 'checking' | 'success';

// Renders a localized sentence, bolding any segment wrapped in **double asterisks**. Keeping the
// emphasis markers inside the l10n string lets translators move the bold keywords naturally.
const renderWithEmphasis = (text: string): JSX.Element[] =>
    text
        .split(/(\*\*[^*]+\*\*)/g)
        .filter((segment) => segment.length > 0)
        .map((segment, index) =>
            segment.startsWith('**') && segment.endsWith('**') ? (
                <strong key={index}>{segment.slice(2, -2)}</strong>
            ) : (
                <Fragment key={index}>{segment}</Fragment>
            ),
        );

const useStyles = makeStyles({
    muted: { color: tokens.colorNeutralForeground2 },
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
    /** The numbered walkthrough inside the guide accordion — not the wizard's own step indicator. */
    guideStepList: {
        margin: 0,
        paddingLeft: '20px',
        color: tokens.colorNeutralForeground2,
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
    },
    guideHeaderBrand: { color: tokens.colorBrandForeground1 },
    fields: { display: 'flex', flexDirection: 'column', gap: '14px' },
    secretButton: { minWidth: '28px' },
});

interface FieldSpec {
    readonly key: 'publicKey' | 'privateKey' | 'clientId' | 'clientSecret';
    readonly label: string;
    readonly placeholder: string;
    readonly secret: boolean;
}

/** The word a screen reader hears after each check's label. The package defaults to English. */
function stageStatusWords(): Partial<Record<StatusListItemStatus, string>> {
    return {
        pending: l10n.t('pending'),
        active: l10n.t('in progress'),
        done: l10n.t('done'),
        error: l10n.t('failed'),
        warning: l10n.t('warning'),
    };
}

export const AtlasCredentialsView = (): JSX.Element => {
    const configuration = useConfiguration<AtlasCredentialsWebviewConfig>();
    const trpcClient = useTrpcClient();
    const styles = useStyles();
    const initialMethod = configuration.authMethod;
    const [phase, setPhase] = useState<Phase>(initialMethod ? 'form' : 'choose');
    const [chosenMethod, setChosenMethod] = useState<AtlasAuthMethod | undefined>(initialMethod);
    const [pendingMethod, setPendingMethod] = useState<AtlasAuthMethod | undefined>(initialMethod ?? 'serviceaccount');
    const [values, setValues] = useState<Record<string, string>>((): Record<string, string> => {
        if (!configuration.credentialIdentity) {
            return {};
        }
        return configuration.authMethod === 'apikey'
            ? { publicKey: configuration.credentialIdentity }
            : { clientId: configuration.credentialIdentity };
    });
    const [submitError, setSubmitError] = useState<CredentialSubmitError | undefined>();
    const [showSecret, setShowSecret] = useState(false);
    const [isCompleting, setIsCompleting] = useState(false);
    const [failedStage, setFailedStage] = useState<number | undefined>(undefined);
    const isApiKey = chosenMethod === 'apikey';
    const isEdit = configuration.mode === 'edit';

    // Step order. Edit mode opens straight on the form, so it drops the "Choose method" step; both
    // flows end on "Done". The order is what the completed / navigable rules below index into.
    const stepIds: readonly Phase[] = useMemo(
        () => (isEdit ? ['form', 'checking', 'success'] : ['choose', 'form', 'checking', 'success']),
        [isEdit],
    );
    const currentStepIndex = stepIds.indexOf(phase);

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

    const stageStatusLabels = useMemo(() => stageStatusWords(), []);

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
        (id: string): void => {
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
        // Allow a first submit from the form, or a retry from the verify screen (which stays on
        // 'checking' with the error shown) - for example after the user fixes an Atlas access list.
        const canRetry = phase === 'checking' && submitError !== undefined;
        if (!chosenMethod || !canSubmit || (phase !== 'form' && !canRetry)) {
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
    }, [canSubmit, chosenMethod, phase, submitError, trpcClient, values]);

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

    const handleCancel = useCallback((): void => {
        void trpcClient.atlasCredentials.cancel.mutate();
    }, [trpcClient]);

    const header = (
        <ContainerHeader
            media={<CloudRegular aria-hidden />}
            title={isEdit ? l10n.t('Update MongoDB Atlas connection') : l10n.t('Add a MongoDB Atlas connection')}
            subtitle={l10n.t(
                'Connect MongoDB Atlas to browse, open, and manage your clusters without leaving VS Code.',
            )}
        />
    );

    // Keep earlier steps locked while verification is active or after the credential is saved.
    // A failed check unlocks them so the user can return through either step.
    const stepsLocked = phase === 'success' || (phase === 'checking' && submitError === undefined);
    // Both rules differ from the wizard's defaults, so they are passed per step. "Choose method"
    // opens pre-satisfied because a default method is always selected — an exception unique to that
    // step, and one that must NOT carry over to whichever step is first in edit mode. Navigation is
    // restricted to the two pre-verify steps: once checking starts a credential may already be saved.
    const isStepCompleted = (id: Phase): boolean => {
        const index = stepIds.indexOf(id);
        return id === 'choose' || index < currentStepIndex || (id === 'success' && index === currentStepIndex);
    };
    const isStepNavigable = (id: Phase): boolean =>
        stepIds.indexOf(id) < currentStepIndex && !stepsLocked && (id === 'choose' || id === 'form');

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
                <Radio
                    checked={pendingMethod === method}
                    onChange={() => setPendingMethod(method)}
                    aria-label={title}
                />
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
        <div className={styles.cardGrid} role="group" aria-label={l10n.t('Choose an authentication method')}>
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
    );

    const guideSteps = (
        <ol className={styles.guideStepList}>
            <li>
                <Body1 as="span">
                    {l10n.t('Sign in to')}{' '}
                    <Link onClick={() => openLink(ATLAS_CONSOLE_URL)}>{l10n.t('MongoDB Atlas')}</Link>{' '}
                    {renderWithEmphasis(l10n.t('and select your **organization**.'))}
                </Body1>
            </li>
            <li>
                <Body1 as="span">
                    {renderWithEmphasis(
                        l10n.t('In the left sidebar, under **Identity & Access**, open **Applications**.'),
                    )}
                </Body1>
            </li>
            <li>
                <Body1 as="span">
                    {isApiKey
                        ? renderWithEmphasis(
                              l10n.t(
                                  'Go to **API Keys**, create a key, set its permissions, then copy the **Public Key** and **Private Key**.',
                              ),
                          )
                        : renderWithEmphasis(
                              l10n.t(
                                  'Go to **Service Accounts**, create one, set its permissions, then copy the **Client ID** and **Client Secret**.',
                              ),
                          )}
                </Body1>
            </li>
        </ol>
    );

    const guide = (
        <Accordion collapsible>
            <AccordionItem value="guide">
                <AccordionHeader>
                    <Text weight="semibold" className={styles.guideHeaderBrand}>
                        {l10n.t('Where do I find these values?')}
                    </Text>
                </AccordionHeader>
                <AccordionPanel>{guideSteps}</AccordionPanel>
            </AccordionItem>
        </Accordion>
    );

    const isNoProjectsWarning = submitError?.kind === 'noProjects';
    const errorMessage = submitError ? (
        <MessageBlock
            intent={isNoProjectsWarning ? 'warning' : 'error'}
            icon={isNoProjectsWarning ? <WarningRegular /> : <ErrorCircleFilled />}
            title={submitError.title}
            actions={
                <>
                    {submitError.action && (
                        <Button appearance="secondary" onClick={() => openLink(submitError.action!.url)}>
                            {submitError.action.label}
                        </Button>
                    )}
                    {submitError.action && (
                        <Button appearance="secondary" onClick={() => void handleSubmit()}>
                            {l10n.t('Retry')}
                        </Button>
                    )}
                    {!isNoProjectsWarning && (
                        <Button appearance="secondary" onClick={showDetails}>
                            {l10n.t('Show details')}
                        </Button>
                    )}
                </>
            }
        >
            {submitError.message}
        </MessageBlock>
    ) : null;

    const methodName = isApiKey
        ? l10n.t('Provide your MongoDB Atlas API Key')
        : l10n.t('Provide your MongoDB Atlas Service Account');
    const form = (
        <form
            className={styles.fields}
            onSubmit={(event) => {
                event.preventDefault();
                void handleSubmit();
            }}
        >
            {fieldSpecs.map((spec) => (
                <Field
                    key={spec.key}
                    label={spec.label}
                    required
                    hint={
                        isEdit && !spec.secret
                            ? isApiKey
                                ? l10n.t('To use a different Public Key, sign out and add a new credential.')
                                : l10n.t('To use a different Client ID, sign out and add a new credential.')
                            : undefined
                    }
                >
                    <Input
                        type={spec.secret && !showSecret ? 'password' : 'text'}
                        value={values[spec.key] ?? ''}
                        placeholder={spec.placeholder}
                        disabled={isEdit && !spec.secret}
                        onChange={
                            isEdit && !spec.secret
                                ? undefined
                                : (_event, data) => setValues((previous) => ({ ...previous, [spec.key]: data.value }))
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
            {guide}
            {/* Submit stays inside the form so Enter works; the visible button lives in the footer. */}
            <button type="submit" hidden disabled={!canSubmit} />
        </form>
    );

    const checkFailed = phase === 'checking' && submitError !== undefined;
    const stageStatusAt = (index: number): StatusListItemStatus => {
        if (checkFailed) {
            // No spinner once it has failed: mark the step that failed (defaulting to the first)
            // and leave the rest pending.
            const failedAt = failedStage ?? 0;
            if (index < failedAt) {
                return 'done';
            }
            if (index === failedAt) {
                return isNoProjectsWarning ? 'warning' : 'error';
            }
            return 'pending';
        }
        // Verifying: the host does not stream per-step progress, so only the first step is shown
        // active and later steps stay pending rather than pretending to have finished.
        return index === 0 ? 'active' : 'pending';
    };
    const verifyTitle = isApiKey
        ? l10n.t('Verify your MongoDB Atlas API Key')
        : l10n.t('Verify your MongoDB Atlas Service Account');
    // A standard lead-in shown under the title in every verify state; it introduces the check list
    // below without narrating live progress.
    const verifySubtitle = l10n.t('We check your credentials with MongoDB Atlas before saving your connection.');
    const checking = (
        <>
            <StatusList ariaLabel={l10n.t('Credential check progress')} statusLabels={stageStatusLabels}>
                {checkStages.map((label, index) => (
                    <StatusListItem key={label} label={label} status={stageStatusAt(index)} />
                ))}
            </StatusList>
            {checkFailed && (
                <Text className={styles.muted}>
                    {l10n.t("We couldn't verify your credentials. Review the details below.")}
                </Text>
            )}
            {checkFailed && errorMessage}
        </>
    );

    const success = (
        <>
            <StatusList ariaLabel={l10n.t('Completed credential checks')} statusLabels={stageStatusLabels}>
                {checkStages.map((label) => (
                    <StatusListItem key={label} label={label} status="done" />
                ))}
            </StatusList>
            <Text>
                {l10n.t(
                    'You can now close this tab and explore your MongoDB Atlas clusters in the Service Discovery area.',
                )}
            </Text>
            <MessageBlock intent="success" title={l10n.t('All set')}>
                {l10n.t('Your credential was successfully checked and saved, and is ready to use.')}
            </MessageBlock>
            {submitError && errorMessage}
        </>
    );

    // Standardized navigation footer: primary action first, then Cancel on the first step or Back
    // on later steps. Back remains disabled while verification is in flight and on success.
    let primaryLabel: string;
    let primaryDisabled: boolean;
    let onPrimary: () => void;
    let secondaryLabel = l10n.t('Back');
    let backDisabled: boolean;
    let onBack: () => void = handleBack;

    if (phase === 'choose') {
        primaryLabel = l10n.t('Continue');
        primaryDisabled = !pendingMethod;
        onPrimary = () => {
            if (pendingMethod) {
                setChosenMethod(pendingMethod);
                setPhase('form');
            }
        };
        secondaryLabel = l10n.t('Cancel');
        backDisabled = false;
        onBack = handleCancel;
    } else if (phase === 'form') {
        primaryLabel = l10n.t('Verify & Save');
        primaryDisabled = !canSubmit;
        onPrimary = () => void handleSubmit();
        backDisabled = isEdit;
    } else if (phase === 'checking') {
        // Primary stays "Verify & Save" (disabled) whether verifying or failed, so its width is
        // constant and Back does not shift. Retry lives in the error MessageBar, next to the details.
        primaryLabel = l10n.t('Verify & Save');
        primaryDisabled = true;
        onPrimary = () => undefined;
        if (checkFailed) {
            backDisabled = false;
            onBack = () => {
                setSubmitError(undefined);
                setFailedStage(undefined);
                setPhase('form');
            };
        } else {
            backDisabled = true;
        }
    } else {
        primaryLabel = isCompleting ? l10n.t('Closing…') : l10n.t('Close');
        primaryDisabled = isCompleting;
        onPrimary = () => void handleDone();
        backDisabled = true;
    }

    const footer = (
        <ContainerFooter
            contentEnd={
                <Button appearance="secondary" onClick={() => openLink(ATLAS_LEARN_MORE_URL)}>
                    {l10n.t('Learn more')}
                </Button>
            }
        >
            <Button appearance="primary" disabled={primaryDisabled} onClick={onPrimary}>
                {primaryLabel}
            </Button>
            <Button appearance="secondary" disabled={backDisabled} onClick={onBack}>
                {secondaryLabel}
            </Button>
        </ContainerFooter>
    );

    return (
        <>
            {/* Out of the wizard's flow: every announcer is absolutely positioned and must stay
                mounted across step changes, or the false → true transition it listens for is lost. */}
            <Announcer when={phase === 'form'} message={l10n.t('Enter your MongoDB Atlas credential details.')} />
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
            <Wizard
                activeStep={phase}
                onStepChange={goToStep}
                stepsAriaLabel={l10n.t('Credential setup progress')}
                overflowAriaLabel={(count) => l10n.t('{0} more steps', String(count))}
                header={header}
                footer={footer}
            >
                {/* Edit mode opens straight on the form, so it drops this step entirely. */}
                {!isEdit && (
                    <WizardStep
                        value="choose"
                        label={l10n.t('Choose method')}
                        title={l10n.t('Choose an authentication method')}
                        subtitle={l10n.t('Pick how we sign in to MongoDB Atlas.')}
                        completed={isStepCompleted('choose')}
                        navigable={isStepNavigable('choose')}
                    >
                        {methodChoice}
                    </WizardStep>
                )}
                <WizardStep
                    value="form"
                    label={l10n.t('Enter details')}
                    title={methodName}
                    subtitle={
                        isApiKey
                            ? l10n.t(
                                  'Copy the Public Key and Private Key from an API Key in MongoDB Atlas. We use them to sign in and show the clusters you can access.',
                              )
                            : l10n.t(
                                  'Copy the Client ID and Client Secret from a Service Account in MongoDB Atlas. We use them to sign in and show the clusters you can access.',
                              )
                    }
                    completed={isStepCompleted('form')}
                    navigable={isStepNavigable('form')}
                >
                    {form}
                </WizardStep>
                <WizardStep
                    value="checking"
                    label={l10n.t('Verify')}
                    title={verifyTitle}
                    subtitle={verifySubtitle}
                    completed={isStepCompleted('checking')}
                    navigable={isStepNavigable('checking')}
                >
                    {checking}
                </WizardStep>
                <WizardStep
                    value="success"
                    label={l10n.t('Done')}
                    title={isEdit ? l10n.t('Credential updated') : l10n.t('Credential added')}
                    subtitle={l10n.t('Everything checked out with MongoDB Atlas.')}
                    completed={isStepCompleted('success')}
                    navigable={isStepNavigable('success')}
                >
                    {success}
                </WizardStep>
            </Wizard>
        </>
    );
};
