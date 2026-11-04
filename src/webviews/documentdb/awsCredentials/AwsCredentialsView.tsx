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
    Dropdown,
    Field,
    Input,
    Link,
    makeStyles,
    mergeClasses,
    Option,
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
    TimerRegular,
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
import { type JSX, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AWS_REGIONS } from '../../../plugins/service-aws-documentdb/discovery/regions';
import {
    type AwsAuthMethod,
    type AwsCredentialRecord,
    type AwsProfile,
    type AwsSsoAccount,
    type AwsSsoStart,
} from '../../../plugins/service-aws-documentdb/types';
import { useTrpcClient } from '../../_integration/useTrpcClient';
import { Announcer } from '../../components/accessibility/Announcer';
import { MessageBlock } from '../../components/MessageBlock';
import './awsCredentials.scss';
import { type AwsCredentialsWebviewConfig } from './awsCredentialsController';
import { type CredentialSubmitError, type CredentialSubmitInput } from './awsCredentialsRouter';

const LEARN_MORE_URL = 'https://docs.aws.amazon.com/documentdb/latest/developerguide/security-iam.html';
type Phase = 'choose' | 'form' | 'checking' | 'success';

const useStyles = makeStyles({
    muted: { color: tokens.colorNeutralForeground2 },
    cardGrid: {
        display: 'grid',
        gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
        gap: '12px',
        '@media (max-width: 640px)': { gridTemplateColumns: '1fr' },
    },
    methodCard: { cursor: 'pointer', height: '100%' },
    methodCardSelected: { outline: `2px solid ${tokens.colorBrandStroke1}`, outlineOffset: '-1px' },
    methodIcon: { color: tokens.colorBrandForeground1, fontSize: '24px' },
    methodSummary: { color: tokens.colorNeutralForeground2 },
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

function waitForPoll(milliseconds: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        if (signal.aborted) {
            reject(new Error('Cancelled'));
            return;
        }
        const abort = (): void => {
            clearTimeout(timer);
            reject(new Error('Cancelled'));
        };
        const timer = setTimeout(() => {
            signal.removeEventListener('abort', abort);
            resolve();
        }, milliseconds);
        signal.addEventListener('abort', abort, { once: true });
    });
}

