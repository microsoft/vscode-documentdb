/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Badge,
    Body1,
    Body1Strong,
    Button,
    Caption1,
    Card,
    CardHeader,
    Spinner,
    Subtitle2,
    Textarea,
} from '@fluentui/react-components';
import {
    ArrowShuffleRegular,
    BotRegular,
    ChatRegular,
    CheckmarkCircleFilled,
    CodeRegular,
    DataBarVerticalRegular,
    DocumentRegular,
    FlashRegular,
    LightbulbRegular,
    LinkRegular,
    SparkleRegular,
    StarRegular,
    TableSearchRegular,
    WindowConsoleRegular,
    WindowRegular,
    WrenchRegular,
} from '@fluentui/react-icons';
import { ContainerHeader } from '@microsoft/vscode-ext-webview-fluentui/components';
import { useConfiguration } from '@microsoft/vscode-ext-webview/react';
import * as l10n from '@vscode/l10n';
import { type FormEvent, type JSX, type KeyboardEvent, useCallback, useEffect, useState } from 'react';
import { useTrpcClient } from '../../_integration/useTrpcClient';
import { Announcer } from '../../components/accessibility/Announcer';
import './wishingWell.scss';
import {
    type WishingWellStatus,
    type WishingWellWebviewConfig,
    type WishKind,
    type WishOutcome,
} from './wishingWellTypes';

const KIND_ICONS: Record<WishKind, JSX.Element> = {
    answer: <ChatRegular />,
    query: <TableSearchRegular />,
    view: <WindowRegular />,
    shell: <WindowConsoleRegular />,
    tool: <WrenchRegular />,
    command: <FlashRegular />,
    playground: <CodeRegular />,
    agent: <BotRegular />,
    link: <LinkRegular />,
    document: <DocumentRegular />,
    trivia: <DataBarVerticalRegular />,
    tip: <LightbulbRegular />,
    fortune: <StarRegular />,
};

const MAX_HISTORY = 10;

function examples(connected: boolean): string[] {
    return connected
        ? [
              l10n.t('How many documents are in each collection?'),
              l10n.t('Show the 5 newest documents'),
              l10n.t('Add 20 sample customers'),
              l10n.t('Open the shell'),
              l10n.t('Why is my query slow?'),
          ]
        : [
              l10n.t('Run DocumentDB on my laptop'),
              l10n.t('Add 20 sample customers'),
              l10n.t('Switch to a dark theme'),
              l10n.t('Write a README for this project'),
              l10n.t('Explain what an index does'),
          ];
}

interface OutcomeCardProps {
    readonly outcome: WishOutcome;
    readonly latest: boolean;
    readonly granted: boolean;
    readonly granting: boolean;
    readonly onGrant: (outcome: WishOutcome) => void;
}

const OutcomeCard = ({ outcome, latest, granted, granting, onGrant }: OutcomeCardProps): JSX.Element => (
    <Card className={latest ? 'ww-card ww-card--latest' : 'ww-card'} data-kind={outcome.kind}>
        <CardHeader
            image={<span className="ww-card__icon">{KIND_ICONS[outcome.kind]}</span>}
            header={<Body1Strong>{outcome.title}</Body1Strong>}
            description={
                <Caption1 className="ww-muted">
                    {outcome.interpretedBy === 'copilot'
                        ? l10n.t('Read by Copilot')
                        : outcome.interpretedBy === 'agent'
                          ? l10n.t('Cast by your agent')
                          : l10n.t('From the well')}
                </Caption1>
            }
        />
        <Body1 className="ww-card__message">{outcome.message}</Body1>
        {outcome.resultCount !== undefined && outcome.resultCount > 0 && (
            <Caption1 className="ww-muted">{l10n.t('Read-only result, at most 50 documents')}</Caption1>
        )}
        {outcome.detail && <pre className="ww-card__detail">{outcome.detail}</pre>}
        {outcome.actionLabel && (
            <div className="ww-card__actions">
                {granted ? (
                    <span className="ww-granted">
                        <CheckmarkCircleFilled aria-hidden />
                        {l10n.t('Granted')}
                    </span>
                ) : (
                    <Button
                        appearance={latest ? 'primary' : 'secondary'}
                        icon={granting ? <Spinner size="tiny" /> : <SparkleRegular />}
                        disabled={granting}
                        onClick={() => onGrant(outcome)}
                    >
                        {outcome.actionLabel}
                    </Button>
                )}
                {outcome.actionHint && <Caption1 className="ww-muted ww-card__hint">{outcome.actionHint}</Caption1>}
            </div>
        )}
    </Card>
);

