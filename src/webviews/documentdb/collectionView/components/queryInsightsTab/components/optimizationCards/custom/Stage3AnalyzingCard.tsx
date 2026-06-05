/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, Card, Spinner, Text, tokens } from '@fluentui/react-components';
import * as l10n from '@vscode/l10n';
import { type JSX, useEffect, useRef } from 'react';
import { Announcer } from '../../../../../../../components/accessibility';
import { type QueryInsightsStage3Phase } from '../../../../../collectionViewContext';

/**
 * Flip locally to log each visible label transition to the WEBVIEW DevTools
 * console while validating the phasing on a real (~15 s) Stage 3 run (review
 * item L1, decision #6). Mirrors `DEBUG_QUERY_INSIGHTS` in the reducer: one
 * toggle, one place. Off by default so production stays quiet.
 */
const DEBUG_STAGE3_PHASE = false;

interface Stage3AnalyzingCardProps {
    /** Invoked when the user cancels the in-flight AI analysis. */
    onCancel: () => void;
    /**
     * Monotonic stream phase driving the card's label only. Advances
     * `connecting → analyzing → generating` and never regresses (see
     * {@link QueryInsightsStage3Phase}). Defaults to `connecting` for the
     * initial render before any stream event has landed.
     */
    phase?: QueryInsightsStage3Phase;
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
 * Maps the monotonic stream phase to the visible (localized) label. Pure
 * presentation — the phase logic lives in the reducer; this only chooses
 * wording. The label advances with the model's real progress so the wait
 * never looks like a single static spinner (review item L1):
 *   - `connecting`  → "Connecting…"  (submitted; awaiting first token)
 *   - `analyzing`   → "Analyzing…"   (first character received; output flowing)
 */
function phaseLabel(phase: QueryInsightsStage3Phase): string {
    switch (phase) {
        case 'connecting':
            return l10n.t('Connecting…');
        case 'analyzing':
            return l10n.t('Analyzing…');
    }
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
export function Stage3AnalyzingCard({
    onCancel,
    phase = 'connecting',
    canCancel = true,
}: Stage3AnalyzingCardProps): JSX.Element {
    const label = phaseLabel(phase);

    // Per-transition trace (decision #6): log only when the visible label
    // actually changes, so a real run shows the connecting → analyzing →
    // generating cadence without per-render noise.
    const lastLabelRef = useRef<string | null>(null);
    useEffect(() => {
        if (DEBUG_STAGE3_PHASE && lastLabelRef.current !== label) {
            console.debug(`[QueryInsights] Stage3 label: ${lastLabelRef.current ?? '(mount)'} → ${label}`);
            lastLabelRef.current = label;
        }
    }, [label]);

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
                <Text size={300}>{label}</Text>
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
             *
             * The per-phase label changes are deliberately NOT announced
             * (decision #5): the message is fixed to the generic "AI is
             * analyzing…" so non-sighted users hear one stable "working"
             * signal rather than a stream of label updates. This is flagged
             * for a11y review.
             */}
            <Announcer when={true} message={l10n.t('AI is analyzing…')} />
        </Card>
    );
}