export const AwsCredentialsView = (): JSX.Element => {
    const configuration = useConfiguration<AwsCredentialsWebviewConfig>();
    const trpcClient = useTrpcClient();
    const styles = useStyles();
    const isEdit = configuration.mode === 'edit';
    const [phase, setPhase] = useState<Phase>(configuration.authMethod ? 'form' : 'choose');
    const [chosenMethod, setChosenMethod] = useState<AwsAuthMethod>(configuration.authMethod ?? 'profile');
    const [pendingMethod, setPendingMethod] = useState<AwsAuthMethod>(configuration.authMethod ?? 'profile');
    const [values, setValues] = useState<Record<string, string>>({
        label: configuration.label ?? '',
        profile: configuration.profile ?? '',
        startUrl: configuration.startUrl ?? '',
        ssoRegion: configuration.ssoRegion ?? 'us-east-1',
    });
    const [regions, setRegions] = useState<string[]>(configuration.regions ?? ['us-east-1']);
    const [profiles, setProfiles] = useState<AwsProfile[]>([]);
    const [profileLoading, setProfileLoading] = useState(false);
    const [profileError, setProfileError] = useState(false);
    const [profileRevision, setProfileRevision] = useState(0);
    const [submitError, setSubmitError] = useState<CredentialSubmitError>();
    const [showSecret, setShowSecret] = useState(false);
    const [busy, setBusy] = useState(false);
    const [isCompleting, setIsCompleting] = useState(false);
    const [flow, setFlow] = useState<AwsSsoStart>();
    const [accounts, setAccounts] = useState<AwsSsoAccount[]>();
    const [roles, setRoles] = useState<string[]>([]);
    const [credential, setCredential] = useState<AwsCredentialRecord>();
    const operationRef = useRef<AbortController | undefined>(undefined);
    const flowRef = useRef<AwsSsoStart | undefined>(undefined);
    const mountedRef = useRef(true);

    useEffect(() => {
        mountedRef.current = true;
        return (): void => {
            mountedRef.current = false;
            operationRef.current?.abort();
        };
    }, []);

    useEffect(() => {
        const controller = new AbortController();
        setProfileLoading(true);
        setProfileError(false);
        const load = async (): Promise<void> => {
            try {
                const result = await trpcClient.awsCredentials.listProfiles.query(undefined, {
                    signal: controller.signal,
                });
                if (!controller.signal.aborted) {
                    setProfiles(result);
                    setValues((previous) => ({
                        ...previous,
                        profile:
                            previous.profile ||
                            result.find((profile) => profile.name === 'default')?.name ||
                            result[0]?.name ||
                            '',
                    }));
                }
            } catch {
                if (!controller.signal.aborted) {
                    setProfileError(true);
                }
            } finally {
                if (!controller.signal.aborted) {
                    setProfileLoading(false);
                }
            }
        };
        void load();
        return (): void => controller.abort();
    }, [trpcClient, profileRevision]);

    const runOperation = useCallback(async (operation: (signal: AbortSignal) => Promise<void>): Promise<void> => {
        operationRef.current?.abort();
        const controller = new AbortController();
        operationRef.current = controller;
        setBusy(true);
        setSubmitError(undefined);
        try {
            await operation(controller.signal);
        } catch (error) {
            if (!controller.signal.aborted && mountedRef.current) {
                setSubmitError({
                    title: l10n.t("We couldn't complete AWS sign-in"),
                    message:
                        error instanceof Error
                            ? error.message
                            : l10n.t('Check your sign-in details, network, and AWS permissions, then retry.'),
                });
            }
        } finally {
            if (operationRef.current === controller && mountedRef.current) {
                setBusy(false);
            }
        }
    }, []);

    const clearFlow = async (): Promise<void> => {
        flowRef.current = undefined;
        setFlow(undefined);
        setAccounts(undefined);
        setRoles([]);
        setValues((previous) => ({ ...previous, accountId: '', roleName: '' }));
        await trpcClient.awsCredentials.cancelSso.mutate({});
    };

    const navigateBack = (target: 'choose' | 'form'): void => {
        void runOperation(async (signal) => {
            const preserveApprovedSso =
                target === 'form' && chosenMethod === 'sso' && flowRef.current !== undefined && accounts !== undefined;
            if (!preserveApprovedSso) {
                await clearFlow();
            }
            if (!signal.aborted) {
                setPhase(target);
                if (target === 'choose') {
                    setValues((previous) => ({ ...previous, secretAccessKey: '', sessionToken: '', accessKeyId: '' }));
                    setShowSecret(false);
                }
            }
        });
    };

    const startSso = (): void => {
        void runOperation(async (signal) => {
            await clearFlow();
            if (signal.aborted) {
                return;
            }
            const started = await trpcClient.awsCredentials.startSso.mutate(
                { startUrl: values.startUrl, ssoRegion: values.ssoRegion },
                { signal },
            );
            if (signal.aborted) {
                return;
            }
            flowRef.current = started;
            setFlow(started);
            while (!signal.aborted) {
                await waitForPoll(Math.max(1, started.intervalSeconds) * 1000, signal);
                const result = await trpcClient.awsCredentials.pollSso.query({ flowId: started.flowId }, { signal });
                if (signal.aborted) {
                    return;
                }
                if (result.status === 'authorized') {
                    setAccounts(result.accounts ?? []);
                    return;
                }
            }
        });
    };

    const selectAccount = (accountId: string): void => {
        setValues((previous) => ({ ...previous, accountId, roleName: '' }));
        setRoles([]);
        const currentFlow = flowRef.current;
        if (!currentFlow) {
            return;
        }
        void runOperation(async (signal) => {
            const result = await trpcClient.awsCredentials.listSsoRoles.query(
                { flowId: currentFlow.flowId, accountId },
                { signal },
            );
            if (!signal.aborted) {
                setRoles(result);
            }
        });
    };

    const isTemporary = chosenMethod === 'temporary';
    const hasKeys = chosenMethod === 'accessKey' || isTemporary;
    const hasValue = (key: string): boolean => (values[key] ?? '').trim().length > 0;
    const validExpiration =
        !values.expiration ||
        (!Number.isNaN(Date.parse(values.expiration)) && Date.parse(values.expiration) > Date.now());
    const canSubmit =
        regions.length > 0 &&
        !busy &&
        ((chosenMethod === 'profile' && hasValue('profile')) ||
            (chosenMethod === 'accessKey' && hasValue('accessKeyId') && hasValue('secretAccessKey')) ||
            (isTemporary &&
                hasValue('accessKeyId') &&
                hasValue('secretAccessKey') &&
                hasValue('sessionToken') &&
                validExpiration) ||
            (chosenMethod === 'sso' && !!flow && hasValue('accountId') && hasValue('roleName')));

    const handleSubmit = (): void => {
        if (!canSubmit) {
            return;
        }
        setPhase('checking');
        void runOperation(async (signal) => {
            const common = { regions, label: values.label || undefined };
            let input: CredentialSubmitInput;
            switch (chosenMethod) {
                case 'profile':
                    input = { ...common, authMethod: 'profile', profile: values.profile };
                    break;
                case 'sso': {
                    const current = flowRef.current;
                    if (!current) {
                        throw new Error('Missing browser sign-in');
                    }
                    input = {
                        ...common,
                        authMethod: 'sso',
                        ssoFlowId: current.flowId,
                        accountId: values.accountId,
                        roleName: values.roleName,
                    };
                    break;
                }
                case 'temporary':
                    input = {
                        ...common,
                        authMethod: 'temporary',
                        accessKeyId: values.accessKeyId,
                        secretAccessKey: values.secretAccessKey,
                        sessionToken: values.sessionToken,
                        expiration: values.expiration ? new Date(values.expiration).toISOString() : undefined,
                    };
                    break;
                case 'accessKey':
                    input = {
                        ...common,
                        authMethod: 'accessKey',
                        accessKeyId: values.accessKeyId,
                        secretAccessKey: values.secretAccessKey,
                    };
                    break;
            }
            const result = await trpcClient.awsCredentials.submit.mutate(input, { signal });
            if (signal.aborted) {
                return;
            }
            if (result.success) {
                setCredential(result.credential);
                setValues((previous) => ({ ...previous, accessKeyId: '', secretAccessKey: '', sessionToken: '' }));
                setShowSecret(false);
                setPhase('success');
            } else {
                setSubmitError(result.error);
            }
        });
    };

    const close = (complete: boolean): void => {
        setIsCompleting(true);
        void runOperation(async () => {
            try {
                if (complete) {
                    await trpcClient.awsCredentials.complete.mutate();
                } else {
                    await trpcClient.awsCredentials.cancel.mutate();
                }
            } finally {
                if (mountedRef.current) {
                    setIsCompleting(false);
                }
            }
        });
    };
    const openLink = (): void => {
        void trpcClient.common.openUrl.mutate({ url: LEARN_MORE_URL }).catch(() => {
            if (mountedRef.current) {
                setSubmitError({
                    title: l10n.t("We couldn't open the browser"),
                    message: l10n.t('Check your default browser settings and try again.'),
                });
            }
        });
    };

    const stepIds: readonly Phase[] = isEdit
        ? ['form', 'checking', 'success']
        : ['choose', 'form', 'checking', 'success'];
    const currentStepIndex = stepIds.indexOf(phase);
    const checkFailed = phase === 'checking' && !!submitError;
    const stepsLocked = phase === 'success' || (phase === 'checking' && !checkFailed);
    const isStepCompleted = (id: Phase): boolean =>
        id === 'choose' || stepIds.indexOf(id) < currentStepIndex || (id === 'success' && phase === 'success');
    const isStepNavigable = (id: Phase): boolean =>
        !stepsLocked && stepIds.indexOf(id) < currentStepIndex && (id === 'choose' || id === 'form');
    const goToStep = (id: string): void => {
        if ((id === 'choose' || id === 'form') && isStepNavigable(id)) {
            navigateBack(id);
        }
    };

    const methodNames: Record<AwsAuthMethod, string> = {
        profile: l10n.t('AWS profile'),
        accessKey: l10n.t('Access key'),
        sso: l10n.t('SSO'),
        temporary: l10n.t('Temporary credentials'),
    };
    const methodCard = (method: AwsAuthMethod, icon: JSX.Element, qualifier: string, summary: string): JSX.Element => (
        <Card
            className={mergeClasses(styles.methodCard, pendingMethod === method && styles.methodCardSelected)}
            selected={pendingMethod === method}
            onSelectionChange={(_event, data) => data.selected && setPendingMethod(method)}
            floatingAction={
                <Radio
                    checked={pendingMethod === method}
                    onChange={() => setPendingMethod(method)}
                    aria-label={methodNames[method]}
                />
            }
        >
            <CardHeader
                image={icon}
                header={<Text weight="semibold">{methodNames[method]}</Text>}
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
                'profile',
                <PersonAccountsRegular aria-hidden className={styles.methodIcon} />,
                l10n.t('Recommended'),
                l10n.t('Use a configured AWS profile, including role-backed and MFA profiles.'),
            )}
            {methodCard(
                'accessKey',
                <KeyRegular aria-hidden className={styles.methodIcon} />,
                l10n.t('Access Key ID + Secret Key'),
                l10n.t('Provide an explicit key pair. Validated keys are kept in VS Code secret storage.'),
            )}
            {methodCard(
                'sso',
                <CloudRegular aria-hidden className={styles.methodIcon} />,
                l10n.t('IAM Identity Center'),
                l10n.t('Sign in through your browser, then choose an AWS account and role.'),
            )}
            {methodCard(
                'temporary',
                <TimerRegular aria-hidden className={styles.methodIcon} />,
                l10n.t('Key ID + secret + token'),
                l10n.t('Use session-only credentials. Re-enter them after expiration or restarting VS Code.'),
            )}
        </div>
    );

    const textField = (
        key: string,
        label: string,
        secret = false,
        required = true,
        placeholder?: string,
        validationMessage?: string,
    ): JSX.Element => (
        <Field
            key={key}
            label={label}
            required={required}
            validationState={validationMessage ? 'error' : 'none'}
            validationMessage={validationMessage}
        >
            <Input
                value={values[key] ?? ''}
                type={secret && !showSecret ? 'password' : 'text'}
                autoComplete="off"
                placeholder={placeholder}
                onChange={(_event, data) => setValues((previous) => ({ ...previous, [key]: data.value }))}
                contentAfter={
                    secret ? (
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
    );
    const selectedProfile = profiles.find((profile) => profile.name === values.profile);
    const ssoProfiles = profiles.filter((profile) => profile.startUrl && profile.ssoRegion);
    const regionOptions = useMemo(
        () => [...new Set([...AWS_REGIONS.map((region) => region.id), ...regions])],
        [regions],
    );
    const stageStatusLabels: Partial<Record<StatusListItemStatus, string>> = {
        pending: l10n.t('pending'),
        active: l10n.t('in progress'),
        done: l10n.t('done'),
        error: l10n.t('failed'),
        warning: l10n.t('warning'),
    };
    const checkStages = [
        l10n.t('Verifying your AWS identity'),
        isTemporary ? l10n.t('Keeping the credential for this session') : l10n.t('Saving the credential'),
    ];
    const stageStatusAt = (index: number): StatusListItemStatus => {
        if (index > 0) {
            return 'pending';
        }
        return checkFailed ? 'error' : 'active';
    };
    const errorMessage = submitError ? (
        <MessageBlock
            intent="error"
            icon={<ErrorCircleFilled />}
            title={submitError.title}
            actions={
                checkFailed ? (
                    <Button appearance="secondary" onClick={handleSubmit}>
                        {l10n.t('Retry')}
                    </Button>
                ) : undefined
            }
        >
            {submitError.message}
        </MessageBlock>
    ) : null;
    const guide = (
        <Accordion collapsible>
            <AccordionItem value="guide">
                <AccordionHeader>
                    <Text weight="semibold" className={styles.guideHeaderBrand}>
                        {l10n.t('Where do I find these values?')}
                    </Text>
                </AccordionHeader>
                <AccordionPanel>
                    <ol className={styles.guideStepList}>
                        <li>
                            <Body1 as="span">
                                {l10n.t(
                                    'Use an AWS CLI profile, an IAM access key, or credentials provided by your administrator.',
                                )}
                            </Body1>
                        </li>
                        <li>
                            <Body1 as="span">
                                {l10n.t(
                                    'For SSO, enter your IAM Identity Center start URL and its AWS region, approve sign-in in your browser, then select an account and role.',
                                )}
                            </Body1>
                        </li>
                        <li>
                            <Body1 as="span">
                                {l10n.t(
                                    'Select the regions containing your DocumentDB clusters. Discovery requires DocumentDB read permissions; database credentials are entered separately.',
                                )}
                            </Body1>
                        </li>
                    </ol>
                    <Link onClick={openLink}>{l10n.t('AWS access and permissions')}</Link>
                </AccordionPanel>
            </AccordionItem>
        </Accordion>
    );
    const form = (
        <form
            className={styles.fields}
            onSubmit={(event) => {
                event.preventDefault();
                handleSubmit();
            }}
        >
            {errorMessage}
            {textField('label', l10n.t('Credential name'), false, false)}
            {(chosenMethod === 'profile' || chosenMethod === 'sso') && profileError && (
                <MessageBlock
                    intent="warning"
                    title={l10n.t("We couldn't load AWS profiles")}
                    actions={
                        <Button type="button" onClick={() => setProfileRevision((revision) => revision + 1)}>
                            {l10n.t('Retry')}
                        </Button>
                    }
                >
                    {l10n.t('Check your local AWS configuration. You can retry without leaving this form.')}
                </MessageBlock>
            )}
            {chosenMethod === 'profile' && (
                <>
                    <Field label={l10n.t('AWS profile')} required>
                        <Dropdown
                            value={values.profile}
                            selectedOptions={values.profile ? [values.profile] : []}
                            placeholder={profileLoading ? l10n.t('Loading profiles…') : l10n.t('Select a profile')}
                            onOptionSelect={(_event, data) =>
                                setValues((previous) => ({ ...previous, profile: data.optionValue ?? '' }))
                            }
                        >
                            {profiles.map((profile) => (
                                <Option key={profile.name} value={profile.name} text={profile.name}>
                                    {profile.name}
                                </Option>
                            ))}
                            {values.profile && !selectedProfile && (
                                <Option value={values.profile}>{values.profile}</Option>
                            )}
                        </Dropdown>
                    </Field>
                    {selectedProfile && (
                        <Text className={styles.muted}>{l10n.t('Profile type: {0}', selectedProfile.kind)}</Text>
                    )}
                    {!profileLoading && profiles.length === 0 && !profileError && (
                        <MessageBlock
                            title={l10n.t('No AWS profiles found')}
                            actions={
                                <Button type="button" onClick={() => setProfileRevision((revision) => revision + 1)}>
                                    {l10n.t('Refresh profiles')}
                                </Button>
                            }
                        >
                            {l10n.t(
                                'Configure a profile with the AWS CLI, then refresh this list, or go Back to choose another method.',
                            )}
                        </MessageBlock>
                    )}
                    <Text className={styles.muted}>
                        {l10n.t('If your profile requires MFA, VS Code will ask for the code during verification.')}
                    </Text>
                </>
            )}
            {hasKeys && textField('accessKeyId', l10n.t('Access Key ID'))}
            {hasKeys && textField('secretAccessKey', l10n.t('Secret Access Key'), true)}
            {isTemporary && textField('sessionToken', l10n.t('Session token'), true)}
            {isTemporary &&
                textField(
                    'expiration',
                    l10n.t('Expiration (optional, ISO 8601)'),
                    false,
                    false,
                    '2026-12-01T12:00:00Z',
                    validExpiration ? undefined : l10n.t('Enter a valid future expiration time.'),
                )}
            {isTemporary && (
                <MessageBlock title={l10n.t('Session only')}>
                    {l10n.t(
                        'These credentials are kept only in memory. You must enter them again after they expire or VS Code restarts.',
                    )}
                </MessageBlock>
            )}
            {chosenMethod === 'sso' && (
                <>
                    {!flow && !busy && (
                        <>
                            {ssoProfiles.length > 0 && (
                                <Field label={l10n.t('Use settings from an SSO profile (optional)')}>
                                    <Dropdown
                                        placeholder={l10n.t('Select an SSO profile')}
                                        onOptionSelect={(_event, data) => {
                                            const profile = ssoProfiles.find((item) => item.name === data.optionValue);
                                            if (profile) {
                                                setValues((previous) => ({
                                                    ...previous,
                                                    startUrl: profile.startUrl ?? '',
                                                    ssoRegion: profile.ssoRegion ?? '',
                                                }));
                                            }
                                        }}
                                    >
                                        {ssoProfiles.map((profile) => (
                                            <Option key={profile.name}>{profile.name}</Option>
                                        ))}
                                    </Dropdown>
                                </Field>
                            )}
                            {textField(
                                'startUrl',
                                l10n.t('SSO start URL'),
                                false,
                                true,
                                'https://your-organization.awsapps.com/start',
                            )}
                            {textField('ssoRegion', l10n.t('SSO region'))}
                        </>
                    )}
                    {!flow && (
                        <Button
                            type="button"
                            appearance="secondary"
                            disabled={busy || !hasValue('startUrl') || !hasValue('ssoRegion')}
                            onClick={startSso}
                        >
                            {busy ? l10n.t('Starting browser sign-in…') : l10n.t('Sign in with browser')}
                        </Button>
                    )}
                    {flow && accounts === undefined && (
                        <MessageBlock
                            title={l10n.t('Approve sign-in in your browser')}
                            actions={
                                <Button type="button" onClick={() => void runOperation(async () => clearFlow())}>
                                    {l10n.t('Cancel browser sign-in')}
                                </Button>
                            }
                        >
                            {l10n.t('Confirm this code in the browser: {0}. ', flow.userCode)}
                            {l10n.t('Waiting for approval. Keep this panel open.')}
                        </MessageBlock>
                    )}
                    {accounts !== undefined && (
                        <>
                            <Field label={l10n.t('AWS account')} required>
                                <Dropdown
                                    value={values.accountId ?? ''}
                                    selectedOptions={values.accountId ? [values.accountId] : []}
                                    placeholder={l10n.t('Select an account')}
                                    onOptionSelect={(_event, data) => selectAccount(data.optionValue ?? '')}
                                >
                                    {accounts.map((account) => (
                                        <Option
                                            key={account.accountId}
                                            value={account.accountId}
                                            text={`${account.accountName} (${account.accountId})`}
                                        >
                                            {account.accountName} ({account.accountId})
                                        </Option>
                                    ))}
                                </Dropdown>
                            </Field>
                            {accounts.length === 0 && (
                                <Text>
                                    {l10n.t(
                                        'No AWS accounts are assigned to this sign-in. Ask your administrator for access.',
                                    )}
                                </Text>
                            )}
                            <Field label={l10n.t('AWS role')} required>
                                <Dropdown
                                    value={values.roleName ?? ''}
                                    selectedOptions={values.roleName ? [values.roleName] : []}
                                    disabled={busy || !values.accountId}
                                    placeholder={busy ? l10n.t('Loading roles…') : l10n.t('Select a role')}
                                    onOptionSelect={(_event, data) =>
                                        setValues((previous) => ({ ...previous, roleName: data.optionValue ?? '' }))
                                    }
                                >
                                    {roles.map((role) => (
                                        <Option key={role}>{role}</Option>
                                    ))}
                                </Dropdown>
                            </Field>
                            {!busy && values.accountId && roles.length === 0 && (
                                <Text>
                                    {l10n.t(
                                        'No roles are available for this account. Select another account or ask your administrator for access.',
                                    )}
                                </Text>
                            )}
                            <Button type="button" onClick={() => void runOperation(async () => clearFlow())}>
                                {l10n.t('Restart browser sign-in')}
                            </Button>
                        </>
                    )}
                </>
            )}
            <Field
                label={l10n.t('Discovery regions')}
                required
                hint={l10n.t('Select at least one region. This selection is remembered for this credential entry.')}
            >
                <Dropdown
                    multiselect
                    value={regions.join(', ')}
                    selectedOptions={regions}
                    placeholder={l10n.t('Select regions')}
                    onOptionSelect={(_event, data) => setRegions(data.selectedOptions)}
                >
                    {regionOptions.map((region) => (
                        <Option key={region}>{region}</Option>
                    ))}
                </Dropdown>
            </Field>
            {guide}
            <button type="submit" hidden disabled={!canSubmit} />
        </form>
    );

    let primaryLabel = l10n.t('Verify & Save');
    let primaryDisabled = !canSubmit;
    let onPrimary: () => void = handleSubmit;
    let secondaryLabel = l10n.t('Back');
    let backDisabled = isEdit;
    let onBack = (): void => navigateBack('choose');
    if (phase === 'choose') {
        primaryLabel = l10n.t('Continue');
        primaryDisabled = busy;
        onPrimary = (): void => {
            setChosenMethod(pendingMethod);
            setPhase('form');
            setSubmitError(undefined);
        };
        secondaryLabel = l10n.t('Cancel');
        backDisabled = isCompleting;
        onBack = (): void => close(false);
    } else if (phase === 'checking') {
        primaryDisabled = true;
        backDisabled = !checkFailed;
        onBack = (): void => navigateBack('form');
    } else if (phase === 'success') {
        primaryLabel = isCompleting ? l10n.t('Closing…') : l10n.t('Close');
        primaryDisabled = isCompleting;
        onPrimary = (): void => close(true);
        backDisabled = true;
    }

    return (
        <>
            <Announcer when={phase === 'form'} message={l10n.t('Enter your AWS credential details.')} />
            <Announcer when={phase === 'checking'} message={l10n.t('Checking your AWS identity.')} />
            <Announcer when={phase === 'success'} message={l10n.t('Your AWS identity was verified.')} />
            <Announcer
                when={accounts !== undefined}
                message={l10n.t('Browser approval received. Select an AWS account and role.')}
            />
            <Announcer
                when={!!flow && accounts === undefined}
                message={l10n.t('Approve AWS sign-in in your browser.')}
            />
            <Announcer
                when={!!submitError}
                message={submitError ? `${submitError.title}. ${submitError.message}` : ''}
                politeness="assertive"
            />
            <Wizard
                activeStep={phase}
                onStepChange={goToStep}
                headerBehavior="sticky-navigation"
                stepsAriaLabel={l10n.t('Credential setup progress')}
                overflowAriaLabel={(count) => l10n.t('{0} more steps', String(count))}
                header={
                    <ContainerHeader
                        media={<CloudRegular aria-hidden />}
                        title={
                            isEdit
                                ? l10n.t('Update an AWS DocumentDB connection')
                                : l10n.t('Add an AWS DocumentDB connection')
                        }
                        subtitle={l10n.t('Discover AWS clusters, then connect using database credentials.')}
                    />
                }
                footer={
                    <ContainerFooter
                        contentEnd={
                            <Button appearance="secondary" onClick={openLink}>
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
                }
            >
                {!isEdit && (
                    <WizardStep
                        value="choose"
                        label={l10n.t('Choose method')}
                        title={l10n.t('Choose an authentication method')}
                        subtitle={l10n.t('Pick how we sign in to AWS.')}
                        completed={isStepCompleted('choose')}
                        navigable={isStepNavigable('choose')}
                    >
                        {methodChoice}
                    </WizardStep>
                )}
                <WizardStep
                    value="form"
                    label={l10n.t('Enter details')}
                    title={methodNames[chosenMethod]}
                    subtitle={l10n.t('Enter your AWS sign-in details and select the regions to discover.')}
                    completed={isStepCompleted('form')}
                    navigable={isStepNavigable('form')}
                >
                    {form}
                </WizardStep>
                <WizardStep
                    value="checking"
                    label={l10n.t('Verify')}
                    title={l10n.t('Verify your AWS credential')}
                    subtitle={l10n.t('We check your identity with AWS before accepting your credential.')}
                    completed={isStepCompleted('checking')}
                    navigable={false}
                >
                    <StatusList ariaLabel={l10n.t('Credential check progress')} statusLabels={stageStatusLabels}>
                        {checkStages.map((label, index) => (
                            <StatusListItem key={label} label={label} status={stageStatusAt(index)} />
                        ))}
                    </StatusList>
                    {checkFailed && errorMessage}
                </WizardStep>
                <WizardStep
                    value="success"
                    label={l10n.t('Done')}
                    title={isEdit ? l10n.t('Credential updated') : l10n.t('Credential added')}
                    subtitle={l10n.t('Your AWS identity was verified.')}
                    completed={phase === 'success'}
                    navigable={false}
                >
                    <StatusList ariaLabel={l10n.t('Completed credential checks')} statusLabels={stageStatusLabels}>
                        {checkStages.map((label) => (
                            <StatusListItem key={label} label={label} status="done" />
                        ))}
                    </StatusList>
                    {credential && (
                        <Text>
                            {l10n.t(
                                'Account: {0}. Identity: {1}. Regions: {2}.',
                                credential.accountId,
                                credential.arn,
                                credential.regions.join(', '),
                            )}
                        </Text>
                    )}
                    <MessageBlock intent="success" title={l10n.t('All set')}>
                        {isTemporary
                            ? l10n.t(
                                  'Your credential was verified and is available for this session only. It is not saved permanently; re-enter it after expiration or restarting VS Code.',
                              )
                            : l10n.t('Your credential was successfully checked and saved, and is ready to use.')}
                    </MessageBlock>
                    {credential?.expiresAt !== undefined && (
                        <Text>{l10n.t('Expires: {0}', new Date(credential.expiresAt).toLocaleString())}</Text>
                    )}
                    <Text>
                        {l10n.t(
                            'Close this tab and explore AWS DocumentDB in Service Discovery. Discovery permissions are checked separately in each selected region; identity verification does not guarantee cluster access or database connectivity.',
                        )}
                    </Text>
                    {errorMessage}
                </WizardStep>
            </Wizard>
        </>
    );
};
