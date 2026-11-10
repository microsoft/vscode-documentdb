/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Link, makeStyles, tokens } from '@fluentui/react-components';
import {
    StatusListDetailsFacts,
    StatusListDetailsMessage,
    StatusListDetailsSection,
} from '@microsoft/vscode-ext-webview-fluentui/components';
import * as l10n from '@vscode/l10n';
import { type JSX } from 'react';
import { type StageDetailFact } from './stageDetailsPresentation';

const useStyles = makeStyles({
    root: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalM },
});

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
                                    {l10n.t('Next:')}{' '}
                                    <Link onClick={onShowOutput}>{l10n.t('View setup log')}</Link>
                                </>
                            ) : undefined
                        }
                    >
                        {fact.value}
                    </StatusListDetailsMessage>
                ))}
            <StatusListDetailsSection>
                <StatusListDetailsFacts
                    items={facts.filter((fact) => !fact.message).map((fact) => ({
                        term: fact.label,
                        value: (
                            <>
                                {fact.code ? <code>{fact.value}</code> : fact.value}
                                {fact.action === 'showOutput' && (
                                    <>
                                        {' · '}
                                        <Link onClick={onShowOutput}>{l10n.t('View setup log')}</Link>
                                    </>
                                )}
                                {fact.note && (
                                    <span className={mutedClassName}>
                                        {' · '}
                                        {fact.note}
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
