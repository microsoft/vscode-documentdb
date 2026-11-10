/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Link, makeStyles, mergeClasses, tokens, Tooltip } from '@fluentui/react-components';
import {
    StatusListDetailsFacts,
    StatusListDetailsMessage,
    StatusListDetailsSection,
} from '@microsoft/vscode-ext-webview-fluentui/components';
import * as l10n from '@vscode/l10n';
import { type JSX, useId } from 'react';
import { type StageDetailFact } from './stageDetailsPresentation';

const useStyles = makeStyles({
    root: {
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.spacingVerticalM,
        '& dt': { color: 'inherit' },
        '& a, & button': {
            fontFamily: 'inherit',
            fontSize: 'inherit',
            fontWeight: 'inherit',
            lineHeight: 'inherit',
        },
    },
    idTrigger: {
        ':focus-visible': { outline: `2px solid ${tokens.colorStrokeFocus2}`, outlineOffset: '2px' },
    },
    idTooltip: { maxWidth: '320px', overflowWrap: 'anywhere', fontWeight: tokens.fontWeightRegular },
    note: { color: `var(--vscode-descriptionForeground, ${tokens.colorNeutralForeground2})` },
});

const ShortId = ({ fact }: { readonly fact: StageDetailFact }): JSX.Element => {
    const styles = useStyles();
    const id = useId();
    return (
        <Tooltip content={{ children: fact.fullValue, className: styles.idTooltip }} relationship="description">
            {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- keyboard focus exposes the full identifier tooltip */}
            <span className={styles.idTrigger} tabIndex={0} role="group" aria-labelledby={id}>
                <span id={id}>{fact.value}</span>
            </span>
        </Tooltip>
    );
};

export const SetupStageDetails = ({
    facts,
    mutedClassName,
    onShowOutput,
}: {
    readonly facts: readonly StageDetailFact[];
    readonly mutedClassName: string;
    readonly onShowOutput: () => void;
}): JSX.Element => {
    const styles = useStyles();
    return (
        <div className={styles.root}>
            {facts
                .filter((fact) => fact.message)
                .map((fact) => (
                    <StatusListDetailsMessage
                        key={fact.label}
                        severity="info"
                        severityLabel={l10n.t('Info:')}
                        title={fact.label}
                        nextStep={
                            fact.action === 'showOutput' ? (
                                <>
                                    {l10n.t('Next:')} <Link onClick={onShowOutput}>{l10n.t('View setup log')}</Link>
                                </>
                            ) : undefined
                        }
                    >
                        {fact.value}
                    </StatusListDetailsMessage>
                ))}
            <StatusListDetailsSection>
                <StatusListDetailsFacts
                    items={facts
                        .filter((fact) => !fact.message)
                        .map((fact) => ({
                            term: fact.label,
                            value: (
                                <>
                                    {fact.fullValue ? <ShortId fact={fact} /> : fact.value}
                                    {fact.action === 'showOutput' && (
                                        <>
                                            {' · '}
                                            <Link onClick={onShowOutput}>{l10n.t('View setup log')}</Link>
                                        </>
                                    )}
                                    {fact.note && (
                                        <span className={mergeClasses(mutedClassName, styles.note)}>
                                            {' · '}
                                            {fact.note}
                                        </span>
                                    )}
                                    {fact.qualification && (
                                        <span>
                                            {' · '}
                                            {fact.qualification}
                                        </span>
                                    )}
                                </>
                            ),
                        }))}
                />
            </StatusListDetailsSection>
        </div>
    );
};
