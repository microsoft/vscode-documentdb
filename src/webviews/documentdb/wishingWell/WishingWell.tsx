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
    ArrowClockwiseRegular,
    ArrowShuffleRegular,
    BotRegular,
    ChatRegular,
    CheckmarkCircleFilled,
    ClockRegular,
    CodeRegular,
    DataBarVerticalRegular,
    DocumentRegular,
    FlashRegular,
    LightbulbRegular,
    LinkRegular,
    SparkleRegular,
    StarRegular,
    TableSearchRegular,
    WarningRegular,
    WindowConsoleRegular,
    WindowRegular,
    WrenchRegular,
} from '@fluentui/react-icons';
import { ContainerHeader } from '@microsoft/vscode-ext-webview-fluentui/components';
import { useConfiguration } from '@microsoft/vscode-ext-webview/react';
import * as l10n from '@vscode/l10n';
import { type FormEvent, type JSX, type KeyboardEvent, useCallback, useEffect, useId, useRef, useState } from 'react';
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

/** Granted, or still waiting for the user to answer a confirmation in VS Code. */
type GrantState = 'granted' | 'waiting';

/** Most grants finish at once; a spinner that flashes for one frame only distracts. */
const SPINNER_DELAY_MS = 300;

function useDelayed(flag: boolean, delayMs: number): boolean {
    const [late, setLate] = useState(false);
    useEffect(() => {
        if (!flag) {
            return undefined;
        }
        const timer = setTimeout(() => setLate(true), delayMs);
        return () => {
            clearTimeout(timer);
            setLate(false);
        };
    }, [flag, delayMs]);
    return flag && late;
}

function grantStateOf(result: { granted: boolean; waiting: boolean }): GrantState | undefined {
    if (result.granted) {
        return 'granted';
    }
    return result.waiting ? 'waiting' : undefined;
}

function copilotStatusText(status: WishingWellStatus | undefined): string {
    if (status === undefined) {
        return l10n.t('Checking for Copilot…');
    }
    return status.copilotAvailable
        ? l10n.t('Copilot reads your wishes, so almost anything goes.')
        : l10n.t('Copilot is not available, so the well understands simple wishes only.');
}

/** What a grant did, in words that fit where the wish went. */
function receipt(kind: WishKind, state: GrantState): string {
    if (state === 'waiting') {
        return l10n.t('Waiting for you in VS Code');
    }
    switch (kind) {
        case 'agent':
            return l10n.t('Sent to Copilot Chat');
        case 'link':
            return l10n.t('Opened in your browser');
        case 'command':
            return l10n.t('Done');
        default:
            return l10n.t('Opened');
    }
}

/** Label for granting a card again, or undefined for the one-shot kinds the host forgets once granted. */
function againLabel(kind: WishKind): string | undefined {
    switch (kind) {
        case 'agent':
        case 'link':
            return undefined;
        case 'command':
            return l10n.t('Do it again');
        default:
            return l10n.t('Open again');
    }
}

function announcement(outcome: WishOutcome): string {
    switch (outcome.status) {
        case 'refused':
            return l10n.t('The well could not grant this wish. {0}', outcome.message);
        case 'proposed':
            return l10n.t('{0}. {1} Use "{2}" to grant it.', outcome.title, outcome.message, outcome.actionLabel ?? '');
        default:
            return `${outcome.title}. ${outcome.message}`;
    }
}

interface OutcomeCardProps {
    readonly outcome: WishOutcome;
    readonly latest: boolean;
    readonly grantState: GrantState | undefined;
    readonly granting: boolean;
    readonly onGrant: (outcome: WishOutcome) => void;
}

const OutcomeCard = ({ outcome, latest, grantState, granting, onGrant }: OutcomeCardProps): JSX.Element => {
    const slowGrant = useDelayed(granting, SPINNER_DELAY_MS);
    const refused = outcome.status === 'refused';
    const again = grantState === 'granted' ? againLabel(outcome.kind) : undefined;
    const className = ['ww-card', latest && 'ww-card--latest', refused && 'ww-card--refused'].filter(Boolean).join(' ');
    return (
        <Card className={className} data-kind={outcome.kind} data-status={outcome.status}>
            <CardHeader
                image={<span className="ww-card__icon">{refused ? <WarningRegular /> : KIND_ICONS[outcome.kind]}</span>}
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
            {outcome.wish && <Caption1 className="ww-card__wish">{l10n.t('You wished: {0}', outcome.wish)}</Caption1>}
            <Body1 className="ww-card__message">{outcome.message}</Body1>
            {outcome.status === 'answered' && (
                <Caption1 className="ww-muted">{l10n.t('Read-only result: nothing was changed.')}</Caption1>
            )}
            {outcome.detail && <pre className="ww-card__detail">{outcome.detail}</pre>}
            {outcome.actionLabel && !refused && (
                <div className="ww-card__actions">
                    {grantState ? (
                        <>
                            <span className={grantState === 'waiting' ? 'ww-waiting' : 'ww-granted'}>
                                {grantState === 'waiting' ? (
                                    <ClockRegular aria-hidden />
                                ) : (
                                    <CheckmarkCircleFilled aria-hidden />
                                )}
                                {receipt(outcome.kind, grantState)}
                            </span>
                            {again && (
                                <Button
                                    icon={slowGrant ? <Spinner size="tiny" /> : <ArrowClockwiseRegular />}
                                    disabled={granting}
                                    onClick={() => onGrant(outcome)}
                                >
                                    {again}
                                </Button>
                            )}
                        </>
                    ) : (
                        <>
                            <Button
                                appearance={latest ? 'primary' : 'secondary'}
                                icon={slowGrant ? <Spinner size="tiny" /> : <SparkleRegular />}
                                disabled={granting}
                                onClick={() => onGrant(outcome)}
                            >
                                {outcome.actionLabel}
                            </Button>
                            {outcome.actionHint && (
                                <Caption1 className="ww-muted ww-card__hint">{outcome.actionHint}</Caption1>
                            )}
                        </>
                    )}
                </div>
            )}
        </Card>
    );
};

