/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, Card, Spinner, Text, tokens } from '@fluentui/react-components';
import * as l10n from '@vscode/l10n';
import { type JSX } from 'react';
import { Announcer } from '../../../../../../../components/accessibility';

interface Stage3AnalyzingCardProps {
    /** Invoked when the user cancels the in-flight AI analysis. */
    onCancel: () => void;
    /**
     * Whether cancellation is currently meaningful. The card stays mounted
     * through the `s3Success` exit collapse (see {@link QueryInsightsTab}), but
     * `cancelStage3` is a no-op outside `s3Loading`. While the card is
     * collapsing away on success this is `false`, so the Cancel button is
     * disabled rather than left visible-but-inert (review item L4). Defaults to
     * `true` for the common in-flight case.
     */
    canCancel?: boolean;
}

/**
 * Slim in-flow "AI is analyzing…" card shown while a Stage 3 AI request is
 * streaming. It replaces the tall pre-request card the moment loading starts:
 * the full card is dismissed and this short single-row card takes its place, so
 * the layout shift when it collapses on completion is tiny. It surfaces the
 * progress message and a clearly visible (outlined) Cancel button.
 *
 * Mount/unmount is the caller's responsibility (e.g. inside a CollapseRelaxed
 * gated on the Stage 3 loading flag) so the enter/exit motion stays consistent
 * with the rest of the section.
 */
export function Stage3AnalyzingCard({ onCancel, canCancel = true }: Stage3AnalyzingCardProps): JSX.Element {
    return (
        <Card
            className="cardSpacing"
            style={{
                backgroundColor: tokens.colorBrandBackground2,
                border: `1px solid ${tokens.colorBrandStroke1}`,
            }}
        >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Spinner size="tiny" aria-hidden="true" />
                <Text size={300}>{l10n.t('AI is analyzing…')}</Text>
                <Button appearance="outline" size="small" onClick={onCancel} disabled={!canCancel}>
                    {l10n.t('Cancel')}
                </Button>
            </div>
            {/*
             * Polite live region so screen-reader users learn the AI request
             * started (and that Cancel exists). The visible Spinner/Text are
             * not themselves a live region, so the announcement happens exactly
             * once on mount via the Announcer (review item M4). The card mounts
             * when Stage 3 starts loading and stays mounted through the success
             * exit-collapse, so this announces a single time per request.
             */}
            <Announcer when={true} message={l10n.t('AI is analyzing…')} />
        </Card>
    );
}