export const WishingWell = (): JSX.Element => {
    const configuration = useConfiguration<WishingWellWebviewConfig>();
    const trpcClient = useTrpcClient();

    const [wish, setWish] = useState('');
    const [busy, setBusy] = useState<'wish' | 'lucky' | undefined>();
    const [status, setStatus] = useState<WishingWellStatus | undefined>();
    const [outcomes, setOutcomes] = useState<WishOutcome[]>([]);
    const [granted, setGranted] = useState<ReadonlySet<string>>(new Set());
    const [granting, setGranting] = useState<string | undefined>();
    const [splash, setSplash] = useState(0);
    const [error, setError] = useState<string | undefined>();

    useEffect(() => {
        trpcClient.wishingWell.status
            .query()
            .then(setStatus)
            .catch(() => setStatus({ copilotAvailable: false }));
    }, [trpcClient]);

    const toss = useCallback(
        async (kind: 'wish' | 'lucky'): Promise<void> => {
            const text = wish.trim();
            if (busy || (kind === 'wish' && !text)) {
                return;
            }
            setBusy(kind);
            setError(undefined);
            setSplash((count) => count + 1);
            try {
                const outcome =
                    kind === 'wish'
                        ? await trpcClient.wishingWell.makeWish.mutate({ wish: text })
                        : await trpcClient.wishingWell.feelingLucky.mutate();
                setOutcomes((previous) => [outcome, ...previous].slice(0, MAX_HISTORY));
                if (kind === 'wish') {
                    setWish('');
                }
            } catch (caught) {
                setError(caught instanceof Error ? caught.message : String(caught));
            } finally {
                setBusy(undefined);
            }
        },
        [busy, trpcClient, wish],
    );

    const grant = useCallback(
        async (outcome: WishOutcome): Promise<void> => {
            setGranting(outcome.id);
            setError(undefined);
            try {
                const result = await trpcClient.wishingWell.grant.mutate({ id: outcome.id });
                if (result.granted) {
                    setGranted((previous) => new Set(previous).add(outcome.id));
                } else {
                    setError(l10n.t('This wish has expired. Make it again.'));
                }
            } catch (caught) {
                setError(caught instanceof Error ? caught.message : String(caught));
            } finally {
                setGranting(undefined);
            }
        },
        [trpcClient],
    );

    const onSubmit = (event: FormEvent): void => {
        event.preventDefault();
        void toss('wish');
    };

    // Enter makes the wish; Shift+Enter starts a new line.
    const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
        if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            void toss('wish');
        }
    };

    const place = [configuration.clusterDisplayName, configuration.databaseName, configuration.collectionName]
        .filter(Boolean)
        .join(' / ');
    const scope = place
        ? l10n.t('Wishing on {0}. Ask about the data, or for anything else.', place)
        : l10n.t('Make a wish. The well grants it, or finds someone who can.');

    const statusText =
        status === undefined
            ? l10n.t('Checking for Copilot…')
            : status.copilotAvailable
              ? l10n.t('Copilot reads your wishes, so almost anything goes.')
              : l10n.t('Copilot is not available, so the well understands simple wishes only.');

    const [latest, ...earlier] = outcomes;

    return (
        <main className="wishing-well" data-ready={status !== undefined ? 'true' : undefined}>
            <ContainerHeader media={<SparkleRegular aria-hidden />} title={l10n.t('Wishing Well')} subtitle={scope} />

            <section className="ww-stage">
                <div className={busy ? 'ww-well ww-well--stirring' : 'ww-well'} aria-hidden>
                    <div className="ww-well__water" key={splash}>
                        {splash > 0 && (
                            <>
                                <span className="ww-well__coin" />
                                <span className="ww-well__ripple" />
                                <span className="ww-well__ripple ww-well__ripple--late" />
                            </>
                        )}
                    </div>
                </div>

                <form className="ww-form" onSubmit={onSubmit}>
                    <Textarea
                        className="ww-input"
                        aria-label={l10n.t('Your wish')}
                        placeholder={l10n.t('I wish…')}
                        value={wish}
                        resize="vertical"
                        onChange={(_event, data) => setWish(data.value)}
                        onKeyDown={onKeyDown}
                        disabled={busy !== undefined}
                    />
                    <div className="ww-buttons">
                        <Button
                            appearance="primary"
                            type="submit"
                            disabled={!wish.trim() || busy !== undefined}
                            icon={busy === 'wish' ? <Spinner size="tiny" /> : <SparkleRegular />}
                        >
                            {l10n.t('Make a wish')}
                        </Button>
                        <Button
                            disabled={busy !== undefined}
                            icon={busy === 'lucky' ? <Spinner size="tiny" /> : <ArrowShuffleRegular />}
                            onClick={() => void toss('lucky')}
                        >
                            {l10n.t("I'm feeling lucky")}
                        </Button>
                    </div>
                    <div className="ww-status">
                        <Badge
                            appearance="tint"
                            color={status?.copilotAvailable ? 'brand' : 'informative'}
                            icon={<BotRegular />}
                        >
                            {status?.copilotAvailable ? l10n.t('Copilot') : l10n.t('Keywords')}
                        </Badge>
                        <Caption1 className="ww-muted">{statusText}</Caption1>
                    </div>
                    <div className="ww-examples" aria-label={l10n.t('Example wishes')}>
                        {examples(configuration.clusterDisplayName !== undefined).map((example) => (
                            <Button
                                key={example}
                                size="small"
                                appearance="subtle"
                                disabled={busy !== undefined}
                                onClick={() => setWish(example)}
                            >
                                {example}
                            </Button>
                        ))}
                    </div>
                </form>
            </section>

            {error && (
                <Body1 role="alert" className="ww-error">
                    {error}
                </Body1>
            )}

            {latest && (
                <section className="ww-results" aria-label={l10n.t('Granted wish')}>
                    <OutcomeCard
                        outcome={latest}
                        latest
                        granted={granted.has(latest.id)}
                        granting={granting === latest.id}
                        onGrant={(outcome) => void grant(outcome)}
                    />
                </section>
            )}

            {earlier.length > 0 && (
                <section className="ww-history" aria-label={l10n.t('Earlier wishes')}>
                    <Subtitle2>{l10n.t('Earlier wishes')}</Subtitle2>
                    {earlier.map((outcome) => (
                        <OutcomeCard
                            key={outcome.id}
                            outcome={outcome}
                            latest={false}
                            granted={granted.has(outcome.id)}
                            granting={granting === outcome.id}
                            onGrant={(item) => void grant(item)}
                        />
                    ))}
                </section>
            )}

            <Announcer when={latest !== undefined} message={latest ? `${latest.title}. ${latest.message}` : ''} />
        </main>
    );
};
