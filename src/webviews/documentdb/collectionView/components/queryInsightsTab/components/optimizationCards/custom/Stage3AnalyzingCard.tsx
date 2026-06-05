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
export function Stage3AnalyzingCard({ onCancel }: Stage3AnalyzingCardProps): JSX.Element {
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
                <Button appearance="outline" size="small" onClick={onCancel}>
                    {l10n.t('Cancel')}
                </Button>
            </div>
            {/*
             * Polite live region so screen-reader users learn the AI request
             * started (and that Cancel exists). The visible Spinner/Text are
             * not themselves a live region, so the announcement happens exactly
             * once on mount via the Announcer (review item M4). This card only
             * mounts while Stage 3 is loading, so `when` is constant `true`.
             */}
            <Announcer when={true} message={l10n.t('AI is analyzing…')} />
        </Card>
    );
}