export const WishingWell = (): JSX.Element => {
    const configuration = useConfiguration<WishingWellWebviewConfig>();
    const trpcClient = useTrpcClient();

    const [wish, setWish] = useState('');
    const [busy, setBusy] = useState<'wish' | 'lucky' | undefined>();
    const [status, setStatus] = useState<WishingWellStatus | undefined>();
    const [outcomes, setOutcomes] = useState<WishOutcome[]>([]);
    const [grantStates, setGrantStates] = useState<ReadonlyMap<string, GrantState>>(new Map());
    // Counted, so granting the same card again is announced again.
    const [grantNotice, setGrantNotice] = useState<{ readonly count: number; readonly message: string }>();
    const [granting, setGranting] = useState<string | undefined>();
    const [splash, setSplash] = useState(0);
    const [error, setError] = useState<string | undefined>();

    const inputRef = useRef<HTMLTextAreaElement>(null);
    const examplesLabelId = useId();

    const refreshStatus = useCallback((): void => {
        trpcClient.wishingWell.status
            .query()
            .then(setStatus)
            .catch(() => setStatus((previous) => previous ?? { copilotAvailable: false, examples: [] }));
    }, [trpcClient]);

    // Copilot sign-in can change while the tab is open, so look again whenever it comes back into view.
    useEffect(() => {
        refreshStatus();
        const onVisibilityChange = (): void => {
            if (document.visibilityState === 'visible') {
                refreshStatus();
            }
        };
        window.addEventListener('focus', refreshStatus);
        document.addEventListener('visibilitychange', onVisibilityChange);
        return () => {
            window.removeEventListener('focus', refreshStatus);
            document.removeEventListener('visibilitychange', onVisibilityChange);
        };
    }, [refreshStatus]);

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
                const state = grantStateOf(result);
                if (state) {
                    setGrantStates((previous) => new Map(previous).set(outcome.id, state));
                    setGrantNotice((previous) => ({
                        count: (previous?.count ?? 0) + 1,
                        message: `${outcome.title}: ${receipt(outcome.kind, state)}`,
                    }));
                } else if (result.declined) {
                    setError(l10n.t('Not granted: the request was declined in VS Code.'));
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

    const statusText = copilotStatusText(status);

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
                        ref={inputRef}
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
                    {status && status.examples.length > 0 && (
                        <div className="ww-examples" role="group" aria-labelledby={examplesLabelId}>
                            <Caption1 id={examplesLabelId} className="ww-muted">
                                {l10n.t('Try:')}
                            </Caption1>
                            {status.examples.map((example) => (
                                <Button
                                    key={example}
                                    className="ww-chip"
                                    size="small"
                                    shape="circular"
                                    appearance="outline"
                                    disabled={busy !== undefined}
                                    onClick={() => {
                                        setWish(example);
                                        inputRef.current?.focus();
                                    }}
                                >
                                    {example}
                                </Button>
                            ))}
                        </div>
                    )}
                </form>
            </section>

            {error && (
                <Body1 role="alert" className="ww-error">
                    {error}
                </Body1>
            )}

            {latest && (
                <section className="ww-results" aria-label={l10n.t('Latest wish')}>
                    <OutcomeCard
                        outcome={latest}
                        latest
                        grantState={grantStates.get(latest.id)}
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
                            grantState={grantStates.get(outcome.id)}
                            granting={granting === outcome.id}
                            onGrant={(item) => void grant(item)}
                        />
                    ))}
                </section>
            )}

            {/* Keyed so every new card and grant is announced, not only the first. */}
            {latest && <Announcer key={latest.id} when message={announcement(latest)} />}
            {grantNotice && <Announcer key={`granted-${grantNotice.count}`} when message={grantNotice.message} />}
        </main>
    );
};
