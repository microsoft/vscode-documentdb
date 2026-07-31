/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Accordion,
    AccordionHeader,
    AccordionItem,
    AccordionPanel,
    // USER-TEST PROTOTYPE: Remove with the footer experiment preview badge.
    Badge,
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
    Menu,
    MenuItem,
    MenuList,
    MenuPopover,
    MenuTrigger,
    mergeClasses,
    MessageBar,
    MessageBarActions,
    MessageBarBody,
    MessageBarTitle,
    Overflow,
    OverflowDivider,
    OverflowItem,
    Radio,
    Spinner,
    // USER-TEST PROTOTYPE: Remove with the footer experiment comparison switch.
    Switch,
    Text,
    tokens,
    useIsOverflowItemVisible,
    useOverflowMenu,
} from '@fluentui/react-components';
import {
    ArrowLeftRegular,
    bundleIcon,
    CheckmarkCircleFilled,
    CircleHintFilled,
    CloudRegular,
    ErrorCircleFilled,
    EyeOffRegular,
    EyeRegular,
    KeyRegular,
    MoreHorizontalFilled,
    MoreHorizontalRegular,
    PersonAccountsRegular,
    WarningRegular,
} from '@fluentui/react-icons';
import { useConfiguration } from '@microsoft/vscode-ext-webview/react';
import * as l10n from '@vscode/l10n';
import { Fragment, type JSX, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type AtlasAuthMethod } from '../../../plugins/service-atlas-mongodb/auth/AtlasSession';
import { useTrpcClient } from '../../_integration/useTrpcClient';
import { Announcer } from '../../components/accessibility/Announcer';
import './atlasCredentials.scss';
import { type AtlasCredentialsWebviewConfig } from './atlasCredentialsController';
import { type CredentialSubmitError } from './atlasCredentialsRouter';

const ATLAS_CONSOLE_URL = 'https://cloud.mongodb.com/';

const MoreHorizontal = bundleIcon(MoreHorizontalFilled, MoreHorizontalRegular);

