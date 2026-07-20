/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Body1,
    Button,
    Field,
    Input,
    Link,
    makeStyles,
    MessageBar,
    MessageBarBody,
    Spinner,
    Title3,
    tokens,
} from '@fluentui/react-components';
import { useConfiguration } from '@microsoft/vscode-ext-webview/react';
import * as l10n from '@vscode/l10n';
import { type JSX, useCallback, useMemo, useState } from 'react';
import { useTrpcClient } from '../../_integration/useTrpcClient';
import { type AtlasCredentialsWebviewConfig } from './atlasCredentialsController';

/** Generic MongoDB Atlas documentation / console links (no org-specific deep link). */
const ATLAS_API_KEY_DOCS_URL = 'https://www.mongodb.com/docs/atlas/configure-api-access/';
const ATLAS_SERVICE_ACCOUNT_DOCS_URL = 'https://www.mongodb.com/docs/atlas/api/service-accounts-overview/';
const ATLAS_CONSOLE_URL = 'https://cloud.mongodb.com/';

const useStyles = makeStyles({
    root: {
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
        maxWidth: '560px',
        margin: '0 auto',
        padding: '24px',
    },
    intro: {
        color: tokens.colorNeutralForeground2,
    },
    fields: {
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
    },
    actions: {
        display: 'flex',
        gap: '8px',
        alignItems: 'center',
        marginTop: '4px',
    },
    guide: {
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
    },
    guideSummary: {
        cursor: 'pointer',
        userSelect: 'none',
    },
    guideHeading: {
        fontWeight: tokens.fontWeightSemibold,
        color: tokens.colorNeutralForeground2,
    },
    stepList: {
        margin: '4px 0 0 0',
        paddingLeft: '20px',
        color: tokens.colorNeutralForeground2,
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
    },
    subStepList: {
        margin: '4px 0 0 0',
        paddingLeft: '18px',
        listStyleType: 'disc',
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
    },
});

interface FieldSpec {
    readonly key: 'publicKey' | 'privateKey' | 'clientId' | 'clientSecret';
    readonly label: string;
    readonly placeholder: string;
    readonly secret: boolean;
}

export const AtlasCredentialsView = (): JSX.Element => {
    const configuration = useConfiguration<AtlasCredentialsWebviewConfig>();
    const trpcClient = useTrpcClient();
    const styles = useStyles();

    const isApiKey = configuration.authMethod === 'apikey';

    const [values, setValues] = useState<Record<string, string>>({});
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);

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

    const canSubmit = fieldSpecs.every((spec) => (values[spec.key] ?? '').trim().length > 0) && !isSubmitting;

    const openLink = useCallback(
        (url: string): void => {
            void trpcClient.common.openUrl.mutate({ url });
        },
        [trpcClient],
    );

    const handleSubmit = useCallback(async (): Promise<void> => {
        if (isSubmitting) {
            return;
        }
        setErrorMessage(undefined);
        setIsSubmitting(true);
        try {
            const result = isApiKey
                ? await trpcClient.atlasCredentials.submitApiKey.mutate({
                      publicKey: values.publicKey ?? '',
                      privateKey: values.privateKey ?? '',
                  })
                : await trpcClient.atlasCredentials.submitServiceAccount.mutate({
                      clientId: values.clientId ?? '',
                      clientSecret: values.clientSecret ?? '',
                  });

            if (!result.success) {
                setErrorMessage(result.errorMessage ?? l10n.t('Authentication failed. Please check your credentials.'));
            }
            // On success the extension host closes this panel; nothing more to do here.
        } catch (error) {
            setErrorMessage(error instanceof Error ? error.message : String(error));
        } finally {
            setIsSubmitting(false);
        }
    }, [isApiKey, isSubmitting, trpcClient, values]);

    return (
        <div className={styles.root}>
            <Title3 as="h1">
                {isApiKey
                    ? l10n.t('Connect with a MongoDB Atlas API Key')
                    : l10n.t('Connect with a MongoDB Atlas Service Account')}
            </Title3>

            <Body1 className={styles.intro}>
                {isApiKey
                    ? l10n.t(
                          'Create an API key in the MongoDB Atlas console under IDENTITY & ACCESS → Applications → API Keys, then paste the Public Key and Private Key below.',
                      )
                    : l10n.t(
                          'Create a Service Account in the MongoDB Atlas console under IDENTITY & ACCESS → Applications → Service Accounts, then paste the Client ID and Client Secret below.',
                      )}
            </Body1>
            <details className={styles.guide}>
                <summary className={styles.guideSummary}>
                    <Body1 as="span" className={styles.guideHeading}>
                        {l10n.t('How to create credentials in MongoDB Atlas')}
                        {' — '}
                        <Link
                            onClick={(e) => {
                                e.stopPropagation();
                                openLink(isApiKey ? ATLAS_API_KEY_DOCS_URL : ATLAS_SERVICE_ACCOUNT_DOCS_URL);
                            }}
                        >
                            {l10n.t('View documentation')}
                        </Link>
                    </Body1>
                </summary>
                <ol className={styles.stepList}>
                    <li>
                        <Body1 as="span">
                            <Link onClick={() => openLink(ATLAS_CONSOLE_URL)}>
                                {l10n.t('Sign in to MongoDB Atlas')}
                            </Link>
                            {l10n.t(", or sign up if you don't have an account yet.")}
                        </Body1>
                    </li>
                    <li>
                        <Body1 as="span">{l10n.t('Select your Organization at the top-left.')}</Body1>
                        <ul className={styles.subStepList}>
                            <li>
                                <Body1 as="span">
                                    {l10n.t(
                                        "If you don't have one: click the Organization name \u2192 View All Organizations \u2192 Create New Organization, enter a name, then click Next \u2192 Create Organization.",
                                    )}
                                </Body1>
                            </li>
                        </ul>
                    </li>
                    <li>
                        <Body1 as="span">
                            {l10n.t('In the left sidebar, under IDENTITY & ACCESS, click Applications.')}
                        </Body1>
                    </li>
                    <li>
                        <Body1 as="span">
                            {isApiKey
                                ? l10n.t(
                                      'Click the API Keys tab → Add new → set permissions → copy the Public Key and Private Key, then paste them in the fields below.',
                                  )
                                : l10n.t(
                                      'Click the Service Accounts tab → Add new → set permissions → copy the Client ID and Client Secret, then paste them in the fields below.',
                                  )}
                        </Body1>
                    </li>
                </ol>
            </details>

            {errorMessage && (
                <MessageBar intent="error">
                    <MessageBarBody style={{ whiteSpace: 'pre-wrap' }}>{errorMessage}</MessageBarBody>
                </MessageBar>
            )}

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
                            type={spec.secret ? 'password' : 'text'}
                            value={values[spec.key] ?? ''}
                            placeholder={spec.placeholder}
                            disabled={isSubmitting}
                            onChange={(_event, data) => setValues((prev) => ({ ...prev, [spec.key]: data.value }))}
                        />
                    </Field>
                ))}

                <div className={styles.actions}>
                    <Button type="submit" appearance="primary" disabled={!canSubmit}>
                        {l10n.t('Connect')}
                    </Button>
                    {isSubmitting && <Spinner size="tiny" label={l10n.t('Validating credentials…')} />}
                </div>
            </form>

            <Body1 className={styles.intro}>
                {isApiKey
                    ? l10n.t(
                          "Make sure your current IP address is on the API key's Access List and that the key has the required project permissions.",
                      )
                    : l10n.t('Make sure the Service Account has the required project permissions.')}
            </Body1>
        </div>
    );
};