type Phase = 'choose' | 'form' | 'checking' | 'success';
type StageStatus = 'pending' | 'active' | 'done' | 'error' | 'warning';

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
    root: {
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        overflow: 'hidden',
        // USER-TEST PROTOTYPE: Anchors the temporary comparison switch.
        position: 'relative',
    },
    scrollArea: {
        flex: 1,
        minHeight: 0,
        overflowY: 'auto',
    },
    // USER-TEST PROTOTYPE: Remove both styles with the comparison switch and measurement logic.
    scrollAreaInlineFooter: {
        flex: '0 0 auto',
        overflowY: 'visible',
    },
    prototypeToggle: {
        position: 'absolute',
        top: '16px',
        right: '24px',
        zIndex: 1,
        padding: '4px 8px',
        backgroundColor: tokens.colorNeutralBackground1,
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
    },
    content: {
        display: 'flex',
        flexDirection: 'column',
        gap: '20px',
        maxWidth: '760px',
        padding: '24px',
    },
    hero: { display: 'flex', alignItems: 'center', gap: '16px' },
    heroIcon: { color: tokens.colorBrandForeground1, fontSize: '56px', flexShrink: 0 },
    muted: { color: tokens.colorNeutralForeground2 },
    section: { display: 'flex', flexDirection: 'column', gap: '12px' },
    sectionHeader: { display: 'flex', flexDirection: 'column', gap: '4px' },
    breadcrumbDone: { color: tokens.colorPaletteGreenForeground1, fontSize: '16px' },
    // Inherit the breadcrumb button's own text colour, so the hint dot matches whatever state the
    // step is in (the active/current item gets its colour for free).
    breadcrumbPending: { color: 'inherit', fontSize: '16px' },
    // Keep completed steps bold. Fluent only bolds the `current` item, so a step dropped back to
    // regular weight when it stopped being current, and the width change shifted the whole row.
    breadcrumbButtonDone: { fontWeight: tokens.fontWeightSemibold },
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
    // Navigation footer. The prototype keeps the existing elevation only while docked content overflows.
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
    formHeader: { display: 'flex', flexDirection: 'column', gap: '8px' },
    stepList: {
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
    stageWarning: { color: tokens.colorStatusWarningForeground1, fontSize: '18px', flexShrink: 0 },
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
    } else if (status === 'warning') {
        icon = <WarningRegular aria-hidden className={styles.stageWarning} />;
        statusText = l10n.t('warning');
    } else {
        icon = <CircleHintFilled aria-hidden className={styles.stagePending} />;
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

// A step's derived breadcrumb state, shared by the inline items and the overflow menu.
interface StepMeta {
    readonly id: Phase;
    readonly label: string;
    readonly isCurrent: boolean;
    readonly isCompleted: boolean;
    readonly canNavigate: boolean;
}

// Renders a hidden (overflowed) step as a menu item; visible steps render nothing here.
const StepOverflowMenuItem = ({
    step,
    onNavigate,
}: {
    readonly step: StepMeta;
    readonly onNavigate: (id: Phase) => void;
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

// The "…" breadcrumb entry that collects steps hidden by overflow. Renders nothing until overflow.
const StepOverflowMenu = ({
    steps,
    onNavigate,
}: {
    readonly steps: readonly StepMeta[];
    readonly onNavigate: (id: Phase) => void;
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

    // On step change, move focus to the new step's heading so screen-reader and keyboard users land
    // on the fresh content instead of focus falling back to <body>. Skipped on the initial render.
    const contentRef = useRef<HTMLDivElement>(null);
    const isInitialRender = useRef(true);
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
    }, [phase]);

    // USER-TEST PROTOTYPE START: Footer experiment comparison. Remove this state, root/footer refs,
    // measurement callback, prototype switch, and scrollAreaInlineFooter class after user testing.
    // Off by default: the experimental adaptive footer position is opt-in via the preview switch.
    const [adaptiveFooterEnabled, setAdaptiveFooterEnabled] = useState(false);
    const [footerDocked, setFooterDocked] = useState(true);
    const rootRef = useRef<HTMLElement>(null);
    const scrollAreaRef = useRef<HTMLDivElement>(null);
    const footerRef = useRef<HTMLDivElement>(null);
    const [footerElevated, setFooterElevated] = useState(false);
    const updateFooterLayout = useCallback((): void => {
        const root = rootRef.current;
        const scrollArea = scrollAreaRef.current;
        const content = contentRef.current;
        const footer = footerRef.current;
        if (root && scrollArea && content && footer) {
            const contentOverflows = content.scrollHeight + footer.offsetHeight > root.clientHeight;
            const shouldDock = !adaptiveFooterEnabled || contentOverflows;
            setFooterDocked(shouldDock);
            setFooterElevated(
                shouldDock && scrollArea.scrollTop + scrollArea.clientHeight < scrollArea.scrollHeight - 1,
            );
        }
    }, [adaptiveFooterEnabled]);
    useEffect(() => {
        const root = rootRef.current;
        const el = scrollAreaRef.current;
        const content = contentRef.current;
        const footer = footerRef.current;
        if (!root || !el || !content || !footer) {
            return;
        }
        const observer = new ResizeObserver(updateFooterLayout);
        observer.observe(root);
        observer.observe(el);
        observer.observe(content);
        observer.observe(footer);
        return () => observer.disconnect();
    }, [updateFooterLayout, phase]);
    // USER-TEST PROTOTYPE END

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

    const hero = (
        <div className={styles.hero}>
            <CloudRegular aria-hidden className={styles.heroIcon} />
            <div>
                <Text as="h1" size={700} weight="semibold">
                    {isEdit ? l10n.t('Update MongoDB Atlas connection') : l10n.t('Add a MongoDB Atlas connection')}
                </Text>
                <div>
                    <Text className={styles.muted}>
                        {l10n.t(
                            'Connect MongoDB Atlas to browse, open, and manage your clusters without leaving VS Code.',
                        )}
                    </Text>
                </div>
            </div>
        </div>
    );

    // Keep earlier steps locked while verification is active or after the credential is saved.
    // A failed check unlocks them so the user can return through either breadcrumb.
    const stepsLocked = phase === 'success' || (phase === 'checking' && submitError === undefined);
    const stepItems: StepMeta[] = steps.map((step, index) => {
        const isCurrent = index === currentStepIndex;
        // "Choose method" opens pre-satisfied (a default method is always selected), so it carries a
        // check from the start - an exception unique to the first step.
        const isCompleted = step.id === 'choose' || index < currentStepIndex || (step.id === 'success' && isCurrent);
        const canNavigate = index < currentStepIndex && !stepsLocked && (step.id === 'choose' || step.id === 'form');
        return { id: step.id, label: step.label, isCurrent, isCompleted, canNavigate };
    });
    // Responsive breadcrumb: when it doesn't fit, steps collapse into a "…" menu. The current step is
    // given the highest priority so it is the last item overflow ever removes - it never hides.
    const progress = (
        <Overflow minimumVisible={1}>
            <Breadcrumb aria-label={l10n.t('Credential setup progress')}>
                {stepItems.map((step, index) => (
                    <Fragment key={step.id}>
                        <OverflowItem
                            id={step.id}
                            groupId={step.id}
                            priority={step.isCurrent ? stepItems.length + 1 : 0}
                        >
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
                                    onClick={step.canNavigate ? () => goToStep(step.id) : undefined}
                                >
                                    {step.label}
                                </BreadcrumbButton>
                            </BreadcrumbItem>
                        </OverflowItem>
                        {index < stepItems.length - 1 && (
                            <OverflowDivider groupId={step.id}>
                                <BreadcrumbDivider />
                            </OverflowDivider>
                        )}
                    </Fragment>
                ))}
                <StepOverflowMenu steps={stepItems} onNavigate={goToStep} />
            </Breadcrumb>
        </Overflow>
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
        <section className={styles.section} aria-labelledby="atlas-auth-method-heading">
            <div className={styles.sectionHeader}>
                <Text id="atlas-auth-method-heading" as="h2" size={500} weight="semibold">
                    {l10n.t('Choose an authentication method')}
                </Text>
                <Text className={styles.muted}>{l10n.t('Pick how we sign in to MongoDB Atlas.')}</Text>
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
        </section>
    );

    const guideSteps = (
        <ol className={styles.stepList}>
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
        <MessageBar
            intent={isNoProjectsWarning ? 'warning' : 'error'}
            layout="multiline"
            icon={isNoProjectsWarning ? <WarningRegular /> : <ErrorCircleFilled />}
        >
            <MessageBarBody>
                <MessageBarTitle>{submitError.title}</MessageBarTitle> {submitError.message}
            </MessageBarBody>
            <MessageBarActions>
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
                        ? l10n.t(
                              'Copy the Public Key and Private Key from an API Key in MongoDB Atlas. We use them to sign in and show the clusters you can access.',
                          )
                        : l10n.t(
                              'Copy the Client ID and Client Secret from a Service Account in MongoDB Atlas. We use them to sign in and show the clusters you can access.',
                          )}
                </Text>
            </div>
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
                                    : (_event, data) =>
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
                {guide}
                {/* Submit stays inside the form so Enter works; the visible button lives in the footer. */}
                <button type="submit" hidden disabled={!canSubmit} />
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
            {checkFailed && (
                <Text className={styles.muted}>
                    {l10n.t("We couldn't verify your credentials. Review the details below.")}
                </Text>
            )}
            {checkFailed && errorMessage}
        </section>
    );

    const success = (
        <section className={styles.section} aria-labelledby="atlas-success-heading">
            <div className={styles.sectionHeader}>
                <Text id="atlas-success-heading" as="h2" size={500} weight="semibold">
                    {isEdit ? l10n.t('Credential updated') : l10n.t('Credential added')}
                </Text>
                <Text className={styles.muted}>{l10n.t('Everything checked out with MongoDB Atlas.')}</Text>
            </div>
            <div className={styles.stageList} role="list" aria-label={l10n.t('Completed credential checks')}>
                {checkStages.map((label) => (
                    <StageRow key={label} label={label} status="done" />
                ))}
            </div>
            <Text>
                {l10n.t(
                    'You can now close this tab and explore your MongoDB Atlas clusters in the Service Discovery area.',
                )}
            </Text>
            <MessageBar intent="success">
                <MessageBarBody>
                    <MessageBarTitle>{l10n.t('All set')}</MessageBarTitle>{' '}
                    {l10n.t('Your credential was successfully checked and saved, and is ready to use.')}
                </MessageBarBody>
            </MessageBar>
            {submitError && errorMessage}
        </section>
    );

    // Standardized navigation footer: primary action first, then Back. Back is always shown and is
    // disabled where there is nowhere to go back to (first step, mid-verify, and on success).
    let primaryLabel: string;
    let primaryDisabled: boolean;
    let onPrimary: () => void;
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
        backDisabled = true;
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
        <div ref={footerRef} className={mergeClasses(styles.footer, footerElevated && styles.footerElevated)}>
            <Button appearance="primary" disabled={primaryDisabled} onClick={onPrimary}>
                {primaryLabel}
            </Button>
            <Button appearance="secondary" icon={<ArrowLeftRegular />} disabled={backDisabled} onClick={onBack}>
                {l10n.t('Back')}
            </Button>
        </div>
    );

    return (
        <main ref={rootRef} className={styles.root}>
            {/* USER-TEST PROTOTYPE: Remove this switch and badge with the footer experiment logic above. */}
            <div className={styles.prototypeToggle}>
                <Switch
                    checked={adaptiveFooterEnabled}
                    label={l10n.t('Footer experiment')}
                    onChange={(_event, data) => setAdaptiveFooterEnabled(data.checked)}
                />
                <Badge
                    appearance="tint"
                    size="small"
                    shape="rounded"
                    color="brand"
                    aria-label={l10n.t('Footer experiment is in preview')}
                >
                    PREVIEW
                </Badge>
            </div>
            <div
                className={mergeClasses(
                    styles.scrollArea,
                    adaptiveFooterEnabled && !footerDocked && styles.scrollAreaInlineFooter,
                )}
                ref={scrollAreaRef}
                onScroll={updateFooterLayout}
            >
                <div ref={contentRef} className={styles.content}>
                    <Announcer
                        when={phase === 'form'}
                        message={l10n.t('Enter your MongoDB Atlas credential details.')}
                    />
                    <Announcer
                        when={phase === 'checking'}
                        message={l10n.t('Checking your MongoDB Atlas credential.')}
                    />
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
                </div>
            </div>
            {footer}
        </main>
    );
};
